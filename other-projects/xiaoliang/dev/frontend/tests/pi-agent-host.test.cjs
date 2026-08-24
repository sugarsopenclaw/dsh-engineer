const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')
let cachedHostModule

function loadHostModule() {
  if (cachedHostModule) return cachedHostModule
  const filename = path.join(
    projectRoot,
    'electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts',
  )
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
  cachedHostModule = mod.exports
  return cachedHostModule
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for Pi host test condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function thinkingCapableModel(model) {
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap: {
      off: 'off',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    },
  }
}

test('XiaoliangPiAgentHost preserves controlled runtime semantics and safe replacement', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const {
    XIAOLIANG_PI_RESOURCE_POLICY,
    XIAOLIANG_PI_RESILIENCE_POLICY,
    XiaoliangPiAgentHost,
  } = loadHostModule()

  assert.deepEqual(XIAOLIANG_PI_RESOURCE_POLICY, {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  assert.deepEqual(XIAOLIANG_PI_RESILIENCE_POLICY, {
    compaction: {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    },
    retry: {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2_000,
      provider: {
        maxRetries: 0,
        maxRetryDelayMs: 30_000,
      },
    },
  })

  const faux = fauxProvider({
    provider: 'xiaoliang-host-test',
    tokensPerSecond: 100_000,
  })
  const providerSystemPrompts = []
  faux.setResponses([
    (context) => {
      providerSystemPrompts.push(context.systemPrompt)
      return fauxAssistantMessage(
        fauxToolCall('echo', { text: 'hello' }),
        { stopReason: 'toolUse' },
      )
    },
    (context) => {
      providerSystemPrompts.push(context.systemPrompt)
      return fauxAssistantMessage(fauxText('done'))
    },
  ])

  const events = []
  const toolCalls = []
  const providerContexts = []
  let payloadTransformCount = 0
  let toolExecutionCount = 0
  let blockToolCalls = false
  let host
  try {
    host = await XiaoliangPiAgentHost.create({
      cwd: projectRoot,
      agentDir: path.join(projectRoot, '.pi-host-test'),
      generation: 7,
      model: faux.getModel(),
      provider: faux.provider,
      thinkingLevel: 'low',
      tools: [{
        name: 'echo',
        label: 'Echo',
        description: 'Echo a string',
        parameters: Type.Object({ text: Type.String() }),
        execute: async (_toolCallId, params) => {
          toolExecutionCount += 1
          return {
            content: [{ type: 'text', text: params.text }],
            details: {},
          }
        },
      }],
      initialMessages: [],
      systemPrompt: 'initial prompt',
      transformContext: async (messages) => {
        providerContexts.push(messages.length)
        return messages
      },
      transformPayload: (payload) => {
        payloadTransformCount += 1
        return payload
      },
      beforeToolCall: async (toolCall) => {
        toolCalls.push(toolCall)
        return blockToolCalls
          ? { block: true, reason: 'blocked by test approval policy' }
          : undefined
      },
      onEvent: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        events.push(event)
      },
    })

    host.setSystemPrompt('updated prompt')
    const probePayload = { probe: true }
    assert.equal(
      await host.agent.onPayload(probePayload, host.agent.state.model),
      probePayload,
    )
    await host.prompt('run echo')

    assert.equal(toolExecutionCount, 1)
    assert.equal(typeof toolCalls[0].id, 'string')
    assert.equal(toolCalls[0].name, 'echo')
    assert.deepEqual(toolCalls[0].args, { text: 'hello' })
    assert.ok(providerContexts.length >= 2)
    assert.equal(payloadTransformCount, 1)
    assert.deepEqual(providerSystemPrompts, ['updated prompt', 'updated prompt'])
    assert.equal(host.agent.state.systemPrompt, 'updated prompt')
    assert.equal(host.session.autoCompactionEnabled, true)
    assert.equal(host.session.autoRetryEnabled, true)
    assert.deepEqual(host.session.getActiveToolNames(), ['echo'])
    assert.equal(host.agent.state.messages.at(-1).role, 'assistant')
    assert.equal(events.at(-1).event.type, 'agent_settled')
    assert.ok(events.every((event) => event.generation === 7))
    assert.deepEqual(
      events.map((event) => event.sequence),
      events.map((_event, index) => index + 1),
    )

    const initialQueueBehavior = {
      steeringMode: host.session.steeringMode,
      followUpMode: host.session.followUpMode,
    }

    blockToolCalls = true
    const initialAgent = host.agent
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('echo', { text: 'must not execute' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxText('after reset')),
    ])
    const replacementAgent = await host.reset()
    assert.notEqual(replacementAgent, initialAgent)
    assert.equal(replacementAgent, host.agent)
    assert.equal(host.currentGeneration, 8)
    assert.equal(host.agent.state.messages.length, 0)
    assert.deepEqual({
      steeringMode: host.session.steeringMode,
      followUpMode: host.session.followUpMode,
    }, initialQueueBehavior)
    assert.equal(host.session.autoCompactionEnabled, true)
    assert.equal(host.session.autoRetryEnabled, true)
    await host.prompt('new session')
    assert.equal(toolExecutionCount, 1)
    assert.equal(toolCalls.at(-1).args.text, 'must not execute')

    const replacementEvents = events.filter((event) => event.generation === 8)
    assert.ok(replacementEvents.length > 0)
    assert.equal(replacementEvents[0].sequence, 1)
    assert.equal(replacementEvents.at(-1).event.type, 'agent_settled')
  } finally {
    await host?.dispose()
  }
})

