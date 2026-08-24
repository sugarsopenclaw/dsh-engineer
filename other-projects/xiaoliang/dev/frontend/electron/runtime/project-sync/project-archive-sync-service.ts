import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import type { AuthSessionData } from '../../../src/shared/backend-api'
import type {
  AgentMessageRecord,
  ConversationSummary,
  ProjectSummary,
} from '../../../src/shared/local-agent'
import { backendRequest } from '../backend/http'
import {
  getConversationSummary,
  getDisplayMessageRecords,
  getProjectSummary,
  listProjectConversations,
  listProjects,
  resolveExternalMessageId,
} from '../conversations/conversation-repository'
import { getDB } from '../db'
import { getConversationPiSessionBinding } from '../agent/pi/pi-session-store'
import { parsePiSessionArchiveJsonl } from './pi-session-archive'
import {
  beginPiSessionArchiveAttempt,
  getPiSessionArchiveGeneration,
  listRetryablePiSessionArchiveConversationIds,
  markPiSessionArchiveFailed,
  markPiSessionArchiveUploaded,
  reconcileChangedPiSessionArchives,
} from './pi-session-archive-state'
import { isDefaultProjectArchiveIgnoredDirectory } from './project-scan-policy'
import { stableMessageKey } from './project-sync-identity'

const PROJECT_SYNC_START_DELAY_MS = 15_000
const PROJECT_SYNC_AFTER_TURN_DELAY_MS = 30_000
const CONVERSATION_SYNC_DELAY_MS = 1_500
const PREPARE_BATCH_SIZE = 50
const CONFIRM_BATCH_SIZE = 50
const UPLOAD_CONCURRENCY = 2
const UPLOAD_IDLE_TIMEOUT_MS = 120_000

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
  '.zip': 'application/zip',
}

interface ScannedProjectFile {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  modifiedAt: string
  modifiedAtMs: number
  sha256: string
  mediaType: string
}

interface ProjectFileScanResult {
  files: ScannedProjectFile[]
  complete: boolean
}

interface ProjectIdentityPayload {
  local_project_id: string
  name: string
  description: string
  root_name: string | null
}

interface SnapshotStartData {
  project_archive_id: string
  local_project_id: string
  sync_status: string
  snapshot_id: string
}

interface UploadTarget {
  relative_path: string
  sha256: string
  upload_required: boolean
  upload_url?: string | null
  required_headers?: Record<string, string>
  expires_in_seconds?: number | null
}

interface PrepareFilesData {
  project_archive_id: string
  targets: UploadTarget[]
}

interface ConfirmFilesData {
  results: Array<{
    relative_path: string
    sha256: string
    status: 'ready' | 'missing' | 'mismatch' | 'failed'
    error?: string | null
  }>
}

interface MessageAttachmentUploadTarget {
  message_source_key: string
  attachment_id: string
  sha256: string
  upload_url: string
  required_headers?: Record<string, string>
  expires_in_seconds: number
}

interface ConversationSyncData {
  project_archive_id: string
  conversation_archive_id: string
  message_count: number
  attachment_count: number
  attachment_error_count: number
  attachment_uploads: MessageAttachmentUploadTarget[]
}

interface PiSessionArchivePrepareData {
  archive_id: string
  pi_session_id: string
  sha256: string
  upload_required: boolean
  storage_key: string
  upload_url?: string | null
  required_headers?: Record<string, string>
  expires_in_seconds?: number | null
}

interface PiSessionArchiveConfirmData {
  archive_id: string
  pi_session_id: string
  sha256: string
  status: 'ready' | 'missing' | 'mismatch' | 'failed'
  storage_key: string
  error?: string | null
}

interface PiSessionArchiveSnapshot {
  data: Buffer
  piSessionId: string
  parentPiSessionId: string | null
  runtimeVersion: number
  jsonlSchemaVersion: number
  currentLeafEntryId: string | null
  entryCount: number
  sha256: string
  sourceModifiedAt: string
}

interface PreparedConversationPayload {
  conversation: Record<string, unknown>
  attachmentBytes: Map<string, Buffer>
}

interface DocumentAnalyzeData {
  project_archive_id: string
  project_file_id: string
  relative_path: string
  sha256: string
  model: string
  primary_model: string
  fallback_used: boolean
  cached: boolean
  content: string
  truncated: boolean
  warnings: string[]
  usage?: Record<string, unknown> | null
}

