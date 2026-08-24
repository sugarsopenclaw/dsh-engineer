const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')
const moduleCache = new Map()

function loadBundledModule(relativePath) {
  if (moduleCache.has(relativePath)) return moduleCache.get(relativePath)
  const filename = path.join(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    banner: {
      js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    define: {
      'import.meta.url': '__bundledImportMetaUrl',
    },
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  moduleCache.set(relativePath, mod.exports)
  return mod.exports
}

function createUsage(totalTokens = 100) {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function seedCompactableSession(manager, fauxAssistantMessage, count = 2) {
  const model = manager.__testModel
  const now = Date.now() - 10_000
  for (let index = 0; index < count; index += 1) {
    manager.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: `historic request ${index} ${'detail '.repeat(30)}` }],
      timestamp: now + index * 2,
    })
    const assistant = fauxAssistantMessage(`historic response ${index}`, {
      timestamp: now + index * 2 + 1,
    })
    assistant.api = model.api
    assistant.provider = model.provider
    assistant.model = model.id
    assistant.usage = createUsage(100 + index)
    manager.appendMessage(assistant)
  }
}

async function createFileBackedHost({
  testName,
  faux,
  fauxAssistantMessage,
  events,
  transformPayload,
}) {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const { XiaoliangPiAgentHost } = loadBundledModule(
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
  )
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${testName}-`))
  const manager = SessionManager.create(root, path.join(root, 'sessions'))
  manager.__testModel = faux.getModel()
  seedCompactableSession(manager, fauxAssistantMessage)
  const host = await XiaoliangPiAgentHost.create({
    cwd: root,
    agentDir: path.join(root, 'agent'),
    generation: 1,
    model: manager.__testModel,
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    sessionManager: manager,
    systemPrompt: testName,
    transformPayload,
    onEvent: ({ event }) => events.push(event),
  })
  host.session.settingsManager.applyOverrides({
    compaction: { enabled: true, reserveTokens: 0, keepRecentTokens: 60 },
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 1,
      provider: { maxRetries: 0 },
    },
  })
  return { host, manager, root }
}

test('stage 4 serializes retry countdowns and compaction lifecycle for the renderer', () => {
  const { serializeAgentEvent } = loadBundledModule(
    'electron/runtime/agent/events/serialize-agent-event.ts',
  )
  const before = Date.now()
  const retry = serializeAgentEvent('conversation-1', {
    type: 'auto_retry_start',
    attempt: 2,
    maxAttempts: 3,
    delayMs: 4_000,
    errorMessage: 'overloaded_error',
  })
  assert.deepEqual(
    { ...retry, retry: { ...retry.retry, scheduledAt: 0 } },
    {
      type: 'retry_update',
      conversationId: 'conversation-1',
      retry: {
        phase: 'waiting',
        source: 'agent',
        attempt: 2,
        maxAttempts: 3,
        delayMs: 4_000,
        scheduledAt: 0,
      },
    },
  )
  assert.ok(retry.retry.scheduledAt >= before && retry.retry.scheduledAt <= Date.now())

  assert.deepEqual(
    serializeAgentEvent('conversation-1', {
      type: 'summarization_retry_attempt_start',
      source: 'branchSummary',
    }),
    {
      type: 'retry_update',
      conversationId: 'conversation-1',
      retry: { phase: 'running', source: 'branch_summary' },
    },
  )
  assert.deepEqual(
    serializeAgentEvent('conversation-1', {
      type: 'compaction_end',
      reason: 'overflow',
      result: { tokensBefore: 120_000, estimatedTokensAfter: 18_000 },
      aborted: false,
      willRetry: true,
    }),
    {
      type: 'compaction_update',
      conversationId: 'conversation-1',
      compaction: {
        phase: 'completed',
        reason: 'overflow',
        willRetry: true,
        tokensBefore: 120_000,
        estimatedTokensAfter: 18_000,
      },
    },
  )
})

test('main-agent retries use exponential delay events and stop cancels the backoff', async () => {
  const { fauxAssistantMessage, fauxProvider, fauxText } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadBundledModule(
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
  )

  const recoveredFaux = fauxProvider({
    provider: 'xiaoliang-stage4-main-retry',
    tokensPerSecond: 100_000,
  })
  recoveredFaux.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'overloaded_error' }),
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'overloaded_error' }),
    fauxAssistantMessage(fauxText('recovered')),
  ])
  const recoveredEvents = []
  const recoveredHost = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-stage4-main-retry'),
    generation: 1,
    model: recoveredFaux.getModel(),
    provider: recoveredFaux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [],
    systemPrompt: 'retry test',
    onEvent: ({ event }) => recoveredEvents.push(event),
  })
  try {
    recoveredHost.session.settingsManager.applyOverrides({
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 2, provider: { maxRetries: 0 } },
    })
    await recoveredHost.prompt('retry twice')
    assert.deepEqual(
      recoveredEvents
        .filter((event) => event.type === 'auto_retry_start')
        .map((event) => ({ attempt: event.attempt, delayMs: event.delayMs })),
      [{ attempt: 1, delayMs: 2 }, { attempt: 2, delayMs: 4 }],
    )
    assert.deepEqual(
      recoveredEvents
        .filter((event) => event.type === 'agent_end')
        .map((event) => event.willRetry),
      [true, true, false],
    )
    assert.equal(recoveredEvents.at(-1).type, 'agent_settled')
    assert.equal(recoveredFaux.state.callCount, 3)
  } finally {
    await recoveredHost.dispose()
  }

  const cancelledFaux = fauxProvider({
    provider: 'xiaoliang-stage4-cancel-retry',
    tokensPerSecond: 100_000,
  })
  cancelledFaux.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'overloaded_error' }),
  ])
  const cancelledEvents = []
  let resolveRetryStart
  const retryStarted = new Promise((resolve) => {
    resolveRetryStart = resolve
  })
  const cancelledHost = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-stage4-cancel-retry'),
    generation: 1,
    model: cancelledFaux.getModel(),
    provider: cancelledFaux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [],
    systemPrompt: 'cancel retry test',
    onEvent: ({ event }) => {
      cancelledEvents.push(event)
      if (event.type === 'auto_retry_start') resolveRetryStart()
    },
  })
  try {
    cancelledHost.session.settingsManager.applyOverrides({
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 30_000,
        provider: { maxRetries: 0 },
      },
    })
    const prompt = cancelledHost.prompt('cancel during backoff')
    await retryStarted
    const abortStartedAt = Date.now()
    await cancelledHost.abort()
    await prompt
    assert.ok(Date.now() - abortStartedAt < 2_000)
    assert.equal(cancelledFaux.state.callCount, 1)
    assert.ok(cancelledEvents.some((event) => (
      event.type === 'auto_retry_end'
      && event.success === false
      && event.finalError === 'Retry cancelled'
    )))
    assert.equal(cancelledEvents.at(-1).type, 'agent_settled')
  } finally {
    await cancelledHost.dispose()
  }
})

test('manual compaction shares retry policy, records usage, and keeps full JSONL history', async () => {
  const { fauxAssistantMessage, fauxProvider, fauxText } = await import('@earendil-works/pi-ai')
  const actualCompactionPayloads = []
  const faux = fauxProvider({
    provider: 'xiaoliang-stage4-manual-compaction',
    tokensPerSecond: 100_000,
  })
  faux.setResponses([
    async (_context, options, _state, model) => {
      actualCompactionPayloads.push(await options.onPayload({ request: 'summary-1' }, model))
      return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'terminated' })
    },
    async (_context, options, _state, model) => {
      actualCompactionPayloads.push(await options.onPayload({ request: 'summary-2' }, model))
      return fauxAssistantMessage(fauxText('compact checkpoint summary'))
    },
  ])
  const events = []
  const { host, manager } = await createFileBackedHost({
    testName: 'xiaoliang-pi-stage4-manual',
    faux,
    fauxAssistantMessage,
    events,
    transformPayload: (payload) => ({ ...payload, transformedByApp: true }),
  })
  let purposeProbe
  const unsubscribe = host.session.subscribe((event) => {
    if (event.type === 'compaction_start') {
      purposeProbe = Promise.resolve(host.agent.onPayload(
        { probe: true },
        host.agent.state.model,
      ))
    }
  })

  try {
    const originalMessageEntries = manager.getEntries()
      .filter((entry) => entry.type === 'message')
    const result = await host.compact()
    assert.match(result.summary, /compact checkpoint summary/)
    assert.ok(result.usage)
    assert.equal(faux.state.callCount, 2)
    assert.deepEqual(
      events.filter((event) => event.type === 'summarization_retry_scheduled')
        .map((event) => ({ attempt: event.attempt, delayMs: event.delayMs })),
      [{ attempt: 1, delayMs: 1 }],
    )
    assert.deepEqual(await purposeProbe, {
      probe: true,
      transformedByApp: true,
      xiaoliang_call_purpose: 'compaction',
    })
    assert.deepEqual(actualCompactionPayloads, [
      {
        request: 'summary-1',
        transformedByApp: true,
        xiaoliang_call_purpose: 'compaction',
      },
      {
        request: 'summary-2',
        transformedByApp: true,
        xiaoliang_call_purpose: 'compaction',
      },
    ])
    assert.deepEqual(
      await host.agent.onPayload({ probe: 'after' }, host.agent.state.model),
      { probe: 'after', transformedByApp: true },
    )

    const entries = manager.getEntries()
    assert.equal(
      entries.filter((entry) => entry.type === 'message').length,
      originalMessageEntries.length,
      'compaction must append a checkpoint instead of deleting history entries',
    )
    const compactionEntries = entries.filter((entry) => entry.type === 'compaction')
    assert.equal(compactionEntries.length, 1)
    assert.deepEqual(compactionEntries[0].usage, result.usage)
    assert.equal(host.agent.state.messages[0].role, 'compactionSummary')
    assert.ok(host.agent.state.messages.length < originalMessageEntries.length + 1)

    const persistedEntries = fs.readFileSync(manager.getSessionFile(), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(
      persistedEntries.filter((entry) => entry.type === 'message').length,
      originalMessageEntries.length,
    )
    assert.equal(persistedEntries.filter((entry) => entry.type === 'compaction').length, 1)
    const compactionEnd = events.filter((event) => event.type === 'compaction_end').at(-1)
    assert.equal(compactionEnd.reason, 'manual')
    assert.equal(compactionEnd.aborted, false)
    assert.equal(compactionEnd.willRetry, false)
    assert.ok(compactionEnd.result.estimatedTokensAfter >= 0)
  } finally {
    unsubscribe()
    await host.dispose()
  }
})

test('context overflow compacts once, retries the interrupted turn, and preserves the failed entry', async () => {
  const { fauxAssistantMessage, fauxProvider, fauxText } = await import('@earendil-works/pi-ai')
  const faux = fauxProvider({
    provider: 'xiaoliang-stage4-overflow',
    tokensPerSecond: 100_000,
  })
  faux.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'prompt is too long' }),
    fauxAssistantMessage(fauxText('overflow checkpoint')),
    fauxAssistantMessage(fauxText('recovered after compaction')),
  ])
  const events = []
  const { host, manager } = await createFileBackedHost({
    testName: 'xiaoliang-pi-stage4-overflow',
    faux,
    fauxAssistantMessage,
    events,
  })

  try {
    await host.prompt('request that overflows')
    assert.equal(faux.state.callCount, 3)
    const compactionEnds = events.filter((event) => event.type === 'compaction_end')
    assert.equal(compactionEnds.length, 1)
    assert.equal(compactionEnds[0].reason, 'overflow')
    assert.equal(compactionEnds[0].aborted, false)
    assert.equal(compactionEnds[0].willRetry, true)
    assert.equal(events.filter((event) => event.type === 'agent_settled').length, 1)

    const fullHistory = manager.getEntries()
    assert.equal(fullHistory.filter((entry) => entry.type === 'compaction').length, 1)
    assert.ok(fullHistory.some((entry) => (
      entry.type === 'message'
      && entry.message.role === 'assistant'
      && entry.message.stopReason === 'error'
      && entry.message.errorMessage === 'prompt is too long'
    )))
    assert.equal(
      host.agent.state.messages.some((message) => (
        message.role === 'assistant' && message.stopReason === 'error'
      )),
      false,
      'the failed overflow response stays in the tree but not in active model context',
    )
    assert.match(
      host.agent.state.messages.at(-1).content[0].text,
      /recovered after compaction/,
    )
  } finally {
    await host.dispose()
  }
})

test('stage 4 exposes one Pi compactor through IPC and accessible UI contracts', () => {
  const host = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts'),
    'utf8',
  )
  const manager = fs.readFileSync(
    path.join(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )
  const contract = fs.readFileSync(
    path.join(projectRoot, 'src/shared/ipc-contract.ts'),
    'utf8',
  )
  const panel = fs.readFileSync(
    path.join(projectRoot, 'src/components/runtime/agent-chat-panel.tsx'),
    'utf8',
  )
  const ring = fs.readFileSync(
    path.join(projectRoot, 'src/components/chat/context-usage-ring.tsx'),
    'utf8',
  )

  assert.equal(fs.existsSync(path.join(
    projectRoot,
    'electron/runtime/agent/memory/compaction/context-compactor.ts',
  )), false)
  assert.equal(fs.existsSync(path.join(
    projectRoot,
    'electron/runtime/backend/agent-compact-client.ts',
  )), false)
  assert.doesNotMatch(manager, /compactMessages|evaluateCompactionNeed|pendingCompactionReasons/)
  assert.match(manager, /callPurpose: 'compaction'/)
  assert.match(host, /xiaoliang_call_purpose: 'compaction'/)
  assert.match(host, /abortRetry\(\)/)
  assert.match(contract, /AGENT_COMPACT_CONTEXT: 'agent:compactContext'/)
  assert.match(panel, /aria-live="polite"/)
  assert.match(ring, /type="button"/)
  assert.match(ring, /aria-disabled=/)
})
