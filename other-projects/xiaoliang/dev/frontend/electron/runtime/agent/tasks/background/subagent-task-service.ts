import type {
  SafeSubagentTaskLaunchResult,
  SafeSubagentToolResult,
  SubagentHandle,
  SubagentRunSnapshot,
  SubagentTerminalResult,
  SubagentType,
} from '../../subagents/contracts'
import {
  projectSafeSubagentResult,
  projectSafeSubagentTaskLaunch,
} from '../../subagents/safe-result-projector'
import { CANONICAL_EVIDENCE_PACK_REF_PATTERN } from '../../subagents/security'
import type {
  StoredSubagentRun,
  SubagentRunStore,
} from '../../subagents/subagent-run-store'
import { buildSubagentCompletionPrompt } from '../../../../../src/shared/subagent-completion'

export const MAX_SUBAGENT_TASK_WAIT_MS = 10 * 60 * 1_000
export const MAX_SUBAGENT_TASK_IDS = 32
/**
 * Idle wakes wait this long before firing. A user who is mid-sentence when the task
 * lands gets to send first, and the completion then rides along as a follow-up
 * instead of racing them with a separate turn.
 */
export const DEFAULT_SUBAGENT_WAKE_GRACE_MS = 1_500
const DEFAULT_COMPLETED_TASK_RETENTION = 256
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export interface SubagentTaskRegistration {
  parentConversationId: string
  parentPromptId: string
  clientRunId: string
  handle: SubagentHandle
}

export interface SubagentTaskDeliveryContext {
  taskId: string
  agentType: SubagentType
  status: SubagentTerminalResult['status']
  /** Children carried by this injection; set only when several were merged. */
  count?: number
}

export interface SubagentTaskDeliveryCallbacks {
  parentExists(conversationId: string): boolean
  isParentBusy(conversationId: string): boolean
  /**
   * Whether the parent has already read these artifacts in its own context.
   *
   * A parent that went and read the evidence pack itself has the result; telling it again
   * costs a turn and invites it to redo the reading. Optional: hosts that cannot answer
   * simply get every notice. Only canonical per-run evidence pack refs are passed.
   */
  hasSeenEvidence?(conversationId: string, artifactRefs: readonly string[]): boolean
  followUp(
    conversationId: string,
    message: string,
    context: SubagentTaskDeliveryContext,
  ): Promise<void>
  wake(
    conversationId: string,
    message: string,
    context: SubagentTaskDeliveryContext,
  ): Promise<void>
}

