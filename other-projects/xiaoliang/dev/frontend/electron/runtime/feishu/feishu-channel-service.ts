import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import * as Lark from '@larksuiteoapi/node-sdk'
import type {
  AgentMessageRecord,
  AgentUiEvent,
  ConversationSummary,
  FeishuConnectionStatus,
  FeishuConnectionTestResult,
  FeishuDomain,
  FeishuSettingsInput,
  FeishuSettingsView,
  ImageAttachmentInput,
  ProjectSummary,
} from '../../../src/shared/local-agent'
import type { AuthSessionData } from '../../../src/shared/backend-api'
import { transcribeSpeechBuffer } from '../backend/speech-transcription'
import { getDB } from '../db'
import type {
  AgentPromptRunResult,
  AgentSessionManager,
  AgentSubagentWakeSettlement,
} from '../agent/sessions/agent-session-manager'
import type { SecretStore } from '../secrets/secret-store'
import {
  getFeishuAppSecretRef,
  getFeishuSettingsView,
} from '../settings/feishu-settings-repository'
import {
  handleFeishuSlashCommand,
  parseFeishuSlashCommand,
} from './feishu-slash-commands'
import {
  buildFeishuRouteKey,
  buildInterruptedNotice,
  buildMarkdownCardContent,
  buildPostContent,
  buildProgressCardContent,
  buildTextContent,
  chunkText,
  createRunProgress,
  extractFeishuBotInfo,
  FEISHU_SUBAGENT_TYPE_LABELS,
  pickRunReplyText,
  renderRunProgress,
  shouldUseMarkdownCard,
  type FeishuRunProgress,
} from './feishu-protocol'

const FEISHU_ROUTE_PROJECT_NAME = '飞书远程'
const FEISHU_ROUTE_PROJECT_DESCRIPTION = '飞书远程消息默认项目'
const FEISHU_STREAM_PATCH_INTERVAL_MS = 1200
const FEISHU_PROBE_TIMEOUT_MS = 10_000
const FEISHU_DEDUP_TTL_MS = 24 * 60 * 60 * 1000
const FEISHU_PROCESSING_STALE_MS = 15 * 60 * 1000
const FEISHU_INBOUND_DEBOUNCE_MS = 1200
const FEISHU_MEDIA_HTTP_TIMEOUT_MS = 120_000
const FEISHU_OUTBOUND_IMAGE_MAX_BYTES = 30 * 1024 * 1024
const FEISHU_WS_HANDSHAKE_TIMEOUT_MS = 20_000
/** Seconds, comfortably above the server's 120s ping interval. */
const FEISHU_WS_PING_TIMEOUT_SECONDS = 300
const FEISHU_TYPING_EMOJI = 'Typing'
const FEISHU_DEDUP_NAMESPACE = 'default'
const FEISHU_AUDIO_KEY_FIELDS = new Set(['file_key', 'audio_key'])

type FeishuMessageType =
  | 'text'
  | 'post'
  | 'image'
  | 'audio'
  | 'file'
  | 'media'
  | 'video'
  | 'interactive'
  | string

interface FeishuEventUserId {
  open_id?: string
  user_id?: string
  union_id?: string
}

interface FeishuMention {
  key?: string
  name?: string
  id?: FeishuEventUserId
}

interface FeishuMessageEvent {
  sender?: {
    sender_id?: FeishuEventUserId
    sender_type?: string
  }
  message?: {
    message_id?: string
    root_id?: string
    parent_id?: string
    thread_id?: string
    chat_id?: string
    chat_type?: 'p2p' | 'group' | 'private' | string
    message_type?: FeishuMessageType
    content?: string
    mentions?: FeishuMention[]
  }
}

interface FeishuResolvedInput {
  prompt: string
  images: ImageAttachmentInput[]
}

interface FeishuResolvedInputPart {
  text: string
  notes: string[]
  images: ImageAttachmentInput[]
}

interface FeishuRouteContext {
  routeKey: string
  chatId: string
  senderId: string
  rootId: string
  isGroup: boolean
  replyInThread: boolean
}

interface FeishuBindingRow {
  conversation_id: string
}

interface FeishuOutboundBindingRow {
  route_key: string
  chat_id: string
  root_id: string
}

type FeishuMessageDedupeStatus = 'processing' | 'processed' | 'failed'

interface FeishuMessageDedupeRow {
  status: FeishuMessageDedupeStatus | string
  claimed_at_ms: number
}

interface FeishuClaimedMessage {
  event: FeishuMessageEvent
  messageId: string
}

interface FeishuDebounceBucket {
  settings: FeishuSettingsView
  route: FeishuRouteContext
  entries: FeishuClaimedMessage[]
  timer: NodeJS.Timeout
}

interface FeishuRuntimeCredentials {
  appId: string
  appSecret: string
  domain: FeishuDomain
}

/** A null anchor posts into the chat instead of replying to a message. */
interface FeishuOutboundTarget {
  chatId: string
  anchorMessageId: string | null
  replyInThread: boolean
}

interface FeishuPendingRun {
  conversationId: string
  chatId: string
  sourceMessageId: string
  replyInThread: boolean
  typingReactionId: string | null
  /** The progress card being patched, and the anchor for the final answer. */
  cardMessageId: string | null
  replyMessageId: string | null
  textBuffer: string
  errorText: string | null
  outboundImages: ImageAttachmentInput[]
  allowImageReplies: boolean
  progress: FeishuRunProgress
  patchTimer: NodeJS.Timeout | null
  lastPatchAt: number
  /** Serializes card writes so a progress patch cannot overtake the final one. */
  cardWrite: Promise<void>
  finalizing: boolean
  closed: boolean
  /** Set when the channel tore down mid-run, so the turn is not claimed as done. */
  interruptedReason: string | null
}

/** Survives past a run so agent-initiated follow-ups can find their way back. */
interface FeishuOutboundRoute {
  chatId: string
  replyInThread: boolean
  anchorMessageId: string | null
}

interface FeishuChannelServiceDeps {
  agent: AgentSessionManager
  secretStore: SecretStore
  getBackendSession: () => Promise<AuthSessionData | null>
}

function nowIso() {
  return new Date().toISOString()
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeTargetId(value: string) {
  return value
    .trim()
    .replace(/^(feishu|lark):(user|open_id|union_id|chat|group|dm|channel):/i, '')
}

function normalizeTargetList(values: string[]) {
  return new Set(values.map(normalizeTargetId).filter(Boolean))
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? '').find(Boolean) ?? ''
}

function tryParseJson(raw: string | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function extractStringField(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return ''
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function collectStringFields(
  value: unknown,
  keys: Set<string>,
  out: string[] = [],
): string[] {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringFields(item, keys, out))
    return out
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof child === 'string' && child.trim()) {
      out.push(child.trim())
      continue
    }
    collectStringFields(child, keys, out)
  }
  return out
}

function collectTextFragments(value: unknown, fragments: string[] = []): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized) fragments.push(normalized)
    return fragments
  }
  if (!value || typeof value !== 'object') return fragments
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextFragments(item, fragments))
    return fragments
  }

  const record = value as Record<string, unknown>
  for (const key of ['title', 'text', 'content']) {
    collectTextFragments(record[key], fragments)
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'title' || key === 'text' || key === 'content') continue
    if (key.endsWith('_key') || key.endsWith('_id')) continue
    collectTextFragments(child, fragments)
  }
  return fragments
}

function parseMessageText(rawContent: string | undefined, messageType: FeishuMessageType) {
  const parsed = tryParseJson(rawContent)
  if (!parsed) return rawContent?.trim() ?? ''

  if (messageType === 'text') {
    return extractStringField(parsed, 'text') || '[文本消息]'
  }
  if (messageType === 'post' || messageType === 'interactive') {
    return Array.from(new Set(collectTextFragments(parsed))).join('\n').trim()
  }

  const text = extractStringField(parsed, 'text')
  if (text) return text
  const title = extractStringField(parsed, 'title')
  if (title) return title
  return ''
}