export interface CloudProjectDocumentReadInput {
  projectId: string
  relativePath: string
  absolutePath: string
  sizeBytes: number
  modifiedAt: string
  instruction?: string
  maxChars: number
  pageRange?: string
  sheetNames?: string[]
  maxRowsPerSheet?: number
  maxColsPerSheet?: number
  includeFormulas?: boolean
  signal?: AbortSignal
}

export interface CloudProjectDocumentReadResult {
  content: string
  parser: string
  warning: string | null
  metadata: Record<string, unknown>
  truncated: boolean
}

interface HashCacheRow {
  size_bytes: number
  modified_at_ms: number
  sha256: string
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, '/')
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function mediaTypeForPath(filePath: string) {
  return MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function projectIdentity(project: ProjectSummary): ProjectIdentityPayload {
  return {
    local_project_id: project.id,
    name: project.name,
    description: project.description,
    root_name: project.rootPath ? path.basename(project.rootPath) : null,
  }
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('操作已取消。')
}

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    const onAbort = () => stream.destroy(new Error('操作已取消。'))
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
    stream.on('close', () => signal?.removeEventListener('abort', onAbort))
  })
  return hash.digest('hex')
}

function cachedSha256(
  projectId: string,
  relativePath: string,
  sizeBytes: number,
  modifiedAtMs: number,
): string | null {
  const row = getDB()
    .prepare(
      `SELECT size_bytes, modified_at_ms, sha256
       FROM project_archive_file_cache
       WHERE project_id = ? AND relative_path = ?`,
    )
    .get(projectId, relativePath) as HashCacheRow | undefined
  if (
    row
    && row.size_bytes === sizeBytes
    && row.modified_at_ms === modifiedAtMs
    && /^[0-9a-f]{64}$/i.test(row.sha256)
  ) {
    return row.sha256.toLowerCase()
  }
  return null
}

function replaceProjectHashCache(projectId: string, files: ScannedProjectFile[]) {
  const db = getDB()
  const remove = db.prepare('DELETE FROM project_archive_file_cache WHERE project_id = ?')
  const insert = db.prepare(
    `INSERT INTO project_archive_file_cache (
       project_id, relative_path, size_bytes, modified_at_ms, sha256, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))`,
  )
  db.transaction(() => {
    remove.run(projectId)
    for (const file of files) {
      insert.run(
        projectId,
        file.relativePath,
        file.sizeBytes,
        file.modifiedAtMs,
        file.sha256,
      )
    }
  })()
}

function upsertProjectHashCache(projectId: string, file: ScannedProjectFile) {
  getDB().prepare(
    `INSERT INTO project_archive_file_cache (
       project_id, relative_path, size_bytes, modified_at_ms, sha256, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(project_id, relative_path) DO UPDATE SET
       size_bytes = excluded.size_bytes,
       modified_at_ms = excluded.modified_at_ms,
       sha256 = excluded.sha256,
       updated_at = excluded.updated_at`,
  ).run(
    projectId,
    file.relativePath,
    file.sizeBytes,
    file.modifiedAtMs,
    file.sha256,
  )
}

async function uploadFileToSignedUrl(input: {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  absolutePath: string
  expectedSize: number
  expectedModifiedAtMs: number
  signal?: AbortSignal
}): Promise<void> {
  throwIfAborted(input.signal)
  const statBefore = await fs.promises.stat(input.absolutePath)
  if (
    !statBefore.isFile()
    || statBefore.size !== input.expectedSize
    || Math.trunc(statBefore.mtimeMs) !== input.expectedModifiedAtMs
  ) {
    throw new Error('文件在上传前发生变化，将在下一次后台同步重试。')
  }

  const endpoint = new URL(input.uploadUrl)
  const transport = endpoint.protocol === 'https:' ? https : http
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(input.absolutePath)
    const request = transport.request(
      endpoint,
      {
        method: 'PUT',
        headers: {
          ...input.requiredHeaders,
          'Content-Length': String(input.expectedSize),
        },
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          const status = response.statusCode || 0
          if (status >= 200 && status < 300) resolve()
          else reject(new Error(`OSS 上传失败（HTTP ${status || 'unknown'}）。`))
        })
      },
    )
    const abort = () => {
      stream.destroy(new Error('操作已取消。'))
      request.destroy(new Error('操作已取消。'))
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => input.signal?.removeEventListener('abort', abort)
    request.on('error', (error) => {
      cleanup()
      reject(error)
    })
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      const error = new Error('OSS 上传长时间无网络进展，已中止并等待后台重试。')
      stream.destroy(error)
      request.destroy(error)
    })
    request.on('close', cleanup)
    stream.on('error', (error) => request.destroy(error))
    stream.pipe(request)
  })

  const statAfter = await fs.promises.stat(input.absolutePath)
  if (
    statAfter.size !== input.expectedSize
    || Math.trunc(statAfter.mtimeMs) !== input.expectedModifiedAtMs
  ) {
    throw new Error('文件在上传过程中发生变化，将在下一次后台同步重试。')
  }
}

