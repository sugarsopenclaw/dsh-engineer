import { isPersistentInteractionKind } from '@/shared/local-agent'
import type {
  AgentCompactionState,
  AgentMessagePart,
  AgentMessageRecord,
  AgentPendingInteraction,
  AgentQueueState,
  AgentRetryState,
  AgentUiEvent,
  ContextUsageInfo,
  ImageAttachment,
  SubagentRunUpdate,
} from '@/shared/local-agent'
import { mergeImageAttachments } from '@/shared/local-agent'

export interface ToolCallState {
  id: string
  name: string
  args: string
  result: string
  output: string
  startedAt: number
  status: 'running' | 'done'
}

export type StreamingPart =
  | {
      id: string
      type: 'thinking' | 'text'
      content: string
      contentIndex: number
    }
  | {
      id: string
      type: 'tool'
      toolCall: ToolCallState
    }

export interface StreamingState {
  isStreaming: boolean
  isThinking: boolean
  parts: StreamingPart[]
  attachments: ImageAttachment[]
}

export type ConversationRunStatus = 'idle' | 'running' | 'queued' | 'completed' | 'error'

export interface ConversationRuntimeBucket {
  runStatus: ConversationRunStatus
  isAgentRunning: boolean
  statusText: string | null
  streamError: string | null
  queue: AgentQueueState
  queueingSupported: boolean
  queueMutationPending: boolean
  retry: AgentRetryState | null
  compaction: AgentCompactionState | null
  compactionMutationPending: boolean
  operationAbortPending: 'retry' | 'compaction' | null
  streaming: StreamingState
  contextUsage: ContextUsageInfo | null
  subagentRuns: SubagentRunUpdate[]
  pendingInteraction: AgentPendingInteraction | null
  interactionSubmitting: boolean
  interactionError: string | null
  unreadCompletion: boolean
}

export const EMPTY_STREAMING: Readonly<StreamingState> = Object.freeze({
  isStreaming: false,
  isThinking: false,
  parts: Object.freeze([]) as unknown as StreamingPart[],
  attachments: Object.freeze([]) as unknown as ImageAttachment[],
})

export const EMPTY_AGENT_QUEUE: Readonly<AgentQueueState> = Object.freeze({
  steeringCount: 0,
  followUpCount: 0,
  items: Object.freeze([]) as unknown as AgentQueueState['items'],
})

export function emptyAgentQueue(): AgentQueueState {
  return {
    steeringCount: 0,
    followUpCount: 0,
    items: [],
  }
}

/**
 * Conversation-list snapshots must not clobber a live `context_usage` event.
 * Seed from persistence only when the runtime bucket has no usage yet.
 */
export function resolveContextUsage(
  live: ContextUsageInfo | null | undefined,
  persisted: ContextUsageInfo | null | undefined,
): ContextUsageInfo | null {
  return live ?? persisted ?? null
}

const ACTIVE_SUBAGENT_STATUSES = new Set<SubagentRunUpdate['status']>([
  'queued',
  'initializing',
  'running',
])
const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentRunUpdate['status']>([
  'completed',
  'failed',
  'cancelled',
])
const MAX_SUBAGENT_RUNS_PER_CONVERSATION = 32

export function createConversationRuntimeBucket(
  overrides: Partial<ConversationRuntimeBucket> = {},
): ConversationRuntimeBucket {
  return {
    runStatus: 'idle',
    isAgentRunning: false,
    statusText: null,
    streamError: null,
    queue: emptyAgentQueue(),
    queueingSupported: false,
    queueMutationPending: false,
    retry: null,
    compaction: null,
    compactionMutationPending: false,
    operationAbortPending: null,
    streaming: { ...EMPTY_STREAMING, parts: [], attachments: [] },
    contextUsage: null,
    subagentRuns: [],
    pendingInteraction: null,
    interactionSubmitting: false,
    interactionError: null,
    unreadCompletion: false,
    ...overrides,
  }
}

export const OPTIMISTIC_USER_MESSAGE_PREFIX = 'optimistic-'
export const SEALED_STREAM_MESSAGE_PREFIX = 'sealed-stream-'

function emptyRunningStreaming(): StreamingState {
  return {
    isStreaming: true,
    isThinking: false,
    parts: [],
    attachments: [],
  }
}

/**
 * Freezes the live overlay into a transcript assistant row so a mid-turn user
 * row can sit after it instead of above it.
 */
