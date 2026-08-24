const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
      electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs'),
    },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

function loadSubagentRepository(userDataDir) {
  const projectRoot = path.resolve(__dirname, '..')
  const filename = path.join(projectRoot, 'subagent-repository-test-entry.cjs')
  const output = esbuild.buildSync({
    stdin: {
      contents: [
        "export * from './electron/runtime/agent/subagents/subagent-run-repository'",
        "export { closeDB } from './electron/runtime/db'",
      ].join('\n'),
      resolveDir: projectRoot,
      sourcefile: 'subagent-repository-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'better-sqlite3'],
    write: false,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataDir } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = new Module(filename, module)
    mod.filename = filename
    mod.paths = Module._nodeModulePaths(projectRoot)
    mod._compile(output.outputFiles[0].text, filename)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

function deferred() {
  let resolve
  const promise = new Promise((settled) => {
    resolve = settled
  })
  return { promise, resolve }
}

async function waitUntil(predicate, message, timeoutMs = 2_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

const buckets = loadBundledModule('src/hooks/conversation-runtime-buckets.ts')
const background = loadBundledModule(
  'electron/runtime/agent/tasks/background/subagent-task-service.ts',
)
const concurrency = loadBundledModule(
  'electron/runtime/agent/sessions/agent-concurrency.ts',
)
const runSource = loadBundledModule(
  'electron/runtime/agent/sessions/agent-run-source.ts',
)
const notificationDeduplication = loadBundledModule(
  'electron/runtime/ipc/agent-notification-deduplicator.ts',
)
const coreRoleSection = loadBundledModule(
  'electron/runtime/agent/prompts/system/sections/core-role.ts',
)
const delegationSection = loadBundledModule(
  'electron/runtime/agent/prompts/system/sections/delegation.ts',
)
const toolingSection = loadBundledModule(
  'electron/runtime/agent/prompts/system/sections/tooling.ts',
)
const completion = loadBundledModule('src/shared/subagent-completion.ts')

function activeSnapshot(taskId, overrides = {}) {
  return {
    childRunId: taskId,
    type: 'blender-modeler',
    description: `background ${taskId}`,
    parentSessionId: 'conversation-1',
    parentPromptId: 'prompt-1',
    clientRunId: 'client-1',
    projectId: 'project-1',
    model: 'xiaoliang-backend/qwen3.8-max',
    status: 'queued',
    createdAt: '2026-08-13T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    queuePosition: 1,
    progress: {},
    errorCode: null,
    ...overrides,
  }
}

function completedResult(taskId, overrides = {}) {
  const base = {
    childRunId: taskId,
    type: 'blender-modeler',
    status: 'completed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: {
      input: 10,
      output: 5,
      cache_read: 0,
      cache_write: 0,
      total: 15,
      cost: 0.1,
    },
    durationMs: 25,
    toolCallCount: 1,
    artifactRefs: [],
    resultText: `Verified result for ${taskId}.`,
  }
  if (overrides.type !== undefined && overrides.type !== 'blender-modeler') {
    // A CAD child reports through its evidence pack and never through direct text.
    delete base.resultText
  }
  return { ...base, ...overrides }
}

function controllableHandle(taskId, overrides = {}) {
  const { artifactRefs, ...snapshotOverrides } = overrides
  const result = deferred()
  let snapshot = activeSnapshot(taskId, snapshotOverrides)
  return {
    handle: {
      childRunId: taskId,
      result: result.promise,
      cancel: () => false,
      snapshot: () => ({ ...snapshot, progress: { ...snapshot.progress } }),
    },
    complete() {
      const terminal = completedResult(taskId, {
        ...(overrides.type ? { type: overrides.type } : {}),
        ...(artifactRefs ? { artifactRefs } : {}),
      })
      snapshot = activeSnapshot(taskId, {
        ...snapshotOverrides,
        status: 'completed',
        queuePosition: null,
        startedAt: snapshot.startedAt ?? snapshot.createdAt,
        finishedAt: '2026-08-13T00:00:00.025Z',
        durationMs: 25,
        progress: { phase: 'completed' },
      })
      result.resolve(terminal)
      return terminal
    },
  }
}

test('conversation runtime buckets accumulate inactive deltas without cross-talk', () => {
  const eventOptions = (active) => ({
    isActive: active,
    createPartId: (() => {
      let sequence = 0
      return () => `part-${++sequence}`
    })(),
    now: () => 1,
  })
  let first = buckets.createConversationRuntimeBucket()
  let second = buckets.createConversationRuntimeBucket()

  first = buckets.reduceConversationRuntimeEvent(first, {
    type: 'agent_start',
    conversationId: 'conversation-a',
    supportsQueueing: true,
  }, eventOptions(false))
  first = buckets.reduceConversationRuntimeEvent(first, {
    type: 'message_delta',
    conversationId: 'conversation-a',
    kind: 'text',
    contentIndex: 0,
    delta: '后台 A',
  }, eventOptions(false))

  second = buckets.reduceConversationRuntimeEvent(second, {
    type: 'agent_start',
    conversationId: 'conversation-b',
    supportsQueueing: true,
  }, eventOptions(true))
  second = buckets.reduceConversationRuntimeEvent(second, {
    type: 'message_delta',
    conversationId: 'conversation-b',
    kind: 'text',
    contentIndex: 0,
    delta: '前台 B',
  }, eventOptions(true))

  assert.equal(first.streaming.parts[0].content, '后台 A')
  assert.equal(second.streaming.parts[0].content, '前台 B')
  assert.equal(first.isAgentRunning, true)
  assert.equal(second.isAgentRunning, true)

  first = buckets.reduceConversationRuntimeEvent(first, {
    type: 'agent_settled',
    conversationId: 'conversation-a',
  }, eventOptions(false))
  assert.equal(first.unreadCompletion, true)
  assert.equal(second.unreadCompletion, false)
  assert.equal(second.streaming.parts[0].content, '前台 B')
})

test('settling a prompt clears only transient thinking-mode notices', () => {
  const options = {
    isActive: true,
    createPartId: () => 'part-status',
  }
  const notice = buckets.createConversationRuntimeBucket({
    isAgentRunning: true,
    statusText: '已切到专家，当前回合结束后生效。',
  })
  const settled = buckets.reduceConversationRuntimeEvent(notice, {
    type: 'agent_settled',
    conversationId: 'conversation-thinking-notice',
  }, options)
  assert.equal(settled.statusText, null)

  const error = buckets.createConversationRuntimeBucket({ statusText: '网络错误' })
  const refreshed = buckets.reduceConversationRuntimeEvent(error, {
    type: 'messages_updated',
    conversationId: 'conversation-error-status',
    promptSettled: true,
  }, options)
  assert.equal(refreshed.statusText, '网络错误')
})

test('generic message refreshes do not masquerade as completed prompts', () => {
  const options = { isActive: false, createPartId: () => 'unused' }
  let bucket = buckets.createConversationRuntimeBucket()
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'agent_start',
    conversationId: 'conversation-refresh',
    supportsQueueing: true,
  }, options)

  const refreshed = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'messages_updated',
    conversationId: 'conversation-refresh',
  }, options)
  assert.equal(refreshed, bucket)
  assert.equal(refreshed.isAgentRunning, true)
  assert.equal(refreshed.unreadCompletion, false)

  const settled = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'messages_updated',
    conversationId: 'conversation-refresh',
    promptSettled: true,
  }, options)
  assert.equal(settled.isAgentRunning, false)
  assert.equal(settled.unreadCompletion, true)
})

