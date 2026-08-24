import type {
  Agent,
  AgentMessage,
  AgentTool,
  BeforeToolCallResult,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import {
  createProvider,
  InMemoryCredentialStore,
  type Api,
  type ImageContent,
  type Message,
  type Model,
  type Provider,
  type ProviderHeaders,
} from '@earendil-works/pi-ai'
import {
  stream as streamOpenAICompletions,
  streamSimple as streamSimpleOpenAICompletions,
} from '@earendil-works/pi-ai/api/openai-completions'
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CompactionResult,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionError,
  type InlineExtension,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionInfo,
  type SessionStats,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Type } from 'typebox'
import type {
  XiaoliangPiControlledResourceResolution,
  XiaoliangPiResourceDiagnostic,
} from './controlled-resources'
import { MAIN_COMPACTION_POLICY } from '../context/compaction-policy'

const PI_HTML_EXPORT_ASSET_MARKER = path.join('dist', 'core', 'export-html', 'template.html')
const IMAGE_ONLY_QUEUE_TEXT_PREFIX = '__xiaoliang_image_queue__:'
let piHtmlExportTail: Promise<void> = Promise.resolve()

function hasPiHtmlExportAssets(packageRoot: string | undefined): packageRoot is string {
  return Boolean(
    packageRoot
    && fs.existsSync(path.join(packageRoot, PI_HTML_EXPORT_ASSET_MARKER)),
  )
}

function resolvePiHtmlExportPackageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.PI_PACKAGE_DIR,
    path.join(moduleDir, 'runtime', 'agent', 'pi', 'pi-package-assets'),
    path.join(moduleDir, 'pi-package-assets'),
    path.join(
      process.cwd(),
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
    ),
  ]

  try {
    const runtimeRequire = createRequire(import.meta.url)
    const entryPath = runtimeRequire.resolve('@earendil-works/pi-coding-agent')
    candidates.push(path.resolve(path.dirname(entryPath), '..'))
  } catch {
    // Packaged builds use the copied asset directory above.
  }

  const packageRoot = candidates.find(hasPiHtmlExportAssets)
  if (!packageRoot) {
    throw new Error('Pi HTML export assets are unavailable in this application build.')
  }
  return packageRoot
}

function withPiHtmlExportAssets<T>(operation: () => Promise<T>): Promise<T> {
  const task = piHtmlExportTail.then(async () => {
    const previousPackageDir = process.env.PI_PACKAGE_DIR
    process.env.PI_PACKAGE_DIR = resolvePiHtmlExportPackageRoot()
    try {
      return await operation()
    } finally {
      if (previousPackageDir === undefined) {
        delete process.env.PI_PACKAGE_DIR
      } else {
        process.env.PI_PACKAGE_DIR = previousPackageDir
      }
    }
  })
  piHtmlExportTail = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

export const XIAOLIANG_PI_RESOURCE_POLICY = Object.freeze({
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
})

export const XIAOLIANG_PI_RESILIENCE_POLICY = Object.freeze({
  compaction: MAIN_COMPACTION_POLICY,
  retry: Object.freeze({
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2_000,
    // High-level Pi retries are observable and shared by agent and summarization calls.
    // Disable the lower provider loop so one failure cannot create two retry loops.
    provider: Object.freeze({
      maxRetries: 0,
      maxRetryDelayMs: 30_000,
    }),
  }),
})

export interface XiaoliangPiToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface XiaoliangPiAgentHostEvent {
  generation: number
  sequence: number
  event: AgentSessionEvent
}

export interface XiaoliangPiQueueSnapshot {
  steering: string[]
  followUp: string[]
}

export type XiaoliangQueueKind = 'steer' | 'followUp'

export interface XiaoliangQueuedItem {
  id: string
  kind: XiaoliangQueueKind
  text: string
  images: ImageContent[]
}

/** A host-owned message that must never enter the user-editable composer queue. */
export interface XiaoliangPiSystemMessage<T = unknown> {
  id: string
  customType: string
  content: string
  details?: T
}

interface XiaoliangPiSystemMessageEnvelope<T = unknown> {
  systemEventId: string
  payload?: T
}

interface XiaoliangPendingSystemMessage {
  message: XiaoliangPiSystemMessage
  queued: boolean
}

interface XiaoliangShadowQueuedItem extends XiaoliangQueuedItem {
  /** Non-empty text tracked by Pi, including the placeholder used for image-only rows. */
  piText: string
}

type XiaoliangQueueMode = 'live' | 'held' | 'rebuilding'

export interface XiaoliangPiControlledResources {
  initial: XiaoliangPiControlledResourceResolution
  resolve?: () => (
    XiaoliangPiControlledResourceResolution
    | Promise<XiaoliangPiControlledResourceResolution>
  )
  /** App-bundled factories only. File-system extension paths are intentionally unsupported. */
  inlineExtensions?: readonly InlineExtension[]
}

export interface XiaoliangPiResourceItem {
  name: string
  description: string
  path: string
  source: string
  argumentHint?: string
}

export interface XiaoliangPiToolStatus {
  name: string
  description: string
  source: string
  active: boolean
}

export interface XiaoliangPiRuntimeResourceStatus {
  enabled: boolean
  revision: string
  reloadedAt: string | null
  extensions: Array<{ name: string; path: string; source: string }>
  skills: XiaoliangPiResourceItem[]
  promptTemplates: XiaoliangPiResourceItem[]
  tools: XiaoliangPiToolStatus[]
  diagnostics: XiaoliangPiResourceDiagnostic[]
}

type XiaoliangPiQueueMode = 'all' | 'one-at-a-time'

interface XiaoliangPiQueueBehavior {
  steeringMode: XiaoliangPiQueueMode
  followUpMode: XiaoliangPiQueueMode
}

export interface XiaoliangPiAgentHostOptions {
  cwd: string
  agentDir: string
  generation: number
  model: Model<Api>
  thinkingLevel: ThinkingLevel
  /** Whether a persisted JSONL level or the caller-provided level is authoritative. */
  thinkingLevelSource?: 'session' | 'caller'
  tools: readonly AgentTool[]
  initialMessages?: readonly AgentMessage[]
  /** Queue rows retained after Stop and transferred from a replaced host. */
  initialHeldQueueItems?: readonly XiaoliangQueuedItem[]
  sessionManager?: SessionManager
  systemPrompt: string
  controlledResources?: XiaoliangPiControlledResources
  resolveApiKey?: () => Promise<string>
  provider?: Provider
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>
  transformPayload?: (
    payload: unknown,
    model: Model<Api>,
  ) => unknown | undefined | Promise<unknown | undefined>
  beforeProviderHeaders?: (
    headers: ProviderHeaders,
    signal?: AbortSignal,
  ) => void | Promise<void>
  beforeToolCall?: (
    toolCall: XiaoliangPiToolCall,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>
  beforePersistMessage?: (message: AgentMessage) => void
  onSessionStart?: (event: SessionStartEvent) => void | Promise<void>
  onSessionShutdown?: (event: SessionShutdownEvent) => void | Promise<void>
  onExtensionError?: (error: ExtensionError) => void
  onEvent: (event: XiaoliangPiAgentHostEvent) => void | Promise<void>
  onEventError?: (error: unknown) => void
}

interface LoadedControlledSkill {
  name: string
  description: string
  filePath: string
  baseDir: string
  source: string
  resources: ReadonlyMap<string, string>
}

interface MutableRuntimeState {
  systemPrompt: string
  callPurpose: 'main' | 'compaction'
  tools: Map<string, AgentTool>
  activeToolNames: string[]
  toolSelectionInitialized: boolean
  skillPaths: string[]
  promptTemplatePaths: string[]
  resourceDiagnostics: XiaoliangPiResourceDiagnostic[]
  resourceRevision: string
  resourcesReloadedAt: string | null
  extensionErrors: ExtensionError[]
  loadedSkills: Map<string, LoadedControlledSkill>
  runtimeQueueBehavior: XiaoliangPiQueueBehavior | null
}

const CONTROLLED_SKILL_READ_TOOL_NAME = 'pi_skill_read'
const CONTROLLED_SKILL_RESOURCE_EXTENSIONS = new Set([
  '.md', '.json', '.txt', '.csv', '.tsv', '.yaml', '.yml',
])
const MAX_CONTROLLED_SKILL_RESOURCE_CHARS = 120_000
const MAX_CONTROLLED_SKILL_RESOURCE_FILES = 100
const MAX_CONTROLLED_SKILL_TOTAL_CHARS = 2_000_000

function applyCallPurpose(
  payload: unknown,
  state: MutableRuntimeState,
  forceCompaction = false,
): unknown {
  if (
    (!forceCompaction && state.callPurpose !== 'compaction')
    || payload === null
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    return payload
  }
  return {
    ...payload,
    xiaoliang_call_purpose: 'compaction',
  }
}

async function transformProviderPayload(
  options: XiaoliangPiAgentHostOptions,
  state: MutableRuntimeState,
  payload: unknown,
  model: Model<Api>,
  forceCompaction = false,
): Promise<unknown> {
  const transformed = (await options.transformPayload?.(payload, model)) ?? payload
  return applyCallPurpose(transformed, state, forceCompaction)
}

function isPersistableMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.prepareArguments ? { prepareArguments: tool.prepareArguments } : {}),
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    execute: (toolCallId, params, signal, onUpdate) => (
      tool.execute(toolCallId, params, signal, onUpdate)
    ),
  }
}

