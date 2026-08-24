import { Agent } from '@earendil-works/pi-agent-core'
import {
  calculateContextTokens,
  estimateContextTokens,
  shouldCompact,
} from '@earendil-works/pi-agent-core'
import type {
  AgentEvent,
  AgentMessage,
  AgentOptions,
  AgentState,
  AgentTool,
} from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Model, Usage } from '@earendil-works/pi-ai'
import { isContextOverflow, isRecoverableLength } from '@earendil-works/pi-ai'
import { streamSimple as legacyStreamSimple } from '@earendil-works/pi-ai/compat'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  reasoningEffortForThinkingMode,
} from '../../../../src/shared/billing-domain'
import type {
  SubagentTraceEventDraft,
  SubagentTraceUsage,
} from '../../../../src/shared/subagent-trace'
import { buildManagedPiModel } from '../../llm/managed-model-factory'
import type { AgentDefinition, AgentDefinitionRegistry } from './agent-definition-registry'
import {
  CAD_DRAFTER_AGENT_TYPE,
  isCadEvidenceSubagent,
  RESEARCH_ANALYST_AGENT_TYPE,
  SubagentRunError,
  type SubagentExecutionSummary,
  type SubagentRequest,
  type SubagentRunner,
  type SubagentRunnerContext,
  type SubagentSalvage,
  type SubagentUsage,
} from './contracts'
import {
  EvidencePackRejection,
  inspectEvidenceBody,
  type EvidencePackWriter,
} from './evidence-pack-writer'
import { normalizeSubagentUsage } from './safe-result-projector'
import {
  artifactRootForSubagentType,
  assertSafeCompletedBlenderReportText,
  assertSafeSubagentText,
  isPathInsideRoot,
  normalizeProjectArtifactRef,
} from './security'
import type { SubagentRunStore } from './subagent-run-store'
import {
  projectSubagentTraceText,
  projectSubagentTraceValue,
} from './subagent-trace-projector'
import {
  compactSubagentMessages,
  SUBAGENT_COMPACTION_POLICY,
  type CompactSubagentMessagesInput,
  type CompactSubagentMessagesResult,
} from './subagent-compaction'
import { addSubagentUsage, type UsageAggregator } from './usage-aggregator'

export interface PiSubagentAgent {
  readonly state: AgentState
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void
  prompt(input: string): Promise<void>
  continue(): Promise<void>
  abort(): void
}

export type PiSubagentAgentFactory = (options: AgentOptions) => PiSubagentAgent

export interface SubagentToolLease {
  tools: AgentTool<any>[]
  dispose(): Promise<void> | void
  getUsage?(): Partial<SubagentUsage>
}

export type SubagentToolFactoryResult = AgentTool<any>[] | SubagentToolLease

export interface FreshPiSubagentRunnerOptions {
  definitions: AgentDefinitionRegistry
  evidenceWriter: EvidencePackWriter
  runStore: SubagentRunStore
  createTools: (
    request: Readonly<SubagentRequest>,
    definition: Readonly<AgentDefinition>,
  ) => Promise<SubagentToolFactoryResult> | SubagentToolFactoryResult
  resolveApiKey: (request: Readonly<SubagentRequest>) => Promise<string> | string
  usageAggregator?: UsageAggregator
  createModel?: (request: Readonly<SubagentRequest>) => Model<any>
  createAgent?: PiSubagentAgentFactory
  compactMessages?: (
    input: CompactSubagentMessagesInput,
  ) => Promise<CompactSubagentMessagesResult | null>
  now?: () => number
  waitForRetry?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

const EMPTY_USAGE: SubagentUsage = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  total: 0,
  cost: 0,
}

function readToolName(tool: AgentTool<any>): string {
  const name = (tool as { name?: unknown }).name
  return typeof name === 'string' ? name.trim() : ''
}

function validateChildTools(tools: readonly AgentTool<any>[], definition: AgentDefinition): void {
  const names = tools.map(readToolName)
  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    throw new SubagentRunError('PROTOCOL_MISMATCH', 'Child tool factory returned unnamed or duplicate tools.')
  }
  if (
    names.length !== definition.tools.length
    || names.some((name, index) => name !== definition.tools[index])
  ) {
    throw new SubagentRunError('PROTOCOL_MISMATCH', 'Child tools do not exactly match the trusted agent definition.')
  }
}

function normalizeToolLease(value: SubagentToolFactoryResult): SubagentToolLease {
  if (Array.isArray(value)) return { tools: value, dispose() {} }
  if (
    !value
    || typeof value !== 'object'
    || !Array.isArray(value.tools)
    || typeof value.dispose !== 'function'
    || (value.getUsage !== undefined && typeof value.getUsage !== 'function')
  ) {
    throw new SubagentRunError('PROTOCOL_MISMATCH', 'Child tool factory returned an invalid lease.')
  }
  return value
}

