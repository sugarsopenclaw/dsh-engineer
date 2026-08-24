import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import type {
  SubagentTraceBlobData,
  SubagentTraceBlobRef,
  SubagentTraceEvent,
  SubagentTraceEventDraft,
  SubagentTracePage,
  SubagentTraceJsonValue,
  SubagentTraceRunSummary,
  SubagentTraceUploadStatus,
  SubagentTraceUsage,
} from '../../../../src/shared/subagent-trace'
import { SUBAGENT_TRACE_SCHEMA_VERSION } from '../../../../src/shared/subagent-trace'
import type {
  SubagentRequest,
  SubagentTerminalStatus,
  SubagentUsage,
} from './contracts'
import { normalizeSubagentUsage } from './safe-result-projector'
import { assertSafeSubagentText, isPathInsideRoot, normalizeProjectArtifactRef } from './security'
import { projectSubagentTraceText } from './subagent-trace-projector'

export const SUBAGENT_RUN_STORE_SCHEMA_VERSION = 2 as const
/** Zero disables automatic deletion. Retention must be an explicit product policy. */
export const DEFAULT_SUBAGENT_RUN_TTL_MS = 0

const TRACE_FILE_NAME = 'trace.jsonl'
/** Read-only compatibility for traces produced before raw JSONL uploads were adopted. */
const COMPRESSED_TRACE_FILE_NAME = 'trace.jsonl.gz'
const LEGACY_TRACE_FILE_NAME = 'events.jsonl'
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const MAX_METADATA_BYTES = 128 * 1024
const MAX_TRACE_EVENT_BYTES = 512 * 1024
const MAX_BLOB_BYTES = 20 * 1024 * 1024
const MAX_TRACE_PAGE_SIZE = 500

export interface StoredSubagentRun {
  schema_version: typeof SUBAGENT_RUN_STORE_SCHEMA_VERSION
  trace_schema_version: typeof SUBAGENT_TRACE_SCHEMA_VERSION
  child_run_id: string
  type: string
  parent_session_id: string
  parent_prompt_id: string
  client_run_id: string
  project_id: string
  model: string
  description: string
  task_preview: string
  task_sha256: string
  thinking_mode: 'fast' | 'deep'
  status: 'running' | SubagentTerminalStatus
  started_at: string
  finished_at: string | null
  usage: SubagentUsage
  tool_call_count: number
  artifact_refs: string[]
  error_code: string | null
  error_message: string | null
  orphan_notice_consumed: boolean
  trace_event_count: number
  trace_last_sequence: number
  trace_sha256: string | null
  trace_size_bytes: number
  trace_compressed: boolean
  upload_status: SubagentTraceUploadStatus
  remote_storage_key: string | null
  uploaded_at: string | null
  upload_error: string | null
}

export interface FinishStoredSubagentRunInput {
  childRunId: string
  status: SubagentTerminalStatus
  usage?: Partial<SubagentUsage>
  toolCallCount?: number
  artifactRefs?: readonly string[]
  errorCode?: string | null
  errorMessage?: string | null
}

export interface SubagentRunStoreOptions {
  rootDir: string
  ttlMs?: number
  now?: () => number
  metadataIndex?: SubagentRunMetadataIndex
}

export interface SubagentRunMetadataIndex {
  upsert(metadata: Readonly<StoredSubagentRun>): Promise<void> | void
  remove(childRunId: string): Promise<void> | void
  replaceAll(metadata: readonly Readonly<StoredSubagentRun>[]): Promise<void> | void
}

export type SubagentTraceListener = (event: Readonly<SubagentTraceEvent>) => void

export interface StoredSubagentTraceBlob {
  sha256: string
  mimeType: string
  sizeBytes: number
  absolutePath: string
}

interface RunContext {
  conversationId: string
  lastSequence: number
  eventCount: number
}

interface TraceFileInfo {
  filePath: string
  compressed: boolean
  legacy: boolean
}

interface TraceArtifactInfo {
  sha256: string
  sizeBytes: number
}

interface TraceScanResult {
  eventCount: number
  lastSequence: number
  lastEvent: SubagentTraceEvent | null
}

type SubagentRunFinishedTraceEvent = Extract<SubagentTraceEvent, { type: 'run_finished' }>

function assertRunId(childRunId: string): void {
  if (!RUN_ID_PATTERN.test(childRunId)) throw new Error('Invalid child run id for run store.')
}

function isRecoverableTerminalEvent(
  event: SubagentTraceEvent | null,
): event is SubagentRunFinishedTraceEvent {
  return event?.type === 'run_finished'
    && (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled')
    && (event.errorCode === null
      || (typeof event.errorCode === 'string' && ERROR_CODE_PATTERN.test(event.errorCode)))
    && Number.isFinite(Date.parse(event.at))
}

function normalizeCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function normalizeSafeToken(label: string, value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !SAFE_TOKEN_PATTERN.test(normalized)) {
    throw new Error(`${label} is not a safe trace token.`)
  }
  return normalized
}

function normalizeNullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Subagent run timestamp is invalid.')
  }
  return new Date(value).toISOString()
}

function normalizeNullableSafeString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > maxLength) return null
  return value
}

function toTraceUsage(value: Partial<SubagentUsage> | undefined): SubagentTraceUsage {
  const usage = normalizeSubagentUsage(value)
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cache_read,
    cacheWrite: usage.cache_write,
    totalTokens: usage.total,
    cost: usage.cost,
  }
}

function normalizeTraceString(value: unknown, maxLength: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, maxLength)
}

function normalizeTraceJsonValue(value: unknown): SubagentTraceJsonValue {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    return JSON.parse(serialized) as SubagentTraceJsonValue
  } catch {
    return '[unserializable trace value]'
  }
}