function createManagedGatewayProvider(options: XiaoliangPiAgentHostOptions): Provider {
  if (options.model.api !== 'openai-completions') {
    throw new Error(`Xiaoliang managed gateway requires openai-completions, received ${options.model.api}`)
  }
  if (!options.resolveApiKey) {
    throw new Error('Xiaoliang managed gateway requires a dynamic API key resolver')
  }

  const model = options.model as Model<'openai-completions'>
  return createProvider<'openai-completions'>({
    id: model.provider,
    name: 'Xiaoliang Managed Gateway',
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: 'Xiaoliang managed session',
        check: async ({ signal }) => {
          if (signal.aborted) throw signal.reason
          return { type: 'api_key', source: 'Xiaoliang managed session' }
        },
        resolve: async ({ signal }) => {
          if (signal.aborted) throw signal.reason
          const apiKey = (await options.resolveApiKey?.())?.trim() || ''
          if (!apiKey) return undefined
          return {
            auth: { apiKey },
            source: 'Xiaoliang managed session',
          }
        },
      },
    },
    models: [model],
    api: {
      stream: streamOpenAICompletions,
      streamSimple: streamSimpleOpenAICompletions,
    },
  })
}

function createRuntimeExtension(
  options: XiaoliangPiAgentHostOptions,
  state: MutableRuntimeState,
): InlineExtension {
  return {
    name: 'xiaoliang-runtime-adapter',
    hidden: true,
    factory: (pi) => {
      for (const tool of state.tools.values()) {
        pi.registerTool(toToolDefinition(tool))
      }

      if (options.onSessionStart) {
        pi.on('session_start', (event) => options.onSessionStart?.(event))
      }

      if (options.onSessionShutdown) {
        pi.on('session_shutdown', (event) => options.onSessionShutdown?.(event))
      }

      pi.on('before_agent_start', () => ({
        systemPrompt: appendControlledSkillsPrompt(state.systemPrompt, state),
      }))

      if (options.transformContext) {
        pi.on('context', async (event, context) => ({
          messages: await options.transformContext?.(event.messages, context.signal),
        }))
      }

      pi.on('before_provider_request', async (event) => {
        return transformProviderPayload(options, state, event.payload, options.model)
      })

      if (options.beforeProviderHeaders) {
        pi.on('before_provider_headers', async (event, context) => {
          await options.beforeProviderHeaders?.(event.headers, context.signal)
        })
      }

      if (options.beforeToolCall) {
        pi.on('tool_call', async (event, context) => (
          options.beforeToolCall?.({
            id: event.toolCallId,
            name: event.toolName,
            args: event.input,
          }, context.signal)
        ))
      }

      if (options.beforePersistMessage) {
        pi.on('message_end', (event) => {
          options.beforePersistMessage?.(event.message)
        })
      }
    },
  }
}

function validateActiveTools(session: AgentSession, expectedToolNames: readonly string[]) {
  const expected = [...new Set(expectedToolNames)].sort()
  const actual = [...session.getActiveToolNames()].sort()
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error(`Pi runtime tool mismatch: expected ${expected.join(', ')}, received ${actual.join(', ')}`)
  }
}

function readRuntimeQueueBehavior(session: AgentSession): XiaoliangPiQueueBehavior {
  return {
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
  }
}

function applyRuntimeDefaults(
  session: AgentSession,
  queueBehavior: XiaoliangPiQueueBehavior,
) {
  session.setSteeringMode(queueBehavior.steeringMode)
  session.setFollowUpMode(queueBehavior.followUpMode)
  session.setAutoCompactionEnabled(true)
  session.setAutoRetryEnabled(true)
}

function validateControlledResources(
  services: Awaited<ReturnType<typeof createAgentSessionServices>>,
  state: MutableRuntimeState,
  expectedExtensionCount: number,
) {
  const extensions = services.resourceLoader.getExtensions()
  if (extensions.errors.length > 0) {
    const details = extensions.errors
      .map(({ path, error }) => `${path}: ${error}`)
      .join('; ')
    throw new Error(`Pi runtime extension adapter failed to load: ${details}`)
  }
  if (extensions.extensions.length !== expectedExtensionCount) {
    throw new Error(
      `Pi runtime resource policy expected ${expectedExtensionCount} inline extensions, received ${extensions.extensions.length}`,
    )
  }

  const skills = services.resourceLoader.getSkills()
  const prompts = services.resourceLoader.getPrompts()
  const unexpectedSkills = skills.skills.filter(
    (skill) => !isPathAllowedByExplicitResources(skill.filePath, state.skillPaths),
  )
  const unexpectedPrompts = prompts.prompts.filter(
    (prompt) => !isPathAllowedByExplicitResources(prompt.filePath, state.promptTemplatePaths),
  )
  if (unexpectedSkills.length > 0 || unexpectedPrompts.length > 0) {
    throw new Error(
      `Pi runtime loaded resources outside the explicit allowlist: ${[
        ...unexpectedSkills.map((skill) => skill.filePath),
        ...unexpectedPrompts.map((prompt) => prompt.filePath),
      ].join(', ')}`,
    )
  }

  const disabledResources = {
    themes: services.resourceLoader.getThemes().themes.length,
    contextFiles: services.resourceLoader.getAgentsFiles().agentsFiles.length,
  }
  const unexpectedDisabled = Object.entries(disabledResources).filter(([, count]) => count > 0)
  if (unexpectedDisabled.length > 0) {
    throw new Error(
      `Pi runtime loaded disabled resources: ${unexpectedDisabled.map(([name, count]) => `${name}=${count}`).join(', ')}`,
    )
  }

  const loaderErrors = [...skills.diagnostics, ...prompts.diagnostics]
    .filter(({ type }) => type === 'error')
  if (loaderErrors.length > 0) {
    throw new Error(
      `Pi controlled resource loading failed: ${loaderErrors.map(({ message }) => message).join('; ')}`,
    )
  }

  const loadedSkills = new Map<string, LoadedControlledSkill>()
  for (const skill of skills.skills) {
    if (loadedSkills.has(skill.name)) {
      throw new Error(`Pi controlled skill name is duplicated: ${skill.name}`)
    }
    const snapshot = snapshotControlledSkillResources(
      skill.filePath,
      skill.baseDir,
      state.skillPaths,
    )
    loadedSkills.set(skill.name, {
      name: skill.name,
      description: skill.description,
      filePath: snapshot.filePath,
      baseDir: snapshot.baseDir,
      source: skill.sourceInfo.source,
      resources: snapshot.resources,
    })
  }
  state.loadedSkills = loadedSkills

  const diagnosticErrors = services.diagnostics.filter(({ type }) => type === 'error')
  if (diagnosticErrors.length > 0) {
    throw new Error(
      `Pi runtime service initialization failed: ${diagnosticErrors.map(({ message }) => message).join('; ')}`,
    )
  }
}