async function uploadBufferToSignedUrl(input: {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  data: Buffer
}): Promise<void> {
  const endpoint = new URL(input.uploadUrl)
  const transport = endpoint.protocol === 'https:' ? https : http
  await new Promise<void>((resolve, reject) => {
    const request = transport.request(
      endpoint,
      {
        method: 'PUT',
        headers: {
          ...input.requiredHeaders,
          'Content-Length': String(input.data.byteLength),
        },
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          const status = response.statusCode || 0
          if (status >= 200 && status < 300) resolve()
          else reject(new Error(`OSS 对象上传失败（HTTP ${status || 'unknown'}）。`))
        })
      },
    )
    request.on('error', reject)
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error('OSS 对象上传长时间无网络进展，已中止。'))
    })
    request.end(input.data)
  })
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  })
  await Promise.all(runners)
}

function messageAttachmentMapKey(messageSourceKey: string, attachmentId: string) {
  return `${messageSourceKey}\0${attachmentId}`
}

function decodeMessageAttachment(data: string): Buffer {
  let encoded = data.trim()
  if (encoded.startsWith('data:')) {
    const separator = encoded.indexOf(',')
    if (separator < 0) throw new Error('消息附件 data URL 无效。')
    encoded = encoded.slice(separator + 1)
  }
  encoded = encoded.replace(/\s+/g, '')
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('消息附件不是合法 Base64。')
  }
  return Buffer.from(encoded, 'base64')
}

