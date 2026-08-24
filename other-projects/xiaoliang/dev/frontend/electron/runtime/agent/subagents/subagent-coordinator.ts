import path from 'node:path'

import {
  ACTIVE_SUBAGENT_TYPES,
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  EMPTY_SUBAGENT_USAGE,
  isActiveSubagentType,
  isEvidencePackSubagent,
  SUBAGENT_TYPES,
  SubagentRunError,
  type SubagentExecutionSummary,
  type SubagentHandle,
  type SubagentLifecycleStatus,
  type SubagentProgress,
  type SubagentRequest,
  type SubagentRunSnapshot,
  type SubagentRunner,
  type SubagentSalvage,
  type SubagentTerminalError,
  type SubagentTerminalResult,
  type SubagentTerminalStatus,
  type SubagentType,
  type SubagentTypePolicies,
} from './contracts'
import { normalizeSubagentUsage } from './safe-result-projector'
import {
  artifactRootForSubagentType,
  assertSafeCompletedBlenderReportText,
  assertSafeSubagentText,
  CANONICAL_EVIDENCE_PACK_REF_PATTERN,
  normalizeProjectArtifactRef,
} from './security'

export const DEFAULT_SUBAGENT_TYPE_POLICIES: SubagentTypePolicies = Object.freeze({
  [CAD_ANALYST_AGENT_TYPE]: Object.freeze({
    maxConcurrent: 1,
    maxSpawnDepth: 0,
    allowedModels: Object.freeze(['xiaoliang-backend/qwen3.8-max']),
  }),
  // Each MLightCAD session is its own hidden window, so the drafter is not bound by the
  // single-threaded COM apartment that caps the analyst at one run. The ceiling here
  // tracks the session pool size rather than a driver limitation, and the runtime
  // overrides it from the configured window budget.
  [CAD_DRAFTER_AGENT_TYPE]: Object.freeze({
    maxConcurrent: 2,
    maxSpawnDepth: 0,
    allowedModels: Object.freeze(['xiaoliang-backend/qwen3.8-max']),
  }),
  [BLENDER_MODELER_AGENT_TYPE]: Object.freeze({
    maxConcurrent: 1,
    maxSpawnDepth: 0,
    allowedModels: Object.freeze(['xiaoliang-backend/qwen3.8-max']),
  }),
})

export type SubagentSnapshotListener = (snapshot: SubagentRunSnapshot) => void

export interface SubagentCoordinatorOptions {
  runner: SubagentRunner
  policies?: SubagentTypePolicies
  now?: () => number
}