function isPathAllowedByExplicitResources(candidate: string, allowedPaths: readonly string[]) {
  const resolvedCandidate = path.resolve(candidate)
  return allowedPaths.some((allowedPath) => {
    const resolvedAllowed = path.resolve(allowedPath)
    if (resolvedCandidate === resolvedAllowed) return true
    const relative = path.relative(resolvedAllowed, resolvedCandidate)
    return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

function snapshotControlledSkillResources(
  skillFilePath: string,
  skillBaseDir: string,
  allowedPaths: readonly string[],
) {
  const baseStat = fs.lstatSync(skillBaseDir)
  const fileStat = fs.lstatSync(skillFilePath)
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error(`Pi controlled skill base directory is unsafe: ${skillBaseDir}`)
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error(`Pi controlled skill file is unsafe: ${skillFilePath}`)
  }
  const realBaseDir = fs.realpathSync(skillBaseDir)
  const realSkillFilePath = fs.realpathSync(skillFilePath)
  if (
    !isPathAllowedByExplicitResources(realBaseDir, allowedPaths)
    || !isPathAllowedByExplicitResources(realSkillFilePath, [realBaseDir])
  ) {
    throw new Error(`Pi controlled skill resolved outside the explicit allowlist: ${skillFilePath}`)
  }

  const skillRelativePath = toPosixRelativePath(realBaseDir, realSkillFilePath)
  if (skillRelativePath !== 'SKILL.md') {
    throw new Error(`Pi controlled skill entry must be SKILL.md: ${skillFilePath}`)
  }

  const resources = new Map<string, string>()
  let totalChars = 0
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Pi controlled skill cannot contain symbolic links: ${candidate}`)
      }
      if (entry.isDirectory()) {
        visit(candidate)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = toPosixRelativePath(realBaseDir, candidate)
      if (!CONTROLLED_SKILL_RESOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
        continue
      }
      if (resources.size >= MAX_CONTROLLED_SKILL_RESOURCE_FILES) {
        throw new Error(`Pi controlled skill exceeds ${MAX_CONTROLLED_SKILL_RESOURCE_FILES} text resources`)
      }
      const resourceStat = fs.lstatSync(candidate)
      if (resourceStat.isSymbolicLink() || !resourceStat.isFile()) {
        throw new Error(`Pi controlled skill resource is unsafe: ${candidate}`)
      }
      const realCandidate = fs.realpathSync(candidate)
      if (!isPathAllowedByExplicitResources(realCandidate, [realBaseDir])) {
        throw new Error(`Pi controlled skill resource escaped its root: ${candidate}`)
      }
      const content = fs.readFileSync(realCandidate, 'utf8')
      if (content.length > MAX_CONTROLLED_SKILL_RESOURCE_CHARS) {
        throw new Error(`Pi controlled skill resource exceeds ${MAX_CONTROLLED_SKILL_RESOURCE_CHARS} characters`)
      }
      totalChars += content.length
      if (totalChars > MAX_CONTROLLED_SKILL_TOTAL_CHARS) {
        throw new Error(`Pi controlled skill exceeds ${MAX_CONTROLLED_SKILL_TOTAL_CHARS} total characters`)
      }
      resources.set(relativePath, content)
    }
  }
  visit(realBaseDir)
  if (!resources.has('SKILL.md')) {
    throw new Error(`Pi controlled skill snapshot is missing SKILL.md: ${skillFilePath}`)
  }
  return {
    filePath: realSkillFilePath,
    baseDir: realBaseDir,
    resources,
  }
}

function toPosixRelativePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Pi controlled resource escaped its root: ${candidate}`)
  }
  return relative.split(path.sep).join('/')
}

function validateToolDefinitions(tools: readonly AgentTool[]) {
  const byName = new Map<string, AgentTool>()
  for (const tool of tools) {
    const name = tool.name.trim()
    if (!name) throw new Error('Pi runtime tool name cannot be empty')
    if (byName.has(name)) throw new Error(`Pi runtime tool name is duplicated: ${name}`)
    byName.set(name, tool)
  }
  return byName
}

function replaceArrayContents<T>(target: T[], source: readonly T[]) {
  target.splice(0, target.length, ...source)
}

function extensionDisplayName(extensionPath: string) {
  const inline = /^<inline:(.+)>$/.exec(extensionPath)
  return inline?.[1] || path.basename(extensionPath).replace(/\.(?:c|m)?[jt]s$/i, '')
}

function createControlledSkillReadTool(state: MutableRuntimeState): AgentTool {
  return {
    name: CONTROLLED_SKILL_READ_TOOL_NAME,
    label: 'Read controlled Pi skill',
    description: 'Read a Xiaoliang-approved Pi skill or one of its bounded text resources.',
    parameters: Type.Object({
      name: Type.String({ description: 'Exact skill name from <available_skills>.' }),
      resource: Type.Optional(Type.String({
        description: 'Optional skill-relative text resource such as references/checklist.md.',
      })),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as { name?: unknown; resource?: unknown }
      const name = String(params.name ?? '').trim()
      const skill = state.loadedSkills.get(name)
      if (!skill) throw new Error(`受控 Pi skill 不存在或未启用：${name}`)

      const resource = String(params.resource ?? '').replace(/\\/g, '/').trim()
      if (resource) {
        if (
          path.isAbsolute(resource)
          || resource.split('/').some((segment) => segment === '..' || segment === '.')
          || !CONTROLLED_SKILL_RESOURCE_EXTENSIONS.has(path.extname(resource).toLowerCase())
        ) {
          throw new Error('skill resource 只允许 skill 目录内的相对文本路径。')
        }
      }
      const resourcePath = resource || 'SKILL.md'
      const content = skill.resources.get(resourcePath)
      if (content === undefined) throw new Error(`skill resource 不存在或未进入受控快照：${resourcePath}`)
      return {
        content: [{ type: 'text', text: content }],
        details: {
          skill: skill.name,
          path: path.join(skill.baseDir, ...resourcePath.split('/')),
          source: skill.source,
        },
      }
    },
  }
}

function appendControlledSkillsPrompt(systemPrompt: string, state: MutableRuntimeState) {
  if (
    state.loadedSkills.size === 0
    || !state.activeToolNames.includes(CONTROLLED_SKILL_READ_TOOL_NAME)
  ) {
    return systemPrompt
  }
  const lines = [
    systemPrompt.trim(),
    '',
    '[受控 Pi skills]',
    `以下 skills 已由晓量校验并加载。任务与描述匹配时，必须先调用 ${CONTROLLED_SKILL_READ_TOOL_NAME} 读取完整 SKILL.md，再遵循其中流程；不要直接读取未列出的本地 skill。`,
  ]
  for (const skill of [...state.loadedSkills.values()].sort((left, right) => (
    left.name.localeCompare(right.name)
  ))) {
    lines.push(`- ${skill.name}：${skill.description.replace(/\s+/g, ' ').trim()}`)
  }
  return lines.join('\n')
}

function systemMessageEnvelope<T>(
  message: XiaoliangPiSystemMessage<T>,
): XiaoliangPiSystemMessageEnvelope<T> {
  return {
    systemEventId: message.id,
    ...(message.details === undefined ? {} : { payload: message.details }),
  }
}

function systemEventIdFromMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const details = (message as { details?: unknown }).details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const eventId = (details as { systemEventId?: unknown }).systemEventId
  return typeof eventId === 'string' && eventId.trim() ? eventId.trim() : null
}

export class XiaoliangPiAgentHost {
  private readonly state: MutableRuntimeState
  private readonly options: XiaoliangPiAgentHostOptions
  private readonly runtime: AgentSessionRuntime
  private unsubscribe: (() => void) | undefined
  private bindingToken: object = {}
  private eventTail: Promise<void> = Promise.resolve()
  private eventError: unknown
  private generation: number
  private sequence = 0
  private accepting = true
  private eventsActive = true
  private disposePromise: Promise<void> | undefined
  private compactionPromise: Promise<CompactionResult> | undefined
  private abortRequested = false
  private readonly payloadAdaptedAgents = new WeakSet<Agent>()
  private readonly steeringWaiters = new Set<() => void>()
  private items: XiaoliangShadowQueuedItem[] = []
  private readonly pendingSystemMessages = new Map<string, XiaoliangPendingSystemMessage>()
  private queueMode: XiaoliangQueueMode = 'live'
  private queueMutation: Promise<void> = Promise.resolve()