test('a pending thinking level waits for agent_settled across a multi-turn tool loop', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-thinking-boundary-test',
    tokensPerSecond: 100_000,
  })
  const requestThinkingLevels = []
  const turnEndThinkingLevels = []
  const eventTypes = []
  let pendingThinkingLevel = null
  let host

  faux.setResponses([
    () => {
      requestThinkingLevels.push(host.session.thinkingLevel)
      return fauxAssistantMessage(
        fauxToolCall('mark-pending', {}),
        { stopReason: 'toolUse' },
      )
    },
    () => {
      requestThinkingLevels.push(host.session.thinkingLevel)
      return fauxAssistantMessage(fauxText('same send finished'))
    },
    () => {
      requestThinkingLevels.push(host.session.thinkingLevel)
      return fauxAssistantMessage(fauxText('next send finished'))
    },
  ])

  host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-thinking-boundary-test'),
    generation: 9,
    model: thinkingCapableModel(faux.getModel()),
    provider: faux.provider,
    thinkingLevel: 'low',
    thinkingLevelSource: 'caller',
    tools: [{
      name: 'mark-pending',
      label: 'Mark pending',
      description: 'Models a user changing the thinking level while a tool is running',
      parameters: Type.Object({}),
      execute: async () => {
        pendingThinkingLevel = 'xhigh'
        return { content: [{ type: 'text', text: 'pending' }], details: {} }
      },
    }],
    initialMessages: [],
    systemPrompt: 'thinking boundary test',
    onEvent: (envelope) => {
      const eventType = envelope.event.type
      eventTypes.push(eventType)
      if (eventType === 'turn_end' && pendingThinkingLevel) {
        turnEndThinkingLevels.push(host.session.thinkingLevel)
      }
      if (eventType === 'agent_settled' && pendingThinkingLevel) {
        host.session.setThinkingLevel(pendingThinkingLevel)
        pendingThinkingLevel = null
      }
    },
  })

  try {
    await host.prompt('run the tool')
    const firstRunAgentEnd = eventTypes.indexOf('agent_end')
    const firstRunTurnEnds = eventTypes
      .map((type, index) => ({ type, index }))
      .filter(({ type }) => type === 'turn_end')

    assert.deepEqual(requestThinkingLevels, ['low', 'low'])
    assert.deepEqual(turnEndThinkingLevels, ['low', 'low'])
    assert.equal(firstRunTurnEnds.length, 2)
    assert.ok(firstRunTurnEnds.every(({ index }) => index < firstRunAgentEnd))
    assert.equal(host.session.thinkingLevel, 'xhigh')

    await host.prompt('start the next send')
    assert.deepEqual(requestThinkingLevels, ['low', 'low', 'xhigh'])
  } finally {
    await host.dispose()
  }
})