function stripMentionText(text: string, mentions: FeishuMention[] | undefined) {
  let next = text
  for (const mention of mentions ?? []) {
    for (const token of [mention.key, mention.name]) {
      if (!token) continue
      next = next.split(token).join(' ')
    }
  }
  return next.replace(/\s+/g, ' ').trim()
}

function collectImageKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return keys
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageKeys(item, keys))
    return keys
  }

  const record = value as Record<string, unknown>
  const imageKey = record.image_key
  if (typeof imageKey === 'string' && imageKey.trim()) {
    keys.add(imageKey.trim())
  }
  for (const child of Object.values(record)) {
    collectImageKeys(child, keys)
  }
  return keys
}

function shouldForwardImageReplies(prompt: string) {
  const normalized = prompt.replace(/\s+/g, '')
  if (/不(要|用|必).{0,8}(发|发送|传|返回|贴).{0,8}(图|图片|截图|图纸)/.test(normalized)) {
    return false
  }
  return (
    /(发|发送|传|返回|贴|给我|发来).{0,16}(图|图片|截图|图纸)/.test(normalized)
    || /(图|图片|截图|图纸).{0,16}(发|发送|传|返回|贴|给我|发来)/.test(normalized)
    || /当前电脑截图/.test(normalized)
  )
}