test('persistent plan and review overlays do not masquerade as active prompts', () => {
  const options = { isActive: true, createPartId: () => 'unused' }
  const interaction = (kind, id) => ({
    id,
    conversationId: 'conversation-idle',
    surfaceId: `surface-${id}`,
    kind,
    toolCallId: `tool-${id}`,
    toolName: kind,
    payloadHash: `hash-${id}`,
    title: '待处理',
    description: '',
    risk: 'medium',
    details: [],
    a2uiMessages: [],
    createdAt: new Date().toISOString(),
    expiresAt: '2099-01-01T00:00:00.000Z',
    persistence: 'persistent',
  })

  for (const kind of ['plan_approval', 'component_review']) {
    const pending = interaction(kind, kind)
    let bucket = buckets.createConversationRuntimeBucket()
    bucket = buckets.reduceConversationRuntimeEvent(bucket, {
      type: 'interaction_requested',
      conversationId: 'conversation-idle',
      interaction: pending,
    }, options)
    assert.equal(bucket.isAgentRunning, false)
    assert.equal(bucket.runStatus, 'idle')

    bucket = buckets.reduceConversationRuntimeEvent(bucket, {
      type: 'interaction_resolved',
      conversationId: 'conversation-idle',
      resolution: {
        interactionId: pending.id,
        conversationId: 'conversation-idle',
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        payloadHash: pending.payloadHash,
        actionId: 'cancelled',
        status: 'cancelled',
        resolvedAt: new Date().toISOString(),
        kind,
      },
    }, options)
    assert.equal(bucket.isAgentRunning, false)
  }

  const confirmation = interaction('confirmation', 'confirmation')
  const live = buckets.reduceConversationRuntimeEvent(
    buckets.createConversationRuntimeBucket(),
    {
      type: 'interaction_requested',
      conversationId: 'conversation-idle',
      interaction: confirmation,
    },
    options,
  )
  assert.equal(live.isAgentRunning, true)
  assert.equal(live.runStatus, 'running')
})

test('subagent snapshots keep queued status until the final active child settles', () => {
  const queued = activeSnapshot('child-queued', {
    type: 'cad-analyst',
    parentSessionId: 'conversation-a',
  })
  let bucket = buckets.createConversationRuntimeBucket()
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'subagent_run',
    conversationId: 'conversation-a',
    update: queued,
    updates: [queued],
  }, { isActive: false, createPartId: () => 'unused' })
  assert.equal(bucket.runStatus, 'queued')

  const completed = { ...queued, status: 'completed', queuePosition: null }
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'subagent_run',
    conversationId: 'conversation-a',
    update: completed,
    updates: [completed],
  }, { isActive: false, createPartId: () => 'unused' })
  assert.equal(bucket.runStatus, 'completed')
  assert.equal(bucket.unreadCompletion, true)
})

test('blocking task wait consumes the terminal result and suppresses completion injection', async () => {
  const scheduled = []
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => true,
      followUp: async (...args) => deliveries.push(['followUp', ...args]),
      wake: async (...args) => deliveries.push(['wake', ...args]),
    },
    schedule: (callback) => scheduled.push(callback),
  })
  const controlled = controllableHandle('task-wait-1')
  service.register({
    parentConversationId: 'conversation-1',
    parentPromptId: 'prompt-1',
    clientRunId: 'client-1',
    handle: controlled.handle,
  })

  const snapshot = await service.wait({
    parentConversationId: 'conversation-1',
    taskIds: ['task-wait-1'],
    timeoutMs: 0,
  })
  assert.equal(snapshot.tasks[0].terminal, false)
  assert.equal(snapshot.tasks[0].result.details.task_id, 'task-wait-1')

  const waiting = service.wait({
    parentConversationId: 'conversation-1',
    taskIds: ['task-wait-1'],
    timeoutMs: 1_000,
  })
  controlled.complete()
  const terminal = await waiting
  assert.equal(terminal.timedOut, false)
  assert.equal(terminal.tasks[0].terminal, true)
  assert.equal(terminal.tasks[0].delivered, true)
  assert.equal(terminal.tasks[0].result.details.status, 'completed')
  assert.equal(scheduled.length, 0)
  assert.deepEqual(deliveries, [])
})

test('unconsumed task completion follows up a busy parent and wakes an idle parent', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: (conversationId) => conversationId === 'conversation-busy',
      followUp: async (conversationId, message, context) => deliveries.push({ kind: 'followUp', conversationId, message, context }),
      wake: async (conversationId, message, context) => deliveries.push({ kind: 'wake', conversationId, message, context }),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const busy = controllableHandle('task-busy', { parentSessionId: 'conversation-busy' })
  const idle = controllableHandle('task-idle', { parentSessionId: 'conversation-idle' })
  service.register({
    parentConversationId: 'conversation-busy',
    parentPromptId: 'prompt-busy',
    clientRunId: 'client-busy',
    handle: busy.handle,
  })
  service.register({
    parentConversationId: 'conversation-idle',
    parentPromptId: 'prompt-idle',
    clientRunId: 'client-idle',
    handle: idle.handle,
  })
  busy.complete()
  idle.complete()

  await waitUntil(() => deliveries.length === 2, 'background completions were not delivered')
  assert.equal(deliveries.find((item) => item.conversationId === 'conversation-busy').kind, 'followUp')
  assert.equal(deliveries.find((item) => item.conversationId === 'conversation-idle').kind, 'wake')
  for (const delivery of deliveries) {
    assert.equal(delivery.context.taskId, delivery.conversationId === 'conversation-busy' ? 'task-busy' : 'task-idle')
    assert.equal(delivery.context.agentType, 'blender-modeler')
    assert.equal(delivery.context.status, 'completed')
    assert.equal(delivery.context.count, undefined, 'a lone child carries no aggregate count')
    assert.match(delivery.message, /\[subagent_completion\]/)
    // The notice says who wrote it, so the model does not answer it as if it were the user.
    assert.match(delivery.message, /<system-reminder>/)
    assert.match(delivery.message, /the user did not write it/)
    assert.match(delivery.message, /do not acknowledge or thank anyone/)
    assert.doesNotMatch(delivery.message, /transcript/i)
  }
})