  private constructor(
    runtime: AgentSessionRuntime,
    state: MutableRuntimeState,
    options: XiaoliangPiAgentHostOptions,
  ) {
    this.runtime = runtime
    this.state = state
    // The transferred queue may contain large base64 images. It belongs to the
    // mutable shadow queue, not the long-lived runtime configuration object.
    this.options = { ...options, initialHeldQueueItems: undefined }
    this.generation = options.generation - 1
    this.bindSession(runtime.session)
    this.restoreHeldQueuedItems(options.initialHeldQueueItems ?? [])
    runtime.setBeforeSessionInvalidate(() => this.detachSession())
    runtime.setRebindSession(async (session) => this.bindSession(session))
  }

  static async create(options: XiaoliangPiAgentHostOptions): Promise<XiaoliangPiAgentHost> {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error(`Invalid Pi runtime generation: ${options.generation}`)
    }

    const initialResources = options.controlledResources?.initial ?? {
      skillPaths: [],
      promptTemplatePaths: [],
      diagnostics: [],
      revision: '',
    }
    const state: MutableRuntimeState = {
      systemPrompt: options.systemPrompt,
      callPurpose: 'main',
      tools: validateToolDefinitions(options.tools),
      activeToolNames: options.tools.map((tool) => tool.name),
      toolSelectionInitialized: false,
      skillPaths: [...initialResources.skillPaths],
      promptTemplatePaths: [...initialResources.promptTemplatePaths],
      resourceDiagnostics: [...initialResources.diagnostics],
      resourceRevision: initialResources.revision,
      resourcesReloadedAt: null,
      extensionErrors: [],
      loadedSkills: new Map(),
      runtimeQueueBehavior: null,
    }
    if (options.controlledResources) {
      if (state.tools.has(CONTROLLED_SKILL_READ_TOOL_NAME)) {
        throw new Error(`${CONTROLLED_SKILL_READ_TOOL_NAME} is reserved by the Pi controlled resource runtime`)
      }
      state.tools.set(CONTROLLED_SKILL_READ_TOOL_NAME, createControlledSkillReadTool(state))
      state.activeToolNames.push(CONTROLLED_SKILL_READ_TOOL_NAME)
    }
    const inlineExtensions = [...(options.controlledResources?.inlineExtensions ?? [])]
    const expectedExtensionCount = 1 + inlineExtensions.length
    let runtimeCreationCount = 0