function usageFromAssistant(message: AssistantMessage): SubagentUsage {
  return normalizeSubagentUsage({
    input: message.usage?.input,
    output: message.usage?.output,
    cache_read: message.usage?.cacheRead,
    cache_write: message.usage?.cacheWrite,
    total: message.usage?.totalTokens,
    cost: message.usage?.cost?.total,
  })
}

function usageContributionId(childRunId: string, messageIndex: number): string {
  const digest = createHash('sha256')
    .update(`${childRunId}:${messageIndex}`, 'utf8')
    .digest('hex')
    .slice(0, 24)
  return `child-call-${digest}`
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((part) => part.type === 'text' && part.text.trim() ? [part.text.trim()] : [])
    .join('\n')
    .trim()
}

function collectArtifactRefs(
  value: unknown,
  output: Set<string>,
  artifactPrefix: string,
  depth = 0,
  budget = { value: 500 },
): void {
  if (depth > 5 || budget.value <= 0 || output.size >= 64) return
  budget.value -= 1
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\\/g, '/')
    if (normalized.startsWith(artifactPrefix) && normalized.length <= 1024) output.add(normalized)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactRefs(item, output, artifactPrefix, depth + 1, budget)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectArtifactRefs(child, output, artifactPrefix, depth + 1, budget)
  }
}

async function materializedArtifactFileRefs(
  projectRootInput: string,
  candidates: Iterable<string>,
  artifactRoot: string,
): Promise<string[]> {
  const projectRoot = await fs.promises.realpath(projectRootInput)
  const checked = await Promise.all([...candidates].map(async (value) => {
    let artifactRef: string
    try {
      artifactRef = normalizeProjectArtifactRef(value, [artifactRoot])
    } catch {
      return null
    }
    const candidate = path.resolve(projectRoot, ...artifactRef.split('/'))
    let realPath: string
    try {
      realPath = await fs.promises.realpath(candidate)
    } catch {
      return null
    }
    if (!isPathInsideRoot(projectRoot, realPath) || realPath === projectRoot) return null
    try {
      return (await fs.promises.stat(realPath)).isFile() ? artifactRef : null
    } catch {
      return null
    }
  }))
  return checked.filter((value): value is string => value !== null)
}

function getLastAssistantText(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Partial<AssistantMessage>
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    if (message.stopReason === 'error' || message.stopReason === 'aborted' || message.stopReason === 'toolUse') continue
    const text = assistantText(message as AssistantMessage)
    if (text) return text
  }
  return ''
}

function childToolScope(type: SubagentRequest['type']): string {
  if (!isCadEvidenceSubagent(type)) {
    return 'tool_scope: Only the connected Blender scene is available. No parent transcript, CAD, project-file, shell or network capability is exposed.'
  }
  const scope = 'tool_scope: All file and CAD tools are host-scoped to the bound project root. Use project-relative paths only.'
  return type === CAD_DRAFTER_AGENT_TYPE
    ? `${scope} This child reads project drawing files only. AutoCAD is not reachable.`
    : scope
}

function buildChildSystemPrompt(definition: AgentDefinition, request: Readonly<SubagentRequest>, now: number): string {
  return [
    definition.systemPrompt.trim(),
    '',
    '[trusted_child_environment]',
    `child_run_id: ${request.childRunId}`,
    `project_id: ${request.projectId}`,
    `current_date: ${new Date(now).toISOString().slice(0, 10)}`,
    childToolScope(request.type),
    'context_inheritance: none',
    '[/trusted_child_environment]',
  ].join('\n')
}

function delegatedInstructions(type: SubagentRequest['type']): string[] {
  return isCadEvidenceSubagent(type)
    ? [
        'Collect CAD evidence for this self-contained task prepared by the parent agent.',
        'Treat it as the complete investigation scope and return only the four-section evidence Markdown body.',
      ]
    : [
        'Execute this self-contained Blender task prepared by the parent agent.',
        'Treat it as the complete scope. Inspect before changing, verify modifications with a viewport screenshot, then return only the concise execution report required by your system prompt.',
      ]
}

function buildDelegatedPrompt(request: Readonly<SubagentRequest>): string {
  const instructions = delegatedInstructions(request.type)
  return [
    ...instructions,
    '--- BEGIN DELEGATED TASK ---',
    request.task,
    '--- END DELEGATED TASK ---',
  ].join('\n\n')
}