test('Xiaoliang managed provider resolves fresh credentials and preserves xhigh', async () => {
  const { XiaoliangPiAgentHost } = loadHostModule()
  const model = {
    id: 'managed-test',
    name: 'Managed test',
    api: 'openai-completions',
    provider: 'xiaoliang-managed-test',
    baseUrl: 'https://example.invalid/agent/v1',
    reasoning: true,
    thinkingLevelMap: {
      off: 'off',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    },
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 8_192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_completion_tokens',
      requiresToolResultName: false,
      supportsStrictMode: false,
    },
  }
  let credentialSequence = 0
  const restoredMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'restored from SQLite projection' }],
    timestamp: 1,
  }
  const restoredCompaction = {
    role: 'compactionSummary',
    summary: 'restored compacted context',
    tokensBefore: 4096,
    timestamp: 2,
  }
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-managed-test'),
    generation: 1,
    model,
    thinkingLevel: 'xhigh',
    tools: [],
    initialMessages: [restoredCompaction, restoredMessage],
    systemPrompt: 'managed prompt',
    resolveApiKey: async () => `credential-${++credentialSequence}`,
    onEvent: () => undefined,
  })
  try {
    const first = await host.session.modelRuntime.getAuth(model)
    const second = await host.session.modelRuntime.getAuth(model)
    assert.equal(first.auth.apiKey, 'credential-1')
    assert.equal(second.auth.apiKey, 'credential-2')
    assert.equal(host.session.thinkingLevel, 'xhigh')
    assert.deepEqual(host.session.getActiveToolNames(), [])
    assert.deepEqual(host.agent.state.messages, [restoredCompaction, restoredMessage])
  } finally {
    await host.dispose()
  }
})

