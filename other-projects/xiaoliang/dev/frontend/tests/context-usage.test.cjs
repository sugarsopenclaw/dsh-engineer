const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8')
}

function loadBundledModule(relativePath) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function loadBundledModuleWithUserData(relativePath, userDataDir) {
  const filename = path.join(projectRoot, relativePath)
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

const tracker = loadBundledModule('electron/runtime/agent/context/context-tracker.ts')
const compaction = loadBundledModule(
  'node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js',
)
const buckets = loadBundledModule('src/hooks/conversation-runtime-buckets.ts')

function assistantMessage(text, usage, timestamp = 1) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'xiaoliang-managed',
    model: 'qwen3.8-max',
    stopReason: 'stop',
    usage: {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: (usage.input ?? 0) + (usage.output ?? 0)
        + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp,
  }
}

function toolResultMessage(text, timestamp = 2) {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp,
  }
}

test('context occupancy follows the pi compaction formula: input + output + cache', () => {
  const usage = tracker.buildContextUsageInfo(
    { input: 4_200, output: 800, cacheRead: 180_000, cacheWrite: 1_800 },
    1_000_000,
    'qwen3.8-max',
  )

  assert.equal(usage.inputTokens, 4_200)
  assert.equal(usage.outputTokens, 800)
  assert.equal(usage.cacheTokens, 181_800)
  // 与 pi-agent-core calculateContextTokens（usage.totalTokens）同口径，含 output。
  assert.equal(usage.usedTokens, 186_800)
  assert.equal(usage.totalTokens, 1_000_000)
  assert.equal(usage.trailingTokens, 0)
})

test('ring denominator uses the configured compaction warning line, not the full window', () => {
  const usage = tracker.buildContextUsageInfo(
    { input: 4_200, output: 800, cacheRead: 180_000, cacheWrite: 1_800 },
    1_000_000,
    'qwen3.8-max',
  )

  const expectedCompactAt = 1_000_000 - 16_384
  assert.equal(usage.compactAtTokens, expectedCompactAt)
  assert.equal(usage.percent, Math.round((186_800 / expectedCompactAt) * 100))

  // 警戒线数值与 shouldCompact 一致；预计 trailing 是否已进入真实触发由 Pi 决定。
  const settings = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 }
  assert.equal(compaction.shouldCompact(expectedCompactAt, 1_000_000, settings), false)
  assert.equal(compaction.shouldCompact(expectedCompactAt + 1, 1_000_000, settings), true)

  const full = tracker.buildContextUsageInfo(
    { input: expectedCompactAt, output: 0, cacheRead: 0, cacheWrite: 0 },
    1_000_000,
    'qwen3.8-max',
  )
  assert.equal(full.percent, 100)
})

test('message-based usage counts trailing tool results and subagent reports', () => {
  const longToolOutput = 'x'.repeat(40_000)
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '开始' }], timestamp: 0 },
    assistantMessage('好的', { input: 4_200, output: 800, cacheRead: 180_000, cacheWrite: 1_800 }, 1),
    toolResultMessage(longToolOutput, 2),
    toolResultMessage(longToolOutput, 3),
  ]

  const usage = tracker.buildContextUsageFromMessages(messages, 1_000_000, 'qwen3.8-max')

  assert.ok(usage)
  assert.equal(usage.inputTokens, 4_200)
  assert.equal(usage.outputTokens, 800)
  assert.equal(usage.cacheTokens, 181_800)
  // 尾部两条 toolResult 的启发式估算必须计入，否则子代理执行期间圆环原地不动。
  assert.ok(usage.trailingTokens > 0)
  assert.equal(usage.usedTokens, 186_800 + usage.trailingTokens)
  assert.equal(usage.compactAtTokens, 1_000_000 - 16_384)
})

test('message-based usage matches estimateContextTokens exactly', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '你好' }], timestamp: 0 },
    assistantMessage('你好！', { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, 1),
    { role: 'user', content: [{ type: 'text', text: '继续' }], timestamp: 2 },
  ]

  const estimate = compaction.estimateContextTokens(messages)
  const usage = tracker.buildContextUsageFromMessages(messages, 262_144, 'kimi-k2.7-code')

  assert.ok(usage)
  assert.equal(usage.usedTokens, estimate.tokens)
  assert.equal(usage.trailingTokens, estimate.trailingTokens)
})