export function patchSubagentPayload(
  payload: unknown,
  request: Pick<SubagentRequest, 'childRunId' | 'clientRunId' | 'thinkingMode'>,
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const next: Record<string, unknown> = { ...(payload as Record<string, unknown>) }
  next.enable_thinking = true
  next.reasoning_effort = reasoningEffortForThinkingMode(request.thinkingMode)
  delete next.thinking_budget
  delete next.preserve_thinking
  next.xiaoliang_client_run_id = request.clientRunId
  next.xiaoliang_child_run_id = request.childRunId
  next.xiaoliang_call_purpose = 'subagent'
  return next
}

function usageFromProvider(usage: Partial<Usage> | undefined): SubagentUsage {
  return normalizeSubagentUsage({
    input: usage?.input,
    output: usage?.output,
    cache_read: usage?.cacheRead,
    cache_write: usage?.cacheWrite,
    total: usage?.totalTokens,
    cost: usage?.cost?.total,
  })
}

function createSubagentCompactionStreamFn(
  request: Pick<SubagentRequest, 'childRunId' | 'clientRunId' | 'thinkingMode'>,
) {
  return ((model, context, options) => {
    return legacyStreamSimple(model, context, {
      ...options,
      onPayload: (payload, payloadModel) => {
        const patched = patchSubagentPayload(payload, request)
        return options?.onPayload ? options.onPayload(patched, payloadModel) : patched
      },
    })
  }) as typeof legacyStreamSimple
}

function findLastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  return [...messages]
    .reverse()
    .find((message) => (message as { role?: string }).role === 'assistant') as AssistantMessage | undefined
}

function dropTrailingAssistant(
  messages: readonly AgentMessage[],
  assistant: AssistantMessage,
): AgentMessage[] {
  const next = [...messages]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index] === assistant) {
      next.splice(index, 1)
      break
    }
  }
  return next
}

function stableRunError(
  error: unknown,
  aborted: boolean,
  salvage: () => SubagentSalvage | undefined,
): SubagentRunError {
  if (aborted) {
    return new SubagentRunError(
      'SUBAGENT_CANCELLED',
      'Subagent execution was cancelled.',
      true,
      (error instanceof SubagentRunError ? error.salvage : undefined) ?? salvage(),
    )
  }
  if (error instanceof SubagentRunError) {
    return error.salvage
      ? error
      : new SubagentRunError(error.code, error.message, error.retryable, salvage())
  }
  const message = error instanceof Error
    ? boundedErrorMessage(error.message)
    : undefined
  return new SubagentRunError(
    'INTERNAL_ERROR',
    message ?? 'Subagent failed with an internal runtime error.',
    false,
    salvage(),
  )
}

const MODEL_ERROR_MESSAGE_LIMIT = 2_000
const MODEL_TRANSIENT_RETRY_DELAYS_MS = [1_000, 3_000] as const

function boundedErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const message = value.trim()
  return message ? message.slice(0, MODEL_ERROR_MESSAGE_LIMIT) : undefined
}

function modelFailureMessage(
  state: Readonly<AgentState>,
  assistant?: Readonly<AssistantMessage>,
): string | undefined {
  return boundedErrorMessage(assistant?.errorMessage)
    ?? boundedErrorMessage(state.errorMessage)
}

const PERMANENT_MODEL_FAILURE_PATTERN =
  /\b(?:unauthori[sz]ed|forbidden|invalid[_ -]?(?:request|token|credential)|context[_ -]?length[_ -]?exceeded|context window|maximum context length|aborted|cancelled|canceled)\b/u

const TRANSIENT_TRANSPORT_FAILURE_PATTERN =
  /\b(?:database_busy|econnreset|econnaborted|econnrefused|etimedout|epipe|socket hang up|fetch failed|network error|model_stream_interrupted)\b/u

/**
 * Statuses are read only where the transport actually reported one.
 *
 * Provider errors routinely quote token ceilings, temperatures and request ids, so matching
 * any bare three-digit number spent two extra paid model calls retrying permanent 4xx
 * rejections. Reading the status instead of pattern-matching the number also means a 4xx
 * other than 429 is simply absent from the retryable set.
 */