interface InternalRun {
  request: Readonly<SubagentRequest>
  status: SubagentLifecycleStatus
  createdAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  durationMs: number
  queuePosition: number | null
  progress: SubagentProgress
  errorCode: string | null
  controller: AbortController
  externalAbortListener: (() => void) | null
  admitted: boolean
  settled: boolean
  resolveResult: (result: SubagentTerminalResult) => void
  result: Promise<SubagentTerminalResult>
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u
const CHILD_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const SAFE_PROGRESS_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u
const TERMINAL_STATUSES = new Set<SubagentLifecycleStatus>(['completed', 'failed', 'cancelled'])
const REQUEST_KEYS = new Set([
  'childRunId',
  'type',
  'task',
  'description',
  'parentSessionId',
  'parentPromptId',
  'clientRunId',
  'projectId',
  'projectRoot',
  'model',
  'thinkingMode',
  'spawnDepth',
  'signal',
])

function isTerminal(status: SubagentLifecycleStatus): status is SubagentTerminalStatus {
  return TERMINAL_STATUSES.has(status)
}

function validateIdentifier(label: string, value: string, pattern = ID_PATTERN): void {
  if (!pattern.test(value)) throw new Error(`${label} is invalid.`)
}

function normalizeCounter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function normalizeProgress(progress: SubagentProgress): SubagentProgress {
  const phase = typeof progress.phase === 'string' && SAFE_PROGRESS_VALUE_PATTERN.test(progress.phase)
    ? progress.phase
    : undefined
  const lastToolName = typeof progress.lastToolName === 'string' && SAFE_PROGRESS_VALUE_PATTERN.test(progress.lastToolName)
    ? progress.lastToolName
    : undefined
  return {
    ...(phase ? { phase } : {}),
    ...(lastToolName ? { lastToolName } : {}),
    ...(normalizeCounter(progress.turnCount) !== undefined ? { turnCount: normalizeCounter(progress.turnCount) } : {}),
    ...(normalizeCounter(progress.toolCallCount) !== undefined
      ? { toolCallCount: normalizeCounter(progress.toolCallCount) }
      : {}),
    ...(normalizeCounter(progress.tokensUsed) !== undefined ? { tokensUsed: normalizeCounter(progress.tokensUsed) } : {}),
  }
}

function cloneProgress(progress: SubagentProgress): SubagentProgress {
  return { ...progress }
}

function normalizeArtifactRefs(
  summary: SubagentExecutionSummary,
  childRunId: string,
  type: SubagentType,
): string[] {
  const rawRefs = summary.artifactRefs ?? []
  if (!Array.isArray(rawRefs) || rawRefs.length > 64) {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Subagent returned an invalid artifact ref list.')
  }
  const artifactRoot = artifactRootForSubagentType(type)
  const normalized = [...new Set(rawRefs.map((value) => {
    if (typeof value !== 'string' || value.length > 1024) {
      throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Subagent returned an invalid artifact ref.')
    }
    try {
      return normalizeProjectArtifactRef(value, [artifactRoot])
    } catch {
      throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Subagent returned an unsafe artifact ref.')
    }
  }))]
  if (!isEvidencePackSubagent(type)) {
    if (normalized.length > 0) {
      throw new SubagentRunError('PROTOCOL_MISMATCH', 'Blender subagent cannot publish project artifacts.')
    }
    return []
  }

  const expectedEvidenceRef = `${artifactRoot}/evidence/${childRunId}/evidence.md`
  const evidenceRefs = normalized.filter((value) => CANONICAL_EVIDENCE_PACK_REF_PATTERN.test(value))
  if (evidenceRefs.length !== 1 || evidenceRefs[0] !== expectedEvidenceRef) {
    throw new SubagentRunError('ARTIFACT_MISSING', 'Subagent did not publish its canonical evidence pack.')
  }
  return normalized
}

function normalizeResultText(summary: SubagentExecutionSummary, type: SubagentType): string | undefined {
  if (isEvidencePackSubagent(type)) {
    if (summary.resultText !== undefined) {
      throw new SubagentRunError('PROTOCOL_MISMATCH', 'Evidence-pack subagent cannot return direct child text.')
    }
    return undefined
  }
  if (typeof summary.resultText !== 'string') {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender subagent did not return an execution report.')
  }
  const resultText = summary.resultText.trim()
  if (!resultText || Buffer.byteLength(resultText, 'utf8') > 64 * 1024) {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender subagent returned an invalid execution report.')
  }
  try {
    assertSafeCompletedBlenderReportText('Blender subagent result', resultText)
  } catch {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender subagent result failed host validation.')
  }
  return resultText
}

function salvageOf(error: unknown): SubagentSalvage | undefined {
  return error instanceof SubagentRunError ? error.salvage : undefined
}

/**
 * Keeps the refs a failed child had already published, dropping anything unsafe.
 *
 * Unlike a completed run there is no canonical evidence pack to insist on: these are the
 * screenshots and indexes that did land, and one bad entry must not cost the rest.
 */
function normalizeSalvagedArtifactRefs(
  values: readonly string[],
  type: SubagentType,
): string[] {
  const artifactRoot = artifactRootForSubagentType(type)
  const normalized: string[] = []
  for (const value of values.slice(0, 64)) {
    if (typeof value !== 'string' || value.length > 1024) continue
    try {
      normalized.push(normalizeProjectArtifactRef(value, [artifactRoot]))
    } catch {
      continue
    }
  }
  return [...new Set(normalized)]
}

function normalizeSalvagedText(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text || Buffer.byteLength(text, 'utf8') > 8 * 1024) return undefined
  try {
    assertSafeSubagentText('Salvaged subagent text', text)
  } catch {
    return undefined
  }
  return text
}