test('post-compaction estimates ignore stale usage retained from before the boundary', () => {
  const messages = [
    {
      role: 'compactionSummary',
      summary: '压缩后的摘要',
      tokensBefore: 930_000,
      timestamp: 200,
    },
    assistantMessage('保留的旧回复', { input: 900_000, output: 10_000 }, 100),
    {
      role: 'custom',
      customType: 'xiaoliang.subagent_completion',
      content: 'x'.repeat(20_000),
      display: false,
      timestamp: 201,
    },
  ]
  const expected = messages.reduce((sum, message) => sum + compaction.estimateTokens(message), 0)
  const usage = tracker.buildContextUsageFromMessages(messages, 1_000_000, 'qwen3.8-max')

  assert.ok(usage)
  assert.equal(usage.usedTokens, expected)
  assert.equal(usage.trailingTokens, expected)
  assert.equal(usage.inputTokens, 0)
  assert.equal(usage.outputTokens, 0)
  assert.equal(usage.cacheTokens, 0)
  assert.ok(usage.usedTokens < 100_000, 'stale 910k usage must not refill the ring')

  const withFreshUsage = [
    ...messages,
    assistantMessage('压缩后的新回复', { input: 35_000, output: 2_000 }, 300),
    toolResultMessage('y'.repeat(8_000), 301),
  ]
  const freshEstimate = compaction.estimateContextTokens(withFreshUsage)
  const fresh = tracker.buildContextUsageFromMessages(
    withFreshUsage,
    1_000_000,
    'qwen3.8-max',
  )
  assert.ok(fresh)
  assert.equal(fresh.usedTokens, freshEstimate.tokens)
  assert.equal(fresh.trailingTokens, freshEstimate.trailingTokens)
  assert.equal(fresh.inputTokens, 35_000)
  assert.equal(fresh.outputTokens, 2_000)
})

test('aborted, errored, and zero-usage assistants do not replace the latest valid usage', () => {
  const valid = assistantMessage('有效回复', { input: 12_000, output: 800 }, 1)
  const aborted = {
    ...assistantMessage('取消回复', { input: 900_000, output: 10_000 }, 2),
    stopReason: 'aborted',
  }
  const errored = {
    ...assistantMessage('失败回复', { input: 800_000, output: 10_000 }, 3),
    stopReason: 'error',
  }
  const zero = assistantMessage('零 usage 回复', {}, 4)
  const messages = [valid, aborted, errored, zero]
  const usage = tracker.buildContextUsageFromMessages(messages, 1_000_000, 'qwen3.8-max')

  assert.equal(tracker.extractLatestUsage(messages), valid.usage)
  assert.ok(usage)
  assert.equal(usage.inputTokens, 12_000)
  assert.equal(usage.outputTokens, 800)
  assert.equal(usage.usedTokens, compaction.estimateContextTokens(messages).tokens)
})

test('message-based usage without any assistant usage still estimates from content', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_000) }], timestamp: 0 },
  ]

  const usage = tracker.buildContextUsageFromMessages(messages, 262_144, 'kimi-k2.7-code')

  assert.ok(usage)
  assert.ok(usage.usedTokens > 0)
  assert.equal(usage.inputTokens, 0)
  assert.equal(usage.trailingTokens, usage.usedTokens)
  assert.equal(tracker.buildContextUsageFromMessages([], 262_144, 'kimi-k2.7-code'), null)
})

test('context occupancy without cache still uses the uncached prompt size', () => {
  const usage = tracker.updateContextUsageFromUsage(
    'conversation-no-cache',
    { input: 12_500, output: 900, cacheRead: 0, cacheWrite: 0 },
    262_144,
    'kimi-k2.7-code',
  )

  assert.equal(usage.usedTokens, 13_400)
  assert.equal(usage.cacheTokens, 0)
  assert.equal(usage.compactAtTokens, 262_144 - 16_384)
  assert.equal(usage.percent, Math.round((13_400 / (262_144 - 16_384)) * 100))
  tracker.clearContextUsage('conversation-no-cache')
})

test('estimated compaction usage is treated as the remaining prompt occupancy', () => {
  const usage = tracker.updateContextUsageEstimate(
    'conversation-compacted',
    48_000,
    1_000_000,
    'qwen3.8-max',
  )

  assert.equal(usage.usedTokens, 48_000)
  assert.equal(usage.inputTokens, 0)
  assert.equal(usage.outputTokens, 0)
  assert.equal(usage.cacheTokens, 0)
  assert.equal(usage.trailingTokens, 48_000)
  assert.equal(usage.compactAtTokens, 1_000_000 - 16_384)
  assert.equal(usage.percent, Math.round((48_000 / (1_000_000 - 16_384)) * 100))
  tracker.clearContextUsage('conversation-compacted')
})