function normalizeTraceUsage(value: unknown): SubagentTraceUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    input: normalizeCounter(record.input),
    output: normalizeCounter(record.output),
    cacheRead: normalizeCounter(record.cacheRead),
    cacheWrite: normalizeCounter(record.cacheWrite),
    totalTokens: normalizeCounter(record.totalTokens),
    cost: typeof record.cost === 'number' && Number.isFinite(record.cost) && record.cost >= 0
      ? record.cost
      : 0,
  }
}

function normalizeTraceDraft(value: SubagentTraceEventDraft): SubagentTraceEventDraft {
  const record = value as unknown as Record<string, unknown>
  if (record.type === 'run_started') {
    return {
      type: 'run_started',
      agentType: normalizeTraceString(record.agentType, 128, 'unknown'),
      description: normalizeTraceString(record.description, 2_000),
      task: normalizeTraceString(record.task, 64 * 1024),
      model: normalizeTraceString(record.model, 128, 'unknown'),
      thinkingMode: record.thinkingMode === 'deep' ? 'deep' : 'fast',
    }
  }
  if (record.type === 'agent_start' || record.type === 'agent_end') return { type: record.type }
  if (record.type === 'turn_start' || record.type === 'turn_end') {
    return {
      type: record.type,
      turnCount: normalizeCounter(record.turnCount),
      toolCallCount: normalizeCounter(record.toolCallCount),
    }
  }
  if (record.type === 'assistant_delta') {
    return {
      type: 'assistant_delta',
      kind: record.kind === 'thinking' || record.kind === 'tool_call' ? record.kind : 'text',
      contentIndex: normalizeCounter(record.contentIndex),
      delta: normalizeTraceString(record.delta, 64 * 1024),
    }
  }
  if (record.type === 'assistant_message') {
    const usage = normalizeTraceUsage(record.usage)
    const stopReason = normalizeTraceString(record.stopReason, 128)
    return {
      type: 'assistant_message',
      content: normalizeTraceJsonValue(record.content),
      ...(stopReason ? { stopReason } : {}),
      ...(usage ? { usage } : {}),
    }
  }
  if (record.type === 'tool_start') {
    return {
      type: 'tool_start',
      toolCallId: normalizeTraceString(record.toolCallId, 256),
      toolName: normalizeTraceString(record.toolName, 128, 'unknown_tool'),
      args: normalizeTraceJsonValue(record.args),
    }
  }
  if (record.type === 'tool_update') {
    return {
      type: 'tool_update',
      toolCallId: normalizeTraceString(record.toolCallId, 256),
      toolName: normalizeTraceString(record.toolName, 128, 'unknown_tool'),
      partialResult: normalizeTraceJsonValue(record.partialResult),
    }
  }
  if (record.type === 'tool_end') {
    return {
      type: 'tool_end',
      toolCallId: normalizeTraceString(record.toolCallId, 256),
      toolName: normalizeTraceString(record.toolName, 128, 'unknown_tool'),
      result: normalizeTraceJsonValue(record.result),
      isError: record.isError === true,
    }
  }
  if (record.type === 'run_finished') {
    const status = record.status === 'completed' || record.status === 'cancelled' ? record.status : 'failed'
    const errorCode = normalizeTraceString(record.errorCode, 64) || null
    return { type: 'run_finished', status, errorCode }
  }
  throw new Error('Unsupported subagent trace event type.')
}