export class ProjectArchiveSyncService {
  private readonly projectTimers = new Map<string, NodeJS.Timeout>()
  private readonly conversationTimers = new Map<string, NodeJS.Timeout>()
  private readonly projectInFlight = new Map<string, Promise<void>>()
  private readonly conversationInFlight = new Map<string, Promise<void>>()
  private projectQueueTail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly getBackendSession: () => Promise<AuthSessionData | null>,
  ) {}

  scheduleInitialSync(delayMs = PROJECT_SYNC_START_DELAY_MS) {
    const retryDelayMs = Math.min(Math.max(0, delayMs), 1_000)
    void reconcileChangedPiSessionArchives()
      .then(() => {
        listRetryablePiSessionArchiveConversationIds().forEach((conversationId, index) => {
          this.scheduleConversation(conversationId, retryDelayMs + index * 250)
        })
      })
      .catch((error) => {
        console.warn('[project-archive] Pi Session startup retry scan failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    const timer = setTimeout(() => this.scheduleAllProjects(), delayMs)
    timer.unref?.()
  }

  scheduleAllProjects() {
    if (this.disposed) return
    listProjects().forEach((project, index) => {
      this.scheduleProject(project.id, index * 2_000)
    })
  }

  scheduleProject(projectId: string, delayMs = PROJECT_SYNC_AFTER_TURN_DELAY_MS) {
    if (this.disposed || !projectId.trim()) return
    const existing = this.projectTimers.get(projectId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.projectTimers.delete(projectId)
      void this.syncProject(projectId).catch((error) => {
        console.warn('[project-archive] background project sync failed', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, Math.max(0, delayMs))
    timer.unref?.()
    this.projectTimers.set(projectId, timer)
  }

  scheduleConversation(conversationId: string, delayMs = CONVERSATION_SYNC_DELAY_MS) {
    if (this.disposed || !conversationId.trim()) return
    const existing = this.conversationTimers.get(conversationId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.conversationTimers.delete(conversationId)
      void this.syncConversation(conversationId).catch((error) => {
        console.warn('[project-archive] background conversation sync failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, Math.max(0, delayMs))
    timer.unref?.()
    this.conversationTimers.set(conversationId, timer)
  }

  async readCloudDocument(input: CloudProjectDocumentReadInput): Promise<CloudProjectDocumentReadResult> {
    throwIfAborted(input.signal)
    const [accessToken, project] = await Promise.all([
      this.requireAccessToken(),
      Promise.resolve(getProjectSummary(input.projectId)),
    ])
    if (!project) throw new Error(`未找到项目: ${input.projectId}`)

    const stable = await this.prepareSingleFileMetadata(input)
    await this.upsertProject(accessToken, project)
    await this.ensureFilesUploaded(accessToken, project, null, [stable], input.signal, true)
    throwIfAborted(input.signal)

    const analyzed = await backendRequest<DocumentAnalyzeData>('/project-archive/documents/analyze', {
      method: 'POST',
      accessToken,
      body: {
        local_project_id: project.id,
        relative_path: stable.relativePath,
        sha256: stable.sha256,
        instruction: input.instruction || '完整读取本文件，保留与后续项目问答有关的正文、标题、表格和定位信息。',
        file_parsing_strategy: 'auto',
        max_chars: input.maxChars,
        page_range: input.pageRange || null,
        sheet_names: input.sheetNames || [],
        max_rows_per_sheet: input.maxRowsPerSheet ?? null,
        max_cols_per_sheet: input.maxColsPerSheet ?? null,
        include_formulas: input.includeFormulas ?? null,
      },
      signal: input.signal,
    })
    return {
      content: analyzed.content,
      parser: analyzed.fallback_used
        ? `cloud:${analyzed.model}:fallback`
        : `cloud:${analyzed.model}`,
      warning: analyzed.warnings.length > 0 ? analyzed.warnings.join('；') : null,
      metadata: {
        projectArchiveId: analyzed.project_archive_id,
        projectFileId: analyzed.project_file_id,
        sha256: analyzed.sha256,
        primaryModel: analyzed.primary_model,
        model: analyzed.model,
        fallbackUsed: analyzed.fallback_used,
        cached: analyzed.cached,
        usage: analyzed.usage || null,
      },
      truncated: analyzed.truncated,
    }
  }

  dispose() {
    this.disposed = true
    for (const timer of this.projectTimers.values()) clearTimeout(timer)
    for (const timer of this.conversationTimers.values()) clearTimeout(timer)
    this.projectTimers.clear()
    this.conversationTimers.clear()
  }

  private async syncProject(projectId: string): Promise<void> {
    const existing = this.projectInFlight.get(projectId)
    if (existing) return existing
    const operation = this.projectQueueTail.catch(() => undefined).then(() => (
      this.syncProjectNow(projectId)
    )).finally(() => {
      if (this.projectInFlight.get(projectId) === operation) {
        this.projectInFlight.delete(projectId)
      }
    })
    this.projectQueueTail = operation.catch(() => undefined)
    this.projectInFlight.set(projectId, operation)
    return operation
  }

  private async syncProjectNow(projectId: string): Promise<void> {
    if (this.disposed) return
    const project = getProjectSummary(projectId)
    if (!project) return
    const accessToken = await this.optionalAccessToken()
    if (!accessToken) return

    await this.upsertProject(accessToken, project)
    if (project.rootPath && project.rootPathExists) {
      const snapshot = await backendRequest<SnapshotStartData>('/project-archive/snapshots/start', {
        method: 'POST',
        accessToken,
        body: {
          ...projectIdentity(project),
          scanned_at: new Date().toISOString(),
        },
      })
      const scan = await this.scanProjectFiles(project)
      const files = scan.files
      const manifestComplete = await this.ensureFilesUploaded(
        accessToken,
        project,
        snapshot.snapshot_id,
        files,
      )
      await backendRequest('/project-archive/snapshots/' + encodeURIComponent(snapshot.snapshot_id) + '/complete', {
        method: 'POST',
        accessToken,
        body: {
          local_project_id: project.id,
          file_count: files.length,
          total_bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
          scan_complete: scan.complete && manifestComplete,
        },
      })
    }

    for (const conversation of listProjectConversations(project.id)) {
      await this.syncConversationNow(conversation.id, accessToken).catch((error) => {
        console.warn('[project-archive] conversation sync during project snapshot failed', {
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  private async syncConversation(conversationId: string): Promise<void> {
    const existing = this.conversationInFlight.get(conversationId)
    if (existing) return existing
    const operation = (async () => {
      const accessToken = await this.optionalAccessToken()
      if (!accessToken) return
      await this.syncConversationNow(conversationId, accessToken)
    })().finally(() => {
      if (this.conversationInFlight.get(conversationId) === operation) {
        this.conversationInFlight.delete(conversationId)
      }
    })
    this.conversationInFlight.set(conversationId, operation)
    return operation
  }

  private async syncConversationNow(conversationId: string, accessToken: string) {
    const conversation = getConversationSummary(conversationId)
    if (!conversation?.projectId) return
    const project = getProjectSummary(conversation.projectId)
    if (!project) return
    const messages = getDisplayMessageRecords(conversation.id)
    const prepared = this.conversationPayload(conversation, messages)
    const synced = await backendRequest<ConversationSyncData>('/project-archive/conversations/sync', {
      method: 'POST',
      accessToken,
      body: {
        ...projectIdentity(project),
        conversation: prepared.conversation,
      },
    })
    await this.uploadMessageAttachments(
      accessToken,
      project,
      conversation,
      synced.attachment_uploads || [],
      prepared.attachmentBytes,
    )
    await this.syncPiSessionArchive(accessToken, project, conversation)
  }

  private conversationPayload(
    conversation: ConversationSummary,
    messages: AgentMessageRecord[],
  ): PreparedConversationPayload {
    const attachmentBytes = new Map<string, Buffer>()
    const messagePayloads = messages.map((message) => {
      const externalMessageId = resolveExternalMessageId(
        message.conversationId,
        message.id,
      )
      const sourceKey = stableMessageKey({ ...message, id: externalMessageId })
      return {
        id: externalMessageId,
        client_run_id: message.clientRunId ?? null,
        pi_session_id: message.piSessionId ?? null,
        pi_entry_id: message.piEntryId ?? null,
        source_key: sourceKey,
        role: message.role,
        content: message.content,
        tool_name: message.toolName,
        tool_args: message.toolArgs,
        tool_result: message.toolResult,
        thinking: message.thinking,
        parts: message.parts || null,
        attachments: (message.attachments || []).map((attachment) => {
          try {
            const data = decodeMessageAttachment(attachment.data)
            const sha256 = createHash('sha256').update(data).digest('hex')
            attachmentBytes.set(messageAttachmentMapKey(sourceKey, attachment.id), data)
            return {
              id: attachment.id,
              sha256,
              size_bytes: data.byteLength,
              mime_type: attachment.mimeType,
              name: attachment.name || null,
            }
          } catch (error) {
            console.warn('[project-archive] invalid local message attachment; syncing metadata only', {
              conversationId: conversation.id,
              attachmentId: attachment.id,
              error: error instanceof Error ? error.message : String(error),
            })
            return {
              id: attachment.id,
              mime_type: attachment.mimeType,
              name: attachment.name || null,
            }
          }
        }),
        created_at: message.createdAt,
      }
    })
    return {
      attachmentBytes,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        creation_source: conversation.creationSource,
        // Cloud archive schema keeps this legacy field for backward compatibility;
        // the desktop app now has a single unified conversation experience.
        conversation_mode: 'knowledge_qa',
        drawing_id: conversation.drawingId,
        drawing_name: conversation.drawingName,
        is_pinned: conversation.isPinned,
        preferred_model_id: conversation.preferredModelId,
        preferred_thinking_mode: conversation.preferredThinkingMode,
        context_usage: conversation.contextUsage,
        session_sync_scope: conversation.sessionSyncScope,
        parent_conversation_id: conversation.parentConversationId,
        forked_from_entry_id: conversation.forkedFromEntryId,
        updated_at: conversation.updatedAt,
        messages: messagePayloads,
      },
    }
  }

  private async readPiSessionArchiveSnapshot(
    conversationId: string,
  ): Promise<PiSessionArchiveSnapshot | null> {
    const binding = getConversationPiSessionBinding(conversationId)
    if (!binding || binding.migrationStatus !== 'ready') return null
    const stat = await fs.promises.stat(binding.piSessionFile)
    const data = await fs.promises.readFile(binding.piSessionFile)
    const statAfterRead = await fs.promises.stat(binding.piSessionFile)
    if (
      statAfterRead.size !== stat.size
      || Math.trunc(statAfterRead.mtimeMs) !== Math.trunc(stat.mtimeMs)
      || data.byteLength !== stat.size
    ) {
      throw new Error('Pi Session JSONL 在归档读取期间发生变化，将等待下次同步。')
    }
    const parsed = parsePiSessionArchiveJsonl(data, binding.piSessionId)
    const parentBinding = binding.parentConversationId
      ? getConversationPiSessionBinding(binding.parentConversationId)
      : null
    const parentPiSessionId = (
      parsed.parentSessionFile
      && parentBinding
      && path.resolve(parsed.parentSessionFile) === path.resolve(parentBinding.piSessionFile)
    ) ? parentBinding.piSessionId : null
    return {
      data,
      piSessionId: binding.piSessionId,
      parentPiSessionId,
      runtimeVersion: binding.runtimeVersion,
      jsonlSchemaVersion: parsed.jsonlSchemaVersion,
      currentLeafEntryId: parsed.currentLeafEntryId,
      entryCount: parsed.entryCount,
      sha256: createHash('sha256').update(data).digest('hex'),
      sourceModifiedAt: stat.mtime.toISOString(),
    }
  }

  private async syncPiSessionArchive(
    accessToken: string,
    project: ProjectSummary,
    conversation: ConversationSummary,
  ): Promise<void> {
    const generation = getPiSessionArchiveGeneration(conversation.id)
    if (generation === null) return
    let snapshot: PiSessionArchiveSnapshot | null = null
    try {
      snapshot = await this.readPiSessionArchiveSnapshot(conversation.id)
      if (!snapshot) return
      if (!beginPiSessionArchiveAttempt({
        conversationId: conversation.id,
        generation,
        snapshot: {
          sha256: snapshot.sha256,
          sizeBytes: snapshot.data.byteLength,
          sourceModifiedAt: snapshot.sourceModifiedAt,
        },
      })) {
        this.scheduleConversation(conversation.id)
        return
      }

      const prepared = await backendRequest<PiSessionArchivePrepareData>(
        '/project-archive/pi-sessions/prepare',
        {
          method: 'POST',
          accessToken,
          body: {
            ...projectIdentity(project),
            local_conversation_id: conversation.id,
            pi_session_id: snapshot.piSessionId,
            parent_pi_session_id: snapshot.parentPiSessionId,
            runtime_version: snapshot.runtimeVersion,
            jsonl_schema_version: snapshot.jsonlSchemaVersion,
            current_leaf_entry_id: snapshot.currentLeafEntryId,
            entry_count: snapshot.entryCount,
            sha256: snapshot.sha256,
            size_bytes: snapshot.data.byteLength,
            source_modified_at: snapshot.sourceModifiedAt,
            training_consent: false,
          },
        },
      )
      let storageKey = prepared.storage_key
      if (prepared.upload_required) {
        if (!prepared.upload_url) throw new Error('后端未返回 Pi Session OSS 上传地址。')
        await uploadBufferToSignedUrl({
          uploadUrl: prepared.upload_url,
          requiredHeaders: prepared.required_headers || {},
          data: snapshot.data,
        })
        const confirmed = await backendRequest<PiSessionArchiveConfirmData>(
          '/project-archive/pi-sessions/confirm',
          {
            method: 'POST',
            accessToken,
            body: {
              local_project_id: project.id,
              local_conversation_id: conversation.id,
              pi_session_id: snapshot.piSessionId,
              sha256: snapshot.sha256,
            },
          },
        )
        if (confirmed.status !== 'ready') {
          throw new Error(confirmed.error || `Pi Session OSS 确认失败（${confirmed.status}）。`)
        }
        storageKey = confirmed.storage_key
      }

      const recorded = markPiSessionArchiveUploaded({
        conversationId: conversation.id,
        generation,
        sha256: snapshot.sha256,
        storageKey,
      })
      if (!recorded) this.scheduleConversation(conversation.id)
    } catch (error) {
      const recorded = markPiSessionArchiveFailed({
        conversationId: conversation.id,
        generation,
        sha256: snapshot?.sha256,
        error,
      })
      if (!recorded) this.scheduleConversation(conversation.id)
      throw error
    }
  }

  private async uploadMessageAttachments(
    accessToken: string,
    project: ProjectSummary,
    conversation: ConversationSummary,
    targets: MessageAttachmentUploadTarget[],
    attachmentBytes: Map<string, Buffer>,
  ) {
    const completed: Array<{
      message_source_key: string
      attachment_id: string
      sha256: string
    }> = []
    await runWithConcurrency(targets, UPLOAD_CONCURRENCY, async (target) => {
      const data = attachmentBytes.get(
        messageAttachmentMapKey(target.message_source_key, target.attachment_id),
      )
      if (!data) return
      try {
        await uploadBufferToSignedUrl({
          uploadUrl: target.upload_url,
          requiredHeaders: target.required_headers || {},
          data,
        })
        completed.push({
          message_source_key: target.message_source_key,
          attachment_id: target.attachment_id,
          sha256: target.sha256,
        })
      } catch (error) {
        console.warn('[project-archive] message attachment upload failed', {
          conversationId: conversation.id,
          attachmentId: target.attachment_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    for (const batch of chunksOf(completed, CONFIRM_BATCH_SIZE)) {
      await backendRequest('/project-archive/message-attachments/confirm', {
        method: 'POST',
        accessToken,
        body: {
          local_project_id: project.id,
          local_conversation_id: conversation.id,
          attachments: batch,
        },
      })
    }
  }

  private async upsertProject(accessToken: string, project: ProjectSummary) {
    await backendRequest('/project-archive/projects', {
      method: 'POST',
      accessToken,
      body: projectIdentity(project),
    })
  }

  private async scanProjectFiles(project: ProjectSummary): Promise<ProjectFileScanResult> {
    if (!project.rootPath) return { files: [], complete: true }
    const rootRealPath = await fs.promises.realpath(project.rootPath)
    const files: ScannedProjectFile[] = []
    let complete = true

    const walk = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true })
      } catch (error) {
        complete = false
        console.warn('[project-archive] skipping unreadable directory', directory, error)
        return
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (isDefaultProjectArchiveIgnoredDirectory(entry.name)) continue
          await walk(candidate)
          continue
        }
        if (!entry.isFile()) continue
        try {
          const absolutePath = await fs.promises.realpath(candidate)
          if (!isPathInsideRoot(rootRealPath, absolutePath)) continue
          const stat = await fs.promises.stat(absolutePath)
          if (!stat.isFile()) continue
          const relativePath = normalizeSlash(path.relative(rootRealPath, absolutePath))
          const modifiedAtMs = Math.trunc(stat.mtimeMs)
          const sha256 = cachedSha256(
            project.id,
            relativePath,
            stat.size,
            modifiedAtMs,
          ) || await sha256File(absolutePath)
          const afterHashStat = await fs.promises.stat(absolutePath)
          if (
            afterHashStat.size !== stat.size
            || Math.trunc(afterHashStat.mtimeMs) !== modifiedAtMs
          ) {
            complete = false
            continue
          }
          files.push({
            relativePath,
            absolutePath,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            modifiedAtMs,
            sha256,
            mediaType: mediaTypeForPath(relativePath),
          })
        } catch (error) {
          complete = false
          console.warn('[project-archive] skipping unreadable file', candidate, error)
        }
      }
    }

    await walk(rootRealPath)
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    replaceProjectHashCache(project.id, files)
    return { files, complete }
  }

  private async prepareSingleFileMetadata(input: CloudProjectDocumentReadInput): Promise<ScannedProjectFile> {
    const stat = await fs.promises.stat(input.absolutePath)
    if (!stat.isFile()) throw new Error(`项目文档不是普通文件：${input.relativePath}`)
    const modifiedAtMs = Math.trunc(stat.mtimeMs)
    const sha256 = cachedSha256(
      input.projectId,
      input.relativePath,
      stat.size,
      modifiedAtMs,
    ) || await sha256File(input.absolutePath, input.signal)
    const prepared = {
      relativePath: normalizeSlash(input.relativePath),
      absolutePath: input.absolutePath,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      modifiedAtMs,
      sha256,
      mediaType: mediaTypeForPath(input.relativePath),
    }
    upsertProjectHashCache(input.projectId, prepared)
    return prepared
  }

  private async ensureFilesUploaded(
    accessToken: string,
    project: ProjectSummary,
    snapshotId: string | null,
    files: ScannedProjectFile[],
    signal?: AbortSignal,
    strict = false,
  ) {
    let manifestComplete = true
    const byPath = new Map(files.map((file) => [file.relativePath, file]))
    for (const batch of chunksOf(files, PREPARE_BATCH_SIZE)) {
      throwIfAborted(signal)
      let prepared: PrepareFilesData
      try {
        prepared = await this.prepareFileBatch(accessToken, project, snapshotId, batch)
      } catch (error) {
        if (batch.length === 1) throw error
        for (const file of batch) {
          try {
            const single = await this.prepareFileBatch(accessToken, project, snapshotId, [file])
            const uploadComplete = await this.uploadPreparedTargets(
              accessToken,
              project,
              single.targets,
              byPath,
              signal,
              strict,
            )
            if (!uploadComplete) manifestComplete = false
          } catch (singleError) {
            manifestComplete = false
            console.warn('[project-archive] file preparation failed', {
              projectId: project.id,
              path: file.relativePath,
              error: singleError instanceof Error ? singleError.message : String(singleError),
            })
          }
        }
        continue
      }
      const uploadComplete = await this.uploadPreparedTargets(
        accessToken,
        project,
        prepared.targets,
        byPath,
        signal,
        strict,
      )
      if (!uploadComplete) manifestComplete = false
    }
    return manifestComplete
  }

  private prepareFileBatch(
    accessToken: string,
    project: ProjectSummary,
    snapshotId: string | null,
    files: ScannedProjectFile[],
  ) {
    return backendRequest<PrepareFilesData>('/project-archive/files/prepare', {
      method: 'POST',
      accessToken,
      body: {
        local_project_id: project.id,
        snapshot_id: snapshotId,
        files: files.map((file) => ({
          relative_path: file.relativePath,
          size_bytes: file.sizeBytes,
          sha256: file.sha256,
          modified_at: file.modifiedAt,
          media_type: file.mediaType,
        })),
      },
    })
  }

  private async uploadPreparedTargets(
    accessToken: string,
    project: ProjectSummary,
    targets: UploadTarget[],
    byPath: Map<string, ScannedProjectFile>,
    signal?: AbortSignal,
    strict = false,
  ) {
    const completed: Array<{ relative_path: string; sha256: string }> = []
    const uploadErrors: Error[] = []
    const uploadTargets = targets.filter((target) => target.upload_required)
    await runWithConcurrency(uploadTargets, UPLOAD_CONCURRENCY, async (target) => {
      const file = byPath.get(target.relative_path)
      if (!file || !target.upload_url) {
        uploadErrors.push(new Error(`后端未返回完整上传目标：${target.relative_path}`))
        return
      }
      try {
        await uploadFileToSignedUrl({
          uploadUrl: target.upload_url,
          requiredHeaders: target.required_headers || {},
          absolutePath: file.absolutePath,
          expectedSize: file.sizeBytes,
          expectedModifiedAtMs: file.modifiedAtMs,
          signal,
        })
        completed.push({ relative_path: file.relativePath, sha256: file.sha256 })
      } catch (error) {
        uploadErrors.push(error instanceof Error ? error : new Error(String(error)))
        console.warn('[project-archive] OSS upload failed; product flow continues', {
          projectId: project.id,
          path: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    for (const batch of chunksOf(completed, CONFIRM_BATCH_SIZE)) {
      const confirmation = await backendRequest<ConfirmFilesData>('/project-archive/files/confirm', {
        method: 'POST',
        accessToken,
        body: {
          local_project_id: project.id,
          files: batch,
        },
      })
      const failed = confirmation.results.filter((item) => item.status !== 'ready')
      if (failed.length > 0) {
        uploadErrors.push(new Error(
          `OSS 文件确认未完成：${failed.map((item) => item.relative_path).join('、')}`,
        ))
        console.warn('[project-archive] OSS confirmations incomplete', {
          projectId: project.id,
          failed: failed.map((item) => ({ path: item.relative_path, status: item.status })),
        })
      }
    }
    if (strict && uploadErrors.length > 0) {
      throw uploadErrors[0]
    }
    return uploadErrors.length === 0
  }

  private async optionalAccessToken() {
    const session = await this.getBackendSession()
    return session?.access_token?.trim() || ''
  }

  private async requireAccessToken() {
    const token = await this.optionalAccessToken()
    if (!token) throw new Error('请先登录后再读取项目文档。')
    return token
  }
}