test('several children finishing at once arrive as one notice instead of one turn each', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => true,
      followUp: async (conversationId, message, context) => deliveries.push({ conversationId, message, context }),
      wake: async () => assert.fail('a busy parent takes follow-ups'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const first = controllableHandle('task-batch-1', { parentSessionId: 'conversation-batch' })
  const second = controllableHandle('task-batch-2', { parentSessionId: 'conversation-batch' })
  const third = controllableHandle('task-batch-3', { parentSessionId: 'conversation-batch' })
  for (const handle of [first.handle, second.handle, third.handle]) {
    service.register({
      parentConversationId: 'conversation-batch',
      parentPromptId: 'prompt-batch',
      clientRunId: 'client-batch',
      handle,
    })
  }
  first.complete()
  second.complete()
  third.complete()

  await waitUntil(() => deliveries.length > 0, 'no completion was delivered')
  // Give any second injection a chance to arrive before asserting there is only one.
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(deliveries.length, 1, 'three children cost one parent turn, not three')
  const [delivery] = deliveries
  assert.equal(delivery.context.count, 3)
  assert.match(delivery.message, /task_count: 3/)
  assert.match(delivery.message, /3 delegated tasks you started have finished/)
  for (const taskId of ['task-batch-1', 'task-batch-2', 'task-batch-3']) {
    assert.match(delivery.message, new RegExp(`--- task_id: ${taskId} \\(blender-modeler, completed\\) ---`))
  }
  const notice = completion.parseSubagentCompletionPrompt(delivery.message)
  assert.equal(notice.count, 3)
  assert.match(completion.describeSubagentCompletionNotice(notice), /3 个子代理已结束/)
})

