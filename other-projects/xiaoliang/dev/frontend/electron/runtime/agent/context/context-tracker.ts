import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  estimateContextTokens,
  estimateTokens,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import type { ContextUsageInfo } from '../../../../src/shared/local-agent'
import { MAIN_COMPACTION_POLICY } from './compaction-policy'

interface TrackerState {
  /** 最近一次 LLM 返回的未命中缓存 input token 数。 */
  lastInputTokens: number
  /** 最近一次 LLM 返回的 output token 数 */
  lastOutputTokens: number
  /** 最近一次记录对应的模型。 */
  modelId: string
  /** 最近一次记录对应的上下文窗口。 */
  contextWindow: number
  /** 当前记录是否为本地估算值。 */
  estimated?: boolean
}

const sessions = new Map<string, TrackerState>()

function nonNegativeInt(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.round(numeric)
}

type PromptUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
}

/**
 * 与 Pi 配置一致的压缩警戒线。圆环还会计入 usage 之后的估算消息，
 * 因此到达 100% 表示预计占用越线，不承诺 Pi 已满足真实触发条件。
 */
export function compactAtTokensForWindow(
  contextWindow: number,
  reserveTokens: number = MAIN_COMPACTION_POLICY.reserveTokens,
): number {
  return Math.max(1, Math.round(contextWindow) - Math.max(0, Math.round(reserveTokens)))
}

function percentOfWindow(usedTokens: number, denominator: number): number {
  return denominator > 0 ? Math.min(100, Math.round((usedTokens / denominator) * 100)) : 0
}

/**
 * 单条 usage 的上下文占用，与 pi-agent-core 的 calculateContextTokens 同口径：
 * 优先使用 usage.totalTokens，缺失时回退到 input + output + cacheRead + cacheWrite。
 * 上一轮 output 已经进入下一轮上下文，必须计入，否则圆环比自动压缩阈值系统性偏低。
 */
export function contextTokensFromUsage(usage: PromptUsage): number {
  const reportedTotal = nonNegativeInt(usage.totalTokens)
  if (reportedTotal > 0) return reportedTotal
  return nonNegativeInt(usage.input)
    + nonNegativeInt(usage.output)
    + nonNegativeInt(usage.cacheRead)
    + nonNegativeInt(usage.cacheWrite)
}

export function buildContextUsageInfo(
  usage: PromptUsage,
  contextWindow: number,
  modelId: string,
  reserveTokens: number = MAIN_COMPACTION_POLICY.reserveTokens,
): ContextUsageInfo {
  const inputTokens = nonNegativeInt(usage.input)
  const outputTokens = nonNegativeInt(usage.output)
  const cacheTokens = nonNegativeInt(usage.cacheRead) + nonNegativeInt(usage.cacheWrite)
  const usedTokens = contextTokensFromUsage(usage)
  const totalTokens = Math.max(0, Math.round(contextWindow))
  const compactAtTokens = compactAtTokensForWindow(totalTokens, reserveTokens)

  return {
    inputTokens,
    outputTokens,
    cacheTokens,
    usedTokens,
    totalTokens,
    compactAtTokens,
    trailingTokens: 0,
    percent: percentOfWindow(usedTokens, compactAtTokens),
    modelId,
  }
}

function toContextUsageInfo(
  usage: NonNullable<AssistantMessage['usage']>,
  contextWindow: number,
  modelId: string,
  reserveTokens?: number,
): ContextUsageInfo {
  return buildContextUsageInfo(usage, contextWindow, modelId, reserveTokens)
}

/**
 * 从 agent 消息列表中提取最后一条有效 AssistantMessage 的 usage，
 * 与 pi-agent-core 的 estimateContextTokens 跳过 aborted/error/zero 的口径一致。
 */
export function extractLatestUsage(messages: AgentMessage[]): AssistantMessage['usage'] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as {
      role?: string
      stopReason?: string
      usage?: AssistantMessage['usage']
    }
    if (
      msg.role === 'assistant'
      && msg.stopReason !== 'aborted'
      && msg.stopReason !== 'error'
      && msg.usage
      && contextTokensFromUsage(msg.usage) > 0
    ) {
      return msg.usage
    }
  }
  return null
}

function messageTimestamp(message: AgentMessage): number | null {
  const value = (message as { timestamp?: unknown }).timestamp
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? timestamp : null
}

function latestCompactionTimestamp(messages: AgentMessage[]): number | null {
  let latest: number | null = null
  for (const message of messages) {
    if ((message as { role?: string }).role !== 'compactionSummary') continue
    const timestamp = messageTimestamp(message)
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp
  }
  return latest
}

function estimateMessagesHeuristically(messages: AgentMessage[]) {
  let tokens = 0
  for (const message of messages) tokens += estimateTokens(message)
  return {
    tokens,
    usageTokens: 0,
    trailingTokens: tokens,
    lastUsageIndex: null,
  }
}

/**
 * Retained tail messages keep their pre-compaction usage. Until a newer assistant
 * responds, use the same full-message heuristic Pi uses for estimatedTokensAfter.
 */
function estimateCurrentContext(messages: AgentMessage[]) {
  const estimate = estimateContextTokens(messages)
  if (estimate.lastUsageIndex === null) {
    return { estimate, usage: null }
  }

  const usageMessage = messages[estimate.lastUsageIndex]
  const compactionTimestamp = latestCompactionTimestamp(messages)
  const usageTimestamp = messageTimestamp(usageMessage)
  if (
    compactionTimestamp !== null
    && (usageTimestamp === null || usageTimestamp <= compactionTimestamp)
  ) {
    return { estimate: estimateMessagesHeuristically(messages), usage: null }
  }

  return {
    estimate,
    usage: (usageMessage as AssistantMessage).usage,
  }
}

