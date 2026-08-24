const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: path.resolve(__dirname, '..', 'tsconfig.app.json'),
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const billing = loadBundledModule('src/shared/billing-domain.ts')
const checkout = loadBundledModule('src/features/billing/wechat-checkout-state.ts')

test('balance falls back to the pre-credits field so old sessions still show a number', () => {
  assert.equal(billing.creditsRemaining({ credits_remaining: 1234 }), 1234)
  assert.equal(billing.creditsRemaining({ quota_remaining: 7 }), 7)
  assert.equal(billing.creditsRemaining({ credits_remaining: 0, quota_remaining: 99 }), 0)
  assert.equal(billing.creditsRemaining(null), 0)
})

test('an overdrawn balance never renders as a negative number', () => {
  assert.equal(billing.creditsRemaining({ credits_remaining: -50 }), 0)
  assert.equal(billing.formatCredits(-50), '0')
})

test('credit counts are grouped so five and six digit balances stay readable', () => {
  assert.equal(billing.formatCredits(2000), '2,000')
  assert.equal(billing.formatCredits(132000), '132,000')
  assert.equal(billing.formatCredits(8.4), '8')
})

test('low balance warning uses the server threshold when one is supplied', () => {
  assert.equal(billing.isLowBalance({ credits_remaining: 400, low_balance_threshold: 1000 }), true)
  assert.equal(billing.isLowBalance({ credits_remaining: 1000, low_balance_threshold: 1000 }), false)
  // No threshold from the server: fall back to the built-in default.
  assert.equal(billing.isLowBalance({ credits_remaining: 10 }), true)
  assert.equal(billing.isLowBalance({ credits_remaining: 50000 }), false)
  // An unknown balance is not a warning.
  assert.equal(billing.isLowBalance(null), false)
})

test('Pi thinking levels map back to the desktop 极速/专家 toggle', () => {
  assert.equal(billing.thinkingModeLabel('fast'), '极速')
  assert.equal(billing.thinkingModeLabel('deep'), '专家')
  assert.equal(billing.piThinkingLevelForMode('fast'), 'low')
  assert.equal(billing.piThinkingLevelForMode('deep'), 'xhigh')
  assert.equal(billing.thinkingModeFromPiLevel('low'), 'fast')
  assert.equal(billing.thinkingModeFromPiLevel('medium'), 'fast')
  assert.equal(billing.thinkingModeFromPiLevel('high'), 'deep')
  assert.equal(billing.thinkingModeFromPiLevel('xhigh'), 'deep')
  assert.equal(billing.thinkingModeFromPiLevel('max'), 'deep')
  assert.equal(billing.thinkingModeFromPiLevel(undefined), 'fast')
})

test('quota label reads as a credit balance rather than a call count', () => {
  const label = billing.formatQuotaLabel({ plan_tier: 'standard', credits_remaining: 63750 })
  assert.match(label, /Credits/)
  assert.doesNotMatch(label, /次/)
  assert.match(label, /63,750/)
})

test('unknown plan tiers degrade to the free label instead of leaking an id', () => {
  assert.equal(billing.planTierLabel('professional'), billing.planTierLabel('professional'))
  assert.equal(billing.planTierLabel('some-new-tier'), billing.planTierLabel('free'))
  assert.equal(billing.planTierLabel(null), billing.planTierLabel('free'))
})

test('prices drop the decimals only when the amount is whole yuan', () => {
  assert.equal(billing.formatAmountYuan(9900), '¥99')
  assert.equal(billing.formatAmountYuan(49900), '¥499')
  assert.equal(billing.formatAmountYuan(1990), '¥19.90')
})

test('per-credit price keeps enough precision to distinguish the three packs', () => {
  const starter = billing.formatUnitPrice(9900, 12375)
  const standard = billing.formatUnitPrice(49900, 63750)
  const professional = billing.formatUnitPrice(99900, 132000)
  assert.equal(starter, '¥0.0080/Credit')
  assert.equal(standard, '¥0.0078/Credit')
  assert.equal(professional, '¥0.0076/Credit')
  assert.equal(new Set([starter, standard, professional]).size, 3)
  assert.equal(billing.formatUnitPrice(9900, 0), '—')
})

test('validity is phrased in years for the 12 month packs', () => {
  assert.equal(billing.formatValidityDays(365), '1 年有效')
  assert.equal(billing.formatValidityDays(30), '1 个月有效')
  assert.equal(billing.formatValidityDays(45), '45 天有效')
})