function dedupeImageAttachments(images: ImageAttachmentInput[]) {
  const seen = new Set<string>()
  const result: ImageAttachmentInput[] = []
  for (const image of images) {
    const key = `${image.mimeType}:${image.data.length}:${image.data.slice(0, 96)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(image)
  }
  return result
}

function guessImageMimeType(fileName: string | undefined, contentType: string | undefined) {
  if (contentType?.startsWith('image/')) return contentType
  const lower = fileName?.toLowerCase() ?? ''
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function guessAudioMimeType(fileName: string | undefined, contentType: string | undefined) {
  if (contentType?.startsWith('audio/')) return contentType
  const lower = fileName?.toLowerCase() ?? ''
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg'
  return 'audio/ogg'
}

function extractHeaderValue(headers: Record<string, unknown> | undefined, name: string) {
  if (!headers) return undefined
  const normalizedName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedName) continue
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string' && entry.trim())
      if (typeof first === 'string') return first.trim()
    }
  }
  return undefined
}

function decodeDispositionFileName(value: string) {
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim().replace(/^"(.*)"$/, '$1'))
    } catch {
      return utf8.trim().replace(/^"(.*)"$/, '$1')
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim()
}

function extractDownloadMetadata(response: unknown) {
  const record = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : {}
  const headers =
    (record.headers && typeof record.headers === 'object'
      ? record.headers as Record<string, unknown>
      : undefined)
    ?? (record.header && typeof record.header === 'object'
      ? record.header as Record<string, unknown>
      : undefined)
  const contentType =
    extractHeaderValue(headers, 'content-type')
    ?? (typeof record.contentType === 'string' ? record.contentType : undefined)
    ?? (typeof record.mime_type === 'string' ? record.mime_type : undefined)
  const disposition = extractHeaderValue(headers, 'content-disposition')
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {}
  const fileName =
    (disposition ? decodeDispositionFileName(disposition) : undefined)
    ?? (typeof record.file_name === 'string' ? record.file_name : undefined)
    ?? (typeof record.fileName === 'string' ? record.fileName : undefined)
    ?? (typeof data.file_name === 'string' ? data.file_name : undefined)
    ?? (typeof data.fileName === 'string' ? data.fileName : undefined)
  return { contentType, fileName }
}

async function readReadableBuffer(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function readFeishuResponseBuffer(response: unknown, errorPrefix: string) {
  if (Buffer.isBuffer(response)) return response
  if (response instanceof ArrayBuffer) return Buffer.from(response)
  if (!response || typeof response !== 'object') {
    throw new Error(`${errorPrefix}: empty response`)
  }

  const record = response as Record<string | symbol, unknown>
  const code = record.code
  if (typeof code === 'number' && code !== 0) {
    const msg = typeof record.msg === 'string' ? record.msg : `code ${code}`
    throw new Error(`${errorPrefix}: ${msg}`)
  }

  const data = record.data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)

  const responseWithStream = response as {
    getReadableStream?: () => Readable
    writeFile?: (path: string) => Promise<void>
    [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | Uint8Array | string>
  }
  if (typeof responseWithStream.getReadableStream === 'function') {
    return readReadableBuffer(responseWithStream.getReadableStream())
  }
  if (response instanceof Readable) {
    return readReadableBuffer(response)
  }
  if (typeof responseWithStream.writeFile === 'function') {
    const tempPath = path.join(os.tmpdir(), `xiaoliang-feishu-${randomUUID()}`)
    try {
      await responseWithStream.writeFile(tempPath)
      return await fs.readFile(tempPath)
    } finally {
      await fs.unlink(tempPath).catch(() => undefined)
    }
  }
  if (typeof responseWithStream[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = []
    for await (const chunk of response as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  const keys = Object.keys(response)
  throw new Error(`${errorPrefix}: unexpected response format. Keys: [${keys.join(', ')}]`)
}

function resolveLarkDomain(domain: FeishuDomain) {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

function getFeishuMessageId(response: unknown) {
  if (!response || typeof response !== 'object') return ''
  const record = response as Record<string, unknown>
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {}
  return firstNonEmpty(
    typeof data.message_id === 'string' ? data.message_id : undefined,
    typeof record.message_id === 'string' ? record.message_id : undefined,
  )
}

function getFeishuReactionId(response: unknown) {
  if (!response || typeof response !== 'object') return ''
  const record = response as Record<string, unknown>
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {}
  return firstNonEmpty(
    typeof data.reaction_id === 'string' ? data.reaction_id : undefined,
    typeof record.reaction_id === 'string' ? record.reaction_id : undefined,
  )
}

function getFeishuImageKey(response: unknown) {
  if (!response || typeof response !== 'object') return ''
  const record = response as Record<string, unknown>
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {}
  return firstNonEmpty(
    typeof data.image_key === 'string' ? data.image_key : undefined,
    typeof record.image_key === 'string' ? record.image_key : undefined,
  )
}

function assertFeishuSuccess(response: unknown, prefix: string) {
  if (!response || typeof response !== 'object') return
  const record = response as Record<string, unknown>
  if (typeof record.code === 'number' && record.code !== 0) {
    throw new Error(`${prefix}: ${typeof record.msg === 'string' ? record.msg : `code ${record.code}`}`)
  }
}

function parseFeishuEvent(raw: unknown): FeishuMessageEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as FeishuMessageEvent & { event?: FeishuMessageEvent }
  if (event.message?.message_id) return event
  if (event.event?.message?.message_id) return event.event
  return null
}

export class FeishuChannelService {
  private client: any | null = null
  private wsClient: any | null = null
  private botOpenId: string | null = null
  private botName: string | null = null
  private warnedUnknownBotIdentity = false
  private connectionGeneration = 0
  private queues = new Map<string, Promise<void>>()
  private conversationQueues = new Map<string, Promise<void>>()
  private pendingRuns = new Map<string, FeishuPendingRun>()
  private outboundRoutes = new Map<string, FeishuOutboundRoute>()
  private pendingDebounces = new Map<string, FeishuDebounceBucket>()
  private status: FeishuConnectionStatus = {
    enabled: false,
    configured: false,
    running: false,
    phase: 'stopped',
    message: '未启用',
    updatedAt: nowIso(),
    lastEventAt: null,
    error: null,
  }

  constructor(private readonly deps: FeishuChannelServiceDeps) {}

  getStatus(): FeishuConnectionStatus {
    return { ...this.status }
  }

  async startIfEnabled() {
    const settings = getFeishuSettingsView()
    if (!settings.enabled) {
      this.setStatus({
        enabled: settings.enabled,
        configured: settings.configured,
        running: false,
        phase: 'stopped',
        message: '未启用',
        error: null,
      })
      return
    }
    await this.restart()
  }

  async restart() {
    await this.stop('正在重启')
    const settings = getFeishuSettingsView()
    if (!settings.enabled) {
      this.setStatus({
        enabled: settings.enabled,
        configured: settings.configured,
        running: false,
        phase: 'stopped',
        message: '未启用',
        error: null,
      })
      return
    }
    if (!settings.configured) {
      this.setStatus({
        enabled: settings.enabled,
        configured: settings.configured,
        running: false,
        phase: 'error',
        message: '已启用，但缺少 App ID 或 App Secret。',
        error: '缺少 App ID 或 App Secret。',
      })
      return
    }

    this.setStatus({
      enabled: true,
      configured: true,
      running: false,
      phase: 'starting',
      message: '正在连接飞书 WebSocket...',
      error: null,
    })

    try {
      const credentials = await this.resolveCredentials(settings)
      this.client = this.createClient(credentials)

      const probe = await this.probeBotInfo(credentials)
      this.warnedUnknownBotIdentity = false
      if (probe.success) {
        this.botOpenId = probe.botOpenId ?? null
        this.botName = probe.botName ?? null
      } else {
        this.botOpenId = null
        this.botName = null
        console.warn('[feishu] bot info probe failed:', probe.error)
      }

      const eventDispatcher = new Lark.EventDispatcher({})
      eventDispatcher.register({
        'im.message.receive_v1': async (payload: unknown) => {
          await this.handleIncomingPayload(payload)
        },
        'im.message.message_read_v1': async () => undefined,
      })

      // A torn-down client keeps its callbacks, so late transitions from a
      // previous connection must not overwrite the current status.
      const generation = ++this.connectionGeneration
      const isCurrent = () => generation === this.connectionGeneration
      const botLabel = this.botName ? ` · ${this.botName}` : ''

      this.wsClient = new Lark.WSClient({
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        domain: resolveLarkDomain(credentials.domain),
        loggerLevel: Lark.LoggerLevel.info,
        handshakeTimeoutMs: FEISHU_WS_HANDSHAKE_TIMEOUT_MS,
        // Without a watchdog a sleeping laptop leaves a dead socket that still
        // reports connected, so nothing reconnects until the app restarts.
        wsConfig: { pingTimeout: FEISHU_WS_PING_TIMEOUT_SECONDS },
        onReady: () => {
          if (!isCurrent()) return
          this.setStatus({
            running: true,
            phase: 'running',
            message: `已连接飞书 WebSocket${botLabel}`,
            error: null,
          })
        },
        onError: (error: Error) => {
          if (!isCurrent()) return
          this.setStatus({
            running: false,
            phase: 'error',
            message: '飞书 WebSocket 连接失败。',
            error: toErrorMessage(error),
          })
        },
        onReconnecting: () => {
          if (!isCurrent()) return
          this.setStatus({
            running: false,
            phase: 'starting',
            message: '飞书 WebSocket 已断开，正在重连...',
          })
        },
        onReconnected: () => {
          if (!isCurrent()) return
          this.setStatus({
            running: true,
            phase: 'running',
            message: `已重连飞书 WebSocket${botLabel}`,
            error: null,
          })
        },
      })

      const startResult = this.wsClient.start({ eventDispatcher })
      void Promise.resolve(startResult).catch((error) => {
        if (!isCurrent()) return
        this.setStatus({
          running: false,
          phase: 'error',
          message: '飞书 WebSocket 连接失败。',
          error: toErrorMessage(error),
        })
      })
    } catch (error) {
      await this.stop('连接失败')
      this.setStatus({
        enabled: true,
        configured: settings.configured,
        running: false,
        phase: 'error',
        message: '飞书通道启动失败。',
        error: toErrorMessage(error),
      })
    }
  }

  async stop(message = '已停止') {
    this.connectionGeneration += 1
    this.clearPendingDebounces('服务停止')
    // Must run while the client is still alive: once it is torn down there is
    // no way left to tell the user their request died mid-flight.
    for (const run of this.pendingRuns.values()) {
      await this.flushInterruptedRun(run, message)
      await this.removeTypingReaction(run).catch((error) => {
        console.warn('[feishu] typing reaction cleanup failed:', toErrorMessage(error))
      })
      this.closePendingRun(run)
    }
    this.pendingRuns.clear()
    this.outboundRoutes.clear()
    this.queues.clear()
    try {
      await Promise.resolve(this.wsClient?.close?.())
    } catch (error) {
      console.warn('[feishu] close ws failed:', toErrorMessage(error))
    }
    this.wsClient = null
    this.client = null
    this.botOpenId = null
    this.botName = null
    const settings = getFeishuSettingsView()
    this.setStatus({
      enabled: settings.enabled,
      configured: settings.configured,
      running: false,
      phase: 'stopped',
      message,
      error: null,
    })
  }

  dispose() {
    this.connectionGeneration += 1
    this.clearPendingDebounces('服务销毁')
    for (const run of this.pendingRuns.values()) {
      // Teardown is synchronous here, so the outbound notice usually loses the
      // race with the client going away. Marking the run interrupted still
      // matters: it keeps the message out of the processed set so a resend works.
      void this.flushInterruptedRun(run, '客户端已退出')
      void this.removeTypingReaction(run).catch((error) => {
        console.warn('[feishu] typing reaction cleanup failed:', toErrorMessage(error))
      })
      this.closePendingRun(run)
    }
    this.pendingRuns.clear()
    this.outboundRoutes.clear()
    this.queues.clear()
    void Promise.resolve(this.wsClient?.close?.()).catch((error) => {
      console.warn('[feishu] close ws failed:', toErrorMessage(error))
    })
    this.wsClient = null
    this.client = null
    this.botOpenId = null
    this.botName = null
    this.setStatus({
      running: false,
      phase: 'stopped',
      message: '已停止',
      error: null,
    })
  }

  async testConnection(input?: FeishuSettingsInput): Promise<FeishuConnectionTestResult> {
    const settings = getFeishuSettingsView()
    const appId = typeof input?.appId === 'string' ? input.appId.trim() : settings.appId
    const domain = input?.domain === 'lark' ? 'lark' : settings.domain
    const appSecret =
      typeof input?.appSecret === 'string' && input.appSecret.trim()
        ? input.appSecret.trim()
        : await this.deps.secretStore.getSecret(getFeishuAppSecretRef())

    const startedAt = Date.now()
    if (!appId || !appSecret) {
      return {
        success: false,
        latencyMs: 0,
        appId,
        error: '缺少 App ID 或 App Secret。',
      }
    }

    return this.probeBotInfo({ appId, appSecret, domain }, Date.now() - startedAt)
  }

  handleAgentEvent(event: AgentUiEvent) {
    const run = this.pendingRuns.get(event.conversationId)
    if (!run || run.closed) return

    switch (event.type) {
      case 'message_delta':
        if (event.kind === 'text') {
          run.textBuffer += event.delta
          run.progress.answering = true
        } else {
          run.progress.thinking = true
        }
        break
      case 'tool_start':
        run.progress.activeTools.set(event.toolCallId, event.toolName)
        break
      case 'tool_end':
        run.progress.activeTools.delete(event.toolCallId)
        run.progress.finishedTools += 1
        run.progress.lastFinishedTool = event.toolName
        run.progress.answering = false
        if (run.allowImageReplies && event.attachments?.length) {
          run.outboundImages.push(...event.attachments)
        }
        break
      case 'subagent_run':
        for (const update of event.updates ?? [event.update]) {
          run.progress.subagents.set(update.childRunId, {
            label: FEISHU_SUBAGENT_TYPE_LABELS[update.type] ?? update.type,
            status: update.status,
          })
        }
        break
      case 'compaction_update':
        run.progress.compaction = event.compaction.phase === 'running'
          ? '正在压缩上下文'
          : ''
        break
      case 'retry_update':
        run.progress.retry = event.retry.phase === 'waiting' || event.retry.phase === 'running'
          ? `正在重试（第 ${event.retry.attempt ?? 1} 次${
            event.retry.maxAttempts ? ` / ${event.retry.maxAttempts}` : ''
          }）`
          : ''
        break
      case 'error':
        run.errorText = event.error
        return
      default:
        return
    }

    this.scheduleProgressPatch(run)
  }

  /** A wake follow-up may only reuse a conversation previously bound to Feishu. */
  handleSubagentWakeSettled(settlement: AgentSubagentWakeSettlement) {
    if (!getFeishuSettingsView().enabled) return
    const route = this.resolveOutboundRoute(settlement.conversationId)
    if (!route) return

    void this.enqueueConversation(settlement.conversationId, async () => {
      if (!this.client) {
        throw new Error('飞书客户端尚未连接。')
      }

      let runAssistantText = ''
      if (!settlement.finalAnswer?.trim()) {
        try {
          runAssistantText = await this.getRunAssistantText(
            settlement.conversationId,
            settlement.clientRunId,
          )
        } catch (error) {
          console.warn('[feishu] wake transcript read failed:', toErrorMessage(error))
        }
      }
      const text = pickRunReplyText({
        finalAnswer: settlement.finalAnswer,
        runAssistantText,
        textBuffer: '',
        errorText: settlement.errorText,
        status: settlement.status,
      })
      const target: FeishuOutboundTarget = {
        chatId: route.chatId,
        anchorMessageId: route.anchorMessageId,
        replyInThread: route.replyInThread,
      }
      for (const chunk of chunkText(text)) {
        await this.sendText(target, chunk)
      }
    }).catch((error) => {
      console.warn('[feishu] subagent wake reply failed:', toErrorMessage(error))
    })
  }

  private createPendingRun(input: {
    conversationId: string
    chatId: string
    sourceMessageId: string
    replyInThread: boolean
    allowImageReplies: boolean
  }): FeishuPendingRun {
    if (this.pendingRuns.has(input.conversationId)) {
      throw new Error('飞书会话内部串行约束被破坏：同一会话已有请求在处理。')
    }

    const run: FeishuPendingRun = {
      conversationId: input.conversationId,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId,
      replyInThread: input.replyInThread,
      typingReactionId: null,
      cardMessageId: null,
      replyMessageId: null,
      textBuffer: '',
      errorText: null,
      outboundImages: [],
      allowImageReplies: input.allowImageReplies,
      progress: createRunProgress(),
      patchTimer: null,
      lastPatchAt: 0,
      cardWrite: Promise.resolve(),
      finalizing: false,
      closed: false,
      interruptedReason: null,
    }
    this.pendingRuns.set(input.conversationId, run)
    this.outboundRoutes.set(input.conversationId, {
      chatId: input.chatId,
      replyInThread: input.replyInThread,
      anchorMessageId: input.sourceMessageId,
    })
    return run
  }

  private setStatus(update: Partial<FeishuConnectionStatus>) {
    this.status = {
      ...this.status,
      ...update,
      updatedAt: nowIso(),
    }
  }

  private async resolveCredentials(settings: FeishuSettingsView): Promise<FeishuRuntimeCredentials> {
    const appSecret = await this.deps.secretStore.getSecret(getFeishuAppSecretRef())
    if (!settings.appId || !appSecret) {
      throw new Error('缺少 App ID 或 App Secret。')
    }
    return {
      appId: settings.appId,
      appSecret,
      domain: settings.domain,
    }
  }

  private createClient(credentials: FeishuRuntimeCredentials) {
    return new Lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: resolveLarkDomain(credentials.domain),
    })
  }

  private async probeBotInfo(
    credentials: FeishuRuntimeCredentials,
    elapsedOffsetMs = 0,
  ): Promise<FeishuConnectionTestResult> {
    const startedAt = Date.now()
    const client = this.createClient(credentials) as {
      request(params: {
        method: 'GET'
        url: string
        timeout: number
      }): Promise<unknown>
    }
    try {
      const response = await client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
        timeout: FEISHU_PROBE_TIMEOUT_MS,
      })
      const bot = extractFeishuBotInfo(response)
      if (bot.code !== undefined && bot.code !== 0) {
        return {
          success: false,
          latencyMs: Date.now() - startedAt + elapsedOffsetMs,
          appId: credentials.appId,
          error: bot.msg || `code ${bot.code}`,
        }
      }
      return {
        success: true,
        latencyMs: Date.now() - startedAt + elapsedOffsetMs,
        appId: credentials.appId,
        botName: bot.appName || null,
        botOpenId: bot.openId || null,
      }
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt + elapsedOffsetMs,
        appId: credentials.appId,
        error: toErrorMessage(error),
      }
    }
  }

  private async handleIncomingPayload(payload: unknown) {
    // A closed connection keeps its dispatcher bindings, and there is no client
    // left to answer with, so late events must not be claimed.
    if (!this.client) return

    const event = parseFeishuEvent(payload)
    const messageId = event?.message?.message_id?.trim()
    if (!event || !messageId) return

    // Receiving anything proves the socket is live, which also repairs the
    // status if the ready callback was missed.
    this.setStatus({
      lastEventAt: nowIso(),
      running: true,
      phase: 'running',
      message: '已收到飞书消息。',
      error: null,
    })

    const settings = getFeishuSettingsView()
    const route = this.buildRouteContext(event, settings)
    if (!route) return
    if (!this.shouldAcceptMessage(event, settings, route)) return

    const claim = this.claimMessage(messageId, route.routeKey)
    if (claim !== 'claimed') {
      return
    }

    const entry = { event, messageId }
    if (this.isSlashCommandEvent(event)) {
      void this.enqueue(route.routeKey, async () => {
        await this.processClaimedMessages([entry], settings, route)
      })
      return
    }

    this.debounceIncomingMessage(entry, settings, route)
  }

  private claimMessage(messageId: string, routeKey: string): 'claimed' | 'duplicate' | 'inflight' {
    const normalizedMessageId = messageId.trim()
    if (!normalizedMessageId) return 'duplicate'

    const db = getDB()
    const now = Date.now()
    db
      .prepare(
        `DELETE FROM feishu_message_dedup
          WHERE namespace = ?
            AND (
              (status = 'processed' AND completed_at_ms > 0 AND completed_at_ms < ?)
              OR (status <> 'processed' AND claimed_at_ms > 0 AND claimed_at_ms < ?)
            )`,
      )
      .run(
        FEISHU_DEDUP_NAMESPACE,
        now - FEISHU_DEDUP_TTL_MS,
        now - FEISHU_DEDUP_TTL_MS,
      )

    const row = db
      .prepare(
        `SELECT status, claimed_at_ms
           FROM feishu_message_dedup
          WHERE namespace = ? AND message_id = ?`,
      )
      .get(FEISHU_DEDUP_NAMESPACE, normalizedMessageId) as FeishuMessageDedupeRow | undefined

    if (row?.status === 'processed') {
      return 'duplicate'
    }
    if (
      row?.status === 'processing'
      && Number(row.claimed_at_ms) > now - FEISHU_PROCESSING_STALE_MS
    ) {
      return 'inflight'
    }

    db
      .prepare(
        `INSERT INTO feishu_message_dedup (
           namespace, message_id, status, route_key, error, claimed_at_ms, completed_at_ms, updated_at
         ) VALUES (?, ?, 'processing', ?, '', ?, 0, datetime('now','localtime'))
         ON CONFLICT(namespace, message_id) DO UPDATE SET
           status = 'processing',
           route_key = excluded.route_key,
           error = '',
           claimed_at_ms = excluded.claimed_at_ms,
           completed_at_ms = 0,
           updated_at = datetime('now','localtime')`,
      )
      .run(FEISHU_DEDUP_NAMESPACE, normalizedMessageId, routeKey, now)
    return 'claimed'
  }

  private finalizeMessages(messageIds: string[]) {
    const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)))
    if (uniqueIds.length === 0) return
    const now = Date.now()
    const update = getDB().prepare(
      `UPDATE feishu_message_dedup
          SET status = 'processed',
              error = '',
              completed_at_ms = ?,
              updated_at = datetime('now','localtime')
        WHERE namespace = ? AND message_id = ?`,
    )
    const transaction = getDB().transaction(() => {
      for (const messageId of uniqueIds) {
        update.run(now, FEISHU_DEDUP_NAMESPACE, messageId)
      }
    })
    transaction()
  }

  private releaseMessages(messageIds: string[], reason: string) {
    const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)))
    if (uniqueIds.length === 0) return
    const update = getDB().prepare(
      `UPDATE feishu_message_dedup
          SET status = 'failed',
              error = ?,
              updated_at = datetime('now','localtime')
        WHERE namespace = ? AND message_id = ?`,
    )
    const transaction = getDB().transaction(() => {
      for (const messageId of uniqueIds) {
        update.run(reason.slice(0, 500), FEISHU_DEDUP_NAMESPACE, messageId)
      }
    })
    transaction()
  }

  private clearPendingDebounces(reason: string) {
    for (const [key, bucket] of this.pendingDebounces.entries()) {
      clearTimeout(bucket.timer)
      this.releaseMessages(bucket.entries.map((entry) => entry.messageId), reason)
      this.pendingDebounces.delete(key)
    }
  }

  private debounceIncomingMessage(
    entry: FeishuClaimedMessage,
    settings: FeishuSettingsView,
    route: FeishuRouteContext,
  ) {
    const existing = this.pendingDebounces.get(route.routeKey)
    if (existing) {
      existing.entries.push(entry)
      existing.settings = settings
      existing.route = route
      clearTimeout(existing.timer)
      existing.timer = setTimeout(
        () => this.flushDebouncedMessages(route.routeKey),
        FEISHU_INBOUND_DEBOUNCE_MS,
      )
      return
    }

    const bucket: FeishuDebounceBucket = {
      settings,
      route,
      entries: [entry],
      timer: setTimeout(
        () => this.flushDebouncedMessages(route.routeKey),
        FEISHU_INBOUND_DEBOUNCE_MS,
      ),
    }
    this.pendingDebounces.set(route.routeKey, bucket)
  }

  private flushDebouncedMessages(routeKey: string) {
    const bucket = this.pendingDebounces.get(routeKey)
    if (!bucket) return
    this.pendingDebounces.delete(routeKey)
    clearTimeout(bucket.timer)

    void this.enqueue(routeKey, async () => {
      await this.processClaimedMessages(bucket.entries, bucket.settings, bucket.route)
    })
  }

  private buildRouteContext(
    event: FeishuMessageEvent,
    settings: FeishuSettingsView,
  ): FeishuRouteContext | null {
    const message = event.message
    if (!message) return null

    const chatId = message.chat_id?.trim() ?? ''
    const messageId = message.message_id?.trim() ?? ''
    const senderId = firstNonEmpty(
      event.sender?.sender_id?.open_id,
      event.sender?.sender_id?.union_id,
      event.sender?.sender_id?.user_id,
    )
    if (!messageId || !chatId) return null

    const isGroup = message.chat_type !== 'p2p'
    // Never fall back to the message id: that would mint one session per
    // message in ordinary groups and throw away the whole conversation.
    const rootId = firstNonEmpty(message.root_id, message.thread_id, message.parent_id)
    const routeKey = buildFeishuRouteKey({
      isGroup,
      chatId,
      senderId,
      rootId,
      groupSessionScope: settings.groupSessionScope,
    })

    return {
      routeKey,
      chatId,
      senderId,
      rootId,
      isGroup,
      replyInThread: isGroup,
    }
  }

  private shouldAcceptMessage(
    event: FeishuMessageEvent,
    settings: FeishuSettingsView,
    route: FeishuRouteContext,
  ) {
    if (event.sender?.sender_type === 'bot') return false

    const senderIds = [
      event.sender?.sender_id?.open_id,
      event.sender?.sender_id?.union_id,
      event.sender?.sender_id?.user_id,
    ].map((value) => normalizeTargetId(value ?? '')).filter(Boolean)

    const allowedUsers = normalizeTargetList(settings.allowFrom)
    if (allowedUsers.size > 0 && !senderIds.some((id) => allowedUsers.has(id))) {
      return false
    }

    if (route.isGroup) {
      const allowedGroups = normalizeTargetList(settings.groupAllowFrom)
      if (allowedGroups.size > 0 && !allowedGroups.has(normalizeTargetId(route.chatId))) {
        return false
      }
      if (settings.requireMention && !this.isMentioned(event.message?.mentions)) {
        return false
      }
    }

    return true
  }

  private isMentioned(mentions: FeishuMention[] | undefined) {
    if (!mentions || mentions.length === 0) return false

    const botOpenId = this.botOpenId
    if (botOpenId) {
      return mentions.some((mention) => {
        const ids = [
          mention.id?.open_id,
          mention.id?.union_id,
          mention.id?.user_id,
        ].map((value) => value?.trim()).filter((value): value is string => Boolean(value))
        return ids.includes(botOpenId)
      })
    }

    // The identity probe failed. Matching the display name is still far better
    // than treating every mention in the group as one of ours.
    const botName = this.botName?.trim()
    if (botName) {
      return mentions.some((mention) => mention.name?.trim() === botName)
    }

    if (!this.warnedUnknownBotIdentity) {
      this.warnedUnknownBotIdentity = true
      console.warn('[feishu] bot identity unknown; treating any group mention as addressed to us')
    }
    return true
  }

  private isSlashCommandEvent(event: FeishuMessageEvent) {
    return parseFeishuSlashCommand(this.resolveMessageText(event)) !== null
  }

  private async processClaimedMessages(
    entries: FeishuClaimedMessage[],
    settings: FeishuSettingsView,
    route: FeishuRouteContext,
  ) {
    const messageIds = entries.map((entry) => entry.messageId)
    try {
      if (entries.length === 1 && await this.tryHandleSlashCommand(entries[0].event, route)) {
        this.finalizeMessages(messageIds)
        return
      }

      await this.processIncomingMessages(entries, route)
      this.finalizeMessages(messageIds)
    } catch (error) {
      this.releaseMessages(messageIds, toErrorMessage(error))
      throw error
    }
  }

  private async processIncomingMessages(
    entries: FeishuClaimedMessage[],
    route: FeishuRouteContext,
  ) {
    const lastEntry = entries[entries.length - 1]
    const messageId = lastEntry?.messageId
    if (!messageId) return

    const conversationId = (await this.resolveConversation(route)).id
    const input = await this.resolveBatchInput(entries.map((entry) => entry.event))
    await this.enqueueConversation(conversationId, () => (
      this.processConversationTurn(conversationId, messageId, input, route)
    ))
  }

  private async processConversationTurn(
    conversationId: string,
    messageId: string,
    input: FeishuResolvedInput,
    route: FeishuRouteContext,
  ) {
    if (!this.client) {
      throw new Error('飞书客户端尚未连接。')
    }
    const run = this.createPendingRun({
      conversationId,
      chatId: route.chatId,
      sourceMessageId: messageId,
      replyInThread: route.replyInThread,
      allowImageReplies: shouldForwardImageReplies(input.prompt),
    })

    try {
      run.typingReactionId = await this.addTypingReaction(messageId)
      run.cardMessageId = await this.startProgressCard(run)
      const result = await this.deps.agent.sendPromptWhenIdle(
        conversationId,
        input.prompt,
        input.images,
      )
      if (run.interruptedReason) {
        throw new Error(`飞书通道已中断本轮：${run.interruptedReason}`)
      }
      await this.publishFinal(run, await this.resolveRunReplyText(run, result))
    } catch (error) {
      // A torn-down run already published its notice. Let this propagate so the
      // caller releases the dedup rows instead of marking them processed.
      if (run.interruptedReason) {
        throw error
      }
      const errorText = run.errorText || toErrorMessage(error)
      let published = false
      await this.publishFinal(run, `处理失败：${errorText}`).then(() => {
        published = true
      }).catch((publishError) => {
        console.warn('[feishu] error reply failed:', toErrorMessage(publishError))
      })
      if (!published) {
        throw error
      }
    } finally {
      await this.removeTypingReaction(run).catch((error) => {
        console.warn('[feishu] typing reaction cleanup failed:', toErrorMessage(error))
      })
      this.closePendingRun(run)
      if (this.pendingRuns.get(conversationId) === run) {
        this.pendingRuns.delete(conversationId)
      }
    }
  }

  private async tryHandleSlashCommand(
    event: FeishuMessageEvent,
    route: FeishuRouteContext,
  ) {
    const messageId = event.message?.message_id?.trim()
    if (!messageId) return false

    const command = parseFeishuSlashCommand(this.resolveMessageText(event))
    if (!command) return false

    const target: FeishuOutboundTarget = {
      chatId: route.chatId,
      anchorMessageId: messageId,
      replyInThread: route.replyInThread,
    }
    try {
      const text = await handleFeishuSlashCommand(command, {
        getStatus: () => this.getStatus(),
        getCurrentConversation: () => this.getBoundConversation(route.routeKey),
        createConversationInProject: async (projectId) =>
          this.deps.agent.createConversationInProject(
            projectId,
            this.buildConversationTitle(route),
            'feishu',
          ),
        bindConversation: (conversation) => this.bindConversation(route, conversation),
        resetConversation: (conversationId) => this.deps.agent.resetConversation(conversationId),
        setConversationThinkingMode: (conversationId, mode) => (
          this.deps.agent.setConversationThinkingMode(conversationId, mode)
        ),
        listProjects: () => this.deps.agent.listProjects(),
        getDefaultProject: () => this.resolveFallbackProject(),
      })
      await this.sendText(target, text)
    } catch (error) {
      await this.sendText(target, `命令处理失败：${toErrorMessage(error)}`).catch((replyError) => {
        console.warn('[feishu] slash command error reply failed:', toErrorMessage(replyError))
      })
    }
    return true
  }

  private resolveMessageText(event: FeishuMessageEvent) {
    const message = event.message
    const messageType = message?.message_type ?? 'text'
    const rawText = parseMessageText(message?.content, messageType)
    return stripMentionText(rawText, message?.mentions)
  }

  private getBoundConversation(routeKey: string): ConversationSummary | null {
    const row = getDB()
      .prepare('SELECT conversation_id FROM feishu_conversation_bindings WHERE route_key = ?')
      .get(routeKey) as FeishuBindingRow | undefined
    if (!row?.conversation_id) return null
    return this.deps.agent.listConversations().find((conversation) => (
      conversation.id === row.conversation_id
    )) ?? null
  }

  private resolveOutboundRoute(conversationId: string): FeishuOutboundRoute | null {
    const live = this.outboundRoutes.get(conversationId)
    if (live) return live

    try {
      const row = getDB()
        .prepare(
          `SELECT route_key, chat_id, root_id
             FROM feishu_conversation_bindings
            WHERE conversation_id = ?
            ORDER BY updated_at DESC, rowid DESC
            LIMIT 1`,
        )
        .get(conversationId) as FeishuOutboundBindingRow | undefined
      const routeKey = row?.route_key?.trim() || ''
      const chatId = row?.chat_id?.trim() || ''
      if (!routeKey || !chatId) return null
      const isGroup = routeKey.startsWith('group:')
      const isTopicScoped = routeKey.includes(':topic:')
      const rootId = row?.root_id?.trim() || ''
      return {
        chatId,
        replyInThread: isGroup,
        anchorMessageId: isTopicScoped && rootId ? rootId : null,
      }
    } catch (error) {
      console.warn('[feishu] outbound route lookup failed:', toErrorMessage(error))
      return null
    }
  }

  private async resolveConversation(route: FeishuRouteContext): Promise<ConversationSummary> {
    const row = getDB()
      .prepare('SELECT conversation_id FROM feishu_conversation_bindings WHERE route_key = ?')
      .get(route.routeKey) as FeishuBindingRow | undefined

    if (row?.conversation_id) {
      const conversation = this.deps.agent.listConversations().find((candidate) => (
        candidate.id === row.conversation_id
      ))
      if (conversation) {
        getDB()
          .prepare(
            `UPDATE feishu_conversation_bindings
                SET updated_at = datetime('now','localtime')
              WHERE route_key = ?`,
          )
          .run(route.routeKey)
        return conversation
      }
    }

    const project = this.resolveFallbackProject()
    const conversation = await this.deps.agent.createConversationInProject(
      project.id,
      this.buildConversationTitle(route),
      'feishu',
    )

    this.bindConversation(route, conversation)
    return conversation
  }

  private bindConversation(route: FeishuRouteContext, conversation: ConversationSummary) {
    getDB()
      .prepare(
        `INSERT INTO feishu_conversation_bindings (
          route_key, conversation_id, chat_id, sender_id, root_id, project_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
        ON CONFLICT(route_key) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          chat_id = excluded.chat_id,
          sender_id = excluded.sender_id,
          root_id = excluded.root_id,
          project_id = excluded.project_id,
          updated_at = datetime('now','localtime')`,
      )
      .run(
        route.routeKey,
        conversation.id,
        route.chatId,
        route.senderId,
        route.rootId,
        conversation.projectId,
      )
  }

  private resolveFallbackProject(): ProjectSummary {
    const projects = this.deps.agent.listProjects()
    const existing = projects.find((project) => project.name === FEISHU_ROUTE_PROJECT_NAME)
    if (existing) return existing

    return this.deps.agent.createProject(FEISHU_ROUTE_PROJECT_NAME, FEISHU_ROUTE_PROJECT_DESCRIPTION)
  }

  private buildConversationTitle(route: FeishuRouteContext) {
    if (route.isGroup) {
      return `飞书群 ${route.chatId.slice(0, 10)}`
    }
    return `飞书私聊 ${route.senderId.slice(0, 10) || route.chatId.slice(0, 10)}`
  }

  private async resolveBatchInput(events: FeishuMessageEvent[]): Promise<FeishuResolvedInput> {
    if (events.length <= 1) {
      return this.resolveInput(events[0])
    }

    const images: ImageAttachmentInput[] = []
    const messageParts: string[] = []
    for (const [index, event] of events.entries()) {
      const part = await this.resolveInputPart(event)
      images.push(...part.images)
      const body = [
        part.text,
        ...part.notes,
        part.images.length > 0 ? `[图片 ${part.images.length} 张]` : '',
      ].filter((item) => item.trim()).join('\n\n')
      if (body.trim()) {
        messageParts.push(`消息 ${index + 1}：\n${body}`)
      }
    }

    const promptParts = [
      '[来自飞书远程消息]',
      `以下 ${events.length} 条飞书消息在短时间内连续发送，已合并为同一轮请求。`,
      ...messageParts,
      images.length > 0 && messageParts.length === 0 ? '请根据图片内容处理用户请求。' : '',
    ].filter((part) => typeof part === 'string' && part.trim())

    return {
      prompt: promptParts.join('\n\n'),
      images,
    }
  }

  private async resolveInput(event: FeishuMessageEvent): Promise<FeishuResolvedInput> {
    const part = await this.resolveInputPart(event)
    const promptParts = [
      '[来自飞书远程消息]',
      part.text,
      ...part.notes,
      part.images.length > 0 && !part.text ? '请根据图片内容处理用户请求。' : '',
    ].filter((item) => typeof item === 'string' && item.trim())

    return {
      prompt: promptParts.join('\n\n'),
      images: part.images,
    }
  }

  private async resolveInputPart(event: FeishuMessageEvent): Promise<FeishuResolvedInputPart> {
    const message = event.message
    const messageType = message?.message_type ?? 'text'
    const parsed = tryParseJson(message?.content)
    const rawText = parseMessageText(message?.content, messageType)
    const text = stripMentionText(rawText, message?.mentions)
    const images: ImageAttachmentInput[] = []
    const notes: string[] = []

    if (messageType === 'image') {
      const imageKey = extractStringField(parsed, 'image_key')
      if (imageKey && message?.message_id) {
        const resource = await this.downloadMessageResource(message.message_id, imageKey, 'image')
        images.push({
          id: randomUUID(),
          data: resource.buffer.toString('base64'),
          mimeType: guessImageMimeType(resource.fileName, resource.contentType),
          name: resource.fileName || `feishu-${imageKey}.png`,
        })
      }
    } else if (messageType === 'post') {
      const imageKeys = Array.from(collectImageKeys(parsed))
      for (const imageKey of imageKeys) {
        if (!message?.message_id) continue
        const resource = await this.downloadMessageResource(message.message_id, imageKey, 'image')
        images.push({
          id: randomUUID(),
          data: resource.buffer.toString('base64'),
          mimeType: guessImageMimeType(resource.fileName, resource.contentType),
          name: resource.fileName || `feishu-${imageKey}.png`,
        })
      }
    } else if (messageType === 'audio' || messageType === 'file' || messageType === 'media') {
      const fileKey = messageType === 'audio'
        ? firstNonEmpty(...collectStringFields(parsed, FEISHU_AUDIO_KEY_FIELDS))
        : extractStringField(parsed, 'file_key')
      const fileName =
        extractStringField(parsed, 'file_name')
        || extractStringField(parsed, 'name')
        || `feishu-${messageType}`
      if (messageType === 'audio') {
        if (!fileKey || !message?.message_id) {
          notes.push('[收到飞书语音，但消息里没有可下载的 file_key，无法转写。]')
        } else {
          try {
            const resource = await this.downloadMessageResource(message.message_id, fileKey, 'file')
            const transcription = await this.transcribeAudio(
              resource.buffer,
              guessAudioMimeType(resource.fileName || fileName, resource.contentType),
              resource.fileName || `${fileName}.ogg`,
            )
            notes.push(`[飞书语音转写]\n${transcription}`)
          } catch (error) {
            notes.push(`[收到飞书语音，但转写失败：${toErrorMessage(error)}]`)
          }
        }
      } else if (fileKey && message?.message_id) {
        try {
          const resource = await this.downloadMessageResource(message.message_id, fileKey, 'file')
          notes.push(`[收到飞书文件：${resource.fileName || fileName}，当前仅将文件名作为上下文。]`)
        } catch (error) {
          notes.push(`[收到飞书文件：${fileName}，但下载失败：${toErrorMessage(error)}]`)
        }
      }
    }

    return {
      text,
      notes,
      images,
    }
  }

  private async downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
  ): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
    if (!this.client) {
      throw new Error('飞书客户端尚未连接。')
    }

    const mediaClient = this.client as {
      im: {
        messageResource: {
          get(params: {
            path: { message_id: string; file_key: string }
            params: { type: 'image' | 'file' }
          }): Promise<unknown>
        }
      }
    }
    const response = await mediaClient.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })
    const buffer = await readFeishuResponseBuffer(
      response,
      '飞书消息资源下载失败',
    )
    return { buffer, ...extractDownloadMetadata(response) }
  }

  private async transcribeAudio(buffer: Buffer, mimeType: string, fileName: string) {
    const result = await transcribeSpeechBuffer({
      buffer,
      mimeType,
      fileName,
      getBackendSession: this.deps.getBackendSession,
    })
    return result.text.trim()
  }

  private scheduleProgressPatch(run: FeishuPendingRun) {
    if (!run.cardMessageId || run.patchTimer || run.closed) return
    const elapsed = Date.now() - run.lastPatchAt
    const delay = elapsed >= FEISHU_STREAM_PATCH_INTERVAL_MS
      ? 0
      : FEISHU_STREAM_PATCH_INTERVAL_MS - elapsed
    run.patchTimer = setTimeout(() => {
      run.patchTimer = null
      void this.patchProgressCard(run).catch((error) => {
        console.warn('[feishu] progress patch failed:', toErrorMessage(error))
      })
    }, delay)
  }

  private async patchProgressCard(run: FeishuPendingRun) {
    const messageId = run.cardMessageId
    if (!messageId || run.closed || run.finalizing) return
    run.lastPatchAt = Date.now()
    const content = buildProgressCardContent(renderRunProgress(run.progress))
    await this.enqueueCardWrite(run, () => this.patchCard(messageId, content))
  }

  /**
   * Card updates must land in order. A progress patch that overtakes the final
   * one would leave the card stuck on "处理中" with the answer nowhere to be seen.
   */
  private enqueueCardWrite(run: FeishuPendingRun, write: () => Promise<void>) {
    const next = run.cardWrite.then(write, write)
    run.cardWrite = next.then(() => undefined, () => undefined)
    return next
  }

  private async startProgressCard(run: FeishuPendingRun) {
    try {
      const messageId = await this.sendRawMessage(
        this.resolveOutboundTarget(run),
        buildProgressCardContent(renderRunProgress(run.progress)),
        'interactive',
      )
      run.lastPatchAt = Date.now()
      return messageId || null
    } catch (error) {
      // Degrades to a single final reply rather than failing the turn.
      console.warn('[feishu] progress card create failed:', toErrorMessage(error))
      return null
    }
  }

  /** Teardown must publish while the outbound client is still available. */
  private async flushInterruptedRun(run: FeishuPendingRun, reason: string) {
    if (run.interruptedReason) return
    run.interruptedReason = reason

    const text = buildInterruptedNotice(run.textBuffer, reason)
    await this.publishFinal(run, text, { force: true }).catch((error) => {
      console.warn('[feishu] interrupted flush failed:', toErrorMessage(error))
    })
  }

  private async publishFinal(
    run: FeishuPendingRun,
    text: string,
    options: { force?: boolean } = {},
  ) {
    if (run.closed && !options.force) return
    run.finalizing = true
    if (run.patchTimer) {
      clearTimeout(run.patchTimer)
      run.patchTimer = null
    }

    const chunks = chunkText(text || '已完成。')
    if (chunks.length === 0) return

    // Settling the progress card in place keeps one turn to one message.
    const cardMessageId = run.cardMessageId
    if (cardMessageId) {
      try {
        await this.enqueueCardWrite(run, () => (
          this.patchCard(cardMessageId, buildMarkdownCardContent(chunks[0]))
        ))
        run.replyMessageId = cardMessageId
      } catch (error) {
        console.warn('[feishu] final card patch failed, falling back to reply:', toErrorMessage(error))
        run.cardMessageId = null
        run.replyMessageId = await this.sendText(this.resolveOutboundTarget(run), chunks[0])
      }
    } else {
      run.replyMessageId = await this.sendText(this.resolveOutboundTarget(run), chunks[0])
    }

    for (const chunk of chunks.slice(1)) {
      await this.sendText(this.resolveOutboundTarget(run, run.replyMessageId), chunk)
    }

    if (run.allowImageReplies && run.outboundImages.length > 0) {
      const target = this.resolveOutboundTarget(run, run.replyMessageId)
      for (const image of dedupeImageAttachments(run.outboundImages)) {
        await this.sendImage(target, image).catch(async (error) => {
          console.warn('[feishu] image reply failed:', toErrorMessage(error))
          await this.sendText(target, `图片发送失败：${toErrorMessage(error)}`).catch((replyError) => {
            console.warn('[feishu] image failure notice failed:', toErrorMessage(replyError))
          })
        })
      }
    }
  }

  /** Follow-up chunks anchor on what was just sent so they stay in order. */
  private resolveOutboundTarget(
    run: FeishuPendingRun,
    anchorMessageId: string | null = run.sourceMessageId,
  ): FeishuOutboundTarget {
    return {
      chatId: run.chatId,
      anchorMessageId,
      replyInThread: run.replyInThread,
    }
  }

  private closePendingRun(run: FeishuPendingRun) {
    run.closed = true
    if (run.patchTimer) {
      clearTimeout(run.patchTimer)
      run.patchTimer = null
    }
  }

  private async sendText(target: FeishuOutboundTarget, text: string) {
    try {
      return await this.sendTextTo(target, text)
    } catch (error) {
      if (!target.anchorMessageId) throw error
      // The anchor can be gone by now (recalled or deleted). Posting into the
      // chat is better than dropping the answer.
      console.warn('[feishu] reply failed, posting to chat instead:', toErrorMessage(error))
      return await this.sendTextTo({ ...target, anchorMessageId: null }, text)
    }
  }

  private async sendTextTo(target: FeishuOutboundTarget, text: string) {
    if (shouldUseMarkdownCard(text)) {
      try {
        return await this.sendRawMessage(target, buildMarkdownCardContent(text), 'interactive')
      } catch (error) {
        console.warn('[feishu] card reply failed, falling back to post:', toErrorMessage(error))
      }
    }

    try {
      return await this.sendRawMessage(target, buildPostContent(text), 'post')
    } catch (error) {
      console.warn('[feishu] post reply failed, falling back to text:', toErrorMessage(error))
      return await this.sendRawMessage(target, buildTextContent(text), 'text')
    }
  }

  private async sendRawMessage(
    target: FeishuOutboundTarget,
    content: string,
    msgType: 'text' | 'post' | 'interactive' | 'image',
  ) {
    if (!this.client) {
      throw new Error('飞书客户端尚未连接。')
    }

    if (!target.anchorMessageId) {
      if (!target.chatId) {
        throw new Error('飞书消息发送失败：缺少会话标识。')
      }
      const created = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: target.chatId,
          content,
          msg_type: msgType,
        },
      })
      assertFeishuSuccess(created, '飞书消息发送失败')
      return getFeishuMessageId(created)
    }

    const response = await this.client.im.message.reply({
      path: { message_id: target.anchorMessageId },
      data: {
        content,
        msg_type: msgType,
        ...(target.replyInThread ? { reply_in_thread: true } : {}),
      },
    })
    assertFeishuSuccess(response, '飞书消息回复失败')
    return getFeishuMessageId(response)
  }

  /** `im.message.patch` only updates interactive messages, so content is a card. */
  private async patchCard(messageId: string, cardContent: string) {
    if (!this.client) {
      throw new Error('飞书客户端尚未连接。')
    }
    const response = await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content: cardContent },
    })
    assertFeishuSuccess(response, '飞书消息更新失败')
  }

  private async sendImage(target: FeishuOutboundTarget, image: ImageAttachmentInput) {
    if (!this.client) {
      throw new Error('飞书客户端尚未连接。')
    }

    const buffer = Buffer.from(image.data, 'base64')
    if (buffer.byteLength > FEISHU_OUTBOUND_IMAGE_MAX_BYTES) {
      const maxMb = Math.floor(FEISHU_OUTBOUND_IMAGE_MAX_BYTES / 1024 / 1024)
      throw new Error(`图片超过 ${maxMb}MB，未发送。`)
    }

    const uploadResponse = await this.client.im.image.create({
      data: {
        image_type: 'message',
        image: buffer,
      },
    })
    assertFeishuSuccess(uploadResponse, '飞书图片上传失败')
    const imageKey = getFeishuImageKey(uploadResponse)
    if (!imageKey) {
      throw new Error('飞书图片上传失败：未返回 image_key')
    }

    return this.sendRawMessage(target, JSON.stringify({ image_key: imageKey }), 'image')
  }

  private async addTypingReaction(messageId: string) {
    if (!this.client) return null
    try {
      const response = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: {
            emoji_type: FEISHU_TYPING_EMOJI,
          },
        },
      })
      assertFeishuSuccess(response, '飞书输入状态表情添加失败')
      return getFeishuReactionId(response) || null
    } catch (error) {
      console.warn('[feishu] typing reaction add failed:', toErrorMessage(error))
      return null
    }
  }

  private async removeTypingReaction(run: FeishuPendingRun) {
    if (!this.client || !run.typingReactionId) return
    const reactionId = run.typingReactionId
    run.typingReactionId = null
    try {
      const response = await this.client.im.messageReaction.delete({
        path: {
          message_id: run.sourceMessageId,
          reaction_id: reactionId,
        },
      })
      assertFeishuSuccess(response, '飞书输入状态表情移除失败')
    } catch (error) {
      console.warn('[feishu] typing reaction remove failed:', toErrorMessage(error))
    }
  }

  private async resolveRunReplyText(run: FeishuPendingRun, result: AgentPromptRunResult) {
    // Pi-backed sessions can leave the manager's in-memory transcript empty, so
    // fall back to the persisted rows for this run only.
    const runAssistantText = result.finalAnswer?.trim()
      ? ''
      : await this.getRunAssistantText(run.conversationId, result.clientRunId)

    return pickRunReplyText({
      finalAnswer: result.finalAnswer,
      runAssistantText,
      textBuffer: run.textBuffer,
      errorText: result.errorText || run.errorText,
      status: result.status,
    })
  }

  private async getRunAssistantText(conversationId: string, clientRunId: string) {
    const messages: AgentMessageRecord[] = await this.deps.agent.getMessages(conversationId)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant' || message.clientRunId !== clientRunId) continue
      const content = message.content.trim()
      if (content) return content
    }
    return ''
  }

  private enqueueConversation<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.conversationQueues.get(conversationId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(task)
    const barrier = operation.then(() => undefined, () => undefined)
    this.conversationQueues.set(conversationId, barrier)
    void barrier.then(() => {
      if (this.conversationQueues.get(conversationId) === barrier) {
        this.conversationQueues.delete(conversationId)
      }
    })
    return operation
  }

  private enqueue(routeKey: string, task: () => Promise<void>) {
    const previous = this.queues.get(routeKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        console.error('[feishu] message handling failed:', toErrorMessage(error))
      })
      .finally(() => {
        if (this.queues.get(routeKey) === next) {
          this.queues.delete(routeKey)
        }
      })
    this.queues.set(routeKey, next)
    return next
  }
}