export interface SubagentTaskServiceOptions {
  delivery: SubagentTaskDeliveryCallbacks
  runStore?: SubagentRunStore
  completedTaskRetention?: number
  schedule?: (callback: () => void) => void
  /** Grace period before an idle wake fires. 0 disables it. */
  wakeGraceMs?: number
  /** Injectable for tests; defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>
}

interface SubagentTaskEntry {
  taskId: string
  parentConversationId: string
  parentPromptId: string
  clientRunId: string
  snapshot: () => SubagentRunSnapshot
  resultPromise: Promise<SubagentTerminalResult> | null
  terminalResult: SubagentTerminalResult | null
  delivered: boolean
  dispatching: boolean
  waiterCount: number
  orphanedByRestart: boolean
}

export interface SubagentTaskOutput {
  taskId: string
  snapshot: SubagentRunSnapshot
  terminal: boolean
  delivered: boolean
  result: SafeSubagentTaskLaunchResult | SafeSubagentToolResult
}

/** Why a blocking wait returned before every selected task reached a terminal state. */
export type SubagentTaskWaitYieldReason = 'user_message' | 'aborted'

export interface SubagentTaskWaitResult {
  timedOut: boolean
  /** Set when the wait released early; the tasks keep running in the background. */
  yielded?: SubagentTaskWaitYieldReason
  tasks: SubagentTaskOutput[]
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

function terminalResultFromStored(run: StoredSubagentRun): SubagentTerminalResult | null {
  if (!isTerminalStatus(run.status)) return null
  const startedAt = Date.parse(run.started_at)
  const finishedAt = run.finished_at ? Date.parse(run.finished_at) : startedAt
  return {
    childRunId: run.child_run_id,
    type: run.type as SubagentType,
    status: run.status as SubagentTerminalResult['status'],
    model: run.model,
    usage: { ...run.usage },
    durationMs: Math.max(0, finishedAt - startedAt),
    toolCallCount: run.tool_call_count,
    artifactRefs: [...run.artifact_refs],
    ...(run.status === 'failed'
      ? {
          error: {
            code: run.error_code || 'INTERNAL_ERROR',
            message: run.error_message || 'Subagent run ended before the current host could deliver it.',
            retryable: run.error_code === 'HOST_RESTARTED',
          },
        }
      : {}),
  }
}

function snapshotFromStored(run: StoredSubagentRun): SubagentRunSnapshot {
  const result = terminalResultFromStored(run)
  const startedAt = Date.parse(run.started_at)
  const finishedAt = run.finished_at ? Date.parse(run.finished_at) : null
  return {
    childRunId: run.child_run_id,
    type: run.type as SubagentType,
    description: run.description,
    parentSessionId: run.parent_session_id,
    parentPromptId: run.parent_prompt_id,
    clientRunId: run.client_run_id,
    projectId: run.project_id,
    model: run.model,
    status: result?.status ?? 'failed',
    createdAt: run.started_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationMs: finishedAt === null ? 0 : Math.max(0, finishedAt - startedAt),
    queuePosition: null,
    progress: { phase: result?.status ?? 'failed' },
    errorCode: run.error_code,
  }
}

function completionMessage(entries: readonly SubagentTaskEntry[]): string {
  const [primary] = entries
  if (!primary) throw new Error('Cannot render an empty subagent completion.')
  return buildSubagentCompletionPrompt({
    parentPromptId: primary.parentPromptId,
    completions: entries.map((entry) => {
      if (!entry.terminalResult) throw new Error('Cannot render an incomplete subagent task.')
      const safe = projectSafeSubagentResult(entry.terminalResult)
      return {
        taskId: entry.taskId,
        agentType: entry.terminalResult.type,
        status: entry.terminalResult.status,
        payload: safe.content.map((item) => item.text).join('\n'),
      }
    }),
  })
}

function validateExplicitTaskIds(taskIds: readonly string[]): void {
  if (taskIds.length === 0 || taskIds.length > MAX_SUBAGENT_TASK_IDS) {
    throw new Error(`subagent_task_status accepts 1 to ${MAX_SUBAGENT_TASK_IDS} task ids.`)
  }
  if (taskIds.some((taskId) => !TASK_ID_PATTERN.test(taskId))) {
    throw new Error('subagent_task_status received an invalid task id.')
  }
}

function validateWaitTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_SUBAGENT_TASK_WAIT_MS) {
    throw new Error(`timeoutMs must be an integer between 0 and ${MAX_SUBAGENT_TASK_WAIT_MS}.`)
  }
}

export class SubagentTaskService {
  private readonly entries = new Map<string, SubagentTaskEntry>()
  private readonly completedTaskRetention: number
  private readonly schedule: (callback: () => void) => void
  private readonly wakeGraceMs: number
  private readonly delay: (ms: number) => Promise<void>
  private disposed = false

