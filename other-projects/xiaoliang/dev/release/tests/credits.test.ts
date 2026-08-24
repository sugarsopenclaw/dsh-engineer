import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_PROVIDER_MODEL,
  USAGE_SCENARIOS,
  creditsForProfile,
  formatUnitPrice,
  formatYuan,
  ratesForModel,
  scenarioCosts,
  tasksPerBalance,
  type CreditPricing,
  type ModelCreditRates,
} from '../src/credits.ts'

/** Mirrors `pricing_table()` on the backend at markup 10/9, ¥0.008 per credit. */
const PRICING: CreditPricing = {
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

const RATES = PRICING.models[DEFAULT_PROVIDER_MODEL] as ModelCreditRates

describe('creditsForProfile', () => {
  it('prices each token bucket at its own rate', () => {
    const credits = creditsForProfile(
      {
        uncachedInputTokens: 1000,
        cachedInputTokens: 1000,
        cacheWriteTokens: 1000,
        outputTokens: 1000,
      },
      RATES,
      1_000_000,
    )
    // (1667 + 208 + 2083 + 5000) * 1000 micro = 8.958 credits, rounded up.
    assert.equal(credits, 9)
  })

  it('rounds a partial credit up, never down', () => {
    const oneMicroOver = creditsForProfile(
      {
        uncachedInputTokens: 601,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      RATES,
      1_000_000,
    )
    // 601 * 1667 = 1_001_867 micro, just past one credit.
    assert.equal(oneMicroOver, 2)
  })

  it('charges nothing for an empty task', () => {
    const credits = creditsForProfile(
      {
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      RATES,
      1_000_000,
    )
    assert.equal(credits, 0)
  })

  it('bills cached input at an eighth of uncached input', () => {
    const profile = { cacheWriteTokens: 0, outputTokens: 0 }
    const uncached = creditsForProfile(
      { ...profile, uncachedInputTokens: 100_000, cachedInputTokens: 0 },
      RATES,
      1_000_000,
    )
    const cached = creditsForProfile(
      { ...profile, uncachedInputTokens: 0, cachedInputTokens: 100_000 },
      RATES,
      1_000_000,
    )
    assert.equal(uncached, 167)
    assert.equal(cached, 21)
  })
})

describe('scenario table', () => {
  const costs = scenarioCosts(PRICING)

  it('publishes the signup coverage ladder', () => {
    assert.deepEqual(
      costs.map((cost) => [cost.id, cost.credits, cost.listCredits]),
      [
        ['single_turn', 200, 200],
        ['analysis', 400, 400],
        ['cad_takeoff', 1000, 1000],
        ['deep_review', 2000, 2000],
      ],
    )
    assert.deepEqual(
      costs.map((cost) => tasksPerBalance(2000, cost.credits)),
      [10, 5, 2, 1],
    )
  })

  it('keeps list credits aligned with the published row', () => {
    for (const cost of costs) {
      assert.equal(cost.credits, cost.listCredits)
    }
  })

  it('reads as a ladder from cheapest to dearest', () => {
    const credits = costs.map((cost) => cost.credits)
    assert.deepEqual(credits, [...credits].sort((left, right) => left - right))
    assert.equal(new Set(credits).size, credits.length)
  })

  it('does not let a rate-card change move the published ladder', () => {
    const doubled = scenarioCosts({
      ...PRICING,
      models: {
        [DEFAULT_PROVIDER_MODEL]: {
          uncached_input_micro: RATES.uncached_input_micro * 2,
          cached_input_micro: RATES.cached_input_micro * 2,
          cache_write_micro: RATES.cache_write_micro * 2,
          output_micro: RATES.output_micro * 2,
        },
      },
    })
    assert.deepEqual(
      doubled.map((cost) => cost.credits),
      costs.map((cost) => cost.credits),
    )
  })

  it('quotes whole-task figures, not single calls', () => {
    // A task fanning out into many calls is the whole reason these numbers are
    // large; a scenario claiming multiple calls must cost more than a lone one.
    const single = costs.find((cost) => cost.id === 'single_turn')
    const multi = costs.filter((cost) => cost.medianCalls > 1)
    assert.ok(single)
    for (const cost of multi) {
      assert.ok(cost.credits > single.credits)
    }
  })
})

describe('ratesForModel', () => {
  it('falls back to the default model when the name is unknown', () => {
    assert.deepEqual(ratesForModel(PRICING, 'not-a-model'), RATES)
  })

  it('falls back to any listed model when the default is missing', () => {
    const other: ModelCreditRates = {
      uncached_input_micro: 1,
      cached_input_micro: 1,
      cache_write_micro: 1,
      output_micro: 1,
    }
    assert.deepEqual(ratesForModel({ ...PRICING, models: { other } }), other)
  })

  it('returns null rather than guessing when the rate card is empty', () => {
    assert.equal(ratesForModel({ ...PRICING, models: {} }), null)
    assert.deepEqual(scenarioCosts({ ...PRICING, models: {} }), [])
  })
})

describe('tasksPerBalance', () => {
  it('only counts tasks a balance can actually finish', () => {
    assert.equal(tasksPerBalance(12_375, 1000), 12)
    assert.equal(tasksPerBalance(999, 1000), 0)
  })

  it('refuses to divide by a free task', () => {
    assert.equal(tasksPerBalance(10_000, 0), 0)
  })

  it('reports what the signup grant is worth', () => {
    const costs = scenarioCosts(PRICING)
    const singleTurn = costs.find((cost) => cost.id === 'single_turn')!
    assert.equal(tasksPerBalance(2000, singleTurn.credits), 10)
  })
})

describe('formatYuan', () => {
  it('drops decimals a whole price does not need', () => {
    assert.equal(formatYuan(9900), '99')
    assert.equal(formatYuan(99900), '999')
  })
})

describe('formatUnitPrice', () => {
  it('matches the desktop panel to four decimal places', () => {
    assert.equal(formatUnitPrice(9900, 12_375), '¥0.0080/Credit')
    assert.equal(formatUnitPrice(49900, 63_750), '¥0.0078/Credit')
    assert.equal(formatUnitPrice(99900, 132_000), '¥0.0076/Credit')
  })

  it('refuses a zero-credit pack', () => {
    assert.equal(formatUnitPrice(9900, 0), '—')
  })
})

describe('USAGE_SCENARIOS', () => {
  it('has no duplicate ids', () => {
    const ids = USAGE_SCENARIOS.map((scenario) => scenario.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('describes every scenario for the reader', () => {
    for (const scenario of USAGE_SCENARIOS) {
      assert.ok(scenario.label.length > 0)
      assert.ok(scenario.detail.length > 0)
      assert.ok(scenario.medianCalls >= 1)
      assert.ok(scenario.listCredits > 0)
    }
  })
})