export function sealStreamingAsAssistantMessage(
  conversationId: string,
  streaming: StreamingState,
): AgentMessageRecord | null {
  if (streaming.parts.length === 0) return null

  const parts: AgentMessagePart[] = streaming.parts.map((part) => {
    if (part.type === 'tool') {
      return {
        type: 'tool',
        toolCallId: part.toolCall.id,
        name: part.toolCall.name,
        args: part.toolCall.args,
        result: part.toolCall.result || part.toolCall.output || '',
      }
    }
    return { type: part.type, content: part.content }
  })
  const content = parts
    .flatMap((part) => (part.type === 'text' && part.content ? [part.content] : []))
    .join('\n\n')
  const thinking = parts
    .flatMap((part) => (part.type === 'thinking' && part.content ? [part.content] : []))
    .join('\n\n')

  return {
    id: `${SEALED_STREAM_MESSAGE_PREFIX}${Date.now()}`,
    conversationId,
    role: 'assistant',
    content,
    toolName: '',
    toolArgs: '',
    toolResult: '',
    thinking,
    parts,
    ...(streaming.attachments.length > 0 ? { attachments: [...streaming.attachments] } : {}),
    createdAt: new Date().toISOString(),
  }
}

export interface AppliedPersistedTranscriptMessage {
  messages: AgentMessageRecord[]
  streaming: StreamingState
}

/**
 * Places a display-ready row the host just persisted. A genuine user turn replaces
 * its optimistic placeholder. Any mid-turn row that lands while the previous
 * assistant still lives in the overlay seals that overlay first, so transcript
 * order remains assistant -> user/host notice -> next assistant.
 */
export function applyPersistedTranscriptMessage(
  current: readonly AgentMessageRecord[],
  message: AgentMessageRecord,
  streaming: StreamingState,
): AppliedPersistedTranscriptMessage {
  if (current.some((existing) => existing.id === message.id)) {
    return { messages: [...current], streaming }
  }

  const placeholder = message.role === 'user' && !message.hostNotice
    ? current.findIndex((existing) => (
        existing.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX)
        && existing.content === message.content
      ))
    : -1
  if (placeholder >= 0) {
    const next = [...current]
    next[placeholder] = message
    return { messages: next, streaming }
  }

  if (streaming.parts.length === 0) {
    return { messages: [...current, message], streaming }
  }

  const last = current.at(-1)
  if (last?.role !== 'assistant') {
    const sealed = sealStreamingAsAssistantMessage(message.conversationId, streaming)
    return {
      messages: sealed ? [...current, sealed, message] : [...current, message],
      streaming: emptyRunningStreaming(),
    }
  }

  return {
    messages: [...current, message],
    streaming: emptyRunningStreaming(),
  }
}

/**
 * Places a user row the host just persisted. Every user turn echoes back, including the one
 * this window rendered optimistically, so that echo replaces its placeholder instead of
 * doubling it; rows the user never typed here (steering replays, host wakes) simply append.
 */
export function appendPersistedUserMessage(
  current: readonly AgentMessageRecord[],
  message: AgentMessageRecord,
): AgentMessageRecord[] {
  return applyPersistedTranscriptMessage(current, message, {
    ...EMPTY_STREAMING,
    parts: [],
    attachments: [],
  }).messages
}

export function isTerminalSubagentRun(update: SubagentRunUpdate): boolean {
  return TERMINAL_SUBAGENT_STATUSES.has(update.status)
}

export function isActiveSubagentRun(update: SubagentRunUpdate): boolean {
  return ACTIVE_SUBAGENT_STATUSES.has(update.status)
}

export function findLastRunningToolPartIndex(
  parts: StreamingPart[],
  toolCallId: string | undefined,
  toolName: string,
): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (
      part?.type === 'tool'
      && part.toolCall.status === 'running'
      && (toolCallId ? part.toolCall.id === toolCallId : part.toolCall.name === toolName)
    ) {
      return index
    }
  }
  return -1
}

export function updateStreamingMarkdownPart(
  current: StreamingState,
  partId: string,
  content: string,
): StreamingState {
  const partIndex = current.parts.findIndex((part) => part.id === partId)
  if (partIndex < 0) return current

  const target = current.parts[partIndex]
  if (target.type === 'tool' || target.content === content) return current

  const nextParts = [...current.parts]
  nextParts[partIndex] = { ...target, content }
  return { ...current, parts: nextParts }
}