function normalizeTerminalError(error: unknown): SubagentTerminalError {
  if (error instanceof SubagentRunError && ERROR_CODE_PATTERN.test(error.code)) {
    const message = error.message.trim().slice(0, 2_000)
    return {
      code: error.code,
      message: message || 'Subagent run failed with a stable runtime error.',
      retryable: error.retryable,
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Subagent run failed with an internal error.',
    retryable: false,
  }
}

export class SubagentCoordinator {
  private readonly runner: SubagentRunner
  private readonly policies: SubagentTypePolicies
  private readonly now: () => number
  private readonly runs = new Map<string, InternalRun>()
  private readonly queues = new Map<SubagentType, InternalRun[]>(
    ACTIVE_SUBAGENT_TYPES.map((type) => [type, [] as InternalRun[]]),
  )
  private readonly activeCounts = new Map<SubagentType, number>(
    ACTIVE_SUBAGENT_TYPES.map((type) => [type, 0]),
  )
  private readonly listeners = new Set<SubagentSnapshotListener>()
  private readonly drainingTypes = new Set<SubagentType>()

  constructor(options: SubagentCoordinatorOptions) {
    this.runner = options.runner
    this.policies = options.policies ?? DEFAULT_SUBAGENT_TYPE_POLICIES
    this.now = options.now ?? Date.now
    this.validatePolicies()
  }

  enqueue(request: SubagentRequest): SubagentHandle {
    this.validateRequest(request)
    if (this.runs.has(request.childRunId)) throw new Error(`Duplicate child run id "${request.childRunId}".`)

    let resolveResult!: (result: SubagentTerminalResult) => void
    const result = new Promise<SubagentTerminalResult>((resolve) => {
      resolveResult = resolve
    })
    const run: InternalRun = {
      request: Object.freeze({ ...request }),
      status: 'queued',
      createdAtMs: this.now(),
      startedAtMs: null,
      finishedAtMs: null,
      durationMs: 0,
      queuePosition: null,
      progress: {},
      errorCode: null,
      controller: new AbortController(),
      externalAbortListener: null,
      admitted: false,
      settled: false,
      resolveResult,
      result,
    }
    this.runs.set(request.childRunId, run)
    const queue = this.queueFor(request.type)
    queue.push(run)
    run.queuePosition = queue.length
    this.attachExternalCancellation(run)
    this.emit(run)

    if (request.signal?.aborted) this.cancel(request.childRunId)
    else this.drain(request.type)

    return Object.freeze({
      childRunId: request.childRunId,
      result,
      cancel: () => this.cancel(request.childRunId),
      snapshot: () => this.snapshotOf(run),
    })
  }

  subscribe(listener: SubagentSnapshotListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(childRunId: string): SubagentRunSnapshot | null {
    const run = this.runs.get(childRunId)
    return run ? this.snapshotOf(run) : null
  }

  listSnapshots(): SubagentRunSnapshot[] {
    return [...this.runs.values()]
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((run) => this.snapshotOf(run))
  }

  hasActiveType(parentSessionId: string, type: SubagentType): boolean {
    for (const run of this.runs.values()) {
      if (run.request.parentSessionId !== parentSessionId) continue
      if (run.request.type !== type) continue
      if (!isTerminal(run.status)) return true
    }
    return false
  }

  cancel(childRunId: string): boolean {
    const run = this.runs.get(childRunId)
    if (!run || isTerminal(run.status)) return false
    run.controller.abort()

    if (run.status === 'queued') {
      this.removeFromQueue(run)
      this.finishRun(run, 'cancelled', {
        code: 'SUBAGENT_CANCELLED',
        message: 'Subagent run was cancelled.',
        retryable: true,
      })
      return true
    }

    run.progress = { ...run.progress, phase: 'cancelling' }
    this.emit(run)
    return true
  }

  cancelByParent(parentSessionId: string, parentPromptId?: string): number {
    let cancelled = 0
    for (const run of this.runs.values()) {
      if (run.request.parentSessionId !== parentSessionId) continue
      if (parentPromptId !== undefined && run.request.parentPromptId !== parentPromptId) continue
      if (this.cancel(run.request.childRunId)) cancelled += 1
    }
    return cancelled
  }

  private validatePolicies(): void {
    for (const type of ACTIVE_SUBAGENT_TYPES) {
      const policy = this.policies[type]
      if (!policy) throw new Error(`Missing subagent policy for "${type}".`)
      if (!Number.isSafeInteger(policy.maxConcurrent) || policy.maxConcurrent < 1) {
        throw new Error(`Subagent policy for "${type}" has an invalid maxConcurrent.`)
      }
      if (!Number.isSafeInteger(policy.maxSpawnDepth) || policy.maxSpawnDepth < 0) {
        throw new Error(`Subagent policy for "${type}" has an invalid maxSpawnDepth.`)
      }
      if (policy.allowedModels.length === 0 || new Set(policy.allowedModels).size !== policy.allowedModels.length) {
        throw new Error(`Subagent policy for "${type}" has an invalid model allowlist.`)
      }
    }
  }

  private validateRequest(request: SubagentRequest): void {
    const unknownKeys = Object.keys(request).filter((key) => !REQUEST_KEYS.has(key))
    if (unknownKeys.length > 0) {
      throw new Error(`Subagent request contains unsupported fields: ${unknownKeys.join(', ')}.`)
    }
    if (!SUBAGENT_TYPES.includes(request.type)) {
      throw new Error(`Unknown subagent type "${request.type}".`)
    }
    if (!isActiveSubagentType(request.type)) {
      throw new SubagentRunError('SUBAGENT_TYPE_RETIRED', `Subagent type "${request.type}" has been removed.`)
    }
    validateIdentifier('childRunId', request.childRunId, CHILD_RUN_ID_PATTERN)
    validateIdentifier('parentSessionId', request.parentSessionId)
    validateIdentifier('parentPromptId', request.parentPromptId)
    validateIdentifier('clientRunId', request.clientRunId)
    validateIdentifier('projectId', request.projectId)
    if (!request.task.trim() || request.task.length > 50_000) {
      throw new Error('Subagent task must contain 1 to 50,000 characters.')
    }
    if (!request.description.trim() || request.description.length > 240) {
      throw new Error('Subagent description must contain 1 to 240 characters.')
    }
    assertSafeSubagentText('Subagent task', request.task)
    assertSafeSubagentText('Subagent description', request.description)
    if (!path.isAbsolute(request.projectRoot)) throw new Error('Subagent projectRoot must be absolute.')

    const policy = this.policies[request.type]
    if (!policy) throw new Error(`Missing subagent policy for "${request.type}".`)
    if (!policy.allowedModels.includes(request.model)) {
      throw new Error(`Model "${request.model}" is not allowed for subagent type "${request.type}".`)
    }
    if (!Number.isSafeInteger(request.spawnDepth) || request.spawnDepth < 0 || request.spawnDepth > policy.maxSpawnDepth) {
      throw new Error(`Subagent spawnDepth exceeds the policy for "${request.type}".`)
    }
    if (request.thinkingMode !== 'fast' && request.thinkingMode !== 'deep') {
      throw new Error('Subagent thinkingMode is invalid.')
    }
  }

  private queueFor(type: SubagentType): InternalRun[] {
    const queue = this.queues.get(type)
    if (!queue) throw new Error(`No queue configured for subagent type "${type}".`)
    return queue
  }

  private attachExternalCancellation(run: InternalRun): void {
    const signal = run.request.signal
    if (!signal || signal.aborted) return
    const listener = (): void => {
      this.cancel(run.request.childRunId)
    }
    run.externalAbortListener = listener
    signal.addEventListener('abort', listener, { once: true })
  }

  private detachExternalCancellation(run: InternalRun): void {
    if (run.externalAbortListener && run.request.signal) {
      run.request.signal.removeEventListener('abort', run.externalAbortListener)
    }
    run.externalAbortListener = null
  }

  private removeFromQueue(run: InternalRun): void {
    const queue = this.queueFor(run.request.type)
    const index = queue.indexOf(run)
    if (index >= 0) queue.splice(index, 1)
    run.queuePosition = null
    this.refreshQueuePositions(run.request.type, true)
  }

  private refreshQueuePositions(type: SubagentType, notifyChanges = false): void {
    this.queueFor(type).forEach((run, index) => {
      const nextPosition = index + 1
      if (run.queuePosition === nextPosition) return
      run.queuePosition = nextPosition
      if (notifyChanges) this.emit(run)
    })
  }

  private drain(type: SubagentType): void {
    if (this.drainingTypes.has(type)) return
    this.drainingTypes.add(type)
    try {
      const policy = this.policies[type]
      if (!policy) throw new Error(`Missing subagent policy for "${type}".`)
      const queue = this.queueFor(type)
      while ((this.activeCounts.get(type) ?? 0) < policy.maxConcurrent && queue.length > 0) {
        const run = queue.shift()
        if (!run || run.settled) continue
        run.queuePosition = null
        run.admitted = true
        this.activeCounts.set(type, (this.activeCounts.get(type) ?? 0) + 1)
        this.refreshQueuePositions(type, true)
        void this.startRun(run)
      }
    } finally {
      this.drainingTypes.delete(type)
    }
  }

  private async startRun(run: InternalRun): Promise<void> {
    run.status = 'initializing'
    run.startedAtMs = this.now()
    run.progress = { phase: 'initializing' }
    this.emit(run)

    await Promise.resolve()
    if (run.controller.signal.aborted) {
      this.finishRun(run, 'cancelled', {
        code: 'SUBAGENT_CANCELLED',
        message: 'Subagent run was cancelled.',
        retryable: true,
      })
      return
    }

    run.status = 'running'
    run.progress = { phase: 'running' }
    this.emit(run)

    try {
      const requestForRunner = Object.freeze({
        ...run.request,
        signal: run.controller.signal,
      })
      const summary = await this.runner.run(requestForRunner, {
        signal: run.controller.signal,
        reportProgress: (progress) => this.reportProgress(run, progress),
      })
      if (run.controller.signal.aborted) {
        this.finishRun(run, 'cancelled', {
          code: 'SUBAGENT_CANCELLED',
          message: 'Subagent run was cancelled.',
          retryable: true,
        })
        return
      }
      this.finishRun(run, 'completed', undefined, summary)
    } catch (error) {
      if (run.controller.signal.aborted) {
        this.finishRun(run, 'cancelled', {
          code: 'SUBAGENT_CANCELLED',
          message: 'Subagent run was cancelled.',
          retryable: true,
        }, {}, salvageOf(error))
        return
      }
      this.finishRun(run, 'failed', normalizeTerminalError(error), {}, salvageOf(error))
    }
  }

  private reportProgress(run: InternalRun, progress: SubagentProgress): void {
    if (run.status !== 'running' || run.settled) return
    run.progress = { ...run.progress, ...normalizeProgress(progress) }
    this.emit(run)
  }

  private finishRun(
    run: InternalRun,
    status: SubagentTerminalStatus,
    error?: SubagentTerminalError,
    summary: SubagentExecutionSummary = {},
    salvage?: SubagentSalvage,
  ): void {
    if (run.settled) return

    let artifactRefs: string[] = []
    let resultText: string | undefined
    if (status === 'completed') {
      try {
        artifactRefs = normalizeArtifactRefs(summary, run.request.childRunId, run.request.type)
        resultText = normalizeResultText(summary, run.request.type)
      } catch (normalizationError) {
        status = 'failed'
        error = normalizeTerminalError(normalizationError)
        salvage = salvageOf(normalizationError) ?? {
          ...(summary.artifactRefs?.length ? { artifactRefs: summary.artifactRefs } : {}),
        }
      }
    }
    // A run that did not reach a published evidence pack still reports what it produced,
    // so the parent can cite the images and pick up from the child's own account.
    if (status !== 'completed' && salvage) {
      artifactRefs = normalizeSalvagedArtifactRefs(salvage.artifactRefs ?? [], run.request.type)
      resultText = normalizeSalvagedText(salvage.partialText)
    }

    const finishedAt = this.now()
    run.settled = true
    run.status = status
    run.finishedAtMs = finishedAt
    run.durationMs = run.startedAtMs === null ? 0 : Math.max(0, finishedAt - run.startedAtMs)
    run.queuePosition = null
    run.progress = { ...run.progress, phase: status }
    run.errorCode = error?.code ?? null
    this.detachExternalCancellation(run)

    if (run.admitted) {
      const active = this.activeCounts.get(run.request.type) ?? 0
      this.activeCounts.set(run.request.type, Math.max(0, active - 1))
      run.admitted = false
    }

    const result: SubagentTerminalResult = {
      childRunId: run.request.childRunId,
      type: run.request.type,
      status,
      model: run.request.model,
      usage: status === 'completed' ? normalizeSubagentUsage(summary.usage) : { ...EMPTY_SUBAGENT_USAGE },
      durationMs: run.durationMs,
      toolCallCount: status === 'completed' ? normalizeCounter(summary.toolCallCount) ?? 0 : 0,
      artifactRefs,
      ...(resultText ? { resultText } : {}),
      ...(error ? { error } : {}),
    }
    this.emit(run)
    run.resolveResult(result)
    this.drain(run.request.type)
  }

  private snapshotOf(run: InternalRun): SubagentRunSnapshot {
    const effectiveDuration = run.startedAtMs === null
      ? 0
      : run.finishedAtMs === null
        ? Math.max(0, this.now() - run.startedAtMs)
        : run.durationMs
    return {
      childRunId: run.request.childRunId,
      type: run.request.type,
      description: run.request.description,
      parentSessionId: run.request.parentSessionId,
      parentPromptId: run.request.parentPromptId,
      clientRunId: run.request.clientRunId,
      projectId: run.request.projectId,
      model: run.request.model,
      status: run.status,
      createdAt: new Date(run.createdAtMs).toISOString(),
      startedAt: run.startedAtMs === null ? null : new Date(run.startedAtMs).toISOString(),
      finishedAt: run.finishedAtMs === null ? null : new Date(run.finishedAtMs).toISOString(),
      durationMs: effectiveDuration,
      queuePosition: run.queuePosition,
      progress: cloneProgress(run.progress),
      errorCode: run.errorCode,
    }
  }

  private emit(run: InternalRun): void {
    const snapshot = this.snapshotOf(run)
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // Observer failures cannot mutate the lifecycle state machine.
      }
    }
  }
}