test('steer and follow-up stay in one Pi run and publish deterministic queue updates', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-queue-test',
    tokensPerSecond: 100_000,
  })
  const providerUserMessages = []
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('hold', {}),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('steering applied'))
    },
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('follow-up applied'))
    },
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-queue-test'),
    generation: 20,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'queue test',
    onEvent: (event) => events.push(event),
  })

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))
    assert.equal(host.isRunning, true)

    await host.steer('adjust the active task')
    await host.followUp('continue after the task')
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: ['adjust the active task'],
      followUp: ['continue after the task'],
    })

    releaseTool()
    await run

    const queueUpdates = events
      .filter(({ event }) => event.type === 'queue_update')
      .map(({ event }) => ({
        steering: [...event.steering],
        followUp: [...event.followUp],
      }))
    assert.deepEqual(queueUpdates, [
      { steering: ['adjust the active task'], followUp: [] },
      { steering: ['adjust the active task'], followUp: ['continue after the task'] },
      { steering: [], followUp: ['continue after the task'] },
      { steering: [], followUp: [] },
    ])
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
    assert.equal(host.isRunning, false)
    assert.equal(events.at(-1).event.type, 'agent_settled')
    assert.equal(events.filter(({ event }) => event.type === 'agent_settled').length, 1)
    assert.deepEqual(providerUserMessages, [
      ['initial request', 'adjust the active task'],
      ['initial request', 'adjust the active task', 'continue after the task'],
    ])
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('host system follow-ups bypass the composer queue and survive clearing user rows', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-system-follow-up-test',
    tokensPerSecond: 100_000,
  })
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  const providerUserMessages = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('hold', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxText('main task done')),
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('system report handled'))
    },
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-system-follow-up-test'),
    generation: 21,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'system follow-up test',
    onEvent: (event) => events.push(event),
  })

  const completionMessage = [
    '[subagent_completion]',
    'task_id: child-system-1',
    'parent_prompt_id: prompt-system-1',
    'agent_type: blender-modeler',
    'status: completed',
    'Treat this as a tool result.',
  ].join('\n')

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))

    await host.followUp('user row to clear')
    await host.followUpSystemMessage({
      id: 'xiaoliang.subagent_completion:child-system-1',
      customType: 'xiaoliang.subagent_completion',
      content: completionMessage,
      details: {
        taskId: 'child-system-1',
        agentType: 'blender-modeler',
        status: 'completed',
      },
    })

    assert.deepEqual(host.getQueuedItems().map((item) => item.text), ['user row to clear'])
    assert.deepEqual(await host.clearQueue(), {
      steering: [],
      followUp: ['user row to clear'],
    })
    assert.deepEqual(host.getQueuedItems(), [])

    releaseTool()
    await run

    assert.equal(providerUserMessages.length, 1)
    assert.ok(providerUserMessages[0].includes('initial request'))
    assert.ok(providerUserMessages[0].includes(completionMessage))
    assert.ok(!providerUserMessages[0].includes('user row to clear'))

    const projectedQueueText = events
      .filter(({ event }) => event.type === 'queue_update')
      .flatMap(({ event }) => event.items?.map((item) => item.text) ?? [
        ...event.steering,
        ...event.followUp,
      ])
      .join('\n')
    assert.doesNotMatch(projectedQueueText, /subagent_completion|child-system-1/)

    const customEntries = host.session.sessionManager.getEntries().filter((entry) => (
      entry.type === 'custom_message'
      && entry.customType === 'xiaoliang.subagent_completion'
    ))
    assert.equal(customEntries.length, 1)
    assert.equal(customEntries[0].display, false)

    const customMessageEnds = events.filter(({ event }) => (
      event.type === 'message_end'
      && event.message?.role === 'custom'
      && event.message.customType === 'xiaoliang.subagent_completion'
    ))
    assert.equal(customMessageEnds.length, 1)
    assert.deepEqual(customMessageEnds[0].event.message.details?.payload, {
      taskId: 'child-system-1',
      agentType: 'blender-modeler',
      status: 'completed',
    })
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('an idle host system message starts a custom turn without creating a queue row', async () => {
  const {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-system-prompt-test',
    tokensPerSecond: 100_000,
  })
  const providerUserMessages = []
  faux.setResponses([
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('idle system report handled'))
    },
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-system-prompt-test'),
    generation: 22,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [],
    systemPrompt: 'system prompt test',
    onEvent: (event) => events.push(event),
  })

  try {
    await host.promptSystemMessage({
      id: 'xiaoliang.subagent_completion:child-idle-system-1',
      customType: 'xiaoliang.subagent_completion',
      content: '[subagent_completion]\ntask_id: child-idle-system-1',
      details: {
        taskId: 'child-idle-system-1',
        agentType: 'blender-modeler',
        status: 'completed',
      },
    })

    assert.deepEqual(providerUserMessages, [[
      '[subagent_completion]\ntask_id: child-idle-system-1',
    ]])
    assert.deepEqual(host.getQueuedItems(), [])
    assert.equal(events.filter(({ event }) => event.type === 'queue_update').length, 0)
    assert.ok(host.session.sessionManager.getEntries().some((entry) => (
      entry.type === 'custom_message'
      && entry.customType === 'xiaoliang.subagent_completion'
      && entry.display === false
    )))
  } finally {
    await host.dispose()
  }
})

test('ordinary Pi continue does not rebuild shadow items already drained into the prompt', async () => {
  const {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-continue-queue-test',
    tokensPerSecond: 100_000,
  })
  const providerUserMessages = []
  faux.setResponses([
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('continued once'))
    },
    (context) => {
      providerUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('unexpected duplicate'))
    },
  ])

  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-continue-queue-test'),
    generation: 21,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [fauxAssistantMessage(fauxText('ready'))],
    systemPrompt: 'continue queue test',
    onEvent: () => {},
  })

  try {
    // Reproduce Pi's post-run window: its UI queue and the host shadow still contain
    // the row, while Agent.continue() drains the core queue before agent_start.
    await host.session.steer('queued once')
    assert.deepEqual(host.getQueuedItems().map((item) => item.text), ['queued once'])

    await host.session.agent.continue()
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(providerUserMessages, [['queued once']])
    assert.deepEqual(host.getQueuedItems(), [])
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
  } finally {
    await host.dispose()
  }
})