test('a completion is dropped when the parent already read that evidence itself', async () => {
  const deliveries = []
  const evidenceRef = '.xiaoliang/cad/evidence/task-read-1/evidence.md'
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => true,
      hasSeenEvidence: (_conversationId, refs) => refs.includes(evidenceRef),
      followUp: async (conversationId, message) => deliveries.push({ conversationId, message }),
      wake: async () => assert.fail('a busy parent takes follow-ups'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const read = controllableHandle('task-read-1', {
    parentSessionId: 'conversation-read',
    type: 'cad-analyst',
    artifactRefs: [evidenceRef],
  })
  const unread = controllableHandle('task-read-2', { parentSessionId: 'conversation-read' })
  for (const handle of [read.handle, unread.handle]) {
    service.register({
      parentConversationId: 'conversation-read',
      parentPromptId: 'prompt-read',
      clientRunId: 'client-read',
      handle,
    })
  }
  read.complete()
  unread.complete()

  await waitUntil(() => deliveries.length > 0, 'no completion was delivered')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(deliveries.length, 1)
  assert.match(deliveries[0].message, /task_id: task-read-2/)
  assert.doesNotMatch(deliveries[0].message, /task-read-1/)
})

test('a completion survives the parent having read a page shared with another child', async () => {
  const deliveries = []
  const seenRefs = []
  // Research pages are named by URL, not by run, so two children on the same source share one.
  const sharedPageRef = '.xiaoliang/research/pages/gonggao.a1b2c3d4e5.md'
  const evidenceRef = '.xiaoliang/research/evidence/task-shared-1/evidence.md'
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => true,
      hasSeenEvidence: (_conversationId, refs) => {
        seenRefs.push([...refs])
        return refs.includes(sharedPageRef)
      },
      followUp: async (conversationId, message) => deliveries.push({ conversationId, message }),
      wake: async () => assert.fail('a busy parent takes follow-ups'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const shared = controllableHandle('task-shared-1', {
    parentSessionId: 'conversation-shared',
    type: 'research-analyst',
    artifactRefs: [sharedPageRef, evidenceRef],
  })
  service.register({
    parentConversationId: 'conversation-shared',
    parentPromptId: 'prompt-shared',
    clientRunId: 'client-shared',
    handle: shared.handle,
  })
  shared.complete()

  await waitUntil(() => deliveries.length > 0, 'the completion was dropped over a shared page')
  assert.deepEqual(seenRefs, [[evidenceRef]], 'only the canonical evidence pack may gate the notice')
  assert.match(deliveries[0].message, /task_id: task-shared-1/)
})

test('the parent is not told about evidence it already read with its own read tool', () => {
  const turnWindow = loadBundledModule('electron/runtime/agent/review/turn-window.ts')
  const evidenceRef = '.xiaoliang/cad/evidence/child-read-1/evidence.md'
  const readCall = (id, filePath) => ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'read', arguments: { path: filePath } }],
  })

  assert.equal(turnWindow.hasReadArtifact([readCall('call-1', evidenceRef)], [evidenceRef]), true)
  // Windows-style separators in the call still match a project-relative ref.
  assert.equal(
    turnWindow.hasReadArtifact([readCall('call-1', evidenceRef.replace(/\//gu, '\\'))], [evidenceRef]),
    true,
  )
  // A read that failed leaves the parent without the evidence, so the notice still goes out.
  assert.equal(
    turnWindow.hasReadArtifact(
      [readCall('call-1', evidenceRef), { role: 'toolResult', toolCallId: 'call-1', isError: true }],
      [evidenceRef],
    ),
    false,
  )
  assert.equal(turnWindow.hasReadArtifact([readCall('call-1', 'other/file.md')], [evidenceRef]), false)
  // A shared research page is not a per-run evidence pack, even when the parent really read it.
  const sharedPageRef = '.xiaoliang/research/pages/gonggao.a1b2c3d4e5.md'
  assert.equal(turnWindow.hasReadArtifact([readCall('call-1', sharedPageRef)], [sharedPageRef]), false)
  // Naming the path in prose is not reading it.
  assert.equal(
    turnWindow.hasReadArtifact(
      [{ role: 'assistant', content: [{ type: 'text', text: `稍后读 ${evidenceRef}` }] }],
      [evidenceRef],
    ),
    false,
  )
  assert.equal(turnWindow.hasReadArtifact([readCall('call-1', evidenceRef)], []), false)
  assert.equal(turnWindow.hasReadArtifact(undefined, [evidenceRef]), false)
})

test('an injected child report becomes a transcript notice instead of a user message', () => {
  const injected = completion.buildSubagentCompletionPrompt({
    parentPromptId: 'prompt-notice-1',
    completions: [{
      taskId: 'child-notice-1',
      agentType: 'blender-modeler',
      status: 'completed',
      payload: 'Blender subagent completed and verified the scene.',
    }],
  })

  const notice = completion.parseSubagentCompletionPrompt(injected)
  assert.deepEqual(notice, {
    taskId: 'child-notice-1',
    agentType: 'blender-modeler',
    status: 'completed',
  })
  const described = completion.describeSubagentCompletionNotice(notice)
  assert.match(described, /Blender 子代理已完成/)
  // The payload itself must never reach the transcript.
  assert.doesNotMatch(described, /subagent_completion|parent_prompt_id/)

  // Payloads written before the header carried the child's identity still get a notice.
  const legacy = [
    '[subagent_completion]',
    'task_id: child-legacy-1',
    'parent_prompt_id: prompt-legacy-1',
    '',
    'CAD evidence pack saved.',
  ].join('\n')
  assert.deepEqual(completion.parseSubagentCompletionPrompt(legacy), { taskId: 'child-legacy-1' })

  // Anything the user could plausibly type stays a normal message.
  assert.equal(completion.parseSubagentCompletionPrompt('看看 [subagent_completion] 是什么'), null)
  assert.equal(completion.parseSubagentCompletionPrompt('[subagent_completion]\n没有 task_id'), null)
  assert.equal(completion.SUBAGENT_COMPLETION_CUSTOM_TYPE, 'xiaoliang.subagent_completion')
  assert.deepEqual(completion.parseSubagentCompletionDeliveryDetails({
    taskId: 'child-notice-1',
    parentPromptId: 'prompt-notice-1',
    agentType: 'blender-modeler',
    status: 'completed',
  }), {
    taskId: 'child-notice-1',
    agentType: 'blender-modeler',
    status: 'completed',
  })
  assert.equal(completion.parseSubagentCompletionDeliveryDetails({ taskId: '../bad' }), null)

  const repository = read('electron/runtime/conversations/conversation-repository.ts')
  assert.match(repository, /content: completion \? describeSubagentCompletionNotice\(completion\) : text/)
  assert.match(repository, /host_notice/)
  const bubble = read('src/components/chat/message-bubble.tsx')
  assert.match(bubble, /if \(message\.hostNotice\) \{[\s\S]{0,120}HostNoticeRow/)
})

test('persisted user and host-notice rows reach the transcript before the run settles', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  // Pi persists steering/follow-ups as users and child completions as typed custom messages.
  // Both display projections use the same role-agnostic immediate transcript event.
  assert.match(
    manager,
    /payload\.type === 'message_end' && payload\.message\?\.role === 'user'[\s\S]{0,900}this\.emitPersistedTranscriptMessage\(conversationId/,
  )
  assert.match(
    manager,
    /emitPersistedTranscriptMessage\([\s\S]{0,500}type: 'transcript_message'/,
  )
  const completionDeliveryStart = manager.indexOf(
    'if (projectsFromPiJsonl && isSubagentCompletionMessageEnd',
  )
  const completionDeliveryEnd = manager.indexOf(
    "payload.message?.role === 'assistant'",
    completionDeliveryStart,
  )
  assert.ok(completionDeliveryStart >= 0)
  const completionDelivery = manager.slice(completionDeliveryStart, completionDeliveryEnd)
  assert.match(completionDelivery, /parseSubagentCompletionDeliveryDetails/)
  assert.match(completionDelivery, /emitPersistedTranscriptMessage/)
  assert.match(completionDelivery, /message\.hostNotice\.taskId === completion\.taskId/)
  assert.match(completionDelivery, /scheduleConversation\(conversationId\)/)

  const hook = read('src/hooks/use-local-agent-chat.ts')
  assert.match(
    hook,
    /event\.type === 'transcript_message' && isActive[\s\S]{0,400}applyPersistedTranscriptMessage/,
  )
  assert.match(
    hook,
    /applyPersistedTranscriptMessage[\s\S]{0,500}streaming: applied\.streaming/,
  )

  const {
    applyPersistedTranscriptMessage,
    appendPersistedUserMessage,
    SEALED_STREAM_MESSAGE_PREFIX,
  } = buckets
  const optimistic = {
    id: 'optimistic-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: '继续',
  }
  const persisted = { ...optimistic, id: 'entry-1' }
  assert.deepEqual(appendPersistedUserMessage([optimistic], persisted), [persisted])
  assert.deepEqual(appendPersistedUserMessage([persisted], persisted), [persisted])
  const injected = { ...persisted, id: 'entry-2', content: '换个思路' }
  assert.deepEqual(
    appendPersistedUserMessage([persisted], injected),
    [persisted, injected],
  )

  const emptyStreaming = { isStreaming: true, isThinking: false, parts: [], attachments: [] }
  assert.deepEqual(
    applyPersistedTranscriptMessage([optimistic], persisted, emptyStreaming),
    { messages: [persisted], streaming: emptyStreaming },
  )

  const liveStreaming = {
    isStreaming: true,
    isThinking: false,
    parts: [
      { id: 'think-1', type: 'thinking', content: 'Who are you?', contentIndex: 0 },
      { id: 'text-1', type: 'text', content: 'I am the assistant.', contentIndex: 0 },
      {
        id: 'tool-1',
        type: 'tool',
        toolCall: {
          id: 'call-1',
          name: 'lookup',
          args: '{}',
          result: 'ok',
          output: '',
          startedAt: 1,
          status: 'done',
        },
      },
    ],
    attachments: [],
  }
  const queued = {
    id: 'entry-follow-up',
    conversationId: 'conversation-1',
    role: 'user',
    content: '你好',
  }
  const sealed = applyPersistedTranscriptMessage([persisted], queued, liveStreaming)
  assert.equal(sealed.messages.length, 3)
  assert.equal(sealed.messages[0], persisted)
  assert.equal(sealed.messages[1].role, 'assistant')
  assert.ok(String(sealed.messages[1].id).startsWith(SEALED_STREAM_MESSAGE_PREFIX))
  assert.equal(sealed.messages[1].content, 'I am the assistant.')
  assert.equal(sealed.messages[1].thinking, 'Who are you?')
  assert.deepEqual(sealed.messages[1].parts, [
    { type: 'thinking', content: 'Who are you?' },
    { type: 'text', content: 'I am the assistant.' },
    { type: 'tool', toolCallId: 'call-1', name: 'lookup', args: '{}', result: 'ok' },
  ])
  assert.equal(sealed.messages[2], queued)
  assert.deepEqual(sealed.streaming.parts, [])
  assert.equal(sealed.streaming.isStreaming, true)
  assert.notEqual(sealed.streaming, liveStreaming)

  const alreadySealed = {
    id: 'assistant-1',
    conversationId: 'conversation-1',
    role: 'assistant',
    content: 'I am the assistant.',
  }
  const afterPersistedAssistant = applyPersistedTranscriptMessage(
    [persisted, alreadySealed],
    queued,
    liveStreaming,
  )
  assert.deepEqual(afterPersistedAssistant.messages, [persisted, alreadySealed, queued])
  assert.deepEqual(afterPersistedAssistant.streaming.parts, [])
  assert.equal(afterPersistedAssistant.streaming.isStreaming, true)

  const notice = {
    id: 'pi:session-1:custom-entry-1',
    conversationId: 'conversation-1',
    role: 'user',
    hostNotice: {
      kind: 'subagent_completion',
      taskId: 'child-notice-1',
      agentType: 'blender-modeler',
      status: 'completed',
    },
    content: 'Blender 子代理已完成，执行报告已注入上下文',
  }
  const noticeDuringStream = applyPersistedTranscriptMessage(
    [persisted],
    notice,
    liveStreaming,
  )
  assert.equal(noticeDuringStream.messages.length, 3)
  assert.equal(noticeDuringStream.messages[1].role, 'assistant')
  assert.equal(noticeDuringStream.messages[2], notice)
  assert.deepEqual(noticeDuringStream.streaming.parts, [])

  // A host notice is not a user echo even though its display projection uses role=user.
  // It must never replace an optimistic user row with coincidentally identical text.
  const sameTextOptimistic = {
    ...optimistic,
    id: 'optimistic-same-as-notice',
    content: notice.content,
  }
  const noticeAfterSameText = applyPersistedTranscriptMessage(
    [sameTextOptimistic],
    notice,
    emptyStreaming,
  )
  assert.deepEqual(noticeAfterSameText.messages, [sameTextOptimistic, notice])
  assert.equal(
    applyPersistedTranscriptMessage(
      noticeAfterSameText.messages,
      notice,
      emptyStreaming,
    ).messages.length,
    2,
  )
})

test('completion during a non-streaming parent operation is retried as a wake', async () => {
  let parentPhase = 'compact'
  let followUps = 0
  let wakeAttempts = 0
  let wakes = 0
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => parentPhase === 'prompt',
      followUp: async () => { followUps += 1 },
      wake: async () => {
        wakeAttempts += 1
        if (parentPhase !== 'idle') throw new Error('parent operation is still active')
        wakes += 1
      },
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const controlled = controllableHandle('task-during-compact')
  service.register({
    parentConversationId: 'conversation-compact',
    parentPromptId: 'prompt-before-compact',
    clientRunId: 'client-before-compact',
    handle: controlled.handle,
  })

  controlled.complete()
  await waitUntil(() => wakeAttempts === 1, 'completion did not attempt a deferred wake')
  assert.equal(followUps, 0)
  assert.equal(wakes, 0)

  parentPhase = 'idle'
  service.flushPendingDeliveries('conversation-compact')
  await waitUntil(() => wakes === 1, 'completion was not woken after compaction')
  assert.equal(wakeAttempts, 2)

  const status = await service.wait({
    parentConversationId: 'conversation-compact',
    taskIds: ['task-during-compact'],
  })
  assert.equal(status.tasks[0].delivered, true)
})

test('implicit task status queries bound the completed tail without applying the explicit id limit', async () => {
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => undefined,
      wake: async () => undefined,
    },
    schedule: () => undefined,
  })
  const controls = Array.from({ length: 33 }, (_, index) => (
    controllableHandle(`task-${String(index + 1).padStart(2, '0')}`)
  ))
  for (const controlled of controls) {
    service.register({
      parentConversationId: 'conversation-many',
      parentPromptId: 'prompt-many',
      clientRunId: 'client-many',
      handle: controlled.handle,
    })
    controlled.complete()
  }
  await new Promise((resolve) => setImmediate(resolve))

  const implicit = await service.wait({ parentConversationId: 'conversation-many' })
  assert.equal(implicit.tasks.length, background.MAX_SUBAGENT_TASK_IDS)
  assert.equal(implicit.tasks[0].taskId, 'task-02')
  assert.equal(implicit.tasks.at(-1).taskId, 'task-33')
  await assert.rejects(
    service.wait({
      parentConversationId: 'conversation-many',
      taskIds: controls.map((controlled) => controlled.handle.childRunId),
    }),
    /accepts 1 to 32 task ids/,
  )
})

test('completed-task retention evicts consumed entries before pending deliveries', async () => {
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => undefined,
      wake: async () => undefined,
    },
    completedTaskRetention: 1,
    schedule: () => undefined,
  })
  const pending = controllableHandle('task-pending')
  const consumed = controllableHandle('task-consumed')
  for (const controlled of [pending, consumed]) {
    service.register({
      parentConversationId: 'conversation-retention',
      parentPromptId: 'prompt-retention',
      clientRunId: 'client-retention',
      handle: controlled.handle,
    })
    controlled.complete()
  }
  await new Promise((resolve) => setImmediate(resolve))

  const consumedResult = await service.wait({
    parentConversationId: 'conversation-retention',
    taskIds: ['task-consumed'],
    timeoutMs: 1,
  })
  assert.equal(consumedResult.tasks[0].delivered, true)

  const pendingResult = await service.wait({
    parentConversationId: 'conversation-retention',
    taskIds: ['task-pending'],
  })
  assert.equal(pendingResult.tasks[0].delivered, false)
  await assert.rejects(
    service.wait({
      parentConversationId: 'conversation-retention',
      taskIds: ['task-consumed'],
    }),
    /Unknown subagent task/,
  )
})