const HTTP_STATUS_PATTERNS: readonly RegExp[] = [
  /\bhttp(?:\/[\d.]+)?\s*(?:error|status)?["']?\s*[:=]?\s*(\d{3})\b/u,
  /\bstatus(?:\s*code)?["']?\s*[:=]?\s*(\d{3})\b/u,
  /\b(?:error|code)["']?\s*[:=]?\s*(\d{3})\b/u,
  /\b(\d{3})\s+(?:too many requests|service unavailable|internal server error|bad gateway|gateway time-?out)\b/u,
]

function httpStatusFromMessage(normalized: string): number | undefined {
  for (const pattern of HTTP_STATUS_PATTERNS) {
    const match = pattern.exec(normalized)
    if (match) return Number(match[1])
  }
  return undefined
}

function isTransientModelFailure(message: string | undefined): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  if (PERMANENT_MODEL_FAILURE_PATTERN.test(normalized)) return false
  if (TRANSIENT_TRANSPORT_FAILURE_PATTERN.test(normalized)) return true
  const status = httpStatusFromMessage(normalized)
  if (status === undefined) return false
  return status === 429 || (status >= 500 && status <= 599)
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', settle)
      resolve()
    }
    const timer = setTimeout(settle, delayMs)
    signal.addEventListener('abort', settle, { once: true })
  })
}

/** One reprompt only: a child that cannot produce its summary twice will not on a third. */
const SCHEMA_CONTRACT_RETRIES = 1

const SALVAGED_TEXT_LIMIT = 4_000

const CONTINUATION_PROMPT = [
  '你的上一条回复没有正文。现在只输出证据 Markdown 总结：按系统提示要求的四个二级章节组织，',
  '写你已经收集到的内容，缺失的部分写进“限制与未采用材料”。不要再调用工具。',
].join('')

/** One repair only: a child that cannot satisfy the protocol twice will not on a third. */
const EVIDENCE_REPAIR_RETRIES = 1

function buildEvidenceRepairPrompt(reason: string): string {
  return [
    '宿主拒收了你上一条证据正文，原因如下：',
    reason,
    '请只重新输出完整的证据 Markdown 正文（同样的四个二级章节，全文重写，不要只给补丁），'
    + '按上述要求修正。证据不足以支撑的判断一律降级，不要为了通过校验编造来源、日期或原文。'
    + '不要再调用工具。',
  ].join('\n')
}

/**
 * Any text the child produced, including from a turn that ended in a tool call.
 *
 * `getLastAssistantText` deliberately skips those messages because they are not a final
 * answer; for a failure report they are the best account of what the child found.
 */
function lastAssistantTextForSalvage(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Partial<AssistantMessage>
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const text = assistantText(message as AssistantMessage)
    if (text) return text
  }
  return ''
}

function salvageText(messages: readonly AgentMessage[]): string | undefined {
  const text = lastAssistantTextForSalvage(messages).slice(0, SALVAGED_TEXT_LIMIT).trim()
  if (!text) return undefined
  try {
    assertSafeSubagentText('Salvaged subagent text', text)
  } catch {
    return undefined
  }
  return text
}

function validateBlenderResultText(value: string): string {
  const result = value.trim()
  if (!result) throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender child returned no execution report.')
  if (Buffer.byteLength(result, 'utf8') > 64 * 1024) {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender child execution report is too large.')
  }
  try {
    assertSafeCompletedBlenderReportText('Blender child execution report', result)
  } catch {
    throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Blender child execution report failed host validation.')
  }
  return result
}

function traceUsage(usage: Readonly<SubagentUsage>): SubagentTraceUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cache_read,
    cacheWrite: usage.cache_write,
    totalTokens: usage.total,
    cost: usage.cost,
  }
}

export class FreshPiSubagentRunner implements SubagentRunner {
  private readonly createModel: (request: Readonly<SubagentRequest>) => Model<any>
  private readonly createAgent: PiSubagentAgentFactory
  private readonly now: () => number
  private readonly waitForRetry: (delayMs: number, signal: AbortSignal) => Promise<void>

  constructor(private readonly options: FreshPiSubagentRunnerOptions) {
    this.createModel = options.createModel ?? (() => buildManagedPiModel('default', 'subagent'))
    this.createAgent = options.createAgent ?? ((agentOptions) => new Agent(agentOptions))
    this.now = options.now ?? Date.now
    this.waitForRetry = options.waitForRetry ?? waitForRetryDelay
  }