    const refreshControlledResources = async () => {
      const resolution = await options.controlledResources?.resolve?.()
      if (!resolution) return
      replaceArrayContents(state.skillPaths, resolution.skillPaths)
      replaceArrayContents(state.promptTemplatePaths, resolution.promptTemplatePaths)
      state.resourceDiagnostics = [...resolution.diagnostics]
      state.resourceRevision = resolution.revision
    }
    const initialMessages = options.initialMessages ?? []
    const initialSessionManager = options.sessionManager ?? SessionManager.inMemory(options.cwd)
    if (!options.sessionManager) {
      for (const message of initialMessages) {
        if (!isPersistableMessage(message)) continue
        initialSessionManager.appendMessage(message)
      }
    }

    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      agentDir,
      sessionManager,
      sessionStartEvent,
    }) => {
      if (runtimeCreationCount > 0) {
        await refreshControlledResources()
      }
      runtimeCreationCount += 1
      const persistedContext = sessionManager.buildSessionContext()
      const hasThinkingEntry = sessionManager
        .getBranch()
        .some((entry) => entry.type === 'thinking_level_change')
      const thinkingLevelSource = options.thinkingLevelSource ?? 'session'
      const restoredThinkingLevel = thinkingLevelSource === 'session' && hasThinkingEntry
        ? persistedContext.thinkingLevel as ThinkingLevel
        : options.thinkingLevel
      const settingsManager = SettingsManager.inMemory({
        defaultProvider: options.model.provider,
        defaultModel: options.model.id,
        defaultThinkingLevel: restoredThinkingLevel,
        compaction: XIAOLIANG_PI_RESILIENCE_POLICY.compaction,
        retry: XIAOLIANG_PI_RESILIENCE_POLICY.retry,
        images: {
          autoResize: false,
          blockImages: false,
        },
      }, { projectTrusted: false })
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
      modelRuntime.registerNativeProvider(options.provider ?? createManagedGatewayProvider(options))

      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager,
        modelRuntime,
        resourceLoaderOptions: {
          ...XIAOLIANG_PI_RESOURCE_POLICY,
          systemPrompt: state.systemPrompt,
          systemPromptOverride: () => state.systemPrompt,
          additionalSkillPaths: state.skillPaths,
          additionalPromptTemplatePaths: state.promptTemplatePaths,
          extensionFactories: [
            createRuntimeExtension(options, state),
            ...inlineExtensions,
          ],
        },
      })
      const created = await createAgentSession({
        cwd,
        agentDir,
        model: options.model,
        thinkingLevel: restoredThinkingLevel,
        noTools: 'builtin',
        modelRuntime,
        resourceLoader: services.resourceLoader,
        sessionManager,
        settingsManager,
        sessionStartEvent,
      })
      await created.session.bindExtensions({
        mode: 'rpc',
        onError: (error) => {
          state.extensionErrors.push(error)
          if (state.extensionErrors.length > 50) state.extensionErrors.shift()
          options.onExtensionError?.(error)
        },
      })
      state.runtimeQueueBehavior ??= readRuntimeQueueBehavior(created.session)
      applyRuntimeDefaults(created.session, state.runtimeQueueBehavior)
      if (!state.toolSelectionInitialized) {
        state.activeToolNames = created.session.getActiveToolNames()
        state.toolSelectionInitialized = true
      } else {
        created.session.setActiveToolsByName(state.activeToolNames)
      }
      validateControlledResources(services, state, expectedExtensionCount)
      validateActiveTools(created.session, state.activeToolNames)
      return {
        ...created,
        services,
        diagnostics: services.diagnostics,
      }
    }

    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: options.cwd,
      agentDir: options.agentDir,
      sessionManager: initialSessionManager,
    })
    if (!options.sessionManager && initialMessages.length > 0) {
      runtime.session.agent.state.messages = [...initialMessages]
    }
    if (options.controlledResources) {
      state.resourcesReloadedAt = new Date().toISOString()
    }
    return new XiaoliangPiAgentHost(runtime, state, options)
  }

  get session(): AgentSession {
    return this.runtime.session
  }

  get agent(): Agent {
    return this.runtime.session.agent
  }

  get currentGeneration(): number {
    return this.generation
  }

  get isRunning(): boolean {
    return this.runtime.session.isStreaming
  }

  get isBusy(): boolean {
    return this.runtime.session.isStreaming
      || this.runtime.session.isCompacting
      || this.runtime.session.isRetrying
  }

  getQueueSnapshot(): XiaoliangPiQueueSnapshot {
    return {
      steering: [...this.runtime.session.getSteeringMessages()],
      followUp: [...this.runtime.session.getFollowUpMessages()],
    }
  }

  getQueuedItems(): XiaoliangQueuedItem[] {
    return this.items.map(cloneQueuedItem)
  }

  get steeringQueueLength(): number {
    const piSteerCount = this.runtime.session.getSteeringMessages().length
    if (this.queueMode !== 'live') return piSteerCount
    return this.items.filter((item) => item.kind === 'steer').length || piSteerCount
  }

  /**
   * Resolves once the user has queued a steering message. Background task waits
   * use this to yield the turn back so the interjection is answered promptly.
   * Follow-up messages are deliberately excluded: they are meant to run later.
   */
  waitForSteeringMessage(signal?: AbortSignal): Promise<void> {
    if (this.steeringQueueLength > 0) return Promise.resolve()
    if (signal?.aborted) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const release = () => {
        this.steeringWaiters.delete(release)
        signal?.removeEventListener('abort', release)
        resolve()
      }
      this.steeringWaiters.add(release)
      signal?.addEventListener('abort', release, { once: true })
    })
  }

  getResourceStatus(): XiaoliangPiRuntimeResourceStatus {
    const resourceLoader = this.runtime.services.resourceLoader
    const extensions = resourceLoader.getExtensions()
    const skills = resourceLoader.getSkills()
    const prompts = resourceLoader.getPrompts()
    const activeTools = new Set(this.runtime.session.getActiveToolNames())
    const loaderDiagnostics = [...skills.diagnostics, ...prompts.diagnostics].map((diagnostic) => ({
      level: diagnostic.type === 'error' ? 'error' as const : 'warning' as const,
      code: 'pi_loader_diagnostic' as const,
      message: diagnostic.message,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
    }))
    const extensionDiagnostics = this.state.extensionErrors.map((error) => ({
      level: 'error' as const,
      code: 'extension_runtime_error' as const,
      message: `${error.event}: ${error.error}`,
      path: error.extensionPath,
    }))

    return {
      enabled: Boolean(this.options.controlledResources),
      revision: this.state.resourceRevision,
      reloadedAt: this.state.resourcesReloadedAt,
      extensions: extensions.extensions
        .map((extension) => ({
          name: extensionDisplayName(extension.path),
          path: extension.path,
          source: extension.sourceInfo.source,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      skills: skills.skills
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: skill.filePath,
          source: skill.sourceInfo.source,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      promptTemplates: prompts.prompts
        .map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          path: prompt.filePath,
          source: prompt.sourceInfo.source,
          ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      tools: this.runtime.session.getAllTools()
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          source: tool.sourceInfo.source,
          active: activeTools.has(tool.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      diagnostics: [
        ...this.state.resourceDiagnostics,
        ...loaderDiagnostics,
        ...extensionDiagnostics,
      ],
    }
  }

  setActiveTools(toolNames: readonly string[]): XiaoliangPiRuntimeResourceStatus {
    this.assertReloadable()
    const configured = new Set(this.runtime.session.getAllTools().map((tool) => tool.name))
    const normalized = [...new Set(toolNames.map((name) => name.trim()).filter(Boolean))]
    const unknown = normalized.filter((name) => !configured.has(name))
    if (unknown.length > 0) {
      throw new Error(`Pi runtime cannot activate unknown tools: ${unknown.join(', ')}`)
    }
    this.state.activeToolNames = normalized
    this.runtime.session.setActiveToolsByName(normalized)
    validateActiveTools(this.runtime.session, normalized)
    return this.getResourceStatus()
  }

  async registerTools(
    tools: readonly AgentTool[],
    options: { activate?: boolean } = {},
  ): Promise<XiaoliangPiRuntimeResourceStatus> {
    this.assertReloadable()
    const additions = validateToolDefinitions(tools)
    if (additions.has(CONTROLLED_SKILL_READ_TOOL_NAME)) {
      throw new Error(`${CONTROLLED_SKILL_READ_TOOL_NAME} is reserved by the Pi controlled resource runtime`)
    }
    for (const [name, tool] of additions) this.state.tools.set(name, tool)
    if (options.activate !== false) {
      this.state.activeToolNames = [
        ...new Set([...this.state.activeToolNames, ...additions.keys()]),
      ]
    }
    await this.reloadRuntimeResources(false)
    return this.getResourceStatus()
  }

  async replaceTools(
    tools: readonly AgentTool[],
    activeToolNames?: readonly string[],
  ): Promise<XiaoliangPiRuntimeResourceStatus> {
    this.assertReloadable()
    const replacement = validateToolDefinitions(tools)
    if (this.options.controlledResources) {
      if (replacement.has(CONTROLLED_SKILL_READ_TOOL_NAME)) {
        throw new Error(`${CONTROLLED_SKILL_READ_TOOL_NAME} is reserved by the Pi controlled resource runtime`)
      }
      replacement.set(CONTROLLED_SKILL_READ_TOOL_NAME, createControlledSkillReadTool(this.state))
    }
    const normalizedActiveToolNames = activeToolNames
      ? [...new Set(activeToolNames.map((name) => name.trim()).filter(Boolean))]
      : [...replacement.keys()]
    const unknown = normalizedActiveToolNames.filter((name) => !replacement.has(name))
    if (unknown.length > 0) {
      throw new Error(`Pi runtime cannot activate unknown replacement tools: ${unknown.join(', ')}`)
    }
    this.state.tools = replacement
    this.state.activeToolNames = normalizedActiveToolNames
    await this.reloadRuntimeResources(false)
    return this.getResourceStatus()
  }

  async reloadResources(): Promise<XiaoliangPiRuntimeResourceStatus> {
    this.assertReloadable()
    await this.reloadRuntimeResources(true)
    return this.getResourceStatus()
  }

  setSystemPrompt(systemPrompt: string) {
    this.assertAccepting()
    this.state.systemPrompt = systemPrompt
    this.runtime.session.agent.state.systemPrompt = systemPrompt
  }

  setSessionName(name: string) {
    this.assertAccepting()
    this.runtime.session.setSessionName(name.trim())
  }

  getSessionStats(): SessionStats {
    return this.runtime.session.getSessionStats()
  }

  async listSessions(): Promise<SessionInfo[]> {
    return SessionManager.list(
      this.runtime.cwd,
      this.runtime.session.sessionManager.getSessionDir(),
    )
  }

  exportToJsonl(outputPath?: string): string {
    this.assertAccepting()
    return this.runtime.session.exportToJsonl(outputPath)
  }

  async exportToHtml(outputPath?: string): Promise<string> {
    this.assertAccepting()
    return withPiHtmlExportAssets(() => this.runtime.session.exportToHtml(outputPath))
  }

  async prompt(text: string, images?: ImageContent[]): Promise<void> {
    this.assertAccepting()
    this.abortRequested = false
    let operationError: unknown
    try {
      await this.runtime.session.prompt(text, images?.length ? { images } : undefined)
    } catch (error) {
      operationError = error
    }

    let eventError: unknown
    try {
      await this.drainEvents()
    } catch (error) {
      eventError = error
    }
    if (operationError !== undefined) throw operationError
    if (eventError !== undefined) throw eventError
  }

  async steer(text: string, images?: ImageContent[]): Promise<void> {
    await this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      this.assertQueueable(text, images)
      await this.pushQueuedItem('steer', text, images)
    })
  }

  async followUp(text: string, images?: ImageContent[]): Promise<void> {
    await this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      this.assertQueueable(text, images)
      await this.pushQueuedItem('followUp', text, images)
    })
  }

  /**
   * Injects a host-owned message after the live agent would otherwise stop.
   * Pi keeps custom messages out of its string queue projection; the additional
   * registry below also preserves them when user queue edits rebuild Pi's queues.
   */
  async followUpSystemMessage<T>(message: XiaoliangPiSystemMessage<T>): Promise<void> {
    await this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      const normalized = this.normalizeSystemMessage(message)
      const existing = this.pendingSystemMessages.get(normalized.id)
      if (existing) {
        if (!existing.queued && this.runtime.session.isStreaming) {
          await this.pushSystemMessage(existing)
        }
        return
      }

      this.assertQueueable(normalized.content)
      const pending: XiaoliangPendingSystemMessage = {
        message: normalized,
        queued: false,
      }
      this.pendingSystemMessages.set(normalized.id, pending)
      try {
        await this.pushSystemMessage(pending)
      } catch (error) {
        this.pendingSystemMessages.delete(normalized.id)
        throw error
      }
    })
  }

  /** Starts an idle Pi turn with a host-owned message instead of a fake user prompt. */
  async promptSystemMessage<T>(message: XiaoliangPiSystemMessage<T>): Promise<void> {
    this.assertAccepting()
    if (this.runtime.session.isStreaming) {
      throw new Error('Pi agent session is already running')
    }
    const normalized = this.normalizeSystemMessage(message)
    this.abortRequested = false
    let operationError: unknown
    try {
      await this.runtime.session.sendCustomMessage({
        customType: normalized.customType,
        content: normalized.content,
        display: false,
        details: systemMessageEnvelope(normalized),
      }, { triggerTurn: true })
    } catch (error) {
      operationError = error
    }

    let eventError: unknown
    try {
      await this.drainEvents()
    } catch (error) {
      eventError = error
    }
    if (operationError !== undefined) throw operationError
    if (eventError !== undefined) throw eventError
  }

  async removeQueuedItem(id: string): Promise<XiaoliangQueuedItem> {
    return this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      const index = this.items.findIndex((item) => item.id === id)
      if (index < 0) {
        throw new Error('未找到排队消息。')
      }
      const removed = this.items[index]
      if (!removed) {
        throw new Error('未找到排队消息。')
      }
      const nextItems = this.items
        .filter((item) => item.id !== id)
        .map(cloneShadowQueuedItem)
      if (this.shouldSyncPiQueue()) {
        await this.rebuildPiQueues(nextItems)
      } else {
        this.items = nextItems
        this.enqueueShadowQueueEvent()
      }
      await this.drainEvents()
      return cloneQueuedItem(removed)
    })
  }

  async updateQueuedItem(
    id: string,
    text: string,
    images?: ImageContent[],
  ): Promise<XiaoliangQueuedItem> {
    return this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      const itemIndex = this.items.findIndex((entry) => entry.id === id)
      if (itemIndex < 0) {
        throw new Error('未找到排队消息。')
      }
      const nextText = text.trim()
      const nextImages = cloneImages(images)
      if (!nextText && nextImages.length === 0) {
        throw new Error('排队消息不能为空。')
      }
      const nextItems = this.items.map((item, index) => (
        index === itemIndex
          ? {
              ...cloneShadowQueuedItem(item),
              text: nextText,
              images: nextImages,
              piText: piQueueText(item.id, nextText, nextImages),
            }
          : cloneShadowQueuedItem(item)
      ))
      const requested = nextItems[itemIndex]
      if (!requested) {
        throw new Error('未找到排队消息。')
      }
      if (this.shouldSyncPiQueue()) {
        await this.rebuildPiQueues(nextItems)
      } else {
        this.items = nextItems
        this.enqueueShadowQueueEvent()
      }
      await this.drainEvents()
      const updated = this.items.find((entry) => entry.id === id)
      // Pi may consume the row while its queue is being rebuilt. The edit still
      // succeeded; return the requested value without resurrecting the row.
      return cloneQueuedItem(updated ?? requested)
    })
  }

  async setQueuedItemKind(id: string, kind: XiaoliangQueueKind): Promise<XiaoliangQueuedItem> {
    return this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      if (kind !== 'steer' && kind !== 'followUp') {
        throw new Error('排队消息类型无效。')
      }
      const itemIndex = this.items.findIndex((entry) => entry.id === id)
      if (itemIndex < 0) {
        throw new Error('未找到排队消息。')
      }
      const current = this.items[itemIndex]
      if (!current) {
        throw new Error('未找到排队消息。')
      }
      if (current.kind === kind) {
        return cloneQueuedItem(current)
      }
      const nextItems = this.items.map((item, index) => (
        index === itemIndex
          ? { ...cloneShadowQueuedItem(item), kind }
          : cloneShadowQueuedItem(item)
      ))
      const requested = nextItems[itemIndex]
      if (!requested) {
        throw new Error('未找到排队消息。')
      }
      if (this.shouldSyncPiQueue()) {
        await this.rebuildPiQueues(nextItems)
      } else {
        this.items = nextItems
        this.enqueueShadowQueueEvent()
      }
      await this.drainEvents()
      const updated = this.items.find((entry) => entry.id === id)
      // A turn boundary can drain the row during rebuild. Do not turn that
      // successful delivery into an edit failure or put it back into shadow.
      return cloneQueuedItem(updated ?? requested)
    })
  }

  async clearQueue(): Promise<XiaoliangPiQueueSnapshot> {
    return this.enqueueQueueMutation(async () => {
      this.assertAccepting()
      const cleared = this.snapshotShadowQueue()
      this.items = []
      this.queueMode = 'rebuilding'
      await this.clearPiQueuesPreservingSystemMessages()
      this.queueMode = 'live'
      this.enqueueShadowQueueEvent()
      await this.drainEvents()
      return cleared
    })
  }

  async compact(customInstructions?: string): Promise<CompactionResult> {
    this.assertAccepting()
    if (this.runtime.session.isCompacting) {
      throw new Error('Pi session compaction is already running')
    }

    this.abortRequested = false
    const operation = this.runtime.session.compact(customInstructions)
    this.compactionPromise = operation
    let operationError: unknown
    let result: CompactionResult | undefined
    try {
      result = await operation
    } catch (error) {
      operationError = error
    } finally {
      if (this.compactionPromise === operation) {
        this.compactionPromise = undefined
      }
      this.state.callPurpose = 'main'
    }

    let eventError: unknown
    try {
      await this.drainEvents()
    } catch (error) {
      eventError = error
    }
    if (operationError !== undefined) throw operationError
    if (eventError !== undefined) throw eventError
    if (!result) throw new Error('Pi session compaction did not return a result')
    return result
  }

  async navigateTree(
    targetEntryId: string,
    options?: {
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
    },
  ): Promise<Awaited<ReturnType<AgentSession['navigateTree']>>> {
    this.assertAccepting()
    if (this.isBusy) {
      throw new Error('Pi session 正在运行，暂时不能切换 Tree 路径。')
    }

    this.abortRequested = false
    let operationError: unknown
    let result: Awaited<ReturnType<AgentSession['navigateTree']>> | undefined
    try {
      result = await this.runtime.session.navigateTree(targetEntryId, options)
    } catch (error) {
      operationError = error
    } finally {
      this.state.callPurpose = 'main'
    }

    let eventError: unknown
    try {
      await this.drainEvents()
    } catch (error) {
      eventError = error
    }
    if (operationError !== undefined) throw operationError
    if (eventError !== undefined) throw eventError
    if (!result) throw new Error('Pi Tree navigate 未返回结果。')
    return result
  }

  async abort(): Promise<XiaoliangPiQueueSnapshot> {
    if (!this.accepting) return { steering: [], followUp: [] }
    return this.abortAndDrain()
  }

  abortCompaction(): void {
    this.assertAccepting()
    this.runtime.session.abortCompaction()
  }

  abortBranchSummary(): void {
    this.assertAccepting()
    this.runtime.session.abortBranchSummary()
  }

  abortRetry(): void {
    this.assertAccepting()
    this.runtime.session.abortRetry()
  }

  async waitForIdle(): Promise<void> {
    await this.runtime.session.waitForIdle()
    await this.drainEvents()
  }

  async reset(): Promise<Agent> {
    this.assertAccepting()
    await this.abortAndDrain()
    this.pendingSystemMessages.clear()
    const result = await this.runtime.newSession()
    if (result.cancelled) {
      throw new Error('Pi session reset was cancelled')
    }
    await this.drainEvents()
    return this.agent
  }

  async switchSession(sessionFile: string, cwdOverride?: string): Promise<Agent> {
    this.assertAccepting()
    await this.abortAndDrain()
    this.pendingSystemMessages.clear()
    const result = await this.runtime.switchSession(sessionFile, { cwdOverride })
    if (result.cancelled) {
      throw new Error('Pi session switch was cancelled')
    }
    await this.drainEvents()
    return this.agent
  }

  async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<Agent> {
    this.assertAccepting()
    await this.abortAndDrain()
    this.pendingSystemMessages.clear()
    const result = await this.runtime.importFromJsonl(inputPath, cwdOverride)
    if (result.cancelled) {
      throw new Error('Pi session import was cancelled')
    }
    await this.drainEvents()
    return this.agent
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.performDispose()
    return this.disposePromise
  }

  private bindSession(session: AgentSession) {
    this.detachSession()
    this.items = []
    for (const pending of this.pendingSystemMessages.values()) pending.queued = false
    this.queueMode = 'live'
    this.abortRequested = false
    this.state.callPurpose = 'main'
    this.adaptSummarizationPayloads(session.agent)
    this.generation += 1
    this.sequence = 0
    const token = this.bindingToken
    this.unsubscribe = session.subscribe((event) => {
      this.observeSessionEvent(session, event)
      this.enqueueEvent(event, token)
    })
  }

  private detachSession() {
    this.releaseSteeringWaiters()
    this.bindingToken = {}
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private adaptSummarizationPayloads(agent: Agent) {
    if (this.payloadAdaptedAgents.has(agent)) return
    this.payloadAdaptedAgents.add(agent)
    const streamFunction = agent.streamFunction
    agent.streamFunction = (model, context, streamOptions) => streamFunction(
      model,
      context,
      {
        ...streamOptions,
        onPayload: async (payload, currentModel) => {
          const inherited = streamOptions?.onPayload
            ? (await streamOptions.onPayload(payload, currentModel)) ?? payload
            : await transformProviderPayload(
                this.options,
                this.state,
                payload,
                currentModel,
                true,
              )
          return applyCallPurpose(inherited, this.state)
        },
      },
    )
  }

  private enqueueEvent(
    event: AgentSessionEvent,
    token: object,
    options: { force?: boolean } = {},
  ) {
    if (
      event.type === 'queue_update'
      && this.queueMode !== 'live'
      && options.force !== true
    ) {
      return
    }
    const nextEvent = event.type === 'queue_update'
      ? this.projectQueueEvent(event, options.force !== true)
      : event
    const envelope: XiaoliangPiAgentHostEvent = {
      generation: this.generation,
      sequence: ++this.sequence,
      event: nextEvent,
    }
    this.eventTail = this.eventTail
      .then(async () => {
        if (!this.eventsActive || token !== this.bindingToken) return
        await this.options.onEvent(envelope)
      })
      .catch((error) => {
        this.eventError ??= error
        try {
          this.options.onEventError?.(error)
        } catch {
          // Event delivery errors are surfaced by drainEvents().
        }
      })
  }

  private observeSessionEvent(session: AgentSession, event: AgentSessionEvent) {
    if (event.type === 'message_start' && event.message.role === 'custom') {
      const eventId = systemEventIdFromMessage(event.message)
      if (eventId) this.pendingSystemMessages.delete(eventId)
    }
    if (
      (event.type === 'message_start' || event.type === 'message_end')
      && event.message.role === 'user'
    ) {
      clearDeliveredImageQueuePlaceholder(event.message)
    }
    const hasUnqueuedSystemMessages = [...this.pendingSystemMessages.values()]
      .some((pending) => !pending.queued)
    if (
      event.type === 'agent_start'
      && (this.queueMode === 'held' || hasUnqueuedSystemMessages)
    ) {
      if (this.items.length === 0 && !hasUnqueuedSystemMessages) {
        this.queueMode = 'live'
        return
      }
      this.queueMode = 'rebuilding'
      queueMicrotask(() => {
        void this.enqueueQueueMutation(async () => {
          const hasPendingSystemMessages = [...this.pendingSystemMessages.values()]
            .some((pending) => !pending.queued)
          if (!this.accepting || (this.items.length === 0 && !hasPendingSystemMessages)) {
            this.queueMode = this.items.length === 0 ? 'live' : 'held'
            return
          }
          if (this.runtime.session.isStreaming) {
            if (this.items.length > 0) {
              await this.rebuildPiQueues()
            } else {
              await this.restorePendingSystemMessages()
              this.queueMode = 'live'
            }
            await this.drainEvents()
            return
          }
          this.queueMode = 'held'
        }).catch((error) => {
          this.eventError ??= error
          try {
            this.options.onEventError?.(error)
          } catch {
            // The original queue error is surfaced by drainEvents().
          }
        })
      })
    }
    if (event.type === 'queue_update') {
      // Only Pi's current queue can wake an in-flight steering waiter. During a
      // rebuild clearQueue() emits an empty update while shadow still has the old
      // kind, so consulting shadow here can falsely wake a waiter on demotion.
      if (event.steering.length > 0) {
        this.releaseSteeringWaiters()
      }
      return
    }
    if (event.type === 'compaction_start') {
      this.state.callPurpose = 'compaction'
      if (this.abortRequested) {
        queueMicrotask(() => {
          if (this.abortRequested) session.abortCompaction()
        })
      }
      return
    }
    if (event.type === 'compaction_end') {
      this.state.callPurpose = 'main'
    }
  }

  private releaseSteeringWaiters() {
    if (this.steeringWaiters.size === 0) return
    for (const release of [...this.steeringWaiters]) release()
  }

  private async abortAndDrain(): Promise<XiaoliangPiQueueSnapshot> {
    const cleared = await this.enqueueQueueMutation(async () => {
      this.queueMode = 'held'
      await this.clearPiQueuesPreservingSystemMessages()
      this.enqueueShadowQueueEvent()
      return this.snapshotShadowQueue()
    })
    this.releaseSteeringWaiters()
    this.abortRequested = true
    const pendingCompaction = this.compactionPromise
    this.runtime.session.abortCompaction()
    this.runtime.session.abortBranchSummary()
    this.runtime.session.abortRetry()
    await this.runtime.session.abort()
    if (pendingCompaction) {
      await pendingCompaction.catch(() => undefined)
    }
    await this.runtime.session.waitForIdle()
    await this.drainEvents()
    this.state.callPurpose = 'main'
    return cleared
  }

  private async reloadRuntimeResources(refreshPaths: boolean) {
    if (refreshPaths) {
      const resolution = await this.options.controlledResources?.resolve?.()
      if (resolution) {
        replaceArrayContents(this.state.skillPaths, resolution.skillPaths)
        replaceArrayContents(this.state.promptTemplatePaths, resolution.promptTemplatePaths)
        this.state.resourceDiagnostics = [...resolution.diagnostics]
        this.state.resourceRevision = resolution.revision
      }
    }

    this.state.extensionErrors = []
    const activeToolNames = [...this.state.activeToolNames]
    const heldQueueItems = this.getQueuedItems()
    try {
      await this.runtime.session.reload()
    } catch (error) {
      this.restoreHeldQueuedItems(heldQueueItems)
      throw error
    }
    this.restoreHeldQueuedItems(heldQueueItems)
    if (heldQueueItems.length > 0) {
      this.enqueueShadowQueueEvent()
    }
    this.runtime.session.setActiveToolsByName(activeToolNames)
    validateControlledResources(
      this.runtime.services,
      this.state,
      1 + (this.options.controlledResources?.inlineExtensions?.length ?? 0),
    )
    validateActiveTools(this.runtime.session, activeToolNames)
    this.state.resourcesReloadedAt = new Date().toISOString()
    await this.drainEvents()
  }

  private async drainEvents() {
    await this.eventTail
    if (this.eventError === undefined) return
    const error = this.eventError
    this.eventError = undefined
    throw error
  }

  private async performDispose() {
    this.accepting = false
    let pendingError: unknown
    try {
      await this.abortAndDrain()
    } catch (error) {
      pendingError = error
    }

    this.eventsActive = false
    this.detachSession()
    this.pendingSystemMessages.clear()
    try {
      await this.runtime.dispose()
    } catch (error) {
      pendingError ??= error
    }
    if (pendingError !== undefined) throw pendingError
  }

  private assertAccepting() {
    if (!this.accepting) {
      throw new Error('Xiaoliang Pi agent host is disposed')
    }
  }

  private assertReloadable() {
    this.assertAccepting()
    if (this.isBusy) {
      throw new Error('Pi session 正在运行，暂时不能重载资源或注册工具。')
    }
  }

  private assertQueueable(text: string, images?: ImageContent[]) {
    if (!text.trim() && !images?.length) {
      throw new Error('排队消息不能为空。')
    }
    if (!this.runtime.session.isStreaming) {
      throw new Error('Pi agent session is not running')
    }
  }

  private normalizeSystemMessage<T>(
    message: XiaoliangPiSystemMessage<T>,
  ): XiaoliangPiSystemMessage<T> {
    const id = message.id.trim()
    const customType = message.customType.trim()
    const content = message.content.trim()
    if (!id || id.length > 256) throw new Error('系统消息事件 ID 无效。')
    if (!customType || customType.length > 128) throw new Error('系统消息类型无效。')
    if (!content) throw new Error('系统消息内容不能为空。')
    return {
      id,
      customType,
      content,
      ...(message.details === undefined ? {} : { details: message.details }),
    }
  }

  private async pushSystemMessage(pending: XiaoliangPendingSystemMessage): Promise<void> {
    await this.runtime.session.sendCustomMessage({
      customType: pending.message.customType,
      content: pending.message.content,
      display: false,
      details: systemMessageEnvelope(pending.message),
    }, { deliverAs: 'followUp' })
    pending.queued = true
  }

  private async restorePendingSystemMessages(): Promise<void> {
    if (!this.runtime.session.isStreaming) return
    for (const pending of [...this.pendingSystemMessages.values()]) {
      if (!pending.queued) await this.pushSystemMessage(pending)
    }
  }

  /** Pi clears user and custom queues together; immediately restore host-owned rows. */
  private async clearPiQueuesPreservingSystemMessages(): Promise<void> {
    for (const pending of this.pendingSystemMessages.values()) pending.queued = false
    this.runtime.session.clearQueue()
    // Let a message already drained by Pi publish message_start before deciding
    // whether it still needs to be restored.
    await Promise.resolve()
    await this.restorePendingSystemMessages()
  }

  private enqueueQueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueMutation.then(task, task)
    this.queueMutation = run.then(() => undefined, () => undefined)
    return run
  }

  private shouldSyncPiQueue(): boolean {
    return this.queueMode !== 'held' && this.runtime.session.isStreaming
  }

  private restoreHeldQueuedItems(items: readonly XiaoliangQueuedItem[]) {
    this.items = items.map((item) => {
      const images = cloneImages(item.images)
      return {
        id: item.id,
        kind: item.kind,
        text: item.text,
        images,
        piText: piQueueText(item.id, item.text, images),
      }
    })
    this.queueMode = this.items.length > 0 ? 'held' : 'live'
  }

  private steeringTexts(): string[] {
    return this.items.filter((item) => item.kind === 'steer').map((item) => item.text)
  }

  private followUpTexts(): string[] {
    return this.items.filter((item) => item.kind === 'followUp').map((item) => item.text)
  }

  private snapshotShadowQueue(): XiaoliangPiQueueSnapshot {
    return {
      steering: this.steeringTexts(),
      followUp: this.followUpTexts(),
    }
  }

  private enqueueShadowQueueEvent() {
    this.enqueueEvent({
      type: 'queue_update',
      steering: this.steeringTexts(),
      followUp: this.followUpTexts(),
    } as AgentSessionEvent, this.bindingToken, { force: true })
  }

  private projectQueueEvent(event: AgentSessionEvent, reconcile = true): AgentSessionEvent {
    const payload = event as AgentSessionEvent & {
      steering?: string[]
      followUp?: string[]
      items?: XiaoliangQueuedItem[]
    }
    if (reconcile && this.queueMode === 'live') {
      this.reconcileShadow(
        Array.isArray(payload.steering) ? payload.steering : [],
        Array.isArray(payload.followUp) ? payload.followUp : [],
      )
    }
    return {
      ...payload,
      type: 'queue_update',
      steering: this.steeringTexts(),
      followUp: this.followUpTexts(),
      items: this.items.map(cloneQueuedItem),
    } as unknown as AgentSessionEvent
  }

  private reconcileShadow(steering: string[], followUp: string[]) {
    this.items = [
      ...matchQueuedItems(this.items.filter((item) => item.kind === 'steer'), steering, 'steer'),
      ...matchQueuedItems(this.items.filter((item) => item.kind === 'followUp'), followUp, 'followUp'),
    ]
  }

  private reconcileShadowWithPiQueues() {
    this.reconcileShadow(
      [...this.runtime.session.getSteeringMessages()],
      [...this.runtime.session.getFollowUpMessages()],
    )
  }

  private async pushQueuedItem(
    kind: XiaoliangQueueKind,
    text: string,
    images?: ImageContent[],
  ): Promise<XiaoliangQueuedItem> {
    const id = randomUUID()
    const visibleText = text.trim()
    const nextImages = cloneImages(images)
    const queuedText = piQueueText(id, visibleText, nextImages)
    this.queueMode = 'rebuilding'
    try {
      if (kind === 'steer') {
        await this.runtime.session.steer(queuedText, nextImages.length > 0 ? nextImages : undefined)
      } else {
        await this.runtime.session.followUp(queuedText, nextImages.length > 0 ? nextImages : undefined)
      }
      const queuedTexts = kind === 'steer'
        ? this.runtime.session.getSteeringMessages()
        : this.runtime.session.getFollowUpMessages()
      const expanded = queuedTexts.at(-1) ?? queuedText
      const item: XiaoliangShadowQueuedItem = {
        id,
        kind,
        text: visibleText ? expanded : '',
        piText: expanded,
        images: nextImages,
      }
      this.items.push(item)
      this.queueMode = 'live'
      // The agent can drain a just-written row at a turn boundary while steer()
      // or followUp() is resolving. Reconcile after leaving rebuilding mode so
      // an already-consumed row cannot survive in shadow.
      this.reconcileShadowWithPiQueues()
      this.enqueueShadowQueueEvent()
      await this.drainEvents()
      return item
    } catch (error) {
      this.queueMode = this.runtime.session.isStreaming ? 'live' : 'held'
      throw error
    }
  }

  private async rebuildPiQueues(nextItems: XiaoliangShadowQueuedItem[] = this.items): Promise<void> {
    const previousItems = this.items.map(cloneShadowQueuedItem)
    this.queueMode = 'rebuilding'
    try {
      this.items = await this.writePiQueues(nextItems)
      this.queueMode = 'live'
      // writePiQueues() crosses an async boundary. Re-read Pi after that boundary;
      // any later consumption will emit a normal live queue_update and reconcile.
      this.reconcileShadowWithPiQueues()
      this.enqueueShadowQueueEvent()
    } catch (error) {
      this.items = previousItems
      try {
        this.items = await this.writePiQueues(previousItems)
        this.queueMode = 'live'
        this.reconcileShadowWithPiQueues()
      } catch {
        await this.clearPiQueuesPreservingSystemMessages()
        this.queueMode = 'held'
      }
      this.enqueueShadowQueueEvent()
      throw error
    }
  }

  private async writePiQueues(
    items: XiaoliangShadowQueuedItem[],
  ): Promise<XiaoliangShadowQueuedItem[]> {
    const queuedItems = items.map(cloneShadowQueuedItem)
    await this.clearPiQueuesPreservingSystemMessages()
    const operations = queuedItems.map((item) => {
      const images = item.images.length > 0 ? item.images : undefined
      return item.kind === 'steer'
        ? this.runtime.session.steer(item.piText, images)
        : this.runtime.session.followUp(item.piText, images)
    })
    const results = await Promise.allSettled(operations)
    const failure = results.find((result): result is PromiseRejectedResult => (
      result.status === 'rejected'
    ))
    if (failure) throw failure.reason

    const steering = [...this.runtime.session.getSteeringMessages()]
    const followUp = [...this.runtime.session.getFollowUpMessages()]
    // Pi may already have drained rows while the writes were settling. Build
    // shadow exclusively from the queues that still exist; falling back to the
    // input item here would resurrect a delivered message on the next edit.
    return [
      ...matchQueuedItems(
        queuedItems.filter((item) => item.kind === 'steer'),
        steering,
        'steer',
      ),
      ...matchQueuedItems(
        queuedItems.filter((item) => item.kind === 'followUp'),
        followUp,
        'followUp',
      ),
    ]
  }
}

