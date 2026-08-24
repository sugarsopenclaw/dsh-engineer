const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const Database = require('better-sqlite3')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath, userDataDir) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'better-sqlite3'],
    banner: {
      js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    define: {
      'import.meta.url': '__bundledImportMetaUrl',
    },
    write: false,
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => userDataDir,
          isReady: () => false,
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = new Module(filename, module)
    mod.filename = filename
    mod.paths = Module._nodeModulePaths(path.dirname(filename))
    mod._compile(output.outputFiles[0].text, filename)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

const { RunUsageMonitor } = loadBundledModule(
  'electron/runtime/billing/run-usage-monitor.ts',
  fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-run-usage-monitor-')),
)

function createFakeClock(start = 0) {
  let now = start
  const timers = []
  return {
    now: () => now,
    advance(ms) {
      now += ms
      const due = timers.filter((timer) => timer.at <= now)
      for (const timer of due) {
        if (timer.cancelled) continue
        timer.cancelled = true
        timer.fn()
      }
      for (const timer of due) {
        const index = timers.indexOf(timer)
        if (index >= 0) timers.splice(index, 1)
      }
    },
    setTimeoutFn: (fn, ms) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeoutFn: (timer) => {
      if (timer) timer.cancelled = true
    },
    pendingCount: () => timers.filter((timer) => !timer.cancelled).length,
  }
}

function makeDetail(clientRunId, overrides = {}) {
  const totals = {
    input_tokens: 12_000,
    output_tokens: 3_000,
    cache_read_tokens: 9_600,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 15_000,
    image_count: 0,
    ...(overrides.totals ?? {}),
  }
  return {
    run: {
      id: `srv-${clientRunId}`,
      organization_id: 'org',
      user_id: 'user',
      client_run_id: clientRunId,
      source: 'desktop',
      status: overrides.status ?? 'completed',
      started_at: overrides.startedAt ?? '2026-08-18T00:00:00.000Z',
    },
    call_count: overrides.callCount ?? 1,
    totals,
    credits_charged: overrides.credits ?? 13,
    breakdown: overrides.breakdown ?? [
      {
        call_purpose: 'main',
        child_run_id: null,
        call_count: 1,
        ...totals,
      },
    ],
    calls: [],
    truncated: false,
  }
}

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

test('settled notifications are debounced, single-flight, and trailed', async () => {
  const clock = createFakeClock()
  const published = []
  const reads = []
  let releaseRead = null
  const monitor = new RunUsageMonitor({
    readUsage: (clientRunId) => {
      reads.push(clientRunId)
      return new Promise((resolve) => {
        releaseRead = () => resolve(makeDetail(clientRunId))
      })
    },
    persist: (conversationId, detail) => ({
      conversationId,
      run: {
        clientRunId: detail.run.client_run_id,
        status: detail.run.status,
        creditsCharged: detail.credits_charged,
        callCount: detail.call_count,
        inputTokens: detail.totals.input_tokens,
        outputTokens: detail.totals.output_tokens,
        cacheReadTokens: detail.totals.cache_read_tokens,
        cacheWriteTokens: detail.totals.cache_write_tokens,
        reasoningTokens: detail.totals.reasoning_tokens,
        totalTokens: detail.totals.total_tokens,
        breakdown: [],
        updatedAt: 'now',
      },
      session: {
        runCount: 1,
        creditsCharged: detail.credits_charged,
        callCount: detail.call_count,
        inputTokens: detail.totals.input_tokens,
        outputTokens: detail.totals.output_tokens,
        cacheReadTokens: detail.totals.cache_read_tokens,
        cacheWriteTokens: detail.totals.cache_write_tokens,
        reasoningTokens: detail.totals.reasoning_tokens,
        totalTokens: detail.totals.total_tokens,
        breakdown: [],
      },
    }),
    publish: (payload) => published.push(payload),
    minIntervalMs: 2_000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  // 第一次立即发起；进行中到达的通知合并为一次尾部补刷。
  monitor.notifySettled('conv-1', 'run-1')
  monitor.notifySettled('conv-1', 'run-1')
  monitor.notifySettled('conv-1', 'run-1')
  assert.equal(reads.length, 1)

  releaseRead()
  await flushMicrotasks()
  assert.equal(published.length, 1)
  // 尾部补刷受最小间隔限制，定时器挂起。
  assert.equal(reads.length, 1)
  assert.equal(clock.pendingCount(), 1)

  clock.advance(2_000)
  await flushMicrotasks()
  assert.equal(reads.length, 2)
  releaseRead()
  await flushMicrotasks()
  // 值没变（同样的 detail）不重复发布。
  assert.equal(published.length, 1)
  monitor.dispose()
})

test('flushFinal bypasses the minimum interval and stops further scheduling', async () => {
  const clock = createFakeClock()
  const reads = []
  const monitor = new RunUsageMonitor({
    readUsage: async (clientRunId) => {
      reads.push(clientRunId)
      return makeDetail(clientRunId, { credits: reads.length * 5 })
    },
    persist: (conversationId, detail) => ({
      conversationId,
      run: null,
      session: {
        runCount: 1,
        creditsCharged: detail.credits_charged,
        callCount: detail.call_count,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        breakdown: [],
      },
    }),
    publish: () => {},
    minIntervalMs: 2_000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  monitor.notifySettled('conv-1', 'run-2')
  await flushMicrotasks()
  assert.equal(reads.length, 1)

  // 最小间隔内的 final 拉取立即执行，不等定时器。
  monitor.flushFinal('conv-1', 'run-2')
  await flushMicrotasks()
  assert.equal(reads.length, 2)
  assert.equal(clock.pendingCount(), 0)
  monitor.dispose()
})

test('failed reads keep previously published numbers and do not throw', async () => {
  const clock = createFakeClock()
  const published = []
  let fail = false
  const monitor = new RunUsageMonitor({
    readUsage: async (clientRunId) => {
      if (fail) throw new Error('network down')
      return makeDetail(clientRunId)
    },
    persist: (conversationId, detail) => ({
      conversationId,
      run: null,
      session: {
        runCount: 1,
        creditsCharged: detail.credits_charged,
        callCount: detail.call_count,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        breakdown: [],
      },
    }),
    publish: (payload) => published.push(payload),
    minIntervalMs: 0,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  monitor.notifySettled('conv-1', 'run-3')
  await flushMicrotasks()
  assert.equal(published.length, 1)

  fail = true
  monitor.notifySettled('conv-1', 'run-3')
  await flushMicrotasks(10)
  // 失败不清空、不补发空值。
  assert.equal(published.length, 1)
  monitor.dispose()
})

test('session-total changes publish even when the latest run fields are unchanged', async () => {
  const published = []
  let sessionCredits = 10
  const monitor = new RunUsageMonitor({
    readUsage: async (clientRunId) => makeDetail(clientRunId),
    persist: (conversationId, detail) => ({
      conversationId,
      run: {
        clientRunId: 'newer-run',
        status: 'completed',
        creditsCharged: 5,
        callCount: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 120,
        breakdown: [],
        updatedAt: new Date().toISOString(),
      },
      session: {
        runCount: 2,
        creditsCharged: sessionCredits,
        callCount: 2,
        inputTokens: detail.totals.input_tokens,
        outputTokens: detail.totals.output_tokens,
        cacheReadTokens: detail.totals.cache_read_tokens,
        cacheWriteTokens: detail.totals.cache_write_tokens,
        reasoningTokens: detail.totals.reasoning_tokens,
        totalTokens: detail.totals.total_tokens,
        breakdown: [],
      },
    }),
    publish: (payload) => published.push(payload.session.creditsCharged),
    minIntervalMs: 0,
  })

  monitor.notifySettled('conv-1', 'older-run')
  await flushMicrotasks()
  sessionCredits = 14
  monitor.notifySettled('conv-1', 'older-run')
  await flushMicrotasks()

  assert.deepEqual(published, [10, 14])
  monitor.dispose()
})

test('run usage store upserts by client_run_id and sums per conversation', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-run-usage-store-'))
  const store = loadBundledModule('electron/runtime/billing/run-usage-store.ts', userDataDir)
  const repository = loadBundledModule(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const project = repository.createProject('用量累计')
  const conversation = repository.createConversationInProject(project.id, '累计会话')

  const detail = makeDetail('run-a', {
    credits: 13,
    callCount: 2,
    startedAt: '2026-08-18T00:00:00.000Z',
    totals: {
      input_tokens: 12_000,
      output_tokens: 3_000,
      cache_read_tokens: 9_600,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 15_000,
    },
  })

  const first = store.upsertConversationUsageRun(conversation.id, detail)
  assert.ok(first)
  assert.equal(first.run.clientRunId, 'run-a')
  assert.equal(first.run.creditsCharged, 13)
  assert.equal(first.run.inputTokens, 12_000)
  assert.equal(first.run.cacheReadTokens, 9_600)
  assert.equal(first.session.runCount, 1)
  assert.equal(first.session.creditsCharged, 13)

  // 幂等：同一 run 重复快照（值变大）覆盖而不是累加。
  const second = store.upsertConversationUsageRun(conversation.id, makeDetail('run-a', {
    credits: 21,
    callCount: 3,
  }))
  assert.equal(second.session.runCount, 1)
  assert.equal(second.session.creditsCharged, 21)

  // 第二个 run 进入后按会话求和。
  const third = store.upsertConversationUsageRun(conversation.id, makeDetail('run-b', {
    credits: 7,
    callCount: 1,
    startedAt: '2026-08-18T00:01:00.000Z',
    totals: {
      input_tokens: 4_000,
      output_tokens: 1_000,
      cache_read_tokens: 2_000,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 5_000,
    },
  }))
  assert.equal(third.session.runCount, 2)
  assert.equal(third.session.creditsCharged, 28)
  assert.equal(third.session.inputTokens, 16_000)
  assert.equal(third.session.outputTokens, 4_000)
  assert.equal(third.session.cacheReadTokens, 11_600)
  assert.equal(third.run.clientRunId, 'run-b')

  // 旧 run 的后台子代理迟到刷新，不得把“本轮”切回旧 run。
  const lateOldRun = store.upsertConversationUsageRun(conversation.id, makeDetail('run-a', {
    credits: 25,
    callCount: 4,
    startedAt: '2026-08-18T00:00:00.000Z',
  }))
  assert.equal(lateOldRun.run.clientRunId, 'run-b')
  assert.equal(lateOldRun.session.runCount, 2)
  assert.equal(lateOldRun.session.creditsCharged, 32)
  assert.equal(lateOldRun.session.callCount, 5)

  // 重新读取（模拟重启后）仍在。
  const restored = store.readConversationUsage(conversation.id)
  assert.equal(restored.run.clientRunId, 'run-b')
  assert.equal(restored.session.creditsCharged, 32)
  repository.deleteConversation(conversation.id)
  assert.equal(store.readConversationUsage(conversation.id), null)
  assert.equal(
    store.upsertConversationUsageRun(conversation.id, makeDetail('late-after-delete')),
    null,
  )
  assert.equal(store.readConversationUsage('missing-conversation'), null)
})

test('usage schema migration backfills started_at for pre-feature rows', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-run-usage-migration-'))
  const { runMigrations } = loadBundledModule(
    'electron/runtime/db/schema.ts',
    userDataDir,
  )
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE conversation_usage_runs (
      client_run_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      credits INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      breakdown_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    INSERT INTO conversation_usage_runs (
      client_run_id, conversation_id, updated_at
    ) VALUES ('legacy-run', 'legacy-conversation', '2026-08-17 08:09:10');
  `)

  runMigrations(db)
  const columns = db.prepare('PRAGMA table_info(conversation_usage_runs)').all()
  const row = db.prepare(
    'SELECT started_at, updated_at FROM conversation_usage_runs WHERE client_run_id = ?',
  ).get('legacy-run')

  assert.ok(columns.some((column) => column.name === 'started_at'))
  assert.equal(row.started_at, row.updated_at)
  assert.equal(db.prepare('SELECT version FROM schema_version').get().version, 39)
  db.close()
})