test('persisted conversation snapshots do not clobber live context usage', () => {
  const live = {
    inputTokens: 3_000,
    outputTokens: 400,
    cacheTokens: 90_000,
    usedTokens: 93_000,
    totalTokens: 1_000_000,
    percent: 9,
    modelId: 'qwen3.8-max',
  }
  const stale = {
    ...live,
    usedTokens: 3_000,
    cacheTokens: 0,
    percent: 0,
  }

  assert.equal(buckets.resolveContextUsage(live, stale), live)
  assert.equal(buckets.resolveContextUsage(null, stale), stale)
  assert.equal(buckets.resolveContextUsage(undefined, null), null)
})

test('context usage fingerprints include composition, not only the token total', () => {
  const base = tracker.buildContextUsageInfo(
    { input: 10_000, output: 1_000, cacheRead: 2_000, cacheWrite: 0 },
    262_144,
    'qwen3.8-max',
  )
  const recomposed = {
    ...base,
    inputTokens: 9_000,
    trailingTokens: 1_000,
  }

  assert.notEqual(
    tracker.contextUsageFingerprint(base),
    tracker.contextUsageFingerprint(recomposed),
  )
})

test('context usage persists cache/trailing/compactAt directly and reads them back', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-context-usage-'))
  const repository = loadBundledModuleWithUserData(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const project = repository.createProject('上下文落库')
  const conversation = repository.createConversationInProject(project.id, '用量会话')

  const usage = tracker.buildContextUsageInfo(
    { input: 4_200, output: 800, cacheRead: 180_000, cacheWrite: 1_800 },
    1_000_000,
    'qwen3.8-max',
  )
  usage.trailingTokens = 3_300
  repository.updateConversationContextUsage(conversation.id, usage)

  const restored = repository.getConversationSummary(conversation.id)?.contextUsage
  assert.ok(restored)
  assert.equal(restored.inputTokens, 4_200)
  assert.equal(restored.outputTokens, 800)
  // 直接读列，不再用 used - input 反推（used 含 output/trailing 时反推会虚高）。
  assert.equal(restored.cacheTokens, 181_800)
  assert.equal(restored.usedTokens, 186_800)
  assert.equal(restored.trailingTokens, 3_300)
  assert.equal(restored.compactAtTokens, 1_000_000 - 16_384)
  assert.equal(restored.percent, usage.percent)
})

test('legacy persisted rows still derive cache from used - input', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-context-legacy-'))
  const repository = loadBundledModuleWithUserData(
    'electron/runtime/conversations/conversation-repository.ts',
    userDataDir,
  )
  const project = repository.createProject('旧快照')
  const conversation = repository.createConversationInProject(project.id, '旧格式')

  // 旧格式行：used = input + cache，没有 compactAt 列值。
  repository.updateConversationContextUsage(conversation.id, {
    inputTokens: 5_000,
    outputTokens: 700,
    usedTokens: 65_000,
    totalTokens: 1_000_000,
    percent: 7,
    modelId: 'qwen3.8-max',
  })

  const restored = repository.getConversationSummary(conversation.id)?.contextUsage
  assert.ok(restored)
  assert.equal(restored.cacheTokens, 60_000)
  assert.equal(restored.compactAtTokens, undefined)
  assert.equal(restored.trailingTokens, undefined)
})

test('composer ring and conversation list keep live usage instead of last persisted snapshot', () => {
  const hook = read('src/hooks/use-local-agent-chat.ts')
  const ring = read('src/components/chat/context-usage-ring.tsx')
  const trackerSource = read('electron/runtime/agent/context/context-tracker.ts')

  assert.match(hook, /resolveContextUsage\(current, matched\?\.contextUsage\)/)
  assert.match(hook, /resolveContextUsage\(current, list\.find/)
  assert.doesNotMatch(
    hook,
    /setContextUsage\(matched\?\.contextUsage \?\? null\)/,
  )
  assert.match(trackerSource, /estimateContextTokens/)
  assert.match(trackerSource, /cacheRead/)
  assert.match(trackerSource, /cacheWrite/)
  assert.match(ring, /缓存/)
  assert.match(ring, /自动触发以模型 usage 为准/)
  assert.doesNotMatch(ring, /将自动压缩/)
  assert.match(ring, /Math\.round\(percent\)/)
})

test('conversation usage push wins over an older in-flight snapshot', () => {
  const hook = read('src/features/billing/use-run-usage.ts')
  const subscribeAt = hook.indexOf('onBillingRunUsageChanged')
  const snapshotAt = hook.indexOf('getConversationUsage')

  assert.ok(subscribeAt >= 0 && subscribeAt < snapshotAt)
  assert.match(hook, /receivedPush = true/)
  assert.match(hook, /!cancelled && !receivedPush && next/)
})
