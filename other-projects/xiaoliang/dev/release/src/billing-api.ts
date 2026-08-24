/**
 * Pricing for the landing page comes from the same endpoints the desktop
 * purchase panel reads, so the numbers here can never drift from what the
 * backend actually charges. Changing a price means editing
 * `dev/backend/app/domain/billing/products.py` and nothing else.
 *
 * Both endpoints are public (no auth dependency, CORS open). The fallbacks
 * below mirror the current backend constants and exist only so a dead API
 * still renders a page with prices instead of an empty section.
 */
import type { CreditPricing } from './credits'
import { DEFAULT_PROVIDER_MODEL } from './credits'
import { RELEASE_API_BASE_URL } from './release-api'

/** Shape of one entry from `GET /billing/products`. */
export interface BillingProduct {
  id: string
  plan_tier: string
  name: string
  description: string
  amount_fen: number
  credits: number
  duration_days: number
  /** RMB per credit; strictly decreases as the pack grows. */
  unit_price_rmb: number
  /** Percent cheaper per credit than the smallest pack; 0 for the smallest. */
  discount_percent: number
}

/** Credits granted to every new account. Mirrors BILLING_SIGNUP_GRANT_CREDITS. */
export const SIGNUP_GRANT_CREDITS = 2000

/** Mirrors `list_products()` plus the discount math in `billing_service.py`. */
export const FALLBACK_PRODUCTS: BillingProduct[] = [
  {
    id: 'credits_starter',
    plan_tier: 'starter',
    name: '入门版',
    description: '晓量算力包 12,375 Credits（12 个月）',
    amount_fen: 9900,
    credits: 12_375,
    duration_days: 365,
    unit_price_rmb: 0.008,
    discount_percent: 0,
  },
  {
    id: 'credits_standard',
    plan_tier: 'standard',
    name: '标准版',
    description: '晓量算力包 63,750 Credits（12 个月）',
    amount_fen: 49900,
    credits: 63_750,
    duration_days: 365,
    unit_price_rmb: 0.007827,
    discount_percent: 2,
  },
  {
    id: 'credits_professional',
    plan_tier: 'professional',
    name: '专业版',
    description: '晓量算力包 132,000 Credits（12 个月）',
    amount_fen: 99900,
    credits: 132_000,
    duration_days: 365,
    unit_price_rmb: 0.007568,
    discount_percent: 5,
  },
]

/** Mirrors `pricing_table()` at markup 10/9 and ¥0.008 per credit. */
export const FALLBACK_PRICING: CreditPricing = {
  pricing_version: 'qwen3.8-max-cn-beijing-x1.11-v1',
  credit_unit_price_rmb: 0.008,
  micro_per_credit: 1_000_000,
  models: {
    [DEFAULT_PROVIDER_MODEL]: {
      uncached_input_micro: 1667,
      cached_input_micro: 208,
      cache_write_micro: 2083,
      output_micro: 5_000,
    },
  },
}

const REQUEST_TIMEOUT_MS = 8000

export async function fetchBillingProducts(): Promise<BillingProduct[]> {
  const products = await getJson<BillingProduct[]>('/billing/products')
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('价格套餐为空')
  }
  return [...products].sort((left, right) => left.amount_fen - right.amount_fen)
}

export async function fetchCreditPricing(): Promise<CreditPricing> {
  const pricing = await getJson<CreditPricing>('/billing/pricing')
  if (!pricing?.models || !pricing.micro_per_credit) {
    throw new Error('费率表为空')
  }
  return pricing
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
  message?: string | null
}

async function getJson<T>(pathName: string): Promise<T> {
  const response = await fetch(`${RELEASE_API_BASE_URL}${pathName}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  let payload: ApiEnvelope<T> | null = null
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    /* keep payload null when the body is not JSON */
  }

  if (!response.ok || !payload?.success || payload.data == null) {
    throw new Error(payload?.message || `请求失败 (${response.status})`)
  }

  return payload.data
}