  constructor(private readonly options: SubagentTaskServiceOptions) {
    const retention = options.completedTaskRetention ?? DEFAULT_COMPLETED_TASK_RETENTION
    if (!Number.isSafeInteger(retention) || retention < 1) {
      throw new Error('Subagent task retention must be a positive safe integer.')
    }
    const wakeGraceMs = options.wakeGraceMs ?? DEFAULT_SUBAGENT_WAKE_GRACE_MS
    if (!Number.isSafeInteger(wakeGraceMs) || wakeGraceMs < 0) {
      throw new Error('Subagent wake grace must be a non-negative safe integer.')
    }
    this.completedTaskRetention = retention
    this.wakeGraceMs = wakeGraceMs
    this.schedule = options.schedule ?? ((callback) => queueMicrotask(callback))
    this.delay = options.delay
      ?? ((ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  }

  register(registration: SubagentTaskRegistration): void {
    if (this.disposed) throw new Error('Subagent task service is disposed.')
    const { handle } = registration
    if (this.entries.has(handle.childRunId)) {
      throw new Error(`Duplicate background subagent task "${handle.childRunId}".`)
    }
    const entry: SubagentTaskEntry = {
      taskId: handle.childRunId,
      parentConversationId: registration.parentConversationId,
      parentPromptId: registration.parentPromptId,
      clientRunId: registration.clientRunId,
      snapshot: () => handle.snapshot(),
      resultPromise: handle.result,
      terminalResult: null,
      delivered: false,
      dispatching: false,
      waiterCount: 0,
      orphanedByRestart: false,
    }
    this.entries.set(entry.taskId, entry)
    void handle.result.then((result) => this.settle(entry, result))
  }

  async restoreRestartedTasks(runs: readonly StoredSubagentRun[]): Promise<number> {
    let restored = 0
    for (const run of runs) {
      if (
        run.error_code !== 'HOST_RESTARTED'
        || run.orphan_notice_consumed
        || this.entries.has(run.child_run_id)
      ) continue
      const result = terminalResultFromStored(run)
      if (!result) continue
      const snapshot = snapshotFromStored(run)
      this.entries.set(run.child_run_id, {
        taskId: run.child_run_id,
        parentConversationId: run.parent_session_id,
        parentPromptId: run.parent_prompt_id,
        clientRunId: run.client_run_id,
        snapshot: () => snapshot,
        resultPromise: Promise.resolve(result),
        terminalResult: result,
        delivered: false,
        dispatching: false,
        waiterCount: 0,
        orphanedByRestart: true,
      })
      restored += 1
    }
    this.trimCompletedEntries()
    return restored
  }

  async takeRestartedTaskNotices(parentConversationId: string): Promise<string[]> {
    const entries = [...this.entries.values()].filter((entry) => (
      entry.parentConversationId === parentConversationId
      && entry.orphanedByRestart
      && !entry.delivered
    ))
    if (entries.length === 0) return []
    for (const entry of entries) {
      entry.delivered = true
      if (this.options.runStore) {
        await this.options.runStore.markOrphanNoticeConsumed(entry.taskId).catch(() => undefined)
      }
    }
    this.trimCompletedEntries()
    return entries.map((entry) => entry.taskId)
  }

  async wait(input: {
    parentConversationId: string
    taskIds?: readonly string[]
    timeoutMs?: number
    /**
     * Resolves when the user queues a steering message; releases the wait early.
     * The passed signal is aborted once the wait settles so the observer can detach.
     */
    interrupt?: (signal: AbortSignal) => Promise<void>
    /** Abort signal of the parent run; releases the wait early. */
    signal?: AbortSignal
  }): Promise<SubagentTaskWaitResult> {
    const timeoutMs = input.timeoutMs ?? 0
    validateWaitTimeout(timeoutMs)
    if (input.taskIds !== undefined) validateExplicitTaskIds(input.taskIds)
    const selected = this.selectEntries(input.parentConversationId, input.taskIds)
    if (selected.length === 0 && input.taskIds === undefined) {
      return { timedOut: false, tasks: [] }
    }

    if (timeoutMs === 0) {
      return { timedOut: false, tasks: selected.map((entry) => this.toOutput(entry)) }
    }

    // Register waiters before checking terminal state. A completion cannot slip
    // between the check and listener installation and trigger duplicate delivery.
    for (const entry of selected) entry.waiterCount += 1
    let timedOut = false
    let yielded: SubagentTaskWaitYieldReason | undefined
    const release = new AbortController()
    try {
      if (!selected.some((entry) => entry.terminalResult)) {
        if (input.signal?.aborted) {
          yielded = 'aborted'
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            ...selected.flatMap((entry) => entry.resultPromise
              ? [entry.resultPromise.then(() => undefined)]
              : []),
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                timedOut = true
                resolve()
              }, timeoutMs)
            }),
            ...(input.interrupt
              ? [input.interrupt(release.signal).then(() => {
                  if (!release.signal.aborted) yielded ??= 'user_message'
                })]
              : []),
            ...(input.signal
              ? [new Promise<void>((resolve) => {
                  input.signal!.addEventListener('abort', () => {
                    yielded ??= 'aborted'
                    resolve()
                  }, { once: true, signal: release.signal })
                })]
              : []),
          ])
          if (timer) clearTimeout(timer)
        }
      }
      const terminalEntries = selected.filter((entry) => entry.terminalResult)
      if (input.signal?.aborted) {
        // The tool result is discarded with the run, so nothing may be consumed here.
        yielded = 'aborted'
      } else if (yielded === 'user_message' && terminalEntries.length > 0) {
        // A terminal result that landed alongside a user interjection still reaches
        // the model through this tool result, so consume it instead of injecting twice.
        yielded = undefined
      }
      if (!yielded) {
        for (const entry of terminalEntries) entry.delivered = true
      }
      return {
        timedOut,
        ...(yielded ? { yielded } : {}),
        tasks: selected.map((entry) => this.toOutput(entry)),
      }
    } finally {
      release.abort()
      for (const entry of selected) {
        entry.waiterCount = Math.max(0, entry.waiterCount - 1)
        if (entry.waiterCount === 0 && entry.terminalResult && !entry.delivered) {
          this.schedule(() => void this.dispatchCompletion(entry))
        }
      }
      this.trimCompletedEntries()
    }
  }

  flushPendingDeliveries(parentConversationId?: string): void {
    for (const entry of this.entries.values()) {
      if (parentConversationId && entry.parentConversationId !== parentConversationId) continue
      if (!entry.terminalResult || entry.delivered || entry.dispatching || entry.waiterCount > 0) continue
      this.schedule(() => void this.dispatchCompletion(entry))
    }
  }

  suppressByParent(parentConversationId: string, parentPromptId?: string): number {
    let suppressed = 0
    for (const entry of this.entries.values()) {
      if (entry.parentConversationId !== parentConversationId) continue
      if (parentPromptId && entry.parentPromptId !== parentPromptId) continue
      if (!entry.delivered) {
        entry.delivered = true
        suppressed += 1
      }
    }
    if (suppressed > 0) this.trimCompletedEntries()
    return suppressed
  }

  dispose(): void {
    this.disposed = true
    this.entries.clear()
  }

  private selectEntries(
    parentConversationId: string,
    taskIds?: readonly string[],
  ): SubagentTaskEntry[] {
    const ids = taskIds !== undefined
      ? [...new Set(taskIds)]
      : this.selectImplicitEntryIds(parentConversationId)
    const entries = ids.map((taskId) => {
      const entry = this.entries.get(taskId)
      if (!entry || entry.parentConversationId !== parentConversationId) {
        throw new Error(`Unknown subagent task "${taskId}" for this conversation.`)
      }
      this.touch(entry)
      return entry
    })
    return entries
  }

  private selectImplicitEntryIds(parentConversationId: string): string[] {
    const registered = [...this.entries.values()].filter(
      (entry) => entry.parentConversationId === parentConversationId,
    )
    const active = registered.filter((entry) => !entry.terminalResult)
    const completed = registered.filter((entry) => entry.terminalResult)
    const completedBudget = Math.max(0, MAX_SUBAGENT_TASK_IDS - active.length)
    const recentCompleted = completedBudget > 0
      ? completed.slice(-completedBudget)
      : []
    return [...active, ...recentCompleted].map((entry) => entry.taskId)
  }

  private settle(entry: SubagentTaskEntry, result: SubagentTerminalResult): void {
    if (this.disposed || entry.terminalResult) return
    entry.terminalResult = result
    this.touch(entry)
    this.trimCompletedEntries()
    if (entry.waiterCount === 0) this.schedule(() => void this.dispatchCompletion(entry))
  }

  private async dispatchCompletion(entry: SubagentTaskEntry): Promise<void> {
    if (!this.isDispatchable(entry)) return
    if (!this.options.delivery.parentExists(entry.parentConversationId)) {
      entry.delivered = true
      this.trimCompletedEntries()
      return
    }
    if (this.hasParentAlreadyRead(entry)) {
      entry.delivered = true
      this.trimCompletedEntries()
      return
    }
    // Everything else that finished for this parent while nothing was injected rides along
    // in the same notice; the alternative is one whole parent turn per child.
    const batch = [entry, ...[...this.entries.values()].filter((candidate) => (
      candidate !== entry
      && candidate.parentConversationId === entry.parentConversationId
      && this.isDispatchable(candidate)
      && !this.hasParentAlreadyRead(candidate)
    ))]
    for (const member of batch) member.dispatching = true
    try {
      const message = completionMessage(batch)
      const context: SubagentTaskDeliveryContext = {
        taskId: entry.taskId,
        agentType: entry.terminalResult!.type,
        status: entry.terminalResult!.status,
        ...(batch.length > 1 ? { count: batch.length } : {}),
      }
      if (await this.shouldFollowUp(entry)) {
        await this.options.delivery.followUp(entry.parentConversationId, message, context)
      } else {
        await this.options.delivery.wake(entry.parentConversationId, message, context)
      }
      for (const member of batch) member.delivered = true
    } catch (error) {
      console.warn(
        '[subagent-task-service] completion delivery deferred',
        entry.taskId,
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      for (const member of batch) member.dispatching = false
      if (entry.delivered) this.trimCompletedEntries()
    }
  }

  private isDispatchable(entry: SubagentTaskEntry): boolean {
    return !this.disposed
      && !entry.delivered
      && !entry.dispatching
      && entry.waiterCount === 0
      && Boolean(entry.terminalResult)
      && !entry.orphanedByRestart
  }

  private hasParentAlreadyRead(entry: SubagentTaskEntry): boolean {
    if (!this.options.delivery.hasSeenEvidence) return false
    // Only the per-run evidence pack proves the parent has this run's result; shared
    // research pages carry no run identity and must not suppress the notice.
    const refs = (entry.terminalResult?.artifactRefs ?? [])
      .filter((ref) => CANONICAL_EVIDENCE_PACK_REF_PATTERN.test(ref))
    if (refs.length === 0) return false
    return this.options.delivery.hasSeenEvidence(entry.parentConversationId, refs)
  }

  /**
   * Decides between injecting into a live turn and waking an idle conversation.
   * An idle conversation gets a grace period first: if the user starts a turn during
   * it, the completion joins that turn instead of opening a competing one.
   */
  private async shouldFollowUp(entry: SubagentTaskEntry): Promise<boolean> {
    if (this.options.delivery.isParentBusy(entry.parentConversationId)) return true
    if (this.wakeGraceMs === 0) return false
    await this.delay(this.wakeGraceMs)
    if (this.disposed || entry.delivered) return false
    return this.options.delivery.isParentBusy(entry.parentConversationId)
  }

  private toOutput(entry: SubagentTaskEntry): SubagentTaskOutput {
    const snapshot = entry.snapshot()
    return {
      taskId: entry.taskId,
      snapshot,
      terminal: Boolean(entry.terminalResult),
      delivered: entry.delivered,
      result: entry.terminalResult
        ? projectSafeSubagentResult(entry.terminalResult)
        : projectSafeSubagentTaskLaunch(snapshot),
    }
  }

  private touch(entry: SubagentTaskEntry): void {
    this.entries.delete(entry.taskId)
    this.entries.set(entry.taskId, entry)
  }

  private trimCompletedEntries(): void {
    const completed = [...this.entries.values()].filter((entry) => entry.terminalResult)
    let excess = completed.length - this.completedTaskRetention
    if (excess <= 0) return
    for (const [taskId, entry] of this.entries) {
      if (excess <= 0) break
      if (
        !entry.terminalResult
        || !entry.delivered
        || entry.waiterCount > 0
        || entry.dispatching
      ) continue
      this.entries.delete(taskId)
      excess -= 1
    }
  }
}