test('abort clears pending queue and resolves only after aborted tool events settle', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-stop-test',
    tokensPerSecond: 100_000,
  })
  const resumedUserMessages = []
  const resumedThinkingLevels = []
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('wait-for-abort', {}),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      resumedThinkingLevels.push(host.session.thinkingLevel)
      resumedUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('resumed steering'))
    },
    (context) => {
      resumedThinkingLevels.push(host.session.thinkingLevel)
      resumedUserMessages.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')),
      )
      return fauxAssistantMessage(fauxText('resumed follow-up'))
    },
  ])

  const events = []
  let pendingThinkingLevel = null
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-stop-test'),
    generation: 30,
    model: thinkingCapableModel(faux.getModel()),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'wait-for-abort',
      label: 'Wait for abort',
      description: 'Resolve when the run is aborted',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, signal) => new Promise((resolve) => {
        const finish = () => resolve({
          content: [{ type: 'text', text: 'tool observed abort' }],
          details: {},
        })
        if (signal.aborted) {
          finish()
          return
        }
        signal.addEventListener('abort', finish, { once: true })
      }),
    }],
    initialMessages: [],
    systemPrompt: 'stop test',
    onEvent: async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      events.push(event)
      if (event.event.type === 'agent_settled' && pendingThinkingLevel) {
        host.session.setThinkingLevel(pendingThinkingLevel)
        pendingThinkingLevel = null
      }
    },
  })

  try {
    const run = host.prompt('start stoppable work')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))
    pendingThinkingLevel = 'xhigh'
    await host.steer('queued correction')
    await host.followUp('queued continuation')

    const cleared = await host.abort()
    await run

    assert.deepEqual(cleared, {
      steering: ['queued correction'],
      followUp: ['queued continuation'],
    })
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
    assert.deepEqual(host.getQueuedItems().map((item) => ({
      kind: item.kind,
      text: item.text,
    })), [
      { kind: 'steer', text: 'queued correction' },
      { kind: 'followUp', text: 'queued continuation' },
    ])
    assert.equal(events.at(-1).event.type, 'agent_settled')
    assert.ok(events.some(({ event }) => event.type === 'tool_execution_end'))
    assert.ok(events.some(({ event }) => event.type === 'agent_end'))
    const settledIndex = events.findIndex(({ event }) => event.type === 'agent_settled')
    const toolEndIndex = events.findIndex(({ event }) => event.type === 'tool_execution_end')
    const agentEndIndex = events.findIndex(({ event }) => event.type === 'agent_end')
    assert.ok(settledIndex > toolEndIndex)
    assert.ok(settledIndex > agentEndIndex)
    assert.equal(host.session.thinkingLevel, 'xhigh')

    await host.registerTools([{
      name: 'post_stop_probe',
      label: 'Post-stop probe',
      description: 'Verifies that a runtime reload keeps held queue rows',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
    }])
    assert.deepEqual(host.getQueuedItems().map((item) => ({
      kind: item.kind,
      text: item.text,
    })), [
      { kind: 'steer', text: 'queued correction' },
      { kind: 'followUp', text: 'queued continuation' },
    ])

    const waitController = new AbortController()
    let waiterResolved = false
    const heldWait = host.waitForSteeringMessage(waitController.signal).then(() => {
      waiterResolved = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(waiterResolved, false)
    waitController.abort()
    await heldWait

    await host.prompt('resume after stop')
    assert.deepEqual(resumedThinkingLevels, ['xhigh', 'xhigh'])
    assert.deepEqual(host.getQueuedItems(), [])
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
    assert.deepEqual(
      resumedUserMessages[0].slice(-2),
      ['resume after stop', 'queued correction'],
    )
    assert.deepEqual(
      resumedUserMessages[1].slice(-3),
      ['resume after stop', 'queued correction', 'queued continuation'],
    )
  } finally {
    await host.dispose()
  }
})