function cloneImages(images?: ImageContent[]): ImageContent[] {
  return (images ?? []).map((image) => ({ ...image }))
}

function cloneQueuedItem(item: XiaoliangShadowQueuedItem): XiaoliangQueuedItem {
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    images: cloneImages(item.images),
  }
}

function cloneShadowQueuedItem(item: XiaoliangShadowQueuedItem): XiaoliangShadowQueuedItem {
  return {
    ...item,
    images: cloneImages(item.images),
  }
}

function piQueueText(id: string, text: string, images: ImageContent[]): string {
  return text.trim() || (images.length > 0 ? `${IMAGE_ONLY_QUEUE_TEXT_PREFIX}${id}` : '')
}

function clearDeliveredImageQueuePlaceholder(message: AgentMessage): void {
  if (!('content' in message) || !Array.isArray(message.content)) return
  const content = message.content as Array<{ type?: string; text?: string }>
  const hasImage = content.some((part) => part.type === 'image')
  if (!hasImage) return
  for (const part of content) {
    if (
      part.type === 'text'
      && part.text?.startsWith(IMAGE_ONLY_QUEUE_TEXT_PREFIX)
    ) {
      part.text = ''
    }
  }
}

function matchQueuedItems(
  shadow: XiaoliangShadowQueuedItem[],
  texts: string[],
  kind: XiaoliangQueueKind,
): XiaoliangShadowQueuedItem[] {
  const remaining = [...shadow]
  const kept: XiaoliangShadowQueuedItem[] = []
  for (const text of texts) {
    const index = remaining.findIndex((item) => item.piText === text)
    if (index >= 0) {
      const [matched] = remaining.splice(index, 1)
      if (matched) kept.push(matched)
      continue
    }
    kept.push({
      id: randomUUID(),
      kind,
      text,
      piText: text,
      images: [],
    })
  }
  return kept
}