test('timed-out waits remain deliverable, while explicit parent cancellation suppresses delivery', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const timedOut = controllableHandle('task-timeout')
  service.register({
    parentConversationId: 'conversation-1',
    parentPromptId: 'prompt-1',
    clientRunId: 'client-1',
    handle: timedOut.handle,
  })
  const timeoutResult = await service.wait({
    parentConversationId: 'conversation-1',
    taskIds: ['task-timeout'],
    timeoutMs: 1,
  })
  assert.equal(timeoutResult.timedOut, true)
  timedOut.complete()
  await waitUntil(() => deliveries.length === 1, 'timed-out task was not delivered later')

  const suppressed = controllableHandle('task-suppressed')
  service.register({
    parentConversationId: 'conversation-1',
    parentPromptId: 'prompt-2',
    clientRunId: 'client-2',
    handle: suppressed.handle,
  })
  assert.equal(service.suppressByParent('conversation-1', 'prompt-2'), 1)
  suppressed.complete()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(deliveries, ['wake'])
})

test('restart-orphan notices are emitted and persisted exactly once', async () => {
  const consumed = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => undefined,
      wake: async () => undefined,
    },
    runStore: {
      markOrphanNoticeConsumed: async (taskId) => consumed.push(taskId),
    },
  })
  const restored = await service.restoreRestartedTasks([{
    child_run_id: 'task-orphan',
    type: 'blender-modeler',
    description: 'orphaned task',
    parent_session_id: 'conversation-orphan',
    parent_prompt_id: 'prompt-orphan',
    client_run_id: 'client-orphan',
    project_id: 'project-orphan',
    model: 'xiaoliang-backend/qwen3.8-max',
    status: 'failed',
    started_at: '2026-08-13T00:00:00.000Z',
    finished_at: '2026-08-13T00:00:01.000Z',
    usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 },
    tool_call_count: 0,
    artifact_refs: [],
    error_code: 'HOST_RESTARTED',
    orphan_notice_consumed: false,
  }])
  assert.equal(restored, 1)
  assert.deepEqual(await service.takeRestartedTaskNotices('conversation-orphan'), ['task-orphan'])
  assert.deepEqual(await service.takeRestartedTaskNotices('conversation-orphan'), [])
  assert.deepEqual(consumed, ['task-orphan'])
})

