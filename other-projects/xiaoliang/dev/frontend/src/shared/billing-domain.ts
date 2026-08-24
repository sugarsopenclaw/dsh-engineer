/** Pure billing domain helpers (no React / Electron). */

export const QUOTA_EXCEEDED_CODE = 'quota_exceeded'

export type ManagedModelKind = 'default' | 'vision' | 'expert'
export type ManagedCallPurpose =
  | 'main'
  | 'subagent'
  | 'cad_query'
  | 'visual_index'
  /** Reserved slot: the catalog ships a limit for it, but nothing calls it yet. */
  | 'schema_repair'
  | 'compaction'

/** Desktop chat thinking mode: 极速 / 专家 (does not change model alias). */
export type ThinkingMode = 'fast' | 'deep'

/**
 * DashScope qwen3.8-max reasoning_effort.
 * Official mapping (do not also send thinking_budget):
 * low→4096, medium→16384, xhigh→262144. Default when unset: xhigh.
 */
export type ReasoningEffort = 'low' | 'medium' | 'xhigh'

export const DEFAULT_THINKING_MODE: ThinkingMode = 'fast'
/** 极速：轻量推理（官方 low → thinking_budget 4096） */
export const FAST_REASONING_EFFORT: ReasoningEffort = 'low'
/** 专家：最强推理（官方 xhigh → thinking_budget 262144） */
export const DEEP_REASONING_EFFORT: ReasoningEffort = 'xhigh'
/** 辅助链路（CAD/压缩/联网等）统一用 low，始终开启思考。 */
export const AUX_REASONING_EFFORT: ReasoningEffort = 'low'

export const MANAGED_MODEL_ALIASES = {
  default: 'xiaoliang-agent-default',
  vision: 'xiaoliang-agent-vision',
  expert: 'xiaoliang-agent-expert',
} as const

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === 'fast' || value === 'deep'
}

export function normalizeThinkingMode(value: unknown): ThinkingMode {
  return isThinkingMode(value) ? value : DEFAULT_THINKING_MODE
}

export function thinkingModeLabel(mode: ThinkingMode): string {
  return mode === 'deep' ? '专家' : '极速'
}

export function reasoningEffortForThinkingMode(mode: ThinkingMode): ReasoningEffort {
  return mode === 'deep' ? DEEP_REASONING_EFFORT : FAST_REASONING_EFFORT
}

/** Persist / restore the Pi session thinking_level_change that matches a chat mode. */
export function piThinkingLevelForMode(mode: ThinkingMode): 'low' | 'xhigh' {
  return mode === 'deep' ? 'xhigh' : 'low'
}

/**
 * Map a Pi thinking_level_change back to the desktop 极速/专家 toggle.
 * `high` is treated as 专家 so an older session that clamped xhigh→high stays deep.
 */
export function thinkingModeFromPiLevel(level: unknown): ThinkingMode {
  return level === 'high' || level === 'xhigh' || level === 'max' ? 'deep' : 'fast'
}

/** Encode access token + agent-run id for gateway anti-bypass checks. */
export function buildManagedGatewayCredential(accessToken: string, clientRunId?: string | null): string {
  const token = accessToken.trim()
  const runId = (clientRunId || '').trim()
  if (!token) return ''
  if (!runId) return token
  return `xl.${runId}.${token}`
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: string; status?: number; name?: string }
  if (record.code === QUOTA_EXCEEDED_CODE) return true
  if (record.status === 402) return true
  if (error instanceof Error && /额度不足|quota/i.test(error.message)) return true
  return false
}

/** Credits below this are treated as "about to run out" by the UI. */
export const DEFAULT_LOW_BALANCE_CREDITS = 500

export const PLAN_TIER_LABELS: Record<string, string> = {
  free: '免费',
  starter: '入门版',
  standard: '标准版',
  professional: '专业版',
}

export function planTierLabel(planTier?: string | null): string {
  const tier = (planTier || 'free').toLowerCase()
  return PLAN_TIER_LABELS[tier] ?? PLAN_TIER_LABELS.free
}

export interface QuotaLike {
  plan_tier?: string | null
  credits_remaining?: number | null
  credits_total?: number | null
  low_balance_threshold?: number | null
  /** @deprecated pre-credits builds only */
  quota_remaining?: number | null
}

export function creditsRemaining(quota: QuotaLike | null | undefined): number {
  if (!quota) return 0
  return Math.max(0, quota.credits_remaining ?? quota.quota_remaining ?? 0)
}

export function formatCredits(credits: number): string {
  return Math.max(0, Math.round(credits)).toLocaleString('en-US')
}

export function formatQuotaLabel(input: QuotaLike): string {
  return `${planTierLabel(input.plan_tier)} · ${formatCredits(creditsRemaining(input))} Credits`
}

export function isLowBalance(quota: QuotaLike | null | undefined): boolean {
  if (!quota) return false
  const threshold = quota.low_balance_threshold || DEFAULT_LOW_BALANCE_CREDITS
  return creditsRemaining(quota) < threshold
}

export function formatAmountYuan(amountFen: number): string {
  return `¥${(amountFen / 100).toFixed(amountFen % 100 === 0 ? 0 : 2)}`
}

/** Per-credit price, e.g. "¥0.0080/Credit". */
export function formatUnitPrice(amountFen: number, credits: number): string {
  if (credits <= 0) return '—'
  return `¥${(amountFen / 100 / credits).toFixed(4)}/Credit`
}

export function formatValidityDays(days: number): string {
  if (days % 365 === 0) return `${days / 365} 年有效`
  if (days % 30 === 0) return `${days / 30} 个月有效`
  return `${days} 天有效`
}

/* ------------------------------------------------------------------ */
/* Run usage：后端权威的单次 run / 会话累计 token 与 Credits 快照。        */
/* 注意后端口径与 pi-ai 不同：input_tokens 是完整 prompt（含缓存部分）。   */
/* ------------------------------------------------------------------ */

export interface RunUsagePurposeBreakdown {
  callPurpose: string
  childRunId: string | null
  callCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

/** 单个 run 的后端权威用量快照（conversation_usage_runs 行的视图形态）。 */
export interface ConversationRunUsageView {
  clientRunId: string
  status: string
  creditsCharged: number
  callCount: number
  /** 完整 prompt token（含 cache_read/cache_write 部分） */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  breakdown: RunUsagePurposeBreakdown[]
  updatedAt: string
}

/** 会话累计：本机观测到的每个 run 的后端权威数字之和。 */
export interface ConversationUsageTotalsView {
  runCount: number
  creditsCharged: number
  callCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  breakdown: RunUsagePurposeBreakdown[]
}

export interface ConversationUsageChangedPayload {
  conversationId: string
  /** 当前/最近一个 run 的快照；会话还没有任何 run 记录时为 null */
  run: ConversationRunUsageView | null
  session: ConversationUsageTotalsView
}

/** 缓存命中率：命中部分占完整 prompt 的比例（0-100，无输入时为 0）。 */
export function runUsageCacheHitPercent(view: {
  inputTokens: number
  cacheReadTokens: number
}): number {
  if (view.inputTokens <= 0) return 0
  return Math.min(100, Math.round((view.cacheReadTokens / view.inputTokens) * 100))
}