test('replacement host adopts detached held queue rows with stable ids and images', async () => {
  const {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-held-transfer-test',
    tokensPerSecond: 100_000,
  })
  faux.setResponses([
    fauxAssistantMessage(fauxText('initial answer')),
    fauxAssistantMessage(fauxText('steering answer')),
    fauxAssistantMessage(fauxText('follow-up answer')),
  ])
  const heldRows = [{
    id: 'held-steer-id',
    kind: 'steer',
    text: 'transferred correction',
    images: [],
  }, {
    id: 'held-follow-up-id',
    kind: 'followUp',
    text: 'transferred continuation',
    images: [{ type: 'image', data: 'aGVsZA==', mimeType: 'image/png' }],
  }]
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-held-transfer-test'),
    generation: 31,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [],
    initialHeldQueueItems: heldRows,
    systemPrompt: 'held transfer test',
    onEvent: () => {},
  })

  try {
    assert.deepEqual(host.getQueuedItems(), heldRows)
    await host.prompt('resume with transferred queue')
    assert.deepEqual(host.getQueuedItems(), [])
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
  } finally {
    await host.dispose()
  }
})

test('queued items keep images and can be removed or updated by id', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-queue-item-test',
    tokensPerSecond: 100_000,
  })
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('hold', {}),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('done')),
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-queue-item-test'),
    generation: 40,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'queue item test',
    onEvent: (event) => events.push(event),
  })

  const image = {
    type: 'image',
    data: Buffer.from('queue-image').toString('base64'),
    mimeType: 'image/png',
  }

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))

    await host.steer('keep this', [image])
    await host.followUp('delete me')
    await host.followUp('edit me')

    const queued = host.getQueuedItems()
    assert.equal(queued.length, 3)
    assert.equal(queued[0].kind, 'steer')
    assert.equal(queued[0].images.length, 1)
    assert.equal(queued[0].images[0].mimeType, 'image/png')
    assert.equal(queued[1].text, 'delete me')
    assert.equal(queued[2].text, 'edit me')

    await host.removeQueuedItem(queued[1].id)
    assert.deepEqual(host.getQueuedItems().map((item) => item.text), ['keep this', 'edit me'])
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: ['keep this'],
      followUp: ['edit me'],
    })

    const edited = await host.updateQueuedItem(queued[2].id, 'edited follow-up', [image])
    assert.equal(edited.text, 'edited follow-up')
    assert.equal(edited.images.length, 1)
    assert.deepEqual(host.getQueuedItems().map((item) => item.text), ['keep this', 'edited follow-up'])
    assert.equal(host.getQueuedItems()[1].images.length, 1)
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: ['keep this'],
      followUp: ['edited follow-up'],
    })

    const beforeFailedEdit = host.getQueuedItems()
    const originalFollowUp = host.session.followUp.bind(host.session)
    let rejectNextRebuild = true
    host.session.followUp = async (text, images) => {
      if (text === 'edited follow-up' && rejectNextRebuild) {
        rejectNextRebuild = false
        throw new Error('forced queue rebuild failure')
      }
      return originalFollowUp(text, images)
    }
    try {
      await assert.rejects(
        host.updateQueuedItem(queued[0].id, 'must roll back', [image]),
        /forced queue rebuild failure/,
      )
    } finally {
      host.session.followUp = originalFollowUp
    }
    assert.deepEqual(host.getQueuedItems(), beforeFailedEdit)
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: ['keep this'],
      followUp: ['edited follow-up'],
    })

    releaseTool()
    await run
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('setQueuedItemKind can promote a follow-up to steering and release waiters', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-queue-kind-test',
    tokensPerSecond: 100_000,
  })
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('hold', {}),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('done')),
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-queue-kind-test'),
    generation: 41,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'queue kind test',
    onEvent: (event) => events.push(event),
  })

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))

    await host.followUp('later guidance')
    const queued = host.getQueuedItems()
    assert.equal(queued.length, 1)
    assert.equal(queued[0].kind, 'followUp')
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: [],
      followUp: [queued[0].text],
    })

    await assert.rejects(
      () => host.setQueuedItemKind('missing-id', 'steer'),
      /未找到排队消息/,
    )

    const unchanged = await host.setQueuedItemKind(queued[0].id, 'followUp')
    assert.equal(unchanged.kind, 'followUp')
    assert.deepEqual(host.getQueueSnapshot(), {
      steering: [],
      followUp: [queued[0].text],
    })

    let waiterDone = false
    const waiter = host.waitForSteeringMessage().then(() => {
      waiterDone = true
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    assert.equal(waiterDone, false)

    const steered = await host.setQueuedItemKind(queued[0].id, 'steer')
    assert.equal(steered.kind, 'steer')
    assert.deepEqual(host.getQueuedItems().map((item) => item.kind), ['steer'])
    assert.equal(host.getQueueSnapshot().steering.length, 1)
    assert.deepEqual(host.getQueueSnapshot().followUp, [])
    await waiter
    assert.equal(waiterDone, true)

    const demotionWaitController = new AbortController()
    let demotionWaiterDone = false
    let demotionWaiter
    const originalClearQueue = host.session.clearQueue.bind(host.session)
    let installWaiterAfterClear = true
    host.session.clearQueue = () => {
      const cleared = originalClearQueue()
      if (installWaiterAfterClear) {
        installWaiterAfterClear = false
        demotionWaiter = host.waitForSteeringMessage(demotionWaitController.signal).then(() => {
          demotionWaiterDone = true
        })
      }
      return cleared
    }
    let demoted
    try {
      demoted = await host.setQueuedItemKind(queued[0].id, 'followUp')
    } finally {
      host.session.clearQueue = originalClearQueue
    }
    assert.equal(demoted.kind, 'followUp')
    assert.deepEqual(host.getQueueSnapshot().steering, [])
    assert.equal(host.getQueueSnapshot().followUp.length, 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(demotionWaiterDone, false)
    demotionWaitController.abort()
    await demotionWaiter

    let laterWaiterDone = false
    void host.waitForSteeringMessage().then(() => {
      laterWaiterDone = true
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    assert.equal(laterWaiterDone, false)

    releaseTool()
    await run
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('queue rebuild drops rows Pi drains while rewritten messages settle', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-queue-rebuild-drain-test',
    tokensPerSecond: 100_000,
  })
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('hold', {}),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('done')),
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-queue-rebuild-drain-test'),
    generation: 42,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'queue rebuild drain test',
    onEvent: (event) => events.push(event),
  })

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))

    await host.steer('drained during rebuild')
    await host.followUp('survives rebuild')
    const [drained, survivor] = host.getQueuedItems()
    assert.ok(drained)
    assert.ok(survivor)

    const originalFollowUp = host.session.followUp.bind(host.session)
    let drainFirstRewrite = true
    host.session.followUp = (text, images) => {
      const pending = originalFollowUp(text, images)
      if (drainFirstRewrite) {
        drainFirstRewrite = false
        // Model the turn-boundary state after Pi has consumed this rewritten row.
        host.session.clearQueue()
      }
      return pending
    }
    let changed
    try {
      changed = await host.setQueuedItemKind(drained.id, 'followUp')
    } finally {
      host.session.followUp = originalFollowUp
    }

    assert.equal(changed.id, drained.id)
    assert.equal(changed.kind, 'followUp')
    assert.deepEqual(host.getQueuedItems().map((item) => ({
      id: item.id,
      text: item.text,
    })), [{
      id: survivor.id,
      text: 'survives rebuild',
    }])

    await host.setQueuedItemKind(survivor.id, 'steer')
    assert.deepEqual(host.getQueuedItems().map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
    })), [{
      id: survivor.id,
      kind: 'steer',
      text: 'survives rebuild',
    }])

    releaseTool()
    await run
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('image-only queued items use a Pi placeholder and disappear after delivery', async () => {
  const {
    Type,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-image-only-queue-test',
    tokensPerSecond: 100_000,
  })
  let releaseTool
  const toolGate = new Promise((resolve) => {
    releaseTool = resolve
  })
  const deliveredUserMessages = []
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('hold', {}),
      { stopReason: 'toolUse' },
    ),
    (context) => {
      deliveredUserMessages.push(...context.messages.filter((message) => message.role === 'user'))
      return fauxAssistantMessage(fauxText('image received'))
    },
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-image-only-queue-test'),
    generation: 41,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [{
      name: 'hold',
      label: 'Hold',
      description: 'Wait until the test releases the tool',
      parameters: Type.Object({}),
      execute: async () => {
        await toolGate
        return {
          content: [{ type: 'text', text: 'released' }],
          details: {},
        }
      },
    }],
    initialMessages: [],
    systemPrompt: 'image-only queue test',
    onEvent: (event) => events.push(event),
  })
  const image = {
    type: 'image',
    data: Buffer.from('image-only-queue').toString('base64'),
    mimeType: 'image/png',
  }

  try {
    const run = host.prompt('initial request')
    await waitFor(() => events.some(({ event }) => event.type === 'tool_execution_start'))
    await host.steer('', [image])

    assert.equal(host.getQueuedItems()[0].text, '')
    assert.equal(host.getQueuedItems()[0].images.length, 1)
    const queuedImageEvent = events
      .filter(({ event }) => event.type === 'queue_update')
      .at(-1)
    assert.equal(queuedImageEvent.event.items[0].images.length, 1)
    assert.match(
      host.getQueueSnapshot().steering[0],
      /^__xiaoliang_image_queue__:[0-9a-f]{8}-[0-9a-f-]{27}$/u,
    )

    releaseTool()
    await run

    const deliveredImageMessage = deliveredUserMessages.find((message) => (
      message.content.some((part) => part.type === 'image')
    ))
    assert.ok(deliveredImageMessage)
    assert.equal(
      deliveredImageMessage.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
      '',
    )
    assert.deepEqual(host.getQueuedItems(), [])
    assert.deepEqual(host.getQueueSnapshot(), { steering: [], followUp: [] })
  } finally {
    releaseTool?.()
    await host.dispose()
  }
})