test('composer usage line appends remaining credits and warns when the balance is low', () => {
  const { ComposerUsageStats } = loadBundledModule('src/components/chat/composer-usage-stats.tsx')

  const usage = {
    conversationId: 'conv-1',
    run: {
      runId: 'run-1',
      inputTokens: 17400,
      outputTokens: 540,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      creditsCharged: 32,
      breakdown: [],
    },
    session: {
      runCount: 1,
      inputTokens: 17400,
      outputTokens: 540,
      cacheReadTokens: 0,
      creditsCharged: 32,
      breakdown: [],
    },
  }

  const withRun = renderToStaticMarkup(
    React.createElement(ComposerUsageStats, {
      usage,
      remainingCredits: 63750,
    }),
  )
  assert.match(withRun, /输入 17\.4K/)
  assert.match(withRun, /Credits 消耗 32/)
  assert.match(withRun, /Credits 剩余 63,750/)
  assert.match(withRun, /会话累计 1 轮/)
  assert.doesNotMatch(withRun, /amber/)

  const remainingOnly = renderToStaticMarkup(
    React.createElement(ComposerUsageStats, {
      usage: null,
      remainingCredits: 120,
      remainingLow: true,
    }),
  )
  assert.match(remainingOnly, /Credits 剩余 120/)
  assert.match(remainingOnly, /amber/)
  assert.doesNotMatch(remainingOnly, /本轮/)

  assert.equal(
    renderToStaticMarkup(React.createElement(ComposerUsageStats, { usage: null })),
    '',
  )
})

test('subscription panel sells three credit packs and shows why the big ones are better value', () => {
  const { SubscriptionPanel } = loadBundledModule('src/features/billing/SubscriptionPanel.tsx')
  const markup = renderToStaticMarkup(React.createElement(SubscriptionPanel, {}))

  for (const price of ['¥99', '¥499', '¥999']) {
    assert.ok(markup.includes(price), `missing pack price ${price}`)
  }
  for (const credits of ['12,375', '63,750', '132,000']) {
    assert.ok(markup.includes(credits), `missing pack size ${credits}`)
  }

  // Per-credit price is what makes "buy more, pay less" legible.
  assert.match(markup, /¥0\.0080\/Credit/)
  assert.match(markup, /¥0\.0078\/Credit/)
  assert.match(markup, /¥0\.0076\/Credit/)

  // Only the upsell packs carry a savings badge.
  assert.equal(markup.match(/省 \d+%/g).length, 2)

  assert.match(markup, /1 年有效/)

  // The retired per-run packages must be gone.
  assert.doesNotMatch(markup, /¥19\.90/)
  assert.doesNotMatch(markup, /Plus|Pro\b/)
  assert.doesNotMatch(markup, /\d+ 次/)

  // Narrow settings columns use container width, not the viewport sm breakpoint.
  assert.match(markup, /settings-plan-grid/)
  assert.doesNotMatch(markup, /sm:grid-cols-3/)
  assert.match(markup, /whitespace-normal/)

  // The QR lives in a modal that stays closed until the user clicks buy.
  assert.doesNotMatch(markup, /role="dialog"/)
  assert.doesNotMatch(markup, /微信支付二维码/)
})

test('an unfinished WeChat order remains resumable until it expires or becomes terminal', () => {
  const order = {
    order_id: 'order-a',
    product_id: 'credits_standard',
    plan_tier: 'standard',
    status: 'pending',
    out_trade_no: 'XL-A',
    amount_fen: 49900,
    code_url: 'weixin://wxpay/a',
    expires_at: '2026-08-17T12:15:00.000Z',
    paid_at: null,
    poll_after_seconds: 2,
  }

  assert.equal(
    checkout.isWeChatOrderPayable(order, 'pending', Date.parse('2026-08-17T12:14:59Z')),
    true,
  )
  assert.equal(
    checkout.isWeChatOrderPayable(order, 'pending', Date.parse('2026-08-17T12:15:00Z')),
    false,
  )
  for (const status of ['paid', 'closed', 'failed', 'expired']) {
    assert.equal(checkout.isTerminalWeChatOrderStatus(status), true)
    assert.equal(checkout.isWeChatOrderPayable(order, status, Date.parse('2026-08-17T12:00:00Z')), false)
  }
})

test('checkout request guard prevents overlapping creates and invalidates an old order response', () => {
  const guard = new checkout.WeChatCheckoutRequestGuard()
  const firstCreate = guard.beginCreate()
  assert.equal(typeof firstCreate, 'number')
  assert.equal(guard.beginCreate(), null)
  assert.equal(guard.acceptCreated(firstCreate, 'order-a'), true)
  const oldSync = guard.tokenFor('order-a')
  assert.ok(oldSync)
  assert.equal(guard.finishCreate(firstCreate), true)

  // An active order must be explicitly replaced only after the caller has
  // established that it is terminal or expired.
  assert.equal(guard.beginCreate(), null)
  const secondCreate = guard.beginCreate(true)
  assert.ok(secondCreate > firstCreate)
  assert.equal(guard.isCurrent(oldSync, 'order-a'), false)
  assert.equal(guard.acceptCreated(firstCreate, 'order-a-late'), false)
  assert.equal(guard.acceptCreated(secondCreate, 'order-b'), true)
  assert.equal(guard.finishCreate(secondCreate), true)

  const currentSync = guard.tokenFor('order-b')
  assert.ok(currentSync)
  assert.equal(guard.isCurrent(currentSync, 'order-a'), false)
  assert.equal(guard.isCurrent(currentSync, 'order-b'), true)
})