  async run(
    request: Readonly<SubagentRequest>,
    context: SubagentRunnerContext,
  ): Promise<SubagentExecutionSummary> {
    if (request.type === RESEARCH_ANALYST_AGENT_TYPE) {
      throw new SubagentRunError('SUBAGENT_TYPE_RETIRED', 'Research subagent has been removed.')
    }
    const definition = this.options.definitions.load(request.type)
    if (definition.model !== request.model) {
      throw new SubagentRunError('PROTOCOL_MISMATCH', 'Subagent request model does not match its trusted definition.')
    }

    let storeStarted = false
    let agent: PiSubagentAgent | null = null
    let turnCount = 0
    let toolCallCount = 0
    let assistantMessageCount = 0
    let usage: SubagentUsage = { ...EMPTY_USAGE }
    const artifactRefs = new Set<string>()
    let toolLease: SubagentToolLease | null = null
    let toolLeaseUsageCollected = false
    const artifactRoot = artifactRootForSubagentType(request.type)
    const artifactPrefix = `${artifactRoot}/`

    const collectToolLeaseUsage = (): void => {
      if (toolLeaseUsageCollected || !toolLease?.getUsage) return
      toolLeaseUsageCollected = true
      usage = addSubagentUsage(usage, normalizeSubagentUsage(toolLease.getUsage()))
    }

    const finishStoredRun = async (
      status: 'completed' | 'failed' | 'cancelled',
      errorCode: string | null,
      finalArtifactRefs: readonly string[] = [...artifactRefs],
      errorMessage: string | null = null,
    ): Promise<void> => {
      if (!storeStarted) return
      await this.options.runStore.finish({
        childRunId: request.childRunId,
        status,
        usage,
        toolCallCount,
        artifactRefs: finalArtifactRefs,
        errorCode,
        errorMessage,
      })
    }

    try {
      await this.options.runStore.start(request)
      storeStarted = true
      toolLease = normalizeToolLease(await this.options.createTools(request, definition))
      const tools = toolLease.tools
      validateChildTools(tools, definition)
      const allowedToolNames = new Set(definition.tools)
      const model = this.createModel(request)
      const thinkingLevel = request.thinkingMode === 'deep' ? 'xhigh' : 'low'
      let previousSummary: string | undefined
      let compactCount = 0

      const runCompaction = async (
        messages: readonly AgentMessage[],
        force: boolean,
      ): Promise<CompactSubagentMessagesResult | null> => {
        context.reportProgress({
          phase: 'compacting',
          turnCount,
          toolCallCount,
          tokensUsed: usage.total,
        })
        const compact = this.options.compactMessages ?? compactSubagentMessages
        const result = await compact({
          messages,
          model,
          apiKey: await this.options.resolveApiKey(request),
          streamFn: createSubagentCompactionStreamFn(request),
          signal: context.signal,
          thinkingLevel,
          previousSummary,
          force,
        })
        if (!result) return null
        previousSummary = result.summary
        const compactUsage = usageFromProvider(result.usage)
        usage = addSubagentUsage(usage, compactUsage)
        compactCount += 1
        this.options.usageAggregator?.record({
          clientRunId: request.clientRunId,
          contributionId: `child-compact-${compactCount}`,
          callPurpose: 'subagent',
          childRunId: request.childRunId,
          usage: compactUsage,
        })
        return result
      }

      agent = this.createAgent({
        streamFn: legacyStreamSimple,
        initialState: {
          systemPrompt: buildChildSystemPrompt(definition, request, this.now()),
          model,
          thinkingLevel,
          tools,
          messages: [],
        },
        getApiKey: async () => this.options.resolveApiKey(request),
        onPayload: (payload) => patchSubagentPayload(payload, request),
        beforeToolCall: async ({ toolCall }) => {
          if (!allowedToolNames.has(toolCall.name)) {
            return { block: true, reason: 'Tool is outside the trusted subagent runtime ceiling.' }
          }
          return undefined
        },
        prepareNextTurnWithContext: async (turnContext) => {
          if (context.signal.aborted) return undefined
          const reported = turnContext.message.usage
            ? calculateContextTokens(turnContext.message.usage)
            : 0
          const tokens = reported > 0
            ? reported
            : estimateContextTokens(turnContext.context.messages).tokens
          if (!shouldCompact(tokens, model.contextWindow, SUBAGENT_COMPACTION_POLICY)) {
            return undefined
          }
          try {
            const compacted = await runCompaction(turnContext.context.messages, false)
            if (!compacted) return undefined
            return {
              context: {
                ...turnContext.context,
                messages: compacted.messages,
              },
            }
          } catch (error) {
            console.warn(
              '[subagent-compaction] threshold compact failed',
              error instanceof Error ? error.message : String(error),
            )
            return undefined
          }
        },
        toolExecution: 'sequential',
      })
      const activeAgent = agent

      let traceWriteChain: Promise<void> = Promise.resolve()
      let traceWriteError: unknown = null
      const unsubscribe = agent.subscribe((event) => {
        const payload = event as any
        if (event.type === 'turn_start') turnCount += 1
        if (event.type === 'tool_execution_start') {
          toolCallCount += 1
          context.reportProgress({
            phase: 'tool',
            lastToolName: event.toolName,
            turnCount,
            toolCallCount,
            tokensUsed: usage.total,
          })
        }
        if (event.type === 'tool_execution_end') {
          collectArtifactRefs(payload.result?.details, artifactRefs, artifactPrefix)
        }

        let assistantUsage: SubagentUsage | undefined
        if (event.type === 'message_end' && (event.message as { role?: string }).role === 'assistant') {
          const message = event.message as AssistantMessage
          assistantUsage = usageFromAssistant(message)
          usage = addSubagentUsage(usage, assistantUsage)
          assistantMessageCount += 1
          this.options.usageAggregator?.record({
            clientRunId: request.clientRunId,
            contributionId: usageContributionId(request.childRunId, assistantMessageCount),
            callPurpose: 'subagent',
            childRunId: request.childRunId,
            usage: assistantUsage,
          })
          context.reportProgress({
            phase: 'thinking',
            turnCount,
            toolCallCount,
            tokensUsed: usage.total,
          })
        }

        const eventTurnCount = turnCount
        const eventToolCallCount = toolCallCount
        const eventAssistantUsage = assistantUsage
        traceWriteChain = traceWriteChain.then(async () => {
          const projectionOptions = {
            projectRoot: request.projectRoot,
            storeBlob: (data: Buffer, mimeType: string) => (
              this.options.runStore.storeBlob(request.childRunId, data, mimeType)
            ),
          }
          let traceDraft: SubagentTraceEventDraft | null = null
          if (event.type === 'agent_start' || event.type === 'agent_end') {
            traceDraft = { type: event.type }
          } else if (event.type === 'turn_start' || event.type === 'turn_end') {
            traceDraft = {
              type: event.type,
              turnCount: eventTurnCount,
              toolCallCount: eventToolCallCount,
            }
          } else if (event.type === 'message_update') {
            const messageEvent = payload.assistantMessageEvent
            if (messageEvent?.type === 'text_delta' || messageEvent?.type === 'thinking_delta') {
              traceDraft = {
                type: 'assistant_delta',
                kind: messageEvent.type === 'thinking_delta' ? 'thinking' : 'text',
                contentIndex: Number.isInteger(messageEvent.contentIndex) ? messageEvent.contentIndex : 0,
                delta: projectSubagentTraceText(
                  typeof messageEvent.delta === 'string' ? messageEvent.delta : '',
                  request.projectRoot,
                ),
              }
            }
          } else if (event.type === 'message_end' && payload.message?.role === 'assistant') {
            const message = payload.message as AssistantMessage
            traceDraft = {
              type: 'assistant_message',
              content: await projectSubagentTraceValue(message.content, projectionOptions),
              ...(typeof message.stopReason === 'string'
                ? { stopReason: projectSubagentTraceText(message.stopReason, request.projectRoot).slice(0, 128) }
                : {}),
              ...(eventAssistantUsage ? { usage: traceUsage(eventAssistantUsage) } : {}),
            }
          } else if (event.type === 'tool_execution_start') {
            traceDraft = {
              type: 'tool_start',
              toolCallId: String(payload.toolCallId ?? '').slice(0, 256),
              toolName: String(payload.toolName ?? 'unknown_tool').slice(0, 128),
              args: await projectSubagentTraceValue(payload.args, projectionOptions),
            }
          } else if (event.type === 'tool_execution_update') {
            traceDraft = {
              type: 'tool_update',
              toolCallId: String(payload.toolCallId ?? '').slice(0, 256),
              toolName: String(payload.toolName ?? 'unknown_tool').slice(0, 128),
              partialResult: await projectSubagentTraceValue(payload.partialResult, projectionOptions),
            }
          } else if (event.type === 'tool_execution_end') {
            traceDraft = {
              type: 'tool_end',
              toolCallId: String(payload.toolCallId ?? '').slice(0, 256),
              toolName: String(payload.toolName ?? 'unknown_tool').slice(0, 128),
              result: await projectSubagentTraceValue(payload.result, projectionOptions),
              isError: payload.isError === true,
            }
          }
          if (traceDraft) await this.options.runStore.appendEvent(request.childRunId, traceDraft)
        }).catch((error) => {
          if (!traceWriteError) traceWriteError = error
          console.warn(
            '[subagent-trace] failed to persist event',
            error instanceof Error ? error.message : String(error),
          )
        })
      })

      const abortHandler = (): void => agent?.abort()
      if (context.signal.aborted) abortHandler()
      else context.signal.addEventListener('abort', abortHandler, { once: true })
      try {
        const retryTransientModelFailure = async (): Promise<void> => {
          let thrownError: unknown
          for (let attempt = 0; attempt < MODEL_TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
            if (context.signal.aborted) return
            const failedAssistant = findLastAssistant(activeAgent.state.messages)
            const failureMessage = thrownError instanceof Error
              ? boundedErrorMessage(thrownError.message)
              : modelFailureMessage(activeAgent.state, failedAssistant)
            const hasModelFailure = thrownError !== undefined
              || failedAssistant?.stopReason === 'error'
              || Boolean(activeAgent.state.errorMessage)
            if (!hasModelFailure) return
            if (
              failedAssistant
              && (
                isContextOverflow(failedAssistant, model.contextWindow)
                || isRecoverableLength(failedAssistant, model.maxTokens)
              )
            ) return
            if (!isTransientModelFailure(failureMessage)) {
              if (thrownError !== undefined) throw thrownError
              return
            }
            if (failedAssistant?.stopReason === 'error') {
              activeAgent.state.messages = dropTrailingAssistant(activeAgent.state.messages, failedAssistant)
            }
            const jitterMs = Math.floor(Math.random() * 251)
            await this.waitForRetry(MODEL_TRANSIENT_RETRY_DELAYS_MS[attempt] + jitterMs, context.signal)
            if (context.signal.aborted) return
            try {
              await activeAgent.continue()
              thrownError = undefined
            } catch (error) {
              thrownError = error
            }
          }
          if (thrownError !== undefined) throw thrownError
        }

        if (context.signal.aborted) {
          throw new SubagentRunError('SUBAGENT_CANCELLED', 'Subagent execution was cancelled.', true)
        }
        context.reportProgress({ phase: 'prompting', turnCount: 0, toolCallCount: 0, tokensUsed: 0 })
        await agent.prompt(buildDelegatedPrompt(request))
        const overflowAssistant = findLastAssistant(agent.state.messages)
        if (
          overflowAssistant
          && (
            isContextOverflow(overflowAssistant, model.contextWindow)
            || isRecoverableLength(overflowAssistant, model.maxTokens)
          )
        ) {
          try {
            const compacted = await runCompaction(
              dropTrailingAssistant(agent.state.messages, overflowAssistant),
              true,
            )
            if (compacted) {
              agent.state.messages = compacted.messages
              await agent.continue()
            }
          } catch (error) {
            if (error instanceof SubagentRunError) throw error
            throw new SubagentRunError(
              'MODEL_UNAVAILABLE',
              modelFailureMessage(agent.state, overflowAssistant)
                ?? boundedErrorMessage(error instanceof Error ? error.message : undefined)
                ?? 'Subagent model returned an error.',
              true,
            )
          }
        }
        await retryTransientModelFailure()
        // A CAD child that stops without its Markdown has usually finished the
        // investigation and only skipped the write-up, so it is asked once more for the
        // summary alone. This runs inside the subscription so the extra turn is traced and
        // billed like any other. A reprompt that cannot reach the model at all is reported
        // as the transport failure it is rather than as a missing write-up.
        for (
          let attempt = 0;
          attempt < SCHEMA_CONTRACT_RETRIES
          && isCadEvidenceSubagent(request.type)
          && !context.signal.aborted
          && !getLastAssistantText(agent.state.messages)
          && findLastAssistant(agent.state.messages)?.stopReason !== 'error';
          attempt += 1
        ) {
          try {
            await agent.prompt(CONTINUATION_PROMPT)
            await retryTransientModelFailure()
          } catch (error) {
            throw new SubagentRunError(
              'MODEL_UNAVAILABLE',
              modelFailureMessage(agent.state, findLastAssistant(agent.state.messages))
                ?? boundedErrorMessage(error instanceof Error ? error.message : undefined)
                ?? 'Subagent model returned an error.',
              isTransientModelFailure(
                modelFailureMessage(agent.state, findLastAssistant(agent.state.messages))
                  ?? boundedErrorMessage(error instanceof Error ? error.message : undefined),
              ),
            )
          }
        }
        // The write-up is checked here, still inside the subscription, so a repair turn is
        // traced and billed like any other. A rejection names something the child can fix —
        // most often a claim graded above what its sources support. A repair turn that cannot
        // reach the model leaves the body still rejected, so the run ends either way; it is
        // reported as the transport failure so the cause is not misread as a write-up defect.
        for (
          let attempt = 0;
          attempt < EVIDENCE_REPAIR_RETRIES
          && isCadEvidenceSubagent(request.type)
          && !context.signal.aborted;
          attempt += 1
        ) {
          const body = getLastAssistantText(agent.state.messages)
          if (!body) break
          const rejection = inspectEvidenceBody(body, request.type)
          if (!rejection) break
          try {
            await agent.prompt(buildEvidenceRepairPrompt(rejection))
            await retryTransientModelFailure()
          } catch (error) {
            throw new SubagentRunError(
              'MODEL_UNAVAILABLE',
              modelFailureMessage(agent.state, findLastAssistant(agent.state.messages))
                ?? boundedErrorMessage(error instanceof Error ? error.message : undefined)
                ?? 'Subagent model returned an error.',
              isTransientModelFailure(
                modelFailureMessage(agent.state, findLastAssistant(agent.state.messages))
                  ?? boundedErrorMessage(error instanceof Error ? error.message : undefined),
              ),
            )
          }
        }
      } finally {
        context.signal.removeEventListener('abort', abortHandler)
        unsubscribe()
        await traceWriteChain
      }
      if (traceWriteError) {
        throw new SubagentRunError('INTERNAL_ERROR', 'Subagent trace persistence failed.')
      }
      collectToolLeaseUsage()

      if (context.signal.aborted) {
        throw new SubagentRunError('SUBAGENT_CANCELLED', 'Subagent execution was cancelled.', true)
      }
      const state = agent.state
      const lastAssistant = [...state.messages]
        .reverse()
        .find((message) => (message as { role?: string }).role === 'assistant') as AssistantMessage | undefined
      if (state.errorMessage || lastAssistant?.stopReason === 'error') {
        const message = modelFailureMessage(state, lastAssistant)
        throw new SubagentRunError(
          'MODEL_UNAVAILABLE',
          message ?? 'Subagent model returned an error.',
          isTransientModelFailure(message),
        )
      }
      if (lastAssistant?.stopReason === 'aborted') {
        throw new SubagentRunError('SUBAGENT_CANCELLED', 'Subagent execution was cancelled.', true)
      }

      const childResultText = getLastAssistantText(state.messages)
      if (!isCadEvidenceSubagent(request.type)) {
        const resultText = validateBlenderResultText(childResultText)
        await finishStoredRun('completed', null, [])
        context.reportProgress({
          phase: 'result_ready',
          turnCount,
          toolCallCount,
          tokensUsed: usage.total,
        })
        return {
          usage,
          toolCallCount,
          artifactRefs: [],
          resultText,
        }
      }

      if (!childResultText) {
        throw new SubagentRunError('MODEL_SCHEMA_INVALID', 'Child returned no evidence Markdown.')
      }

      // Tool status payloads may advertise future output paths or store directories (for
      // example, CAD L2-L4 paths while a background build is still running). They are useful
      // discovery hints, but only materialized regular files qualify as evidence references.
      // The writer likewise drops citations it cannot back with a materialized file and
      // records a warning instead of failing the whole pack.
      const materializedRefs = await materializedArtifactFileRefs(
        request.projectRoot,
        artifactRefs,
        artifactRoot,
      )
      let evidence
      try {
        evidence = await this.options.evidenceWriter.write({
          projectRoot: request.projectRoot,
          childRunId: request.childRunId,
          task: request.task,
          evidenceBody: childResultText,
          artifactRefs: materializedRefs,
          type: request.type,
        })
      } catch (writeError) {
        // The gate's reason is its own wording about the write-up, never the write-up
        // itself, so it may stay on the error while the rejected body goes nowhere.
        throw new SubagentRunError(
          'MODEL_SCHEMA_INVALID',
          writeError instanceof EvidencePackRejection
            ? `Child evidence failed host validation: ${writeError.reason}`
            : 'Child evidence failed host validation.',
        )
      }
      for (const warning of evidence.warnings) {
        console.warn(`[subagent-evidence] ${request.childRunId}: ${warning}`)
      }
      await finishStoredRun('completed', null, evidence.artifactRefs)
      context.reportProgress({
        phase: 'evidence_saved',
        turnCount,
        toolCallCount,
        tokensUsed: usage.total,
      })
      return {
        usage,
        toolCallCount,
        artifactRefs: evidence.artifactRefs,
      }
    } catch (error) {
      collectToolLeaseUsage()
      const salvagedRefs = await materializedArtifactFileRefs(
        request.projectRoot,
        artifactRefs,
        artifactRoot,
      ).catch(() => [])
      // Whatever the child already put on disk stays published and is named in the failure
      // report: the screenshots and indexes are valid evidence, and re-collecting them was
      // the most expensive part of a failed run.
      const stable = stableRunError(error, context.signal.aborted, () => {
        const partialText = agent ? salvageText(agent.state.messages) : undefined
        if (!partialText && salvagedRefs.length === 0) return undefined
        return {
          ...(partialText ? { partialText } : {}),
          ...(salvagedRefs.length > 0 ? { artifactRefs: salvagedRefs } : {}),
        }
      })
      await finishStoredRun(
        stable.code === 'SUBAGENT_CANCELLED' ? 'cancelled' : 'failed',
        stable.code,
        salvagedRefs,
        stable.message,
      ).catch(() => undefined)
      throw stable
    } finally {
      await Promise.resolve(toolLease?.dispose()).catch(() => undefined)
    }
  }
}