test('SQLite metadata identifies only unconsumed restart notices without starting the runtime', () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-subagent-notices-'))
  const repository = loadSubagentRepository(userDataDir)
  const metadataIndex = repository.createSqliteSubagentRunMetadataIndex()
  const run = {
    schema_version: 1,
    trace_schema_version: 1,
    child_run_id: 'task-sqlite-orphan',
    type: 'blender-modeler',
    parent_session_id: 'conversation-sqlite-orphan',
    parent_prompt_id: 'prompt-sqlite-orphan',
    client_run_id: 'client-sqlite-orphan',
    project_id: 'project-sqlite-orphan',
    model: 'xiaoliang-backend/qwen3.8-max',
    description: 'orphaned task',
    task_preview: 'orphaned task',
    task_sha256: '0'.repeat(64),
    thinking_mode: 'fast',
    status: 'running',
    started_at: '2026-08-13T00:00:00.000Z',
    finished_at: null,
    usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 },
    tool_call_count: 0,
    artifact_refs: [],
    error_code: null,
    orphan_notice_consumed: false,
    trace_event_count: 1,
    trace_last_sequence: 1,
    trace_sha256: null,
    trace_size_bytes: 0,
    trace_compressed: false,
    upload_status: 'pending',
    remote_storage_key: null,
    uploaded_at: null,
    upload_error: null,
  }
  try {
    metadataIndex.upsert(run)
    assert.equal(
      repository.hasPendingRestartedSubagentTaskNotices(run.parent_session_id),
      true,
    )

    metadataIndex.upsert({
      ...run,
      status: 'failed',
      finished_at: '2026-08-13T00:00:01.000Z',
      error_code: 'HOST_RESTARTED',
    })
    assert.equal(
      repository.hasPendingRestartedSubagentTaskNotices(run.parent_session_id),
      true,
    )

    metadataIndex.upsert({
      ...run,
      status: 'failed',
      finished_at: '2026-08-13T00:00:01.000Z',
      error_code: 'HOST_RESTARTED',
      orphan_notice_consumed: true,
    })
    assert.equal(
      repository.hasPendingRestartedSubagentTaskNotices(run.parent_session_id),
      false,
    )
  } finally {
    repository.closeDB()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('agent conversation capacity admits three runs and rejects the fourth with a stable code', () => {
  assert.equal(concurrency.MAX_ACTIVE_AGENT_CONVERSATIONS, 3)
  assert.doesNotThrow(() => concurrency.assertAgentConversationCapacity(2))
  assert.throws(
    () => concurrency.assertAgentConversationCapacity(3),
    (error) => error.status === 409
      && error.code === 'agent_conversation_limit'
      && /已有 3 个会话在运行/.test(error.message),
  )
})

test('synthetic subagent completion wake is billed as a distinct run source', () => {
  assert.equal(runSource.toAgentRunSource('subagent_completion'), 'subagent_completion')
  assert.equal(runSource.toAgentRunSource('user'), 'desktop_chat')
  assert.equal(runSource.toAgentRunSource(undefined), 'desktop_chat')
})

test('synthetic wake notifications are deduplicated by task id exactly once', () => {
  const deduplicator = new notificationDeduplication.AgentNotificationDeduplicator(2)

  deduplicator.markSubagentCompletionNotified('task-a')
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-b'), false)
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-a'), true)
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-a'), false)

  deduplicator.markSubagentCompletionNotified('task-a')
  deduplicator.markSubagentCompletionNotified('task-b')
  deduplicator.markSubagentCompletionNotified('task-c')
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-a'), false)
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-b'), true)
  assert.equal(deduplicator.consumeSubagentWakeDuplicate('task-c'), true)
})

test('a queued user message releases the blocking wait without consuming the task', async () => {
  const deliveries = []
  const interjected = deferred()
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const controlled = controllableHandle('task-interject')
  service.register({
    parentConversationId: 'conversation-interject',
    parentPromptId: 'prompt-interject',
    clientRunId: 'client-interject',
    handle: controlled.handle,
  })

  const waiting = service.wait({
    parentConversationId: 'conversation-interject',
    taskIds: ['task-interject'],
    timeoutMs: 60_000,
    interrupt: () => interjected.promise,
  })
  interjected.resolve()
  const yielded = await waiting

  assert.equal(yielded.yielded, 'user_message')
  assert.equal(yielded.timedOut, false)
  assert.equal(yielded.tasks[0].terminal, false)
  assert.equal(yielded.tasks[0].delivered, false)

  // The task keeps running and its completion still reaches the parent.
  controlled.complete()
  await waitUntil(() => deliveries.length === 1, 'yielded task was not delivered after completion')
  assert.deepEqual(deliveries, ['wake'])
})

test('an aborted run releases the wait and leaves the terminal result for injection', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const controlled = controllableHandle('task-abort')
  service.register({
    parentConversationId: 'conversation-abort',
    parentPromptId: 'prompt-abort',
    clientRunId: 'client-abort',
    handle: controlled.handle,
  })

  const controller = new AbortController()
  const waiting = service.wait({
    parentConversationId: 'conversation-abort',
    taskIds: ['task-abort'],
    timeoutMs: 60_000,
    signal: controller.signal,
  })
  controller.abort()
  const yielded = await waiting
  assert.equal(yielded.yielded, 'aborted')
  assert.equal(yielded.tasks[0].delivered, false)

  const preAborted = await service.wait({
    parentConversationId: 'conversation-abort',
    taskIds: ['task-abort'],
    timeoutMs: 60_000,
    signal: AbortSignal.abort(),
  })
  assert.equal(preAborted.yielded, 'aborted')

  controlled.complete()
  await waitUntil(() => deliveries.length === 1, 'aborted wait suppressed the completion injection')
})