export function appendRawMarkdownDelta(
  current: StreamingState,
  event: Extract<AgentUiEvent, { type: 'message_delta' }>,
  partId: string,
): StreamingState {
  const last = current.parts.at(-1)
  if (
    last
    && last.type === event.kind
    && last.contentIndex === event.contentIndex
  ) {
    const nextParts = [...current.parts]
    nextParts[nextParts.length - 1] = {
      ...last,
      content: last.content + event.delta,
    }
    return {
      ...current,
      isStreaming: true,
      isThinking: event.kind === 'thinking',
      parts: nextParts,
    }
  }

  return {
    ...current,
    isStreaming: true,
    isThinking: event.kind === 'thinking',
    parts: [
      ...current.parts,
      {
        id: partId,
        type: event.kind,
        content: event.delta,
        contentIndex: event.contentIndex,
      },
    ],
  }
}

export function mergeSubagentRunUpdates(
  current: readonly SubagentRunUpdate[],
  incoming: readonly SubagentRunUpdate[],
): SubagentRunUpdate[] {
  const byId = new Map(current.map((run) => [run.childRunId, run] as const))
  for (const update of incoming) byId.set(update.childRunId, update)
  return [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_SUBAGENT_RUNS_PER_CONVERSATION)
}

const SUBAGENT_LABELS: Readonly<Record<SubagentRunUpdate['type'], string>> = {
  'cad-analyst': 'CAD 取证',
  'cad-drafter': 'CAD 取证',
  'blender-modeler': 'Blender 子代理',
  'research-analyst': '资料调研',
}

function subagentAgentLabel(update: SubagentRunUpdate): string {
  return SUBAGENT_LABELS[update.type] ?? '子代理'
}

/** 两个 CAD 子代理负责取证；历史 research 运行仍按取证结果展示，Blender 是执行。 */
function collectsEvidence(update: SubagentRunUpdate): boolean {
  return update.type === 'cad-analyst'
    || update.type === 'cad-drafter'
    || update.type === 'research-analyst'
}

function subagentProgressPhrase(update: SubagentRunUpdate): string {
  const agentLabel = subagentAgentLabel(update)
  if (update.status === 'queued') {
    const position = update.queuePosition
    return position && position > 0
      ? `${agentLabel}排队中（第 ${position} 位）`
      : `${agentLabel}排队中`
  }
  if (update.status === 'initializing') return `${agentLabel}正在初始化`
  const tool = update.progress.lastToolName?.trim() || ''
  const action = collectsEvidence(update) ? '正在取证' : '正在执行'
  return `${agentLabel}${action}${tool ? ` · ${tool}` : ''}`
}

/**
 * 输入框上方常驻横幅文案。后台子代理与主回合互不影响，所以主回合是否在跑都要能读懂
 * 每个子代理的进度。
 */
export function describeActiveSubagentRuns(updates: readonly SubagentRunUpdate[]): string {
  const active = updates.filter(isActiveSubagentRun)
  if (active.length === 0) return ''
  return `${active.map(subagentProgressPhrase).join('；')}。完成后会自动汇报。`
}

function subagentStatusText(update: SubagentRunUpdate): string {
  const phase = update.progress.phase?.trim() || ''
  const tool = update.progress.lastToolName?.trim() || ''
  const isCad = collectsEvidence(update)
  const agentLabel = subagentAgentLabel(update)
  if (update.status === 'queued') {
    const position = update.queuePosition
    return position && position > 0
      ? `${agentLabel}排队中（第 ${position} 位）...`
      : `${agentLabel}排队中...`
  }
  if (update.status === 'initializing') return `正在初始化隔离 ${agentLabel}...`
  if (update.status === 'running') {
    return `${agentLabel}正在${isCad ? '取证' : '执行'}${tool ? ` · ${tool}` : phase ? ` · ${phase}` : ''}...`
  }
  if (update.status === 'completed') {
    return isCad
      ? `${agentLabel}取证完成，正在读取证据并组织回答...`
      : `${agentLabel}执行完成，正在组织回答...`
  }
  if (update.status === 'cancelled') return `${agentLabel}已取消。`
  return `${agentLabel}${isCad ? '取证' : '执行'}失败${update.errorCode ? `（${update.errorCode}）` : ''}。`
}

export function deriveConversationRunStatus(
  promptRunning: boolean,
  updates: readonly SubagentRunUpdate[],
  fallback: ConversationRunStatus = 'completed',
): ConversationRunStatus {
  if (promptRunning) return 'running'
  if (updates.some((update) => update.status === 'initializing' || update.status === 'running')) {
    return 'running'
  }
  if (updates.some((update) => update.status === 'queued')) return 'queued'
  return fallback
}

