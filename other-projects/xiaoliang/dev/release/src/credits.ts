/**
 * The credit domain: rate-card math plus the published task-coverage ladder.
 *
 * `creditsForProfile` still mirrors `credits_for_tokens` in
 * `dev/backend/app/domain/billing/pricing.py`. The consumption table itself
 * uses a published list price per task so pack coverage stays a clean ratio:
 * the 2,000-credit signup grant covers 10 / 5 / 2 / 1 tasks.
 */

/** Micro-credits charged per single token, per bucket. */
export interface ModelCreditRates {
  uncached_input_micro: number
  cached_input_micro: number
  cache_write_micro: number
  output_micro: number
}

/** Shape of `GET /billing/pricing`. */
export interface CreditPricing {
  pricing_version: string
  credit_unit_price_rmb: number
  micro_per_credit: number
  models: Record<string, ModelCreditRates>
}

export const DEFAULT_PROVIDER_MODEL = 'qwen3.8-max'

/** Billable tokens for a whole task, already split into non-overlapping buckets. */
export interface TokenProfile {
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface UsageScenario {
  id: string
  label: string
  detail: string
  /** Typical model calls the task fans out into. */
  medianCalls: number
  /**
   * Published credits for one task. Chosen so the 2,000-credit signup grant
   * covers 10 / 5 / 2 / 1 tasks; larger packs scale by the same unit.
   */
  listCredits: number
}

/**
 * Published coverage ladder, not a raw production median.
 *
 * 2,000 signup credits → 10 单轮 / 5 常规分析 / 2 图纸算量 / 1 大图分析.
 */
export const USAGE_SCENARIOS: UsageScenario[] = [
  {
    id: 'single_turn',
    label: '单轮问答',
    detail: '直接提问、查规范条文，一问一答不展开子任务',
    medianCalls: 1,
    listCredits: 200,
  },
  {
    id: 'analysis',
    label: '常规分析任务',
    detail: '一次多步骤分析，主代理调度若干子代理协同完成',
    medianCalls: 3,
    listCredits: 400,
  },
  {
    id: 'cad_takeoff',
    label: 'CAD 图纸算量',
    detail: '读取图纸、识别构件、逐项统计并输出工程量',
    medianCalls: 6,
    listCredits: 1_000,
  },
  {
    id: 'deep_review',
    label: '大图深度分析',
    detail: '复杂图纸的全量核查，上下文长、往返轮次多',
    medianCalls: 10,
    listCredits: 2_000,
  },
]

export function ratesForModel(
  pricing: CreditPricing,
  model: string = DEFAULT_PROVIDER_MODEL,
): ModelCreditRates | null {
  return (
    pricing.models?.[model] ??
    pricing.models?.[DEFAULT_PROVIDER_MODEL] ??
    Object.values(pricing.models ?? {})[0] ??
    null
  )
}

/** Credits for one task. Mirrors the backend: sum micro, then ceil once. */
export function creditsForProfile(
  profile: TokenProfile,
  rates: ModelCreditRates,
  microPerCredit: number,
): number {
  if (microPerCredit <= 0) {
    return 0
  }
  const micro =
    profile.uncachedInputTokens * rates.uncached_input_micro +
    profile.cachedInputTokens * rates.cached_input_micro +
    profile.cacheWriteTokens * rates.cache_write_micro +
    profile.outputTokens * rates.output_micro
  return Math.ceil(micro / microPerCredit)
}

export interface ScenarioCost extends UsageScenario {
  credits: number
}

export function scenarioCosts(pricing: CreditPricing): ScenarioCost[] {
  if (!ratesForModel(pricing)) {
    return []
  }
  return USAGE_SCENARIOS.map((scenario) => ({
    ...scenario,
    credits: scenario.listCredits,
  }))
}

/** How many whole tasks of this size a credit balance buys. */
export function tasksPerBalance(balanceCredits: number, taskCredits: number): number {
  if (taskCredits <= 0) {
    return 0
  }
  return Math.floor(balanceCredits / taskCredits)
}

export function formatCredits(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

/** Fen to a yuan string, trimming the decimals whole prices do not need. */
export function formatYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/** Per-credit price, e.g. "¥0.0080/Credit". Matches the desktop purchase panel. */
export function formatUnitPrice(amountFen: number, credits: number): string {
  if (credits <= 0) {
    return '—'
  }
  return `¥${(amountFen / 100 / credits).toFixed(4)}/Credit`
}