test('an aborted run never consumes a terminal result that was already waiting', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: () => undefined,
    wakeGraceMs: 0,
  })
  const controlled = controllableHandle('task-abort-late')
  service.register({
    parentConversationId: 'conversation-abort-late',
    parentPromptId: 'prompt-abort-late',
    clientRunId: 'client-abort-late',
    handle: controlled.handle,
  })
  controlled.complete()
  await new Promise((resolve) => setImmediate(resolve))

  const aborted = await service.wait({
    parentConversationId: 'conversation-abort-late',
    taskIds: ['task-abort-late'],
    timeoutMs: 60_000,
    signal: AbortSignal.abort(),
  })
  assert.equal(aborted.yielded, 'aborted')
  assert.equal(aborted.tasks[0].terminal, true)
  assert.equal(aborted.tasks[0].delivered, false)
})

test('a terminal result that lands with an interjection is consumed instead of injected twice', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    wakeGraceMs: 0,
  })
  const controlled = controllableHandle('task-both')
  service.register({
    parentConversationId: 'conversation-both',
    parentPromptId: 'prompt-both',
    clientRunId: 'client-both',
    handle: controlled.handle,
  })

  const interjected = deferred()
  const waiting = service.wait({
    parentConversationId: 'conversation-both',
    taskIds: ['task-both'],
    timeoutMs: 60_000,
    interrupt: () => interjected.promise,
  })
  controlled.complete()
  interjected.resolve()
  const settled = await waiting

  assert.equal(settled.yielded, undefined)
  assert.equal(settled.tasks[0].terminal, true)
  assert.equal(settled.tasks[0].delivered, true)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(deliveries, [])
})

test('the idle wake grace period lets a user who sends first absorb the completion', async () => {
  const deliveries = []
  let parentBusy = false
  const delays = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => parentBusy,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    delay: (ms) => {
      delays.push(ms)
      // The user starts their turn while the grace period is still running.
      parentBusy = true
      return Promise.resolve()
    },
  })
  const controlled = controllableHandle('task-grace')
  service.register({
    parentConversationId: 'conversation-grace',
    parentPromptId: 'prompt-grace',
    clientRunId: 'client-grace',
    handle: controlled.handle,
  })
  controlled.complete()

  await waitUntil(() => deliveries.length === 1, 'graced completion was never delivered')
  assert.deepEqual(deliveries, ['followUp'])
  assert.deepEqual(delays, [background.DEFAULT_SUBAGENT_WAKE_GRACE_MS])
})

test('a conversation that stays idle through the grace period is woken as usual', async () => {
  const deliveries = []
  const service = new background.SubagentTaskService({
    delivery: {
      parentExists: () => true,
      isParentBusy: () => false,
      followUp: async () => deliveries.push('followUp'),
      wake: async () => deliveries.push('wake'),
    },
    schedule: (callback) => setImmediate(callback),
    delay: () => Promise.resolve(),
  })
  const controlled = controllableHandle('task-still-idle')
  service.register({
    parentConversationId: 'conversation-still-idle',
    parentPromptId: 'prompt-still-idle',
    clientRunId: 'client-still-idle',
    handle: controlled.handle,
  })
  controlled.complete()

  await waitUntil(() => deliveries.length === 1, 'idle completion was never woken')
  assert.deepEqual(deliveries, ['wake'])
})

test('stopping the main turn keeps the sidebar showing the still-running child', () => {
  const running = activeSnapshot('child-running', {
    type: 'cad-analyst',
    parentSessionId: 'conversation-stop',
    status: 'running',
  })
  const options = { isActive: true, createPartId: () => 'unused' }
  let bucket = buckets.createConversationRuntimeBucket()
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'agent_start',
    conversationId: 'conversation-stop',
    supportsQueueing: true,
  }, options)
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'subagent_run',
    conversationId: 'conversation-stop',
    update: running,
    updates: [running],
  }, options)
  bucket = buckets.reduceConversationRuntimeEvent(bucket, {
    type: 'agent_settled',
    conversationId: 'conversation-stop',
  }, options)

  assert.equal(bucket.isAgentRunning, false)
  assert.equal(bucket.runStatus, 'running')
  assert.equal(bucket.subagentRuns.filter(buckets.isActiveSubagentRun).length, 1)
})