function settleTransientStatusText(statusText: string | null): string | null {
  if (
    statusText === '正在完成本轮任务...'
    || statusText?.endsWith('当前回合结束后生效。')
  ) {
    return null
  }
  return statusText
}

export function reduceConversationRuntimeEvent(
  current: ConversationRuntimeBucket,
  event: Exclude<AgentUiEvent, { type: 'conversation_updated' | 'conversation_mode' }>,
  options: {
    isActive: boolean
    createPartId: () => string
    now?: () => number
  },
): ConversationRuntimeBucket {
  switch (event.type) {
    case 'agent_start':
      return {
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        statusText: '正在生成回复...',
        streamError: null,
        queueingSupported: event.supportsQueueing,
        retry: null,
        compaction: null,
        streaming: { ...EMPTY_STREAMING, isStreaming: true, parts: [], attachments: [] },
        subagentRuns: current.subagentRuns.filter((run) => ACTIVE_SUBAGENT_STATUSES.has(run.status)),
        unreadCompletion: false,
      }

    // The transcript list owns these rows; the bucket only tracks run state.
    case 'transcript_message':
      return current

    case 'messages_updated':
      if (event.promptSettled !== true) return current
      return {
        ...current,
        runStatus: deriveConversationRunStatus(false, current.subagentRuns),
        isAgentRunning: false,
        statusText: settleTransientStatusText(current.statusText),
        queueingSupported: false,
        streaming: { ...EMPTY_STREAMING, parts: [], attachments: [] },
        unreadCompletion: options.isActive ? false : true,
      }

    case 'message_delta':
      return {
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        streaming: appendRawMarkdownDelta(current.streaming, event, options.createPartId()),
      }

    case 'tool_start': {
      const partId = options.createPartId()
      return {
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        statusText: `正在调用工具 ${event.toolName} ...`,
        streaming: {
          ...current.streaming,
          isStreaming: true,
          isThinking: false,
          parts: [
            ...current.streaming.parts,
            {
              id: partId,
              type: 'tool',
              toolCall: {
                id: event.toolCallId || partId,
                name: event.toolName,
                args: event.toolArgs,
                result: '',
                output: '',
                startedAt: (options.now ?? Date.now)(),
                status: 'running',
              },
            },
          ],
        },
      }
    }

    case 'tool_update': {
      const index = findLastRunningToolPartIndex(
        current.streaming.parts,
        event.toolCallId,
        event.toolName,
      )
      if (index < 0) return current
      const target = current.streaming.parts[index]
      if (target.type !== 'tool') return current
      const parts = [...current.streaming.parts]
      parts[index] = {
        ...target,
        toolCall: { ...target.toolCall, output: target.toolCall.output + event.data },
      }
      return { ...current, streaming: { ...current.streaming, parts } }
    }

    case 'tool_end': {
      const attachments = mergeImageAttachments(
        current.streaming.attachments,
        event.attachments ?? [],
      )
      const index = findLastRunningToolPartIndex(
        current.streaming.parts,
        event.toolCallId,
        event.toolName,
      )
      if (index < 0) {
        return {
          ...current,
          statusText: `工具 ${event.toolName} 已结束`,
          streaming: { ...current.streaming, isThinking: false, attachments },
        }
      }
      const target = current.streaming.parts[index]
      if (target.type !== 'tool') return current
      const parts = [...current.streaming.parts]
      parts[index] = {
        ...target,
        toolCall: { ...target.toolCall, result: event.toolResult, status: 'done' },
      }
      return {
        ...current,
        statusText: `工具 ${event.toolName} 已结束`,
        streaming: { ...current.streaming, isThinking: false, parts, attachments },
      }
    }

    case 'agent_end':
      return {
        ...current,
        statusText: event.willRetry
          ? '模型调用暂未成功，正在准备重试...'
          : '正在完成本轮任务...',
        streaming: { ...current.streaming, isThinking: false },
      }

    case 'agent_settled':
      return {
        ...current,
        runStatus: deriveConversationRunStatus(false, current.subagentRuns),
        isAgentRunning: false,
        statusText: settleTransientStatusText(current.statusText),
        queueingSupported: false,
        retry: null,
        compaction: current.compaction?.willRetry
          ? { ...current.compaction, willRetry: false }
          : current.compaction,
        streaming: { ...current.streaming, isStreaming: false, isThinking: false },
        unreadCompletion: options.isActive ? false : true,
      }

    case 'retry_update':
      return {
        ...current,
        runStatus: event.retry.phase === 'waiting' || event.retry.phase === 'running'
          ? 'running'
          : current.runStatus,
        isAgentRunning: event.retry.phase === 'waiting' || event.retry.phase === 'running'
          ? true
          : current.isAgentRunning,
        retry: {
          ...current.retry,
          ...event.retry,
          attempt: event.retry.attempt ?? current.retry?.attempt,
          maxAttempts: event.retry.maxAttempts ?? current.retry?.maxAttempts,
          delayMs: event.retry.delayMs ?? current.retry?.delayMs,
          scheduledAt: event.retry.scheduledAt ?? current.retry?.scheduledAt,
        },
        operationAbortPending: event.retry.phase === 'waiting' || event.retry.phase === 'running'
          ? current.operationAbortPending
          : current.operationAbortPending === 'retry'
            ? null
            : current.operationAbortPending,
      }

    case 'compaction_update': {
      const running = event.compaction.phase === 'running'
      const manualFinished = !running && event.compaction.reason === 'manual'
      return {
        ...current,
        runStatus: running ? 'running' : manualFinished ? 'completed' : current.runStatus,
        isAgentRunning: running ? true : manualFinished ? false : current.isAgentRunning,
        queueingSupported: running ? false : current.queueingSupported,
        compaction: event.compaction,
        operationAbortPending: !running && current.operationAbortPending === 'compaction'
          ? null
          : current.operationAbortPending,
        retry: !running && (
          current.retry?.source === 'summarization'
          || current.retry?.source === 'compaction'
          || current.retry?.source === 'branch_summary'
        ) ? null : current.retry,
      }
    }

    case 'queue_update':
      return { ...current, queue: event.queue }

    case 'error':
      return {
        ...current,
        runStatus: 'error',
        isAgentRunning: false,
        statusText: event.error,
        streamError: event.error,
        queueingSupported: false,
        retry: null,
        pendingInteraction: current.pendingInteraction
          && isPersistentInteractionKind(current.pendingInteraction.kind)
          ? current.pendingInteraction
          : null,
        interactionSubmitting: false,
        streaming: { ...current.streaming, isStreaming: false, isThinking: false },
        unreadCompletion: options.isActive ? false : true,
      }

    case 'interaction_requested': {
      const persistent = isPersistentInteractionKind(event.interaction.kind)
      const plan = event.interaction.kind === 'plan_approval'
      return {
        ...current,
        // Persistent overlays can be opened/restored while the conversation is
        // idle. Only ephemeral confirmations imply a live tool wait.
        runStatus: persistent ? current.runStatus : 'running',
        isAgentRunning: persistent ? current.isAgentRunning : true,
        statusText: event.interaction.kind === 'component_review'
          ? '请复核本轮构件'
          : plan
            ? '等待您确认计划...'
            : '等待您确认后继续...',
        pendingInteraction: event.interaction,
        interactionSubmitting: false,
        interactionError: null,
      }
    }

    case 'interaction_resolved':
      return {
        ...current,
        statusText: event.resolution.status === 'confirmed'
          ? '已确认，正在继续执行...'
          : event.resolution.status === 'expired'
            ? '确认已超时，本次操作未执行。'
            : event.resolution.status === 'aborted'
              ? '操作已停止。'
              : '已取消，本次操作未执行。',
        pendingInteraction: current.pendingInteraction?.id === event.resolution.interactionId
          ? null
          : current.pendingInteraction,
        interactionSubmitting: false,
        interactionError: null,
      }

    case 'context_usage':
      return { ...current, contextUsage: event.usage }

    case 'subagent_run': {
      const incoming = event.updates?.length ? event.updates : [event.update]
      const subagentRuns = mergeSubagentRunUpdates(current.subagentRuns, incoming)
      const latest = incoming.at(-1) ?? event.update
      return {
        ...current,
        runStatus: deriveConversationRunStatus(
          current.isAgentRunning,
          subagentRuns,
          isTerminalSubagentRun(event.update) ? 'completed' : current.runStatus,
        ),
        statusText: subagentStatusText(latest),
        subagentRuns,
        unreadCompletion: !options.isActive && isTerminalSubagentRun(event.update)
          ? true
          : current.unreadCompletion,
      }
    }

    case 'subagent_orphaned':
      return {
        ...current,
        runStatus: 'error',
        statusText: event.message,
        streamError: event.message,
        unreadCompletion: options.isActive ? false : true,
      }

    case 'cad_preextract':
      return current
  }
}