test('late sync results cannot mark another order paid or downgrade a paid order', () => {
  const quota = { plan_tier: 'standard', credits_remaining: 63750 }
  const pendingA = {
    order_id: 'order-a',
    product_id: 'credits_standard',
    plan_tier: 'standard',
    status: 'pending',
    out_trade_no: 'XL-A',
    amount_fen: 49900,
    expires_at: '2026-08-17T12:15:00Z',
    paid_at: null,
    quota,
  }
  const paidA = { ...pendingA, status: 'paid', paid_at: '2026-08-17T12:01:00Z' }
  const paidB = { ...paidA, order_id: 'order-b', out_trade_no: 'XL-B' }

  assert.equal(checkout.mergeWeChatOrderStatus(null, paidA, 'order-b'), null)
  assert.equal(checkout.mergeWeChatOrderStatus(pendingA, paidB, 'order-a'), pendingA)
  const settled = checkout.mergeWeChatOrderStatus(pendingA, paidA, 'order-a')
  assert.equal(settled.status, 'paid')
  assert.equal(checkout.mergeWeChatOrderStatus(settled, pendingA, 'order-a'), settled)
})

test('credit balance monitor coalesces a burst of charges into spaced reads', async () => {
  const { CreditBalanceMonitor } = loadBundledModule(
    'electron/runtime/billing/credit-balance-monitor.ts',
  )

  let clock = 1_000
  const timers = []
  const setTimeoutFn = (fn, ms) => {
    const timer = { fn, at: clock + Math.max(1, ms) }
    timers.push(timer)
    return timer
  }
  const clearTimeoutFn = (timer) => {
    const index = timers.indexOf(timer)
    if (index >= 0) timers.splice(index, 1)
  }
  const runDueTimers = () => {
    const due = timers.splice(0).filter((timer) => timer.at <= clock)
    for (const timer of due) timer.fn()
  }
  const flushAsync = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  }

  let balance = 1000
  let reads = 0
  const published = []
  const monitor = new CreditBalanceMonitor({
    readQuota: async () => {
      reads += 1
      return { credits_remaining: balance, credits_total: 2000, plan_tier: 'standard' }
    },
    publish: (quota) => published.push(quota.credits_remaining),
    minIntervalMs: 2_000,
    now: () => clock,
    setTimeoutFn,
    clearTimeoutFn,
  })

  // A burst of ten settled calls collapses into a single immediate read.
  for (let i = 0; i < 10; i += 1) monitor.notifySpend()
  assert.equal(reads, 1)
  await flushAsync()
  assert.deepEqual(published, [1000])

  // Charges during the throttle window wait for the timer, then read once.
  balance = 940
  monitor.notifySpend()
  monitor.notifySpend()
  assert.equal(reads, 1)
  clock += 2_000
  runDueTimers()
  await flushAsync()
  assert.equal(reads, 2)
  assert.deepEqual(published, [1000, 940])

  // A charge that lands while a read is in flight triggers exactly one trailing read.
  let slowBalance = 900
  const slowReads = []
  const slowMonitor = new CreditBalanceMonitor({
    readQuota: () => new Promise((resolve) => {
      slowReads.push(() => resolve({
        credits_remaining: slowBalance,
        credits_total: 2000,
        plan_tier: 'standard',
      }))
    }),
    publish: (quota) => published.push(quota.credits_remaining),
    minIntervalMs: 0,
    now: () => clock,
    setTimeoutFn,
    clearTimeoutFn,
  })
  slowMonitor.notifySpend()
  slowMonitor.notifySpend()
  slowMonitor.notifySpend()
  assert.equal(slowReads.length, 1)
  slowBalance = 870
  slowReads.shift()()
  await flushAsync()
  assert.equal(slowReads.length, 1)
  // The trailing read observes the balance at read time, not at notify time: the
  // queued charge and the trailing charge collapse into one fresh number.
  slowReads.shift()()
  await flushAsync()
  assert.deepEqual(published, [1000, 940, 870])

  slowMonitor.dispose()
  monitor.dispose()
})