/**
 * 用最后一次可信 usage 加后续消息的启发式估算构建预计占用。
 * 这让工具/子代理执行期间的圆环实时上涨；Pi 的自动触发仍以其运行时检查为准。
 */
export function buildContextUsageFromMessages(
  messages: AgentMessage[],
  contextWindow: number,
  modelId: string,
  reserveTokens: number = MAIN_COMPACTION_POLICY.reserveTokens,
): ContextUsageInfo | null {
  if (messages.length === 0) return null
  const { estimate, usage } = estimateCurrentContext(messages)
  if (!usage && estimate.tokens <= 0) return null

  const totalTokens = Math.max(0, Math.round(contextWindow))
  const compactAtTokens = compactAtTokensForWindow(totalTokens, reserveTokens)
  const usedTokens = nonNegativeInt(estimate.tokens)

  return {
    inputTokens: usage ? nonNegativeInt(usage.input) : 0,
    outputTokens: usage ? nonNegativeInt(usage.output) : 0,
    cacheTokens: usage
      ? nonNegativeInt(usage.cacheRead) + nonNegativeInt(usage.cacheWrite)
      : 0,
    usedTokens,
    totalTokens,
    compactAtTokens,
    trailingTokens: nonNegativeInt(estimate.trailingTokens),
    percent: percentOfWindow(usedTokens, compactAtTokens),
    modelId,
  }
}

export function contextUsageFingerprint(usage: ContextUsageInfo): string {
  return JSON.stringify([
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheTokens ?? 0,
    usage.usedTokens,
    usage.totalTokens,
    usage.compactAtTokens ?? 0,
    usage.trailingTokens ?? 0,
    usage.percent,
    usage.modelId,
  ])
}

/**
 * 记录本轮对话的 token 用量并返回 ContextUsageInfo。
 */
export function updateContextUsage(
  conversationId: string,
  messages: AgentMessage[],
  contextWindow: number,
  modelId: string,
  reserveTokens?: number,
): ContextUsageInfo | null {
  const usage = extractLatestUsage(messages)
  if (!usage) return null

  return updateContextUsageFromUsage(conversationId, usage, contextWindow, modelId, reserveTokens)
}

export function updateContextUsageFromUsage(
  conversationId: string,
  usage: NonNullable<AssistantMessage['usage']>,
  contextWindow: number,
  modelId: string,
  reserveTokens?: number,
): ContextUsageInfo {
  const snapshot = toContextUsageInfo(usage, contextWindow, modelId, reserveTokens)

  const state: TrackerState = {
    lastInputTokens: usage.input,
    lastOutputTokens: usage.output,
    modelId,
    contextWindow,
    estimated: false,
  }
  sessions.set(conversationId, state)

  return snapshot
}

/**
 * 用完整消息列表重算并记录上下文占用（每个 message_end / turn_end 都可调用）。
 */
export function updateContextUsageFromMessages(
  conversationId: string,
  messages: AgentMessage[],
  contextWindow: number,
  modelId: string,
  reserveTokens?: number,
): ContextUsageInfo | null {
  const snapshot = buildContextUsageFromMessages(messages, contextWindow, modelId, reserveTokens)
  if (!snapshot) return null

  sessions.set(conversationId, {
    lastInputTokens: snapshot.inputTokens,
    lastOutputTokens: snapshot.outputTokens,
    modelId,
    contextWindow,
    estimated: snapshot.trailingTokens !== 0,
  })

  return snapshot
}

export function updateContextUsageEstimate(
  conversationId: string,
  estimatedTokens: number,
  contextWindow: number,
  modelId: string,
  reserveTokens: number = MAIN_COMPACTION_POLICY.reserveTokens,
): ContextUsageInfo {
  const estimated = Math.max(0, Math.round(estimatedTokens))
  const totalTokens = Math.max(0, Math.round(contextWindow))
  const compactAtTokens = compactAtTokensForWindow(totalTokens, reserveTokens)
  const usageInfo: ContextUsageInfo = {
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    usedTokens: estimated,
    totalTokens,
    compactAtTokens,
    trailingTokens: estimated,
    percent: percentOfWindow(estimated, compactAtTokens),
    modelId,
  }

  sessions.set(conversationId, {
    lastInputTokens: 0,
    lastOutputTokens: 0,
    modelId,
    contextWindow,
    estimated: true,
  })

  return usageInfo
}

/**
 * 用已持久化的会话快照恢复 tracker 状态。
 */
export function restoreContextUsage(
  conversationId: string,
  usage: ContextUsageInfo,
): void {
  sessions.set(conversationId, {
    lastInputTokens: usage.inputTokens,
    lastOutputTokens: usage.outputTokens,
    modelId: usage.modelId,
    contextWindow: usage.totalTokens,
    estimated: (usage.trailingTokens ?? 0) > 0,
  })
}

/**
 * 获取指定会话的最新用量快照（不触发更新）。
 */
export function getContextUsageState(conversationId: string): TrackerState | undefined {
  return sessions.get(conversationId)
}

/**
 * 清除会话的追踪数据。
 */
export function clearContextUsage(conversationId: string): void {
  sessions.delete(conversationId)
}