test('active session replacement aborts, drains, and rejects late-generation events', async () => {
  const {
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
  } = await import('@earendil-works/pi-ai')
  const { XiaoliangPiAgentHost } = loadHostModule()
  const faux = fauxProvider({
    provider: 'xiaoliang-host-abort-test',
    minTokenSize: 1,
    maxTokenSize: 2,
    tokensPerSecond: 25,
  })
  faux.setResponses([
    fauxAssistantMessage(fauxText('old generation '.repeat(80))),
  ])

  const events = []
  const host = await XiaoliangPiAgentHost.create({
    cwd: projectRoot,
    agentDir: path.join(projectRoot, '.pi-host-abort-test'),
    generation: 11,
    model: faux.getModel(),
    provider: faux.provider,
    thinkingLevel: 'low',
    tools: [],
    initialMessages: [],
    systemPrompt: 'abort test',
    onEvent: async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      events.push(event)
    },
  })

  try {
    const oldPrompt = host.prompt('start slow response')
    await waitFor(() => events.some(({ event }) => event.type === 'message_update'))
    await host.reset()
    await oldPrompt

    assert.equal(host.currentGeneration, 12)
    assert.equal(host.agent.state.messages.length, 0)
    faux.setResponses([fauxAssistantMessage(fauxText('new generation'))])
    await host.prompt('continue after reset')
    await new Promise((resolve) => setTimeout(resolve, 20))

    const firstNewIndex = events.findIndex(({ generation }) => generation === 12)
    assert.ok(firstNewIndex >= 0)
    assert.ok(events.slice(0, firstNewIndex).every(({ generation }) => generation === 11))
    assert.ok(events.slice(firstNewIndex).every(({ generation }) => generation === 12))
    assert.equal(events.at(-1).event.type, 'agent_settled')
  } finally {
    await host.dispose()
  }
})