test('credit balance monitor skips unchanged balances and swallows read failures', async () => {
  const { CreditBalanceMonitor } = loadBundledModule(
    'electron/runtime/billing/credit-balance-monitor.ts',
  )
  const published = []
  const quota = { credits_remaining: 500, credits_total: 2000, plan_tier: 'standard' }
  let fail = false
  const monitor = new CreditBalanceMonitor({
    readQuota: async () => {
      if (fail) throw new Error('offline')
      return quota
    },
    publish: (value) => published.push(value),
    minIntervalMs: 0,
  })

  monitor.notifySpend()
  await new Promise((resolve) => setImmediate(resolve))
  monitor.notifySpend()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(published.length, 1)

  fail = true
  assert.doesNotThrow(() => monitor.notifySpend())
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(published.length, 1)

  monitor.dispose()
  monitor.notifySpend()
})

test('credit balance monitor stops a scheduled read when disposed', async () => {
  const { CreditBalanceMonitor } = loadBundledModule(
    'electron/runtime/billing/credit-balance-monitor.ts',
  )
  let clock = 1_000
  const timers = []
  let reads = 0
  const monitor = new CreditBalanceMonitor({
    readQuota: async () => {
      reads += 1
      return { credits_remaining: 100, credits_total: 2000, plan_tier: 'free' }
    },
    publish() {},
    minIntervalMs: 5_000,
    now: () => clock,
    setTimeoutFn: (fn, ms) => {
      const timer = { fn, at: clock + Math.max(1, ms) }
      timers.push(timer)
      return timer
    },
    clearTimeoutFn: (timer) => {
      const index = timers.indexOf(timer)
      if (index >= 0) timers.splice(index, 1)
    },
  })

  monitor.notifySpend()
  assert.equal(reads, 1)
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  // The next charge lands inside the throttle window and must wait on the timer.
  monitor.notifySpend()
  assert.equal(timers.length, 1)
  assert.equal(reads, 1)
  monitor.dispose()
  assert.equal(timers.length, 0)
  clock += 60_000
  assert.equal(reads, 1)
})

test('wechat pay dialog stays inside a compact window and shows the QR in a modal', () => {
  const { WeChatPayDialog, formatPayStatus } = loadBundledModule(
    'src/features/billing/WeChatPayDialog.tsx',
  )

  assert.equal(formatPayStatus('pending', false), '待支付')
  assert.equal(formatPayStatus('paid', false), '已到账')
  assert.equal(formatPayStatus('closed', false), '已关闭')

  const closed = renderToStaticMarkup(
    React.createElement(WeChatPayDialog, {
      open: false,
      onClose() {},
      productName: '标准版',
      amountFen: 49900,
      outTradeNo: 'XL202608170001',
      status: 'pending',
      paid: false,
      qrDataUrl: 'data:image/png;base64,qr',
      creating: false,
      syncing: false,
      paymentError: '',
      onSync() {},
    }),
  )
  assert.equal(closed, '')

  const open = renderToStaticMarkup(
    React.createElement(WeChatPayDialog, {
      open: true,
      onClose() {},
      productName: '标准版',
      amountFen: 49900,
      outTradeNo: 'XL202608170001VERYLONGTRADE',
      status: 'pending',
      paid: false,
      qrDataUrl: 'data:image/png;base64,qr',
      creating: false,
      syncing: false,
      paymentError: '',
      onSync() {},
    }),
  )
  assert.match(open, /role="dialog"/)
  assert.match(open, /微信扫码支付/)
  assert.match(open, /标准版/)
  assert.match(open, /¥499/)
  assert.match(open, /微信支付二维码/)
  assert.match(open, /XL202608170001VERYLONGTRADE/)
  assert.match(open, /我已支付，刷新状态/)
  assert.match(open, /暂时收起/)
  assert.match(open, /收起后仍会继续确认/)
  assert.match(open, /w-\[min\(calc\(100vw-1\.5rem\),22rem\)\]/)
  assert.match(open, /max-h-\[calc\(100vh-1\.5rem\)\]/)
  assert.match(open, /size-\[min\(12rem,42vmin\)\]/)
  assert.match(open, /break-all/)
  assert.match(open, /flex-col-reverse/)

  const paid = renderToStaticMarkup(
    React.createElement(WeChatPayDialog, {
      open: true,
      onClose() {},
      productName: '标准版',
      amountFen: 49900,
      outTradeNo: 'XL202608170001',
      status: 'paid',
      paid: true,
      qrDataUrl: 'data:image/png;base64,qr',
      creating: false,
      syncing: false,
      paymentError: '',
      onSync() {},
    }),
  )
  assert.match(paid, /支付成功，额度已到账/)
  assert.match(paid, />完成</)
  assert.match(paid, /opacity-45/)
})