function normalizeStoredMetadata(value: unknown, expectedChildRunId: string): StoredSubagentRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Subagent run metadata is invalid.')
  }
  const record = value as Record<string, unknown>
  const schemaVersion = normalizeCounter(record.schema_version)
  if (
    (schemaVersion !== 1 && schemaVersion !== SUBAGENT_RUN_STORE_SCHEMA_VERSION)
    || typeof record.child_run_id !== 'string'
    || !RUN_ID_PATTERN.test(record.child_run_id)
    || record.child_run_id !== expectedChildRunId
  ) {
    throw new Error('Subagent run metadata schema or identity is invalid.')
  }
  const type = normalizeSafeToken('Subagent type', record.type)
  const parentSessionId = normalizeSafeToken('Parent session id', record.parent_session_id)
  const parentPromptId = normalizeSafeToken('Parent prompt id', record.parent_prompt_id)
  const clientRunId = normalizeSafeToken('Client run id', record.client_run_id)
  const projectId = normalizeSafeToken('Project id', record.project_id)
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  if (!type || !parentSessionId || !parentPromptId || !clientRunId || !projectId || !model) {
    throw new Error('Subagent run metadata has missing ownership fields.')
  }
  if (model.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u.test(model)) {
    throw new Error('Subagent run model is invalid.')
  }
  if (typeof record.description !== 'string' || !record.description.trim() || record.description.length > 2_000) {
    throw new Error('Subagent run metadata description is invalid.')
  }
  assertSafeSubagentText('Subagent run description', record.description)
  if (typeof record.task_sha256 !== 'string' || !SHA256_PATTERN.test(record.task_sha256)) {
    throw new Error('Subagent run task fingerprint is invalid.')
  }
  if (
    record.status !== 'running'
    && record.status !== 'completed'
    && record.status !== 'failed'
    && record.status !== 'cancelled'
  ) {
    throw new Error('Subagent run metadata status is invalid.')
  }
  if (typeof record.started_at !== 'string' || !Number.isFinite(Date.parse(record.started_at))) {
    throw new Error('Subagent run start timestamp is invalid.')
  }
  const finishedAt = normalizeNullableTimestamp(record.finished_at)
  if ((record.status === 'running' && finishedAt !== null) || (record.status !== 'running' && finishedAt === null)) {
    throw new Error('Subagent run finish timestamp is inconsistent with its status.')
  }
  if (!Array.isArray(record.artifact_refs) || record.artifact_refs.length > 64) {
    throw new Error('Subagent run artifact refs are invalid.')
  }
  const artifactRefs = [...new Set(record.artifact_refs.map((item) => {
    if (typeof item !== 'string') throw new Error('Subagent run artifact ref is invalid.')
    return normalizeProjectArtifactRef(item)
  }))]
  const errorCode = record.error_code
  if (errorCode !== null && (typeof errorCode !== 'string' || !ERROR_CODE_PATTERN.test(errorCode))) {
    throw new Error('Subagent run error code is invalid.')
  }
  const errorMessage = normalizeNullableSafeString(record.error_message, 2_000)
  const uploadStatus: SubagentTraceUploadStatus = (
    record.upload_status === 'pending'
    || record.upload_status === 'uploading'
    || record.upload_status === 'uploaded'
    || record.upload_status === 'failed'
    || record.upload_status === 'disabled'
  ) ? record.upload_status : 'pending'
  const traceSha256 = normalizeNullableSafeString(record.trace_sha256, 64)
  if (traceSha256 && !SHA256_PATTERN.test(traceSha256)) {
    throw new Error('Subagent trace fingerprint is invalid.')
  }
  const taskPreview = typeof record.task_preview === 'string'
    ? record.task_preview.slice(0, 500)
    : record.description.slice(0, 500)
  return {
    schema_version: SUBAGENT_RUN_STORE_SCHEMA_VERSION,
    trace_schema_version: SUBAGENT_TRACE_SCHEMA_VERSION,
    child_run_id: record.child_run_id,
    type,
    parent_session_id: parentSessionId,
    parent_prompt_id: parentPromptId,
    client_run_id: clientRunId,
    project_id: projectId,
    model,
    description: record.description,
    task_preview: taskPreview,
    task_sha256: record.task_sha256,
    thinking_mode: record.thinking_mode === 'deep' ? 'deep' : 'fast',
    status: record.status,
    started_at: new Date(record.started_at).toISOString(),
    finished_at: finishedAt,
    usage: normalizeSubagentUsage(record.usage as Partial<SubagentUsage> | undefined),
    tool_call_count: normalizeCounter(record.tool_call_count),
    artifact_refs: artifactRefs,
    error_code: errorCode as string | null,
    error_message: errorMessage,
    orphan_notice_consumed: record.orphan_notice_consumed === true,
    trace_event_count: normalizeCounter(record.trace_event_count),
    trace_last_sequence: normalizeCounter(record.trace_last_sequence),
    trace_sha256: traceSha256,
    trace_size_bytes: normalizeCounter(record.trace_size_bytes),
    trace_compressed: record.trace_compressed === true,
    upload_status: uploadStatus,
    remote_storage_key: normalizeNullableSafeString(record.remote_storage_key, 2_000),
    uploaded_at: normalizeNullableTimestamp(record.uploaded_at),
    upload_error: normalizeNullableSafeString(record.upload_error, 2_000),
  }
}

function summaryFromMetadata(metadata: Readonly<StoredSubagentRun>): SubagentTraceRunSummary {
  const startedAt = Date.parse(metadata.started_at)
  const endedAt = metadata.finished_at ? Date.parse(metadata.finished_at) : Date.now()
  return {
    childRunId: metadata.child_run_id,
    agentType: metadata.type,
    description: metadata.description,
    taskPreview: metadata.task_preview,
    conversationId: metadata.parent_session_id,
    parentPromptId: metadata.parent_prompt_id,
    clientRunId: metadata.client_run_id,
    projectId: metadata.project_id,
    model: metadata.model,
    status: metadata.status,
    createdAt: metadata.started_at,
    startedAt: metadata.started_at,
    finishedAt: metadata.finished_at,
    durationMs: Math.max(0, endedAt - startedAt),
    usage: toTraceUsage(metadata.usage),
    toolCallCount: metadata.tool_call_count,
    artifactRefs: metadata.artifact_refs,
    errorCode: metadata.error_code,
    errorMessage: metadata.error_message,
    eventCount: metadata.trace_event_count,
    lastSequence: metadata.trace_last_sequence,
    traceAvailable: metadata.trace_event_count > 0,
    traceCompressed: metadata.trace_compressed,
    traceSha256: metadata.trace_sha256,
    traceSizeBytes: metadata.trace_size_bytes,
    uploadStatus: metadata.upload_status,
    remoteStorageKey: metadata.remote_storage_key,
    uploadedAt: metadata.uploaded_at,
    uploadError: metadata.upload_error,
  }
}

function blobExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  return 'png'
}

function mimeTypeForBlobPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return 'image/png'
}

export class SubagentRunStore {
  private readonly configuredRoot: string
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly metadataIndex?: SubagentRunMetadataIndex
  private initializedRoot: string | null = null
  private initializePromise: Promise<string> | null = null
  private readonly writeChains = new Map<string, Promise<unknown>>()
  private readonly runContexts = new Map<string, RunContext>()
  private readonly listeners = new Set<SubagentTraceListener>()

  constructor(options: SubagentRunStoreOptions) {
    if (!path.isAbsolute(options.rootDir)) throw new Error('Subagent run store root must be absolute.')
    if (options.ttlMs !== undefined && (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 0)) {
      throw new Error('Subagent run store TTL must be a non-negative safe integer.')
    }
    this.configuredRoot = path.resolve(options.rootDir)
    this.ttlMs = options.ttlMs ?? DEFAULT_SUBAGENT_RUN_TTL_MS
    this.now = options.now ?? Date.now
    this.metadataIndex = options.metadataIndex
  }

  subscribe(listener: SubagentTraceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized()
    await this.pruneExpired()
    await this.reconcileInterruptedRuns()
    if (this.metadataIndex) await this.metadataIndex.replaceAll(await this.listMetadata())
  }

