import type { ThinkingMode } from '../../../../src/shared/billing-domain'

export const CAD_ANALYST_AGENT_TYPE = 'cad-analyst' as const
/**
 * Reads drawings through MLightCAD instead of AutoCAD. It is a peer of the analyst
 * rather than a replacement: LibreDWG covers fewer entity types and can run out of
 * memory on very large files, so real AutoCAD stays the authoritative fallback.
 */
export const CAD_DRAFTER_AGENT_TYPE = 'cad-drafter' as const
export const BLENDER_MODELER_AGENT_TYPE = 'blender-modeler' as const
/** Legacy discriminator retained only so stored runs and UI projections remain readable. */
export const RESEARCH_ANALYST_AGENT_TYPE = 'research-analyst' as const

export type SubagentType =
  | typeof CAD_ANALYST_AGENT_TYPE
  | typeof CAD_DRAFTER_AGENT_TYPE
  | typeof BLENDER_MODELER_AGENT_TYPE
  | typeof RESEARCH_ANALYST_AGENT_TYPE

export const SUBAGENT_TYPES = Object.freeze([
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  BLENDER_MODELER_AGENT_TYPE,
  RESEARCH_ANALYST_AGENT_TYPE,
] as const)

export const ACTIVE_SUBAGENT_TYPES = Object.freeze([
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  BLENDER_MODELER_AGENT_TYPE,
] as const)

export function isActiveSubagentType(type: SubagentType): boolean {
  return ACTIVE_SUBAGENT_TYPES.includes(type as (typeof ACTIVE_SUBAGENT_TYPES)[number])
}

/**
 * Both CAD subagents terminate by writing a canonical evidence pack rather than
 * returning prose, so every place that switches on that protocol asks this instead
 * of testing for the analyst and treating everything else as Blender.
 */
export function isCadEvidenceSubagent(type: SubagentType): boolean {
  return type === CAD_ANALYST_AGENT_TYPE || type === CAD_DRAFTER_AGENT_TYPE
}

/** Includes retired research runs so their stored results keep the original projection. */
export function isEvidencePackSubagent(type: SubagentType): boolean {
  return isCadEvidenceSubagent(type) || type === RESEARCH_ANALYST_AGENT_TYPE
}

export type SubagentLifecycleStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SubagentTerminalStatus = Extract<
  SubagentLifecycleStatus,
  'completed' | 'failed' | 'cancelled'
>

export interface SubagentUsage {
  input: number
  output: number
  cache_read: number
  cache_write: number
  total: number
  cost: number
}

export const EMPTY_SUBAGENT_USAGE: Readonly<SubagentUsage> = Object.freeze({
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  total: 0,
  cost: 0,
})

export interface SubagentRequest {
  childRunId: string
  type: SubagentType
  task: string
  description: string
  parentSessionId: string
  parentPromptId: string
  clientRunId: string
  projectId: string
  projectRoot: string
  model: string
  thinkingMode: ThinkingMode
  spawnDepth: number
  signal?: AbortSignal
}

export interface SubagentProgress {
  phase?: string
  lastToolName?: string
  turnCount?: number
  toolCallCount?: number
  tokensUsed?: number
}

export interface SubagentRunSnapshot {
  childRunId: string
  type: SubagentType
  description: string
  parentSessionId: string
  parentPromptId: string
  clientRunId: string
  projectId: string
  model: string
  status: SubagentLifecycleStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  queuePosition: number | null
  progress: SubagentProgress
  errorCode: string | null
}

export interface SubagentExecutionSummary {
  usage?: Partial<SubagentUsage>
  toolCallCount?: number
  artifactRefs?: string[]
  resultText?: string
}

/**
 * What a child had already produced when it failed or was cancelled.
 *
 * A child that dies without its final Markdown has usually done most of the work: the
 * screenshots and indexes are on disk and the last thing it said names what it found.
 * Discarding that made the parent re-run the whole investigation, so the failure carries
 * it forward instead. It is untrusted child output and still passes the same projection
 * checks as a successful result.
 */
export interface SubagentSalvage {
  partialText?: string
  artifactRefs?: readonly string[]
}

export interface SubagentTerminalError {
  code: string
  message: string
  retryable: boolean
}

export const TERMINAL_SUBAGENT_FAILURE_CODES = Object.freeze([
  'MODEL_SCHEMA_INVALID',
  'MODEL_UNAVAILABLE',
] as const)

export const SUBAGENT_RETRY_REFUSED_ERROR_CODE = 'SUBAGENT_RETRY_REFUSED' as const

export function isTerminalSubagentFailureCode(value: unknown): boolean {
  return typeof value === 'string'
    && (TERMINAL_SUBAGENT_FAILURE_CODES as readonly string[]).includes(value)
}

export interface SubagentTerminalResult {
  childRunId: string
  type: SubagentType
  status: SubagentTerminalStatus
  model: string
  usage: SubagentUsage
  durationMs: number
  toolCallCount: number
  artifactRefs: string[]
  resultText?: string
  error?: SubagentTerminalError
}

export interface SubagentRunnerContext {
  signal: AbortSignal
  reportProgress(progress: SubagentProgress): void
}

export interface SubagentRunner {
  run(
    request: Readonly<SubagentRequest>,
    context: SubagentRunnerContext,
  ): Promise<SubagentExecutionSummary>
}

export interface SubagentTypePolicy {
  maxConcurrent: number
  maxSpawnDepth: number
  allowedModels: readonly string[]
}

export type SubagentTypePolicies = Partial<Record<SubagentType, SubagentTypePolicy>>

export interface SubagentHandle {
  childRunId: string
  result: Promise<SubagentTerminalResult>
  cancel(reason?: string): boolean
  snapshot(): SubagentRunSnapshot
}

export interface SafeSubagentDetails {
  child_run_id: string
  agent_type: SubagentType
  status: SubagentTerminalStatus
  model: 'qwen3.8-max'
  usage: SubagentUsage
  duration_ms: number
  tool_call_count: number
  artifact_refs: string[]
  /** Present only when another same-task delegation must not be started. */
  terminal?: true
}

export interface SafeSubagentToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: SafeSubagentDetails
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }
}

export interface SafeSubagentTaskLaunchDetails {
  task_id: string
  agent_type: SubagentType
  status: Extract<SubagentLifecycleStatus, 'queued' | 'initializing' | 'running'>
  queue_position: number | null
}

export interface SafeSubagentTaskLaunchResult {
  content: Array<{ type: 'text'; text: string }>
  details: SafeSubagentTaskLaunchDetails
  usage: {
    input: 0
    output: 0
    cacheRead: 0
    cacheWrite: 0
    totalTokens: 0
    cost: {
      input: 0
      output: 0
      cacheRead: 0
      cacheWrite: 0
      total: 0
    }
  }
}

export class SubagentRunError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly salvage: SubagentSalvage | undefined

  constructor(code: string, message: string, retryable = false, salvage?: SubagentSalvage) {
    super(message)
    this.name = 'SubagentRunError'
    this.code = code
    this.retryable = retryable
    this.salvage = salvage
  }
}