test('interactive delegation flips the prompt default between ending the turn and blocking', () => {
  const previous = process.env.XIAOLIANG_SUBAGENT_INTERACTIVE
  const toolNames = ['delegate_cad', 'delegate_blender', 'subagent_task_status']
  try {
    process.env.XIAOLIANG_SUBAGENT_INTERACTIVE = 'on'
    const interactive = {
      coreRole: coreRoleSection.buildCoreRoleSection(toolNames),
      delegation: delegationSection.buildDelegationSection(toolNames),
      tooling: toolingSection.buildToolingSection(toolNames),
    }
    assert.match(interactive.coreRole, /结束当前回合/)
    assert.doesNotMatch(interactive.coreRole, /立即调用 subagent_task_status\(timeoutMs>0\) 阻塞等待/)
    assert.match(interactive.delegation, /结束本回合/)
    assert.match(interactive.delegation, /yielded=user_message/)
    assert.match(interactive.delegation, /跨回合执行/)
    assert.match(interactive.tooling, /不要默认守在 subagent_task_status 上等待/)

    process.env.XIAOLIANG_SUBAGENT_INTERACTIVE = 'off'
    const blocking = {
      coreRole: coreRoleSection.buildCoreRoleSection(toolNames),
      delegation: delegationSection.buildDelegationSection(toolNames),
      tooling: toolingSection.buildToolingSection(toolNames),
    }
    assert.match(blocking.coreRole, /立即调用 subagent_task_status\(timeoutMs>0\) 阻塞等待/)
    assert.match(blocking.delegation, /没有其他独立工作可做时，立刻调用/)
    assert.doesNotMatch(blocking.delegation, /yielded=user_message/)
    assert.match(blocking.tooling, /无独立并行工作时立即调用/)
  } finally {
    if (previous === undefined) delete process.env.XIAOLIANG_SUBAGENT_INTERACTIVE
    else process.env.XIAOLIANG_SUBAGENT_INTERACTIVE = previous
  }
})

test('stopping a conversation spares background children unless the caller asks for all', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const contract = read('src/shared/ipc-contract.ts')

  const stopStart = manager.indexOf('async stopConversation(')
  const stopEnd = manager.indexOf('abortConversationCompaction(', stopStart)
  const stop = manager.slice(stopStart, stopEnd)
  assert.match(stop, /options\.includeSubagents \?\? !this\.subagentInteractiveEnabled/)
  assert.match(stop, /if \(cancelSubagents\) \{\s*await this\.cancelSubagentRuns\(conversationId\)/)

  // Destructive lifecycle transitions must still take the children down with them.
  const resetStart = manager.indexOf('async resetConversation(')
  const reset = manager.slice(resetStart, resetStart + 900)
  assert.match(reset, /cancelSubagentRuns/)

  assert.match(handlers, /scope: AgentStopScope = 'main'[\s\S]*?includeSubagents: scope === 'all'/)
  assert.match(handlers, /AGENT_CANCEL_SUBAGENTS[\s\S]*?cancelConversationSubagents/)
  assert.match(contract, /AGENT_CANCEL_SUBAGENTS: 'agent:cancelSubagents'/)

  // A stopped parent run now routinely outlives its children, so the usage run must
  // stay open until they settle rather than finishing on the stop path.
  const deferStart = manager.indexOf('const usageFinishDeferred = Boolean(')
  const defer = manager.slice(deferStart, manager.indexOf('}', manager.indexOf('if (!usageFinishDeferred)', deferStart)))
  assert.match(defer, /completeSubagentUsageRunWhenChildrenSettle\(\s*subagentUsageRuntime,\s*clientRunId,\s*finishUsageRun,/)
  assert.doesNotMatch(defer, /finishStatus/)
})

test('the blocking status tool forwards the abort signal and the parent steering observer', () => {
  const delegate = read('electron/runtime/agent/tools/domain/delegate/index.ts')
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const host = read('electron/runtime/agent/pi/xiaoliang-pi-agent-host.ts')

  const statusToolStart = delegate.indexOf("name: 'subagent_task_status'")
  assert.notEqual(statusToolStart, -1)
  const statusTool = delegate.slice(statusToolStart)
  assert.match(statusTool, /execute: async \(_toolCallId, params, signal\) => \{/)
  assert.match(statusTool, /interrupt: options\.observeParentUserMessage/)
  assert.match(statusTool, /\.\.\.\(signal \? \{ signal \} : \{\}\)/)

  assert.match(manager, /observeParentUserMessage: async \(signal\)[\s\S]*?waitForSteeringMessage\(signal\)/)
  // Follow-ups are meant to wait their turn, so only steering releases the wait.
  assert.match(host, /event\.type === 'queue_update'[\s\S]*?event\.steering\.length > 0/)
  assert.match(host, /waitForSteeringMessage\(signal\?: AbortSignal\)/)
})

test('session delivery, lazy orphan restore, and completion notification contracts stay explicit', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const sidebar = read('src/components/layout/workspace-sidebar.tsx')
  const repository = read('electron/runtime/agent/subagents/subagent-run-repository.ts')
  const schema = read('electron/runtime/db/schema.ts')

  const deliveryStart = manager.indexOf('backgroundTaskDelivery:')
  const deliveryEnd = manager.indexOf('cadHttpRuntime:', deliveryStart)
  const delivery = manager.slice(deliveryStart, deliveryEnd)
  assert.match(delivery, /isParentBusy:[\s\S]*?piHost\?\.isRunning === true/)
  // An accepted prompt rejects a second sendPrompt before streaming starts, so the wake
  // path must treat it as busy and inject as a follow-up instead.
  assert.match(delivery, /isParentBusy:[\s\S]*?activePromptConversations\.has\(conversationId\)/)
  assert.doesNotMatch(delivery, /piHost\?\.isBusy/)
  assert.match(delivery, /host\.followUpSystemMessage\(\{[\s\S]*?SUBAGENT_COMPLETION_CUSTOM_TYPE/)
  assert.doesNotMatch(delivery, /host\.followUp\(message\)/)

  const sendPromptStart = manager.indexOf('async sendPrompt(')
  const sendPrompt = manager.slice(sendPromptStart)
  assert.match(sendPrompt, /creationSource === 'subagent_completion'[\s\S]*?promptSystemMessage\(\{/)

  const getMessagesStart = manager.indexOf('async getMessages(')
  const getMessagesEnd = manager.indexOf('getConversationSessionInfo(', getMessagesStart)
  const getMessages = manager.slice(getMessagesStart, getMessagesEnd)
  assert.match(getMessages, /hasPendingRestartedSubagentTaskNotices/)
  assert.match(getMessages, /shouldRestoreTaskNotices[\s\S]*?\? await this\.getSubagentRuntime\(\)/)

  assert.match(handlers, /isPromptSettlementRefresh[\s\S]*?event\.promptSettled === true/)
  assert.match(sidebar, /event\.type === 'messages_updated' && event\.promptSettled === true/)
  assert.match(repository, /hasPendingRestartedSubagentTaskNotices/)
  assert.match(schema, /orphan_notice_consumed\s+INTEGER NOT NULL DEFAULT 0/)
})