  async start(request: Readonly<SubagentRequest>): Promise<void> {
    assertRunId(request.childRunId)
    assertSafeSubagentText('Subagent run description', request.description)
    const root = await this.ensureInitialized()
    const runDirectory = path.resolve(root, request.childRunId)
    if (path.dirname(runDirectory) !== root) throw new Error('Subagent run directory escaped its root.')
    await fs.promises.mkdir(runDirectory, { recursive: false, mode: 0o700 })
    const realRunDirectory = await fs.promises.realpath(runDirectory)
    if (!isPathInsideRoot(root, realRunDirectory) || realRunDirectory === root) {
      await fs.promises.rmdir(runDirectory).catch(() => undefined)
      throw new Error('Subagent run directory resolves outside its root.')
    }

    const startedAt = new Date(this.now()).toISOString()
    const safeTask = projectSubagentTraceText(request.task, request.projectRoot)
    const metadata: StoredSubagentRun = {
      schema_version: SUBAGENT_RUN_STORE_SCHEMA_VERSION,
      trace_schema_version: SUBAGENT_TRACE_SCHEMA_VERSION,
      child_run_id: request.childRunId,
      type: request.type,
      parent_session_id: request.parentSessionId,
      parent_prompt_id: request.parentPromptId,
      client_run_id: request.clientRunId,
      project_id: request.projectId,
      model: request.model,
      description: request.description,
      task_preview: safeTask.slice(0, 500),
      task_sha256: createHash('sha256').update(request.task, 'utf8').digest('hex'),
      thinking_mode: request.thinkingMode,
      status: 'running',
      started_at: startedAt,
      finished_at: null,
      usage: normalizeSubagentUsage(undefined),
      tool_call_count: 0,
      artifact_refs: [],
      error_code: null,
      error_message: null,
      orphan_notice_consumed: false,
      trace_event_count: 1,
      trace_last_sequence: 1,
      trace_sha256: null,
      trace_size_bytes: 0,
      trace_compressed: false,
      upload_status: 'pending',
      remote_storage_key: null,
      uploaded_at: null,
      upload_error: null,
    }
    const event: SubagentTraceEvent = {
      schemaVersion: SUBAGENT_TRACE_SCHEMA_VERSION,
      sequence: 1,
      childRunId: request.childRunId,
      conversationId: request.parentSessionId,
      at: startedAt,
      type: 'run_started',
      agentType: request.type,
      description: request.description,
      task: safeTask,
      model: request.model,
      thinkingMode: request.thinkingMode,
    }
    try {
      await this.writeMetadata(realRunDirectory, metadata)
      await fs.promises.writeFile(
        path.join(realRunDirectory, TRACE_FILE_NAME),
        `${JSON.stringify(event)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      this.runContexts.set(request.childRunId, {
        conversationId: request.parentSessionId,
        lastSequence: 1,
        eventCount: 1,
      })
      await this.syncMetadataIndex('upsert started run', () => this.metadataIndex?.upsert(metadata))
      this.publish(event)
    } catch (error) {
      this.runContexts.delete(request.childRunId)
      await fs.promises.rm(realRunDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async appendEvent(childRunId: string, draft: SubagentTraceEventDraft): Promise<SubagentTraceEvent> {
    assertRunId(childRunId)
    if (draft.type === 'run_started' || draft.type === 'run_finished') {
      throw new Error('Subagent lifecycle trace events are owned by the run store.')
    }
    const event = await this.enqueueWrite(childRunId, async () => {
      const runDirectory = await this.resolveExistingRunDirectory(childRunId)
      const context = await this.getRunContext(childRunId, runDirectory)
      return this.appendEventToDirectory(childRunId, runDirectory, context, draft)
    })
    this.publish(event)
    return event
  }

  async finish(input: FinishStoredSubagentRunInput): Promise<void> {
    assertRunId(input.childRunId)
    if (input.status !== 'completed' && input.status !== 'failed' && input.status !== 'cancelled') {
      throw new Error('Stored subagent run status must be terminal.')
    }
    const terminalEvent = await this.enqueueWrite(input.childRunId, async () => {
      const runDirectory = await this.resolveExistingRunDirectory(input.childRunId)
      const current = await this.readMetadataFromDirectory(runDirectory)
      if (current.status !== 'running') {
        await this.syncMetadataIndex('repair terminal run index', () => this.metadataIndex?.upsert(current))
        return null
      }
      const artifactRefs = [...new Set(
        (input.artifactRefs ?? []).map((ref) => normalizeProjectArtifactRef(ref)),
      )]
      if (artifactRefs.length > 64) throw new Error('Stored subagent run has too many artifact refs.')
      const errorCode = input.errorCode?.trim() || null
      if (errorCode && !ERROR_CODE_PATTERN.test(errorCode)) {
        throw new Error('Stored subagent run has an invalid error code.')
      }
      const errorMessage = input.errorMessage?.trim().slice(0, 2_000) || null
      input = { ...input, errorMessage }

      const existingTrace = await this.resolveTraceFile(runDirectory)
      if (existingTrace) {
        const scanned = await this.scanTrace(runDirectory, current)
        if (isRecoverableTerminalEvent(scanned.lastEvent)) {
          const context: RunContext = {
            conversationId: current.parent_session_id,
            lastSequence: Math.max(current.trace_last_sequence, scanned.lastSequence),
            eventCount: Math.max(current.trace_event_count, scanned.eventCount),
          }
          this.runContexts.set(input.childRunId, context)
          const trace = await this.inspectRawTrace(runDirectory)
          await this.persistFinishedRun({
            runDirectory,
            current,
            finishInput: input,
            event: scanned.lastEvent,
            context,
            trace,
            artifactRefs,
          })
          return scanned.lastEvent
        }
      }

      const context = await this.getRunContext(input.childRunId, runDirectory)
      const event = await this.appendEventToDirectory(input.childRunId, runDirectory, context, {
        type: 'run_finished',
        status: input.status,
        errorCode,
      })
      if (!isRecoverableTerminalEvent(event)) {
        throw new Error('Run store produced an invalid terminal trace event.')
      }
      const trace = await this.inspectRawTrace(runDirectory)
      await this.persistFinishedRun({
        runDirectory,
        current,
        finishInput: input,
        event,
        context,
        trace,
        artifactRefs,
      })
      return event
    })
    if (terminalEvent) this.publish(terminalEvent)
  }

  async storeBlob(childRunId: string, data: Buffer, mimeType: string): Promise<SubagentTraceBlobRef> {
    assertRunId(childRunId)
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_BLOB_BYTES) {
      throw new Error('Subagent trace blob is empty or exceeds the size limit.')
    }
    const normalizedMimeType = mimeType.trim().toLowerCase()
    if (!/^image\/(?:png|jpeg|webp|gif)$/u.test(normalizedMimeType)) {
      throw new Error('Subagent trace blob MIME type is unsupported.')
    }
    const runDirectory = await this.resolveExistingRunDirectory(childRunId)
    const blobsDirectory = path.join(runDirectory, 'blobs')
    await fs.promises.mkdir(blobsDirectory, { recursive: true, mode: 0o700 })
    const sha256 = createHash('sha256').update(data).digest('hex')
    const filename = `${sha256}.${blobExtension(normalizedMimeType)}`
    const blobPath = path.join(blobsDirectory, filename)
    try {
      await fs.promises.writeFile(blobPath, data, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return {
      type: 'blob_ref',
      sha256,
      mimeType: normalizedMimeType,
      sizeBytes: data.length,
      localRef: `blobs/${filename}`,
    }
  }

  async readBlob(childRunId: string, sha256: string): Promise<SubagentTraceBlobData> {
    assertRunId(childRunId)
    if (!SHA256_PATTERN.test(sha256)) throw new Error('Subagent trace blob fingerprint is invalid.')
    const runDirectory = await this.resolveExistingRunDirectory(childRunId)
    const blobsDirectory = path.join(runDirectory, 'blobs')
    const entries = await fs.promises.readdir(blobsDirectory, { withFileTypes: true })
    const match = entries.find((entry) => entry.isFile() && entry.name.startsWith(`${sha256}.`))
    if (!match) throw new Error('Subagent trace blob was not found.')
    const blobPath = path.join(blobsDirectory, match.name)
    const stat = await fs.promises.stat(blobPath)
    if (!stat.isFile() || stat.size > MAX_BLOB_BYTES) throw new Error('Subagent trace blob is invalid.')
    const data = await fs.promises.readFile(blobPath)
    if (createHash('sha256').update(data).digest('hex') !== sha256) {
      throw new Error('Subagent trace blob failed integrity verification.')
    }
    return {
      sha256,
      mimeType: mimeTypeForBlobPath(blobPath),
      sizeBytes: data.length,
      data: data.toString('base64'),
    }
  }

  async readTrace(childRunId: string, afterSequence = 0, limit = 200): Promise<SubagentTracePage> {
    assertRunId(childRunId)
    const normalizedAfter = normalizeCounter(afterSequence)
    const normalizedLimit = Math.max(1, Math.min(MAX_TRACE_PAGE_SIZE, normalizeCounter(limit) || 200))
    await this.waitForPendingWrites(childRunId)
    const runDirectory = await this.resolveExistingRunDirectory(childRunId)
    const metadata = await this.readMetadataFromDirectory(runDirectory)
    const trace = await this.resolveTraceFile(runDirectory)
    if (!trace) return { childRunId, events: [], nextSequence: normalizedAfter, hasMore: false }
    const events: SubagentTraceEvent[] = []
    let legacySequence = 0
    let hasMore = false
    const stream = fs.createReadStream(trace.filePath)
    const input = trace.compressed ? stream.pipe(createGunzip()) : stream
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
    try {
      for await (const line of lines) {
        if (!line.trim()) continue
        legacySequence += 1
        const event = this.parseTraceLine(line, metadata, legacySequence)
        if (!event || event.sequence <= normalizedAfter) continue
        if (events.length >= normalizedLimit) {
          hasMore = true
          break
        }
        events.push(event)
      }
    } finally {
      lines.close()
      stream.destroy()
    }
    return {
      childRunId,
      events,
      nextSequence: events.at(-1)?.sequence ?? normalizedAfter,
      hasMore,
    }
  }

  async readMetadata(childRunId: string): Promise<StoredSubagentRun> {
    assertRunId(childRunId)
    const runDirectory = await this.resolveExistingRunDirectory(childRunId)
    return this.readMetadataFromDirectory(runDirectory)
  }

  async listMetadata(): Promise<StoredSubagentRun[]> {
    const root = await this.ensureInitialized()
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const metadata: StoredSubagentRun[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !RUN_ID_PATTERN.test(entry.name)) continue
      try {
        const runDirectory = await this.resolveExistingRunDirectory(entry.name)
        metadata.push(await this.readMetadataFromDirectory(runDirectory))
      } catch (error) {
        console.warn(
          '[subagent-run-store] skipped invalid run metadata',
          entry.name,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    return metadata
  }

  async listSummaries(conversationId?: string): Promise<SubagentTraceRunSummary[]> {
    const metadata = await this.listMetadata()
    return metadata
      .filter((run) => !conversationId || run.parent_session_id === conversationId)
      .map(summaryFromMetadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async updateUploadState(
    childRunId: string,
    update: {
      status: SubagentTraceUploadStatus
      remoteStorageKey?: string | null
      uploadedAt?: string | null
      error?: string | null
    },
  ): Promise<void> {
    assertRunId(childRunId)
    await this.enqueueWrite(childRunId, async () => {
      const runDirectory = await this.resolveExistingRunDirectory(childRunId)
      const current = await this.readMetadataFromDirectory(runDirectory)
      const next: StoredSubagentRun = {
        ...current,
        upload_status: update.status,
        remote_storage_key: update.remoteStorageKey === undefined
          ? current.remote_storage_key
          : update.remoteStorageKey,
        uploaded_at: update.uploadedAt === undefined ? current.uploaded_at : update.uploadedAt,
        upload_error: update.error === undefined ? current.upload_error : update.error,
      }
      await this.writeMetadata(runDirectory, next)
      await this.syncMetadataIndex('update trace upload state', () => this.metadataIndex?.upsert(next))
    })
  }

  async markOrphanNoticeConsumed(childRunId: string): Promise<void> {
    assertRunId(childRunId)
    await this.enqueueWrite(childRunId, async () => {
      const runDirectory = await this.resolveExistingRunDirectory(childRunId)
      const current = await this.readMetadataFromDirectory(runDirectory)
      if (current.orphan_notice_consumed) return
      const next = { ...current, orphan_notice_consumed: true }
      await this.writeMetadata(runDirectory, next)
      await this.syncMetadataIndex('mark orphan notice consumed', () => this.metadataIndex?.upsert(next))
    })
  }

  async getTraceUploadPath(childRunId: string): Promise<string | null> {
    assertRunId(childRunId)
    return this.enqueueWrite(childRunId, async () => {
      const runDirectory = await this.resolveExistingRunDirectory(childRunId)
      const current = await this.readMetadataFromDirectory(runDirectory)
      if (current.status === 'running') return null

      const existingTrace = await this.resolveTraceFile(runDirectory)
      if (!existingTrace) return null
      const trace = await this.inspectRawTrace(runDirectory)
      const scanned = await this.scanTrace(runDirectory, current)

      const metadataChanged = current.trace_compressed
        || current.trace_sha256 !== trace.sha256
        || current.trace_size_bytes !== trace.sizeBytes
        || current.trace_event_count !== scanned.eventCount
        || current.trace_last_sequence !== scanned.lastSequence
      if (metadataChanged) {
        const next: StoredSubagentRun = {
          ...current,
          trace_event_count: scanned.eventCount,
          trace_last_sequence: scanned.lastSequence,
          trace_sha256: trace.sha256,
          trace_size_bytes: trace.sizeBytes,
          trace_compressed: false,
          upload_status: current.upload_status === 'disabled' ? 'disabled' : 'pending',
          upload_error: null,
        }
        await this.writeMetadata(runDirectory, next)
        await this.syncMetadataIndex('refresh raw trace metadata', () => this.metadataIndex?.upsert(next))
      }
      return path.join(runDirectory, TRACE_FILE_NAME)
    })
  }

  async listBlobsForUpload(childRunId: string): Promise<StoredSubagentTraceBlob[]> {
    assertRunId(childRunId)
    const runDirectory = await this.resolveExistingRunDirectory(childRunId)
    const blobsDirectory = path.join(runDirectory, 'blobs')
    const entries = await fs.promises.readdir(blobsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const blobs: StoredSubagentTraceBlob[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      const sha256 = entry.name.split('.')[0]
      if (!SHA256_PATTERN.test(sha256)) continue
      const absolutePath = path.join(blobsDirectory, entry.name)
      const realPath = await fs.promises.realpath(absolutePath)
      if (!isPathInsideRoot(runDirectory, realPath)) continue
      const stat = await fs.promises.stat(realPath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BLOB_BYTES) continue
      blobs.push({
        sha256,
        mimeType: mimeTypeForBlobPath(realPath),
        sizeBytes: stat.size,
        absolutePath: realPath,
      })
    }
    return blobs.sort((left, right) => left.sha256.localeCompare(right.sha256))
  }

  async pruneExpired(): Promise<number> {
    if (this.ttlMs === 0) return 0
    const root = await this.ensureInitialized()
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const cutoff = this.now() - this.ttlMs
    let removed = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue
      const candidate = path.resolve(root, entry.name)
      if (path.dirname(candidate) !== root) continue
      let realDirectory: string
      try {
        realDirectory = await fs.promises.realpath(candidate)
      } catch {
        continue
      }
      if (!isPathInsideRoot(root, realDirectory) || realDirectory === root) continue
      const metadataPath = path.join(realDirectory, 'metadata.json')
      const stat = await fs.promises.stat(metadataPath).catch(() => fs.promises.stat(realDirectory))
      if (stat.mtimeMs > cutoff) continue
      await fs.promises.rm(realDirectory, { recursive: true, force: true })
      this.writeChains.delete(entry.name)
      this.runContexts.delete(entry.name)
      await this.syncMetadataIndex('remove expired run', () => this.metadataIndex?.remove(entry.name))
      removed += 1
    }
    return removed
  }

  private publish(event: SubagentTraceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn(
          '[subagent-run-store] trace listener failed',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  private async appendEventToDirectory(
    childRunId: string,
    runDirectory: string,
    context: RunContext,
    draft: SubagentTraceEventDraft,
  ): Promise<SubagentTraceEvent> {
    const event = {
      ...normalizeTraceDraft(draft),
      schemaVersion: SUBAGENT_TRACE_SCHEMA_VERSION,
      sequence: context.lastSequence + 1,
      childRunId,
      conversationId: context.conversationId,
      at: new Date(this.now()).toISOString(),
    } as SubagentTraceEvent
    const line = `${JSON.stringify(event)}\n`
    if (Buffer.byteLength(line, 'utf8') > MAX_TRACE_EVENT_BYTES) {
      throw new Error('Subagent trace event exceeds the 512 KiB line limit.')
    }
    const tracePath = await this.ensureWritableTrace(runDirectory)
    await fs.promises.appendFile(tracePath, line, { encoding: 'utf8', mode: 0o600 })
    context.lastSequence = event.sequence
    context.eventCount += 1
    return event
  }

  private async getRunContext(childRunId: string, runDirectory: string): Promise<RunContext> {
    const existing = this.runContexts.get(childRunId)
    if (existing) return existing
    const metadata = await this.readMetadataFromDirectory(runDirectory)
    const scanned = await this.scanTrace(runDirectory, metadata)
    const context: RunContext = {
      conversationId: metadata.parent_session_id,
      lastSequence: Math.max(metadata.trace_last_sequence, scanned.lastSequence),
      eventCount: Math.max(metadata.trace_event_count, scanned.eventCount),
    }
    this.runContexts.set(childRunId, context)
    return context
  }

  private async ensureInitialized(): Promise<string> {
    if (this.initializedRoot) return this.initializedRoot
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await fs.promises.mkdir(this.configuredRoot, { recursive: true, mode: 0o700 })
        const root = await fs.promises.realpath(this.configuredRoot)
        const stat = await fs.promises.stat(root)
        if (!stat.isDirectory()) throw new Error('Subagent run store root must resolve to a directory.')
        this.initializedRoot = root
        return root
      })()
    }
    return this.initializePromise
  }

  private async resolveExistingRunDirectory(childRunId: string): Promise<string> {
    const root = await this.ensureInitialized()
    const candidate = path.resolve(root, childRunId)
    if (path.dirname(candidate) !== root) throw new Error('Subagent run directory escaped its root.')
    const runDirectory = await fs.promises.realpath(candidate)
    if (!isPathInsideRoot(root, runDirectory) || runDirectory === root) {
      throw new Error('Subagent run directory resolves outside its root.')
    }
    const stat = await fs.promises.stat(runDirectory)
    if (!stat.isDirectory()) throw new Error('Subagent run path is not a directory.')
    return runDirectory
  }

  private async readMetadataFromDirectory(runDirectory: string): Promise<StoredSubagentRun> {
    const metadataPath = path.join(runDirectory, 'metadata.json')
    const stat = await fs.promises.stat(metadataPath)
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) {
      throw new Error('Subagent run metadata is missing or oversized.')
    }
    const parsed: unknown = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'))
    return normalizeStoredMetadata(parsed, path.basename(runDirectory))
  }

  private async reconcileInterruptedRuns(): Promise<number> {
    const metadata = await this.listMetadata()
    let reconciled = 0
    for (const current of metadata) {
      if (current.status !== 'running') continue
      await this.finish({
        childRunId: current.child_run_id,
        status: 'failed',
        usage: current.usage,
        toolCallCount: current.tool_call_count,
        artifactRefs: current.artifact_refs,
        errorCode: 'HOST_RESTARTED',
      })
      reconciled += 1
    }
    return reconciled
  }

  private async syncMetadataIndex(
    operation: string,
    run: () => Promise<void> | void | undefined,
  ): Promise<void> {
    if (!this.metadataIndex) return
    try {
      await run()
    } catch (error) {
      console.warn(
        `[subagent-run-store] failed to ${operation}`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private async writeMetadata(runDirectory: string, metadata: StoredSubagentRun): Promise<void> {
    const metadataPath = path.join(runDirectory, 'metadata.json')
    const temporaryPath = path.join(runDirectory, `.metadata-${randomUUID()}.tmp`)
    const payload = `${JSON.stringify(metadata, null, 2)}\n`
    if (Buffer.byteLength(payload, 'utf8') > MAX_METADATA_BYTES) {
      throw new Error('Subagent run metadata exceeds the size limit.')
    }
    let handle: fs.promises.FileHandle | null = null
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await fs.promises.rename(temporaryPath, metadataPath)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await fs.promises.unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private async resolveTraceFile(runDirectory: string): Promise<TraceFileInfo | null> {
    const candidates: TraceFileInfo[] = [
      { filePath: path.join(runDirectory, TRACE_FILE_NAME), compressed: false, legacy: false },
      { filePath: path.join(runDirectory, COMPRESSED_TRACE_FILE_NAME), compressed: true, legacy: false },
      { filePath: path.join(runDirectory, LEGACY_TRACE_FILE_NAME), compressed: false, legacy: true },
    ]
    for (const candidate of candidates) {
      const stat = await fs.promises.stat(candidate.filePath).catch(() => null)
      if (stat?.isFile()) return candidate
    }
    return null
  }

  private async ensureWritableTrace(runDirectory: string): Promise<string> {
    const tracePath = path.join(runDirectory, TRACE_FILE_NAME)
    const traceStat = await fs.promises.stat(tracePath).catch(() => null)
    if (traceStat?.isFile()) return tracePath
    const compressedPath = path.join(runDirectory, COMPRESSED_TRACE_FILE_NAME)
    const compressedStat = await fs.promises.stat(compressedPath).catch(() => null)
    if (compressedStat?.isFile()) {
      const temporaryPath = path.join(runDirectory, `.trace-${randomUUID()}.jsonl.tmp`)
      try {
        await pipeline(
          fs.createReadStream(compressedPath),
          createGunzip(),
          fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
        )
        await fs.promises.rename(temporaryPath, tracePath)
        return tracePath
      } catch (error) {
        await fs.promises.unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    }
    const legacyPath = path.join(runDirectory, LEGACY_TRACE_FILE_NAME)
    const legacyStat = await fs.promises.stat(legacyPath).catch(() => null)
    if (legacyStat?.isFile()) {
      await fs.promises.rename(legacyPath, tracePath)
      return tracePath
    }
    await fs.promises.writeFile(tracePath, '', { flag: 'wx', mode: 0o600 })
    return tracePath
  }

  private parseTraceLine(
    line: string,
    metadata: Readonly<StoredSubagentRun>,
    legacySequence: number,
  ): SubagentTraceEvent | null {
    let parsed: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      parsed = value as Record<string, unknown>
    } catch {
      return null
    }
    if (
      parsed.schemaVersion === SUBAGENT_TRACE_SCHEMA_VERSION
      && typeof parsed.sequence === 'number'
      && typeof parsed.childRunId === 'string'
      && typeof parsed.conversationId === 'string'
      && typeof parsed.at === 'string'
      && typeof parsed.type === 'string'
    ) {
      return parsed as unknown as SubagentTraceEvent
    }
    const base = {
      schemaVersion: SUBAGENT_TRACE_SCHEMA_VERSION,
      sequence: legacySequence,
      childRunId: metadata.child_run_id,
      conversationId: metadata.parent_session_id,
      at: typeof parsed.at === 'string' && Number.isFinite(Date.parse(parsed.at))
        ? new Date(parsed.at).toISOString()
        : metadata.started_at,
    } as const
    const turnCount = normalizeCounter(parsed.turn_count)
    const toolCallCount = normalizeCounter(parsed.tool_call_count)
    if (parsed.type === 'agent_start' || parsed.type === 'agent_end') return { ...base, type: parsed.type }
    if (parsed.type === 'turn_start' || parsed.type === 'turn_end') {
      return { ...base, type: parsed.type, turnCount, toolCallCount }
    }
    if (parsed.type === 'assistant_message') {
      return {
        ...base,
        type: 'assistant_message',
        content: '[legacy trace: message content was not recorded]',
        ...(typeof parsed.stop_reason === 'string' ? { stopReason: parsed.stop_reason } : {}),
        ...(parsed.usage ? { usage: toTraceUsage(parsed.usage as Partial<SubagentUsage>) } : {}),
      }
    }
    const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : 'unknown_tool'
    if (parsed.type === 'tool_start') {
      return {
        ...base,
        type: 'tool_start',
        toolCallId: `legacy-${legacySequence}`,
        toolName,
        args: '[legacy trace: tool arguments were not recorded]',
      }
    }
    if (parsed.type === 'tool_end') {
      return {
        ...base,
        type: 'tool_end',
        toolCallId: `legacy-${legacySequence}`,
        toolName,
        result: '[legacy trace: tool result was not recorded]',
        isError: parsed.is_error === true,
      }
    }
    return null
  }

  private async scanTrace(
    runDirectory: string,
    metadata: Readonly<StoredSubagentRun>,
  ): Promise<TraceScanResult> {
    const trace = await this.resolveTraceFile(runDirectory)
    if (!trace) return { eventCount: 0, lastSequence: 0, lastEvent: null }
    const stream = fs.createReadStream(trace.filePath)
    const input = trace.compressed ? stream.pipe(createGunzip()) : stream
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
    let eventCount = 0
    let lastSequence = 0
    let lastEvent: SubagentTraceEvent | null = null
    try {
      for await (const line of lines) {
        if (!line.trim()) continue
        eventCount += 1
        const event = this.parseTraceLine(line, metadata, eventCount)
        lastSequence = Math.max(lastSequence, event?.sequence ?? eventCount)
        if (event) lastEvent = event
      }
    } finally {
      lines.close()
      stream.destroy()
    }
    return { eventCount, lastSequence, lastEvent }
  }

  private async inspectRawTrace(
    runDirectory: string,
  ): Promise<TraceArtifactInfo> {
    const sourcePath = await this.ensureWritableTrace(runDirectory)
    const stat = await fs.promises.stat(sourcePath)
    return {
      sha256: await this.hashFile(sourcePath),
      sizeBytes: stat.size,
    }
  }

  private async persistFinishedRun(details: {
    runDirectory: string
    current: Readonly<StoredSubagentRun>
    finishInput: FinishStoredSubagentRunInput
    event: SubagentRunFinishedTraceEvent
    context: Readonly<RunContext>
    trace: Readonly<TraceArtifactInfo>
    artifactRefs: string[]
  }): Promise<void> {
    const next: StoredSubagentRun = {
      ...details.current,
      status: details.event.status,
      finished_at: new Date(details.event.at).toISOString(),
      usage: normalizeSubagentUsage(details.finishInput.usage),
      tool_call_count: normalizeCounter(details.finishInput.toolCallCount),
      artifact_refs: details.artifactRefs,
      error_code: details.event.errorCode,
      error_message: details.finishInput.errorMessage ?? null,
      trace_event_count: details.context.eventCount,
      trace_last_sequence: details.context.lastSequence,
      trace_sha256: details.trace.sha256,
      trace_size_bytes: details.trace.sizeBytes,
      trace_compressed: false,
      upload_status: details.current.upload_status === 'disabled' ? 'disabled' : 'pending',
      upload_error: null,
    }
    await this.writeMetadata(details.runDirectory, next)
    await this.syncMetadataIndex('upsert finished run', () => this.metadataIndex?.upsert(next))
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    for await (const chunk of stream) hash.update(chunk as Buffer)
    return hash.digest('hex')
  }

  private async waitForPendingWrites(childRunId: string): Promise<void> {
    const pending = this.writeChains.get(childRunId)
    if (pending) await pending.catch(() => undefined)
  }

  private async enqueueWrite<Result>(childRunId: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.writeChains.get(childRunId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.writeChains.set(childRunId, next)
    try {
      return await next
    } finally {
      if (this.writeChains.get(childRunId) === next) this.writeChains.delete(childRunId)
    }
  }
}
