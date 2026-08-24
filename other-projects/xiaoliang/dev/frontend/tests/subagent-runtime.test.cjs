const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
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
    alias: { electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs') },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const subagents = loadBundledModule('electron/runtime/agent/subagents/index.ts')
const cadProjectFiles = loadBundledModule(
  'electron/runtime/agent/tools/domain/cad-subagent/project-files.ts',
)

const definitionsDir = path.resolve(
  __dirname,
  '..',
  'electron',
  'runtime',
  'agent',
  'subagents',
  'definitions',
)

function usage(input, output, cacheRead = 0, cacheWrite = 0, cost = 0) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  }
}

function request(childRunId, projectRoot, overrides = {}) {
  return {
    childRunId,
    type: 'cad-analyst',
    task: '在结构/地下室.dwg 中定位 3 号节点并核验墙厚，只收集证据。',
    description: 'Collecting isolated CAD evidence',
    parentSessionId: 'session-runtime',
    parentPromptId: 'prompt-runtime',
    clientRunId: 'client-runtime',
    projectId: 'project-runtime',
    projectRoot,
    model: 'xiaoliang-backend/qwen3.8-max',
    thinkingMode: 'fast',
    spawnDepth: 0,
    ...overrides,
  }
}

function dummyChildTools() {
  return subagents.CAD_ANALYST_TOOL_CEILING.map((name) => ({
    name,
    label: name,
    description: `${name} fake`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: 'unused' }], details: {} }),
  }))
}

function dummyDrafterTools() {
  return subagents.CAD_DRAFTER_TOOL_CEILING.map((name) => ({
    name,
    label: name,
    description: `${name} fake`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: 'unused' }], details: {} }),
  }))
}

function dummyBlenderTools() {
  return subagents.BLENDER_MODELER_TOOL_CEILING.map((name) => ({
    name,
    label: name,
    description: `${name} fake`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: 'unused' }], details: {} }),
  }))
}

function createEvidenceBody(imageRef) {
  return [
    '## 目标定位',
    '- 图纸：结构/地下室.dwg；区域：frame-01 / q2；handle=A12。',
    '',
    '## 图片证据',
    `- [IMG-001] \`${imageRef}\`，字面可见节点标题与两侧墙线。`,
    '',
    '## 实体与文件摘录',
    '- [ENT-001] handle=A12，type=DIMENSION，measurement=200，layer=S-DIM。',
    '',
    '## 限制与未采用材料',
    '- q4 与目标不在同一区域，未采用。',
  ].join('\n')
}

function createScriptedAgentFactory(input) {
  const {
    evidenceBody,
    imageRef,
    captured,
    stall = false,
    toolDetails = { artifact_refs: [imageRef] },
  } = input
  return (options) => {
    captured.options = options
    const listeners = []
    let rejectPrompt = null
    const state = {
      ...options.initialState,
      messages: [...(options.initialState.messages || [])],
      isStreaming: false,
      pendingToolCalls: new Set(),
      errorMessage: undefined,
    }
    const emit = async (event) => {
      for (const listener of listeners) await listener(event, new AbortController().signal)
    }
    return {
      state,
      subscribe(listener) {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      abort() {
        rejectPrompt?.(new Error('fake agent aborted'))
      },
      async prompt(promptText) {
        captured.prompt = promptText
        captured.apiKey = await options.getApiKey('xiaoliang-backend')
        captured.payload = await options.onPayload({
          model: 'xiaoliang-agent-default',
          thinking_budget: 999,
          preserve_thinking: false,
        }, options.initialState.model)

        if (stall) {
          return new Promise((resolve, reject) => {
            rejectPrompt = reject
          })
        }

        const userMessage = { role: 'user', content: promptText, timestamp: Date.now() }
        const toolAssistant = {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'cad_artifacts', arguments: { action: 'list' } }],
          api: 'openai-completions',
          provider: 'xiaoliang-backend',
          model: 'xiaoliang-agent-default',
          usage: usage(10, 2, 1, 0, 0.1),
          stopReason: 'toolUse',
          timestamp: Date.now(),
        }
        const toolResult = {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'cad_artifacts',
          content: [{ type: 'text', text: 'PARENT_CANARY_MUST_NOT_ESCAPE data:image/png;base64,AAAA' }],
          details: toolDetails,
          isError: false,
          timestamp: Date.now(),
        }
        const finalAssistant = {
          role: 'assistant',
          content: [{ type: 'text', text: evidenceBody }],
          api: 'openai-completions',
          provider: 'xiaoliang-backend',
          model: 'xiaoliang-agent-default',
          usage: usage(20, 8, 2, 0, 0.2),
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        state.messages.push(userMessage)
        await emit({ type: 'agent_start' })
        await emit({ type: 'turn_start' })
        await emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '正在定位目标区域…' },
        })
        state.messages.push(toolAssistant)
        await emit({ type: 'message_end', message: toolAssistant })
        await emit({
          type: 'tool_execution_start',
          toolCallId: 'tool-1',
          toolName: 'cad_artifacts',
          args: { absolute_path: 'C:\\private\\must-not-be-stored' },
        })
        await emit({
          type: 'tool_execution_update',
          toolCallId: 'tool-1',
          toolName: 'cad_artifacts',
          partialResult: { content: [{ type: 'text', text: '已扫描 1 个候选构件' }] },
        })
        state.messages.push(toolResult)
        await emit({
          type: 'tool_execution_end',
          toolCallId: 'tool-1',
          toolName: 'cad_artifacts',
          result: { content: toolResult.content, details: toolResult.details },
          isError: false,
        })
        await emit({ type: 'turn_end', message: toolAssistant, toolResults: [toolResult] })
        await emit({ type: 'turn_start' })
        state.messages.push(finalAssistant)
        await emit({ type: 'message_end', message: finalAssistant })
        await emit({ type: 'turn_end', message: finalAssistant, toolResults: [] })
        await emit({ type: 'agent_end', messages: [...state.messages] })
      },
      async continue() {},
    }
  }
}

function createBlenderScriptedAgentFactory(captured) {
  return (options) => {
    captured.options = options
    const listeners = []
    const state = {
      ...options.initialState,
      messages: [...(options.initialState.messages || [])],
      isStreaming: false,
      pendingToolCalls: new Set(),
      errorMessage: undefined,
    }
    const emit = async (event) => {
      for (const listener of listeners) await listener(event, new AbortController().signal)
    }
    return {
      state,
      subscribe(listener) {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      abort() {},
      async prompt(promptText) {
        captured.prompt = promptText
        captured.apiKey = await options.getApiKey('xiaoliang-backend')
        captured.payload = await options.onPayload({}, options.initialState.model)
        const userMessage = { role: 'user', content: promptText, timestamp: Date.now() }
        const finalAssistant = {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Created XL_Wall at the requested dimensions, preserved Camera, verified the final viewport screenshot, and saved a backup to C:\\Users\\operator\\AppData\\Local\\Temp\\guardhouse.blend.',
          }],
          api: 'openai-completions',
          provider: 'xiaoliang-backend',
          model: 'xiaoliang-agent-default',
          usage: usage(14, 6, 0, 0, 0.12),
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        state.messages.push(userMessage)
        await emit({ type: 'agent_start' })
        await emit({ type: 'turn_start' })
        state.messages.push(finalAssistant)
        await emit({ type: 'message_end', message: finalAssistant })
        await emit({ type: 'turn_end', message: finalAssistant, toolResults: [] })
        await emit({ type: 'agent_end', messages: [...state.messages] })
      },
      async continue() {},
    }
  }
}

function createProjectFixture(prefix = 'xl-subagent-runtime-') {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const projectRoot = path.join(fixtureRoot, 'project')
  const runStoreRoot = path.join(fixtureRoot, 'private-runs')
  const imageRef = '.xiaoliang/cad/previews/drawing/details/detail-a.png'
  const imagePath = path.join(projectRoot, ...imageRef.split('/'))
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return { fixtureRoot, projectRoot, runStoreRoot, imageRef }
}

test('CAD query safety ceiling does not downshift explicit components for speed', () => {
  assert.equal(subagents.cadQueryCallBudget('看看独立基础 10 的做法和尺寸'), 3)
  assert.equal(subagents.cadQueryCallBudget('复核 DJP10 配筋'), 3)
  assert.equal(subagents.cadQueryCallBudget('统计所有图层和实体类型'), 3)
})

test('cad_search resolves aliases and nearby entities entirely from local JSONL', async () => {
  const fixture = createProjectFixture('xl-cad-local-search-')
  const relativePath = '.xiaoliang/cad/drawings/demo/entities/entities.raw.jsonl'
  const absolutePath = path.join(fixture.projectRoot, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, [
    { handle: 'A1', type: 'mtext', layer: '独基集中标注', bbox: { min: [100, 100], max: [120, 120] }, content_clean: 'DJP10,300/600' },
    { handle: 'A2', type: 'dimension', layer: '尺寸', bbox: { min: [130, 100], max: [180, 120] }, measurement: 4400 },
    { handle: 'A3', type: 'lwpolyline', layer: '独立基础', bbox: { min: [80, 80], max: [220, 220] }, closed: true, area: 19_360_000 },
    { handle: 'A4', type: 'dimension', layer: '尺寸', bbox: { min: [10_000, 10_000], max: [10_100, 10_100] }, measurement: 9000 },
    { handle: 'FRAME', type: 'lwpolyline', layer: '图框', bbox: { min: [-10_000, -10_000], max: [10_000, 10_000] }, closed: true },
    { handle: 'OTHER', type: 'text', layer: '邻区', bbox: { min: [450, 450], max: [470, 470] }, content_clean: '相邻但不连通的说明' },
  ].map((item) => JSON.stringify(item)).join('\n'), 'utf8')

  try {
    const tool = cadProjectFiles
      .buildCadSubagentProjectFileTools(fixture.projectRoot)
      .find((item) => item.name === 'cad_search')
    assert.ok(tool)
    const result = await tool.execute('local-search-1', {
      path: relativePath,
      terms: ['DJP10', 'DJ10'],
      radius: 500,
      max_nearby: 20,
    })
    const text = result.content.find((item) => item.type === 'text').text
    assert.match(text, /"handle":"A1"/)
    assert.match(text, /"handle":"A2"/)
    assert.match(text, /"measurement":4400/)
    assert.match(text, /"handle":"A3"/)
    assert.doesNotMatch(text, /"handle":"A4"/)
    assert.match(text, /Suggested complete-detail window \(oversized frames excluded\)/)
    assert.match(text, /Substring matches/)
    assert.equal(result.details.match_count, 1)
    assert.deepEqual(result.details.matched_fields, ['content_clean'])
    assert.equal(result.details.quantity_kind, 'text_frequency')
    assert.equal(result.details.nearby_count, 4)
    assert.deepEqual(result.details.suggested_detail_window, {
      min: [80, 80],
      max: [220, 220],
    })
    assert.deepEqual(result.details.coverage_handles, {
      matches: ['A1'],
      annotations: [],
      dimensions: ['A2'],
      geometry: ['A3'],
    })
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('CAD analyst keeps the single-component path bounded and stops after one verified detail', () => {
  const definition = fs.readFileSync(path.join(definitionsDir, 'cad-analyst.md'), 'utf8')
  assert.match(definition, /工具调用数量本身不是成果/)
  assert.match(definition, /单构件正常快路径是硬上限/)
  assert.match(definition, /`cad_extract → 一次精确 cad_search → 一次 cad_detail → 一次 read → 立即收尾`/)
  assert.match(definition, /`max_matches<=12`、`max_nearby<=32`/)
  assert.match(definition, /不得先于 `cad_search` 调用/)
  assert.doesNotMatch(definition, /cad_facts|cad_ask|cad_lookup/)
  assert.match(definition, /三类均已完整时立即停止图片调用/)
  assert.match(definition, /主体几何、回答所依赖的关键尺寸链、标题\/编号/)
  assert.match(definition, /只截到标题、图例文字或孤立尺寸时属于局部导航图/)
  assert.match(definition, /不得改用 `cad_capture action=plot`/)
})

test('CAD runtime definitions keep four-layer facts off both evidence paths', () => {
  for (const filename of ['cad-analyst.md', 'cad-drafter.md']) {
    const definition = fs.readFileSync(path.join(definitionsDir, filename), 'utf8')
    assert.doesNotMatch(definition, /cad_facts|cad_ask|cad_lookup/)
    assert.doesNotMatch(definition, /四层取证顺序是硬合同/)
  }
})

test('usage aggregator keeps main, child and aux calls on one client run with replay protection', () => {
  const aggregator = new subagents.UsageAggregator()
  aggregator.beginRun('client-usage-1')
  assert.equal(aggregator.record({
    clientRunId: 'client-usage-1',
    contributionId: 'main-call-1',
    callPurpose: 'main',
    usage: { input: 10, output: 5, total: 15, cost: 0.1 },
  }), true)
  assert.equal(aggregator.record({
    clientRunId: 'client-usage-1',
    contributionId: 'child-call-1',
    callPurpose: 'subagent',
    childRunId: 'child-usage-1',
    usage: { input: 20, output: 7, cache_read: 3, total: 30, cost: 0.2 },
  }), true)
  assert.equal(aggregator.record({
    clientRunId: 'client-usage-1',
    contributionId: 'aux-call-1',
    callPurpose: 'cad_query',
    childRunId: 'child-usage-1',
    usage: { input: 5, output: 2, total: 7, cost: 0.05 },
  }), true)
  assert.equal(aggregator.record({
    clientRunId: 'client-usage-1',
    contributionId: 'child-call-1',
    callPurpose: 'subagent',
    childRunId: 'child-usage-1',
    usage: { input: 20, output: 7, cache_read: 3, total: 30, cost: 0.2 },
  }), false)
  assert.throws(() => aggregator.record({
    clientRunId: 'client-usage-1',
    contributionId: 'child-call-1',
    callPurpose: 'subagent',
    childRunId: 'child-usage-1',
    usage: { input: 999, total: 999 },
  }), /different data/)

  const snapshot = aggregator.completeRun('client-usage-1')
  assert.equal(snapshot.status, 'completed')
  assert.equal(snapshot.call_count, 3)
  assert.deepEqual(snapshot.usage, {
    input: 35,
    output: 14,
    cache_read: 3,
    cache_write: 0,
    total: 52,
    cost: 0.35000000000000003,
  })
  assert.equal(snapshot.breakdown.length, 3)
  assert.throws(() => aggregator.record({
    clientRunId: 'missing-run',
    contributionId: 'call-1',
    callPurpose: 'main',
    usage: {},
  }), /not active/)
})

test('usage aggregator fires the contribution observer even when the record itself fails', () => {
  // Per-call billing charges the call whether or not a local aggregation run is
  // active, so the balance observer must fire either way — and must never break
  // bookkeeping when it throws.
  let observed = 0
  const aggregator = new subagents.UsageAggregator({
    onContribution: () => {
      observed += 1
    },
  })
  assert.throws(() => aggregator.record({
    clientRunId: 'missing-run',
    contributionId: 'call-1',
    callPurpose: 'main',
    usage: {},
  }), /not active/)
  assert.equal(observed, 1)

  aggregator.beginRun('client-usage-observer')
  assert.equal(aggregator.record({
    clientRunId: 'client-usage-observer',
    contributionId: 'main-call-1',
    callPurpose: 'main',
    usage: { input: 4, output: 2, total: 6 },
  }), true)
  assert.equal(observed, 2)

  const throwing = new subagents.UsageAggregator({
    onContribution: () => {
      throw new Error('observer exploded')
    },
  })
  throwing.beginRun('client-usage-throwing')
  assert.equal(throwing.record({
    clientRunId: 'client-usage-throwing',
    contributionId: 'main-call-1',
    callPurpose: 'main',
    usage: { input: 1, output: 1, total: 2 },
  }), true)
  assert.equal(throwing.snapshot('client-usage-throwing').call_count, 1)
})

test('run store persists a versioned safe semantic JSONL trace, then honors explicit retention', async () => {
  const fixture = createProjectFixture('xl-subagent-store-')
  let now = Date.now()
  const store = new subagents.SubagentRunStore({
    rootDir: fixture.runStoreRoot,
    ttlMs: 100,
    now: () => now,
  })
  const runRequest = request('child-store-1', fixture.projectRoot, {
    task: 'CANARY_RAW_TASK_TEXT should be hashed and never persisted.',
  })
  try {
    await store.initialize()
    await store.start(runRequest)
    await store.appendEvent('child-store-1', {
      type: 'tool_start',
      toolCallId: 'tool-call-1',
      toolName: 'cad_query',
      args: { query: '核验墙厚' },
    })
    await store.finish({
      childRunId: 'child-store-1',
      status: 'completed',
      artifactRefs: ['.xiaoliang/cad/evidence/child-store-1/evidence.md'],
      toolCallCount: 1,
    })
    const metadata = await store.readMetadata('child-store-1')
    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.task_sha256.length, 64)
    assert.equal(metadata.trace_schema_version, 2)
    assert.equal(metadata.trace_compressed, false)
    assert.equal(metadata.trace_sha256.length, 64)
    assert.equal(fs.existsSync(path.join(fixture.runStoreRoot, 'child-store-1', 'trace.jsonl.gz')), false)
    assert.equal(fs.existsSync(path.join(fixture.runStoreRoot, 'child-store-1', 'trace.jsonl')), true)
    const replay = await store.readTrace('child-store-1')
    assert.deepEqual(replay.events.map((event) => event.sequence), [1, 2, 3])
    assert.deepEqual(replay.events.map((event) => event.type), [
      'run_started',
      'tool_start',
      'run_finished',
    ])
    const storedText = fs.readFileSync(
      path.join(fixture.runStoreRoot, 'child-store-1', 'metadata.json'),
      'utf8',
    ) + JSON.stringify(replay)
    assert.doesNotMatch(storedText, /CANARY_RAW_TASK_TEXT/)
    assert.match(storedText, /\[REDACTED:canary\] should be hashed/)
    assert.doesNotMatch(storedText, new RegExp(fixture.projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    now += 200
    const metadataPath = path.join(fixture.runStoreRoot, 'child-store-1', 'metadata.json')
    const oldTime = new Date(now - 500)
    fs.utimesSync(metadataPath, oldTime, oldTime)
    fs.utimesSync(path.dirname(metadataPath), oldTime, oldTime)
    assert.equal(await store.pruneExpired(), 1)
    assert.equal(fs.existsSync(path.dirname(metadataPath)), false)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('trace projection removes secrets and machine paths while externalizing image bytes', async () => {
  const fixture = createProjectFixture('xl-subagent-projector-')
  const imageBytes = Buffer.from('safe-image-bytes')
  try {
    const projected = await subagents.projectSubagentTraceValue({
      authorization: 'Bearer should-never-persist',
      nested: {
        api_key: 'secret-key',
        project_file: path.join(fixture.projectRoot, 'drawings', 'plan.dwg'),
        machine_file: 'C:\\Users\\private\\token.txt',
      },
      image: {
        type: 'image',
        mimeType: 'image/png',
        data: imageBytes.toString('base64'),
      },
      long_binary: 'A'.repeat(2048),
    }, {
      projectRoot: fixture.projectRoot,
      storeBlob: async (data, mimeType) => ({
        type: 'blob_ref',
        sha256: require('node:crypto').createHash('sha256').update(data).digest('hex'),
        mimeType,
        sizeBytes: data.length,
        localRef: 'blobs/image.png',
      }),
    })
    const text = JSON.stringify(projected)
    assert.doesNotMatch(text, /should-never-persist|secret-key|safe-image-bytes/)
    assert.doesNotMatch(text, /C:\\\\Users|private\\\\token/)
    assert.match(text, /\$PROJECT_ROOT\/drawings\/plan\.dwg/)
    assert.match(text, /\[REDACTED\]|redacted:absolute-path/)
    assert.match(text, /blob_ref/)
    assert.match(text, /omitted base64/)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('run store serializes concurrent events and reconciles an interrupted run after restart', async () => {
  const fixture = createProjectFixture('xl-subagent-restart-')
  const childRunId = 'child-restart-1'
  try {
    const first = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await first.initialize()
    await first.start(request(childRunId, fixture.projectRoot))
    await Promise.all(Array.from({ length: 12 }, (_, index) => first.appendEvent(childRunId, {
      type: 'assistant_delta',
      kind: 'text',
      contentIndex: 0,
      delta: String(index),
    })))

    const restarted = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await restarted.initialize()
    const metadata = await restarted.readMetadata(childRunId)
    const replay = await restarted.readTrace(childRunId, 0, 100)
    assert.equal(metadata.status, 'failed')
    assert.equal(metadata.error_code, 'HOST_RESTARTED')
    assert.equal(metadata.trace_compressed, false)
    assert.equal(replay.events.at(-1).type, 'run_finished')
    assert.equal(replay.events.at(-1).errorCode, 'HOST_RESTARTED')
    assert.deepEqual(
      replay.events.map((event) => event.sequence),
      Array.from({ length: replay.events.length }, (_, index) => index + 1),
    )
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('run store repairs terminal metadata when a crash happens after the terminal JSONL append', async () => {
  const fixture = createProjectFixture('xl-subagent-terminal-metadata-crash-')
  const childRunId = 'child-terminal-metadata-crash-1'
  const metadataPath = path.join(fixture.runStoreRoot, childRunId, 'metadata.json')
  try {
    const first = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await first.initialize()
    await first.start(request(childRunId, fixture.projectRoot))
    const runningMetadata = fs.readFileSync(metadataPath, 'utf8')
    await first.finish({ childRunId, status: 'completed', toolCallCount: 2 })

    // Recreate the crash window: the terminal event is durable, but metadata was not renamed yet.
    fs.writeFileSync(metadataPath, runningMetadata, 'utf8')
    assert.equal(fs.existsSync(path.join(fixture.runStoreRoot, childRunId, 'trace.jsonl')), true)
    assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).status, 'running')

    const restarted = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await restarted.initialize()
    const metadata = await restarted.readMetadata(childRunId)
    const replay = await restarted.readTrace(childRunId, 0, 100)
    const terminalEvents = replay.events.filter((event) => event.type === 'run_finished')

    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.error_code, null)
    assert.equal(metadata.trace_compressed, false)
    assert.equal(metadata.trace_event_count, replay.events.length)
    assert.equal(terminalEvents.length, 1)
    assert.equal(terminalEvents[0].status, 'completed')
    assert.match(await restarted.getTraceUploadPath(childRunId), /trace\.jsonl$/)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('run store materializes a legacy gzip trace as raw JSONL before upload', async () => {
  const fixture = createProjectFixture('xl-subagent-legacy-gzip-')
  const childRunId = 'child-legacy-gzip-1'
  const runDirectory = path.join(fixture.runStoreRoot, childRunId)
  const rawPath = path.join(runDirectory, 'trace.jsonl')
  const compressedPath = path.join(runDirectory, 'trace.jsonl.gz')
  const metadataPath = path.join(runDirectory, 'metadata.json')
  try {
    const store = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await store.initialize()
    await store.start(request(childRunId, fixture.projectRoot))
    await store.finish({ childRunId, status: 'completed' })

    const rawTrace = fs.readFileSync(rawPath)
    const compressedTrace = zlib.gzipSync(rawTrace)
    fs.writeFileSync(compressedPath, compressedTrace)
    fs.unlinkSync(rawPath)
    const legacyMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    legacyMetadata.trace_compressed = true
    legacyMetadata.trace_event_count = 0
    legacyMetadata.trace_last_sequence = 0
    legacyMetadata.trace_sha256 = require('node:crypto').createHash('sha256').update(compressedTrace).digest('hex')
    legacyMetadata.trace_size_bytes = compressedTrace.length
    fs.writeFileSync(metadataPath, `${JSON.stringify(legacyMetadata, null, 2)}\n`, 'utf8')

    const uploadPath = await store.getTraceUploadPath(childRunId)
    const repaired = await store.readMetadata(childRunId)
    assert.equal(uploadPath, rawPath)
    assert.equal(repaired.trace_compressed, false)
    assert.equal(repaired.upload_status, 'pending')
    assert.equal(repaired.upload_error, null)
    assert.equal(repaired.trace_event_count, 2)
    assert.equal(repaired.trace_last_sequence, 2)
    assert.equal(repaired.trace_size_bytes, rawTrace.length)
    assert.deepEqual(fs.readFileSync(rawPath), rawTrace)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('run store repairs stale legacy counters before uploading an unchanged raw trace', async () => {
  const fixture = createProjectFixture('xl-subagent-legacy-counters-')
  const childRunId = 'child-legacy-counters-1'
  const runDirectory = path.join(fixture.runStoreRoot, childRunId)
  const rawPath = path.join(runDirectory, 'trace.jsonl')
  const metadataPath = path.join(runDirectory, 'metadata.json')
  try {
    const store = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await store.initialize()
    await store.start(request(childRunId, fixture.projectRoot))
    await store.finish({ childRunId, status: 'completed' })

    const legacyTrace = [
      { type: 'agent_start', at: '2026-08-09T09:00:00.000Z' },
      { type: 'assistant_message', at: '2026-08-09T09:00:01.000Z', stop_reason: 'stop' },
      { type: 'agent_end', at: '2026-08-09T09:00:02.000Z' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n'
    fs.writeFileSync(rawPath, legacyTrace, 'utf8')

    const legacyMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    legacyMetadata.schema_version = 1
    legacyMetadata.trace_event_count = 0
    legacyMetadata.trace_last_sequence = 0
    legacyMetadata.trace_sha256 = require('node:crypto').createHash('sha256').update(legacyTrace).digest('hex')
    legacyMetadata.trace_size_bytes = Buffer.byteLength(legacyTrace)
    legacyMetadata.upload_status = 'failed'
    legacyMetadata.upload_error = '请求失败 (422)'
    fs.writeFileSync(metadataPath, `${JSON.stringify(legacyMetadata, null, 2)}\n`, 'utf8')

    assert.equal(await store.getTraceUploadPath(childRunId), rawPath)
    const repaired = await store.readMetadata(childRunId)
    assert.equal(repaired.schema_version, 2)
    assert.equal(repaired.trace_event_count, 3)
    assert.equal(repaired.trace_last_sequence, 3)
    assert.equal(repaired.upload_status, 'pending')
    assert.equal(repaired.upload_error, null)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('feature-gated delegate runs a fresh isolated child and returns only the evidence contract', async () => {
  const fixture = createProjectFixture()
  const captured = {}
  const childRunId = 'child-vertical-1'
  const parentCanary = 'PARENT_TRANSCRIPT_CANARY_NEVER_PASSED_TO_CHILD'
  try {
    const runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: fixture.runStoreRoot,
      mode: 'on',
      drafterMode: 'on',
      createChildRunId: () => childRunId,
      createTools: () => dummyChildTools(),
      resolveApiKey: (childRequest) => `xl.${childRequest.clientRunId}.fake-jwt`,
      createModel: () => ({ id: 'test-cad-subagent-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef),
        imageRef: fixture.imageRef,
        captured,
      }),
    })
    runtime.usageAggregator.beginRun('client-vertical')
    const tools = runtime.buildDelegateTools({
      projectId: 'project-vertical',
      cadContextAvailable: true,
      resolveCadSessionContext: () => [
        '[host_cad_session]',
        'active_document_name: 地下室.dwg',
        'project_relative_path: 结构/地下室.dwg',
        '[/host_cad_session]',
      ].join('\n'),
      resolveContext: () => ({
        parentSessionId: 'session-vertical',
        parentPromptId: 'prompt-vertical',
        clientRunId: 'client-vertical',
        projectId: 'project-vertical',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      }),
    })
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['delegate_cad', 'delegate_cad_drafter', 'delegate_blender'],
    )
    const drafterTool = tools.find((candidate) => candidate.name === 'delegate_cad_drafter')
    assert.ok(drafterTool)
    assert.match(drafterTool.description, /可与 delegate_cad 同时进行/u)
    assert.match(drafterTool.description, /必须改走 delegate_cad/u)
    assert.match(drafterTool.description, /不能画图/u)
    assert.doesNotMatch(drafterTool.description, /MLightCAD|LibreDWG|制图|内置引擎/u)
    const tool = tools.find((candidate) => candidate.name === 'delegate_cad')
    assert.ok(tool)
    assert.equal(tool.parameters.additionalProperties, false)
    assert.match(tool.description, /保留用户的快速\/范围限制/u)
    assert.match(tool.description, /extract → 精确 search → detail/u)
    // Combined multi-target tasks are what made children die at summary time, so both
    // channels have to state the granularity rule and why it matters.
    for (const cadTool of [tool, drafterTool]) {
      assert.match(cadTool.description, /一任务一目标/u)
      assert.match(cadTool.description, /收尾失败/u)
      assert.match(cadTool.description, /拆成多次委派/u)
    }

    const result = await tool.execute('delegate-call-1', {
      task: '在结构/地下室.dwg 中定位 3 号节点并核验墙厚，只收集证据。',
    })
    const evidenceRef = `.xiaoliang/cad/evidence/${childRunId}/evidence.md`
    assert.equal(result.details.status, 'completed')
    assert.equal(result.details.agent_type, 'cad-analyst')
    assert.equal(result.details.model, 'qwen3.8-max')
    assert.ok(result.details.artifact_refs.includes(evidenceRef))
    assert.match(result.content[0].text, new RegExp(evidenceRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(JSON.stringify(result), /PARENT_CANARY_MUST_NOT_ESCAPE|data:image|private\\must-not-be-stored/)

    assert.deepEqual(captured.options.initialState.messages, [])
    assert.equal(Object.hasOwn(captured.options, 'transformContext'), false)
    assert.doesNotMatch(captured.options.initialState.systemPrompt, new RegExp(parentCanary))
    assert.match(captured.prompt, /BEGIN DELEGATED TASK/)
    assert.match(captured.prompt, /active_document_name: 地下室\.dwg/)
    assert.match(captured.prompt, /project_relative_path: 结构\/地下室\.dwg/)
    assert.equal(captured.apiKey, 'xl.client-vertical.fake-jwt')
    assert.equal(captured.payload.enable_thinking, true)
    assert.equal(captured.payload.reasoning_effort, 'low')
    assert.equal(captured.payload.xiaoliang_client_run_id, 'client-vertical')
    assert.equal(captured.payload.xiaoliang_child_run_id, childRunId)
    assert.equal(captured.payload.xiaoliang_call_purpose, 'subagent')
    assert.equal(Object.hasOwn(captured.payload, 'thinking_budget'), false)
    assert.equal(Object.hasOwn(captured.payload, 'preserve_thinking'), false)

    const evidencePath = path.join(fixture.projectRoot, ...evidenceRef.split('/'))
    const evidenceText = fs.readFileSync(evidencePath, 'utf8')
    assert.match(evidenceText, /^# CAD Evidence Pack/m)
    assert.match(evidenceText, /\[host_cad_session\]/)
    assert.match(evidenceText, /measurement=200/)

    const metadata = await runtime.runStore.readMetadata(childRunId)
    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.client_run_id, 'client-vertical')
    assert.ok(metadata.artifact_refs.includes(evidenceRef))
    const privateTrace = JSON.stringify(await runtime.runStore.readTrace(childRunId, 0, 500))
    assert.doesNotMatch(privateTrace, /PARENT_CANARY|data:image|private\\must-not-be-stored/)
    assert.match(privateTrace, /"absolute_path":"\[redacted:absolute-path\]"/)
    assert.match(privateTrace, /cad_artifacts/)
    assert.match(privateTrace, /assistant_delta/)
    assert.match(privateTrace, /tool_update/)
    assert.match(privateTrace, /正在定位目标区域/)

    const aggregate = runtime.usageAggregator.completeRun('client-vertical')
    assert.equal(aggregate.call_count, 2)
    assert.equal(aggregate.usage.input, 30)
    assert.equal(aggregate.usage.output, 10)
    assert.equal(aggregate.usage.total, 43)
    assert.equal(aggregate.breakdown.length, 1)
    assert.equal(aggregate.breakdown[0].child_run_id, childRunId)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('planned CAD facts paths cannot turn a completed evidence report into a schema failure', async () => {
  const fixture = createProjectFixture('xl-subagent-planned-facts-paths-')
  const childRunId = 'child-planned-facts-paths-1'
  const semanticDirectoryRef = '.xiaoliang/cad/facts/drawings/demo/semantic'
  const pendingBindingRef = '.xiaoliang/cad/facts/binding.json'
  fs.mkdirSync(path.join(fixture.projectRoot, ...semanticDirectoryRef.split('/')), {
    recursive: true,
  })
  const captured = {}
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = new subagents.FreshPiSubagentRunner({
      definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
      evidenceWriter: new subagents.EvidencePackWriter(),
      runStore,
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'xl.client-runtime.fake-jwt',
      createModel: () => ({ id: 'test-cad-subagent-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef),
        imageRef: fixture.imageRef,
        captured,
        toolDetails: {
          operation: 'facts.status',
          request_id: 'facts.status-fixture',
          relative_paths: [
            fixture.imageRef,
            semanticDirectoryRef,
            pendingBindingRef,
          ],
          warnings: [],
        },
      }),
    })

    const summary = await runner.run(request(childRunId, fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })
    const evidenceRef = `.xiaoliang/cad/evidence/${childRunId}/evidence.md`
    assert.ok(summary.artifactRefs.includes(fixture.imageRef))
    assert.ok(summary.artifactRefs.includes(evidenceRef))
    assert.equal(summary.artifactRefs.includes(semanticDirectoryRef), false)
    assert.equal(summary.artifactRefs.includes(pendingBindingRef), false)

    const metadata = await runStore.readMetadata(childRunId)
    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.error_code, null)
    assert.ok(metadata.artifact_refs.includes(evidenceRef))
    assert.equal(metadata.artifact_refs.includes(semanticDirectoryRef), false)
    assert.equal(metadata.artifact_refs.includes(pendingBindingRef), false)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('a body citation of a path that never materialized no longer fails the evidence report', async () => {
  const fixture = createProjectFixture('xl-subagent-missing-citation-')
  const childRunId = 'child-missing-citation-1'
  // The Markdown cites an L3 store path whose background build never finished: nothing on
  // disk, and no tool result ever advertised it, so it is undeclared as well as missing.
  const missingRef = '.xiaoliang/cad/facts/drawings/demo/semantic/l3.json'
  const captured = {}
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = new subagents.FreshPiSubagentRunner({
      definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
      evidenceWriter: new subagents.EvidencePackWriter(),
      runStore,
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'xl.client-runtime.fake-jwt',
      createModel: () => ({ id: 'test-cad-subagent-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef).replace(
          '- q4 与目标不在同一区域，未采用。',
          `- 规划中的语义层 \`${missingRef}\` 尚未生成，未采用。`,
        ),
        imageRef: fixture.imageRef,
        captured,
      }),
    })

    const summary = await runner.run(request(childRunId, fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })
    const evidenceRef = `.xiaoliang/cad/evidence/${childRunId}/evidence.md`
    assert.deepEqual(summary.artifactRefs, [fixture.imageRef, evidenceRef])

    const metadata = await runStore.readMetadata(childRunId)
    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.error_code, null)
    assert.deepEqual(metadata.artifact_refs, [fixture.imageRef, evidenceRef])
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('Blender delegate is always present while CAD delegate follows its project flag', async () => {
  const fixture = createProjectFixture('xl-subagent-flags-')
  const baseOptions = {
    definitionsDir,
    createTools: () => dummyChildTools(),
    resolveApiKey: () => 'unused',
  }
  try {
    const defaultDrafterOn = await subagents.createSubagentRuntime({
      ...baseOptions,
      runStoreRoot: path.join(fixture.fixtureRoot, 'drafter-default-runs'),
      mode: 'on',
    })
    assert.deepEqual(defaultDrafterOn.buildDelegateTools({
      projectId: 'project-a',
      cadContextAvailable: true,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), [
      'delegate_cad',
      'delegate_cad_drafter',
      'delegate_blender',
    ])

    const drafterOff = await subagents.createSubagentRuntime({
      ...baseOptions,
      runStoreRoot: path.join(fixture.fixtureRoot, 'drafter-off-runs'),
      mode: 'on',
      drafterMode: 'off',
    })
    assert.deepEqual(drafterOff.buildDelegateTools({
      projectId: 'project-a',
      cadContextAvailable: true,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), ['delegate_cad', 'delegate_blender'])

    const off = await subagents.createSubagentRuntime({
      ...baseOptions,
      runStoreRoot: path.join(fixture.fixtureRoot, 'off-runs'),
      mode: 'off',
      backgroundMode: 'off',
      backgroundTaskDelivery: {
        parentExists: () => true,
        isParentBusy: () => false,
        followUp: async () => undefined,
        wake: async () => undefined,
      },
    })
    assert.deepEqual(off.buildDelegateTools({
      projectId: 'project-a',
      cadContextAvailable: true,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), ['delegate_blender'])

    const canary = await subagents.createSubagentRuntime({
      ...baseOptions,
      runStoreRoot: path.join(fixture.fixtureRoot, 'canary-runs'),
      mode: 'canary',
      drafterMode: 'on',
      canaryProjectIds: new Set(['project-a']),
    })
    assert.deepEqual(canary.buildDelegateTools({
      projectId: 'project-a',
      cadContextAvailable: true,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), [
      'delegate_cad',
      'delegate_cad_drafter',
      'delegate_blender',
    ])
    assert.deepEqual(canary.buildDelegateTools({
      projectId: 'project-b',
      cadContextAvailable: true,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), ['delegate_blender'])
    assert.deepEqual(canary.buildDelegateTools({
      projectId: 'project-a',
      cadContextAvailable: false,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name), ['delegate_blender'])
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('research subagent is retired and cannot be delegated', async () => {
  const fixture = createProjectFixture('xl-subagent-research-gate-')
  try {
    const runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: fixture.runStoreRoot,
      mode: 'off',
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'unused',
    })
    const names = runtime.buildDelegateTools({
      projectId: 'project-retired',
      cadContextAvailable: false,
      resolveContext: () => { throw new Error('unused') },
    }).map((tool) => tool.name)
    assert.deepEqual(names, ['delegate_blender'])
    assert.equal(runtime.delegateService.isEnabled('research-analyst', 'project-retired'), false)
    await assert.rejects(
      runtime.delegateService.delegate('research-analyst', 'retired', {
        parentSessionId: 'session-retired',
        parentPromptId: 'prompt-retired',
        clientRunId: 'client-retired',
        projectId: 'project-retired',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      }),
      (error) => error?.code === 'SUBAGENT_TYPE_RETIRED',
    )
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('Blender delegate runs an isolated peer child and returns only its verified report', async () => {
  const fixture = createProjectFixture('xl-subagent-blender-')
  const captured = {}
  const childRunId = 'child-blender-1'
  try {
    const runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: fixture.runStoreRoot,
      mode: 'off',
      createChildRunId: () => childRunId,
      createTools: (childRequest) => (
        childRequest.type === 'blender-modeler' ? dummyBlenderTools() : dummyChildTools()
      ),
      resolveApiKey: (childRequest) => `xl.${childRequest.clientRunId}.fake-jwt`,
      createModel: () => ({ id: 'test-blender-subagent-model' }),
      createAgent: createBlenderScriptedAgentFactory(captured),
    })
    runtime.usageAggregator.beginRun('client-blender')
    const tools = runtime.buildDelegateTools({
      projectId: null,
      cadContextAvailable: false,
      resolveContext: () => ({
        parentSessionId: 'session-blender',
        parentPromptId: 'prompt-blender',
        clientRunId: 'client-blender',
        projectId: 'conversation-blender',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      }),
    })
    assert.deepEqual(tools.map((tool) => tool.name), ['delegate_blender'])

    const result = await tools[0].execute('delegate-blender-1', {
      task: '在 Blender 中创建 XL_Wall，尺寸 2m × 3m × 0.2m，保留 Camera，并截图自检。',
    })
    assert.equal(result.details.status, 'completed')
    assert.equal(result.details.agent_type, 'blender-modeler')
    assert.deepEqual(result.details.artifact_refs, [])
    assert.match(result.content[0].text, /Created XL_Wall/)
    assert.ok(result.content[0].text.includes('C:\\Users\\operator\\AppData\\Local\\Temp\\guardhouse.blend'))
    assert.deepEqual(
      captured.options.initialState.tools.map((tool) => tool.name),
      [...subagents.BLENDER_MODELER_TOOL_CEILING],
    )
    assert.deepEqual(captured.options.initialState.messages, [])
    assert.match(captured.prompt, /Execute this self-contained Blender task/)
    assert.equal(captured.apiKey, 'xl.client-blender.fake-jwt')
    assert.equal(captured.payload.xiaoliang_child_run_id, childRunId)

    const metadata = await runtime.runStore.readMetadata(childRunId)
    assert.equal(metadata.type, 'blender-modeler')
    assert.equal(metadata.status, 'completed')
    assert.deepEqual(metadata.artifact_refs, [])
    assert.equal(fs.existsSync(path.join(
      fixture.projectRoot,
      '.xiaoliang',
      'cad',
      'evidence',
      childRunId,
      'evidence.md',
    )), false)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('running delegate cancellation aborts the fresh child and publishes no partial evidence', async () => {
  const fixture = createProjectFixture('xl-subagent-abort-')
  const captured = {}
  const childRunId = 'child-abort-1'
  try {
    const runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: fixture.runStoreRoot,
      mode: 'on',
      createChildRunId: () => childRunId,
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'xl.client-abort.fake-jwt',
      createModel: () => ({ id: 'test-cad-subagent-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef),
        imageRef: fixture.imageRef,
        captured,
        stall: true,
      }),
    })
    runtime.usageAggregator.beginRun('client-abort')
    const tool = runtime.buildDelegateTools({
      projectId: 'project-abort',
      cadContextAvailable: true,
      resolveContext: () => ({
        parentSessionId: 'session-abort',
        parentPromptId: 'prompt-abort',
        clientRunId: 'client-abort',
        projectId: 'project-abort',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'deep',
      }),
    }).find((candidate) => candidate.name === 'delegate_cad')
    assert.ok(tool)
    const controller = new AbortController()
    const pending = tool.execute('delegate-abort', { task: '收集目标节点证据。' }, controller.signal)
    while (!captured.prompt) await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    const result = await pending
    assert.equal(result.details.status, 'cancelled')
    assert.match(result.content[0].text, /cancelled/)
    assert.equal(fs.existsSync(path.join(
      fixture.projectRoot,
      '.xiaoliang',
      'cad',
      'evidence',
      childRunId,
      'evidence.md',
    )), false)
    const metadata = await runtime.runStore.readMetadata(childRunId)
    assert.equal(metadata.status, 'cancelled')
    assert.equal(metadata.error_code, 'SUBAGENT_CANCELLED')
    assert.equal(captured.payload.reasoning_effort, 'xhigh')
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('background delegate returns immediately, exposes watcher status, and keeps late child usage', async () => {
  const fixture = createProjectFixture('xl-subagent-background-')
  const captured = {}
  let releaseChild
  const childGate = new Promise((resolve) => {
    releaseChild = resolve
  })
  const deliveries = []
  let runtime
  try {
    const createReadyAgent = createBlenderScriptedAgentFactory(captured)
    runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: fixture.runStoreRoot,
      mode: 'off',
      backgroundMode: 'on',
      backgroundTaskDelivery: {
        parentExists: () => true,
        isParentBusy: () => true,
        followUp: async (...args) => deliveries.push(['followUp', ...args]),
        wake: async (...args) => deliveries.push(['wake', ...args]),
      },
      createChildRunId: () => 'child-background-1',
      createTools: (childRequest) => (
        childRequest.type === 'blender-modeler' ? dummyBlenderTools() : dummyChildTools()
      ),
      resolveApiKey: () => 'xl.client-background.fake-jwt',
      createModel: () => ({ id: 'test-background-subagent-model' }),
      createAgent: (options) => {
        const agent = createReadyAgent(options)
        return {
          ...agent,
          prompt: async (promptText) => {
            await childGate
            return agent.prompt(promptText)
          },
        }
      },
    })
    runtime.usageAggregator.beginRun('client-background')
    const tools = runtime.buildDelegateTools({
      projectId: null,
      cadContextAvailable: false,
      resolveParentConversationId: () => 'conversation-background',
      resolveContext: () => ({
        parentSessionId: 'conversation-background',
        parentPromptId: 'prompt-background',
        clientRunId: 'client-background',
        projectId: 'project-background',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      }),
    })
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['delegate_blender', 'subagent_task_status'],
    )

    const launch = await tools[0].execute('delegate-background', {
      task: '创建并核验一个简单墙体。',
    })
    assert.equal(launch.details.task_id, 'child-background-1')
    assert.ok(['queued', 'initializing', 'running'].includes(launch.details.status))
    assert.equal(launch.usage.totalTokens, 0)

    const snapshot = await tools[1].execute('status-background-snapshot', {
      taskIds: ['child-background-1'],
      timeoutMs: 0,
    })
    assert.equal(snapshot.details.task_id, 'child-background-1')
    assert.ok(['queued', 'initializing', 'running'].includes(snapshot.details.status))

    const terminalPromise = tools[1].execute('status-background-wait', {
      taskIds: ['child-background-1'],
      timeoutMs: 1_000,
    })
    releaseChild()
    const terminal = await terminalPromise
    assert.equal(terminal.details.status, 'completed')
    assert.match(terminal.content[0].text, /Created XL_Wall/)
    assert.deepEqual(deliveries, [])

    const aggregate = runtime.usageAggregator.completeRun('client-background')
    assert.equal(aggregate.call_count, 1)
    assert.equal(aggregate.breakdown[0].child_run_id, 'child-background-1')
    assert.equal(aggregate.usage.total, 20)
  } finally {
    await runtime?.dispose().catch(() => undefined)
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

// Smallest valid PNG; the capture tools reject anything without the PNG signature.
const ONE_PIXEL_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const DRAFTER_ENTITY_LINES = [
  JSON.stringify({
    handle: '2A1',
    type: 'line',
    object_name: 'AcDbLine',
    layer: '轴线',
    visible: true,
    bbox: { min: [0, 0], max: [100, 0] },
    start: [0, 0],
    end: [100, 0],
    length: 100,
  }),
  JSON.stringify({
    handle: '2A2',
    type: 'circle',
    object_name: 'AcDbCircle',
    layer: '0',
    visible: true,
    bbox: { min: [80, -10], max: [100, 10] },
    center: [90, 0],
    radius: 10,
    area: 314.159265,
    length: 62.831853,
  }),
]

test('drafter child gets the file-read tool set and never touches the AutoCAD lease', async () => {
  const fixture = createProjectFixture('xl-cad-drafter-')
  const leaseEvents = []
  const engineCalls = []
  const renderRequests = []
  const captured = {}
  let runtime
  try {
    runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: path.join(fixture.fixtureRoot, 'drafter-runs'),
      mode: 'on',
      drafterMode: 'on',
      backgroundMode: 'off',
      cadHttpRuntime: {
        async acquire(projectRoot) {
          leaseEvents.push(`acquire:${projectRoot}`)
          throw new Error('the drafter must not acquire an AutoCAD lease')
        },
      },
      mlightEngine: {
        async documentInfo(ref) {
          engineCalls.push(`documentInfo:${ref.sourceRelativePath}`)
          return {
            kind: 'document_info',
            fileName: 'plan.dwg',
            extents: { min: [0, 0], max: [100, 80] },
            entityCount: 42,
            layerCount: 3,
            fontsNotFound: [],
            warnings: [],
          }
        },
        async layers(ref) {
          engineCalls.push(`layers:${ref.sourceRelativePath}`)
          return {
            kind: 'layers',
            layers: [
              { name: '0', visible: true, frozen: false, locked: false, color: null, entityCount: 2 },
              { name: '轴线', visible: true, frozen: false, locked: false, color: '#ff0000', entityCount: 40 },
            ],
            warnings: [],
          }
        },
        async extract(request) {
          engineCalls.push(`extract:${request.sourceRelativePath}`)
          const stageRelative = `.xiaoliang/cad/.staging/${request.artifactRunId}/entities`
          const stageDirectory = path.join(fixture.projectRoot, ...stageRelative.split('/'))
          fs.mkdirSync(stageDirectory, { recursive: true })
          fs.writeFileSync(path.join(stageDirectory, 'entities.raw.jsonl'), `${DRAFTER_ENTITY_LINES.join('\n')}\n`)
          fs.writeFileSync(
            path.join(stageDirectory, 'entities.readable.md'),
            '# CAD Entity Index\n\nschema_version: 1\n',
          )
          return {
            requestId: 'mlight-test',
            summary: {
              source_entity_count: 2,
              indexed_entity_count: 2,
              omitted_geometry_count: 0,
              failed_entity_count: 0,
              type_counts: { line: 1, circle: 1 },
              layer_count: 2,
              parse_duration_ms: 5,
              extract_duration_ms: 2,
            },
            warnings: [],
            rawPath: `${stageRelative}/entities.raw.jsonl`,
            readablePath: `${stageRelative}/entities.readable.md`,
          }
        },
        async render(request) {
          engineCalls.push(`render:${request.window ? 'window' : 'extents'}`)
          renderRequests.push(request)
          return {
            kind: 'render',
            pngBase64: ONE_PIXEL_PNG_BASE64,
            width: 1,
            height: 1,
            window: request.window ?? null,
            warnings: [],
          }
        },
        async dispose() {},
      },
      createChildRunId: () => 'child-drafter-1',
      resolveApiKey: (childRequest) => `xl.${childRequest.clientRunId}.fake-jwt`,
      createModel: () => ({ id: 'test-drafter-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef),
        imageRef: fixture.imageRef,
        captured,
      }),
    })
    runtime.usageAggregator.beginRun('client-drafter')

    const result = await runtime.delegateService.delegate(
      'cad-drafter',
      '读取 图纸/平面.dwg 的图层清单，只收集证据。',
      {
        parentSessionId: 'conversation-drafter',
        parentPromptId: 'prompt-drafter',
        clientRunId: 'client-drafter',
        projectId: 'project-drafter',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      },
    )

    assert.deepEqual(leaseEvents, [])
    assert.equal(result.details.status, 'completed')
    assert.equal(result.details.agent_type, 'cad-drafter')
    assert.ok(result.details.artifact_refs.includes('.xiaoliang/cad/evidence/child-drafter-1/evidence.md'))
    assert.deepEqual(
      captured.options.initialState.tools.map((tool) => tool.name),
      [...subagents.CAD_DRAFTER_TOOL_CEILING],
    )
    assert.match(captured.options.initialState.systemPrompt, /This child reads project drawing files only/)
    assert.doesNotMatch(captured.options.initialState.systemPrompt, /MLightCAD|LibreDWG/)

    const cadOpen = captured.options.initialState.tools.find((tool) => tool.name === 'cad_open')
    const drawingRelativePath = 'drawings/plan.dwg'
    const drawingPath = path.join(fixture.projectRoot, ...drawingRelativePath.split('/'))
    const alternateDrawingRelativePath = 'drawings/alternate.dwg'
    const alternateDrawingPath = path.join(fixture.projectRoot, ...alternateDrawingRelativePath.split('/'))
    fs.mkdirSync(path.dirname(drawingPath), { recursive: true })
    fs.writeFileSync(drawingPath, Buffer.from('AC1027 fake drawing body'))
    fs.writeFileSync(alternateDrawingPath, Buffer.from('AC1027 alternate drawing body'))

    const opened = await cadOpen.execute('drafter-open-1', { path: drawingRelativePath })
    const openedData = JSON.parse(opened.content[0].text).data
    assert.equal(openedData.drawing_path, drawingRelativePath)
    assert.equal(openedData.entity_count, 42)
    assert.deepEqual(openedData.extents, { min: [0, 0], max: [100, 80] })

    // cad_open selects the working drawing so later tools need no path, and the layer
    // table comes back ordered by entity count.
    const cadLayers = captured.options.initialState.tools.find((tool) => tool.name === 'cad_layers')
    const listed = await cadLayers.execute('drafter-layers-1', {})
    const listedData = JSON.parse(listed.content[0].text).data
    assert.equal(listedData.drawing_path, drawingRelativePath)
    assert.deepEqual(listedData.layers.map((layer) => layer.name), ['轴线', '0'])
    // cad_extract publishes through the shared artifact store, so the index it leaves
    // behind is stamped with the MLight producer and is reusable on the next call.
    const cadExtract = captured.options.initialState.tools.find((tool) => tool.name === 'cad_extract')
    const extracted = JSON.parse((await cadExtract.execute('drafter-extract-1', {})).content[0].text).data
    assert.equal(extracted.cache.hit, false)
    assert.equal(extracted.cache.producer.name, 'file-index')
    assert.equal(extracted.summary.indexed_entity_count, 2)
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, ...extracted.raw_path.split('/'))))
    const manifest = JSON.parse(fs.readFileSync(
      path.join(fixture.projectRoot, ...extracted.cache.manifest_path.split('/')),
      'utf8',
    ))
    assert.equal(manifest.artifact_sets.entities.producer.name, 'mlightcad')

    const reused = JSON.parse((await cadExtract.execute('drafter-extract-2', {})).content[0].text).data
    assert.equal(reused.cache.hit, true)
    assert.equal(engineCalls.filter((call) => call.startsWith('extract:')).length, 1)

    // cad_measure reads geometry back out of the published index rather than re-parsing.
    const cadMeasure = captured.options.initialState.tools.find((tool) => tool.name === 'cad_measure')
    const measured = JSON.parse(
      (await cadMeasure.execute('drafter-measure-1', { handles: ['2A1', '2A2', 'DEAD'] })).content[0].text,
    )
    assert.equal(measured.data.measurements.length, 2)
    assert.equal(measured.data.measurements[0].length, 100)
    assert.equal(measured.data.measurements[1].radius, 10)
    assert.deepEqual(measured.data.combined_extents, { min: [0, -10], max: [100, 10] })
    assert.equal(measured.data.center_distance, 40)
    assert.ok(measured.warnings.some((warning) => warning.includes('DEAD')))

    // Images land under the shared preview root so the evidence allowlist finds them.
    const cadCapture = captured.options.initialState.tools.find((tool) => tool.name === 'cad_capture')
    const captureResult = JSON.parse(
      (await cadCapture.execute('drafter-capture-1', { label: 'Axis 3', isolate_layers: ['轴线'] })).content[0].text,
    ).data
    assert.match(captureResult.image_path, /^\.xiaoliang\/cad\/previews\/.+\/mlight\/axis-3-[0-9a-f]{8}\.png$/u)
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, ...captureResult.image_path.split('/'))))
    assert.deepEqual(renderRequests.at(-1).isolateLayers, ['轴线'])

    // cad_detail frames the requested handles and pads the window with context.
    const cadDetail = captured.options.initialState.tools.find((tool) => tool.name === 'cad_detail')
    const detail = JSON.parse(
      (await cadDetail.execute('drafter-detail-1', { handles: ['2A2'], padding_ratio: 0.5 })).content[0].text,
    ).data
    assert.deepEqual(detail.anchors.map((anchor) => anchor.handle), ['2A2'])
    assert.deepEqual(renderRequests.at(-1).window, { min: [70, -20], max: [110, 20] })
    assert.match(detail.image_path, /\/mlight\/detail-2a2-[0-9a-f]{8}\.png$/u)

    // An explicit cad_layers path becomes the current drawing for later pathless tools.
    const alternateLayers = JSON.parse((await cadLayers.execute('drafter-layers-2', {
      path: alternateDrawingRelativePath,
    })).content[0].text).data
    assert.equal(alternateLayers.drawing_path, alternateDrawingRelativePath)
    await cadCapture.execute('drafter-capture-2', { label: 'Alternate drawing' })
    assert.equal(renderRequests.at(-1).sourceRelativePath, alternateDrawingRelativePath)

    await assert.rejects(
      cadOpen.execute('drafter-open-2', { path: '../outside.dwg' }),
      /project-relative/,
    )
    await assert.rejects(
      cadOpen.execute('drafter-open-3', { path: 'drawings/notes.txt' }),
      /extension/,
    )
  } finally {
    await runtime?.dispose().catch(() => undefined)
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('global CAD FIFO releases project A lease before acquiring project B lease', async () => {
  const fixtureA = createProjectFixture('xl-cad-lease-a-')
  const fixtureB = createProjectFixture('xl-cad-lease-b-')
  const runStoreRoot = path.join(fixtureA.fixtureRoot, 'lease-runs')
  const leaseEvents = []
  const childIds = ['child-lease-a', 'child-lease-b']
  let childIndex = 0
  let runtime
  try {
    const cadHttpRuntime = {
      async acquire(projectRoot) {
        leaseEvents.push(`acquire:${projectRoot}`)
        let released = false
        return {
          projectRoot,
          facade: {},
          capabilities: async () => ({}),
          diagnose: async () => ({}),
          async release() {
            if (released) return
            released = true
            leaseEvents.push(`release:${projectRoot}`)
          },
        }
      },
    }
    runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot,
      mode: 'on',
      backgroundMode: 'off',
      cadHttpRuntime,
      mlightEngine: {},
      createChildRunId: () => childIds[childIndex++],
      resolveApiKey: (childRequest) => `xl.${childRequest.clientRunId}.fake-jwt`,
      createModel: () => ({ id: 'test-cad-lease-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixtureA.imageRef),
        imageRef: fixtureA.imageRef,
        captured: {},
      }),
    })
    runtime.usageAggregator.beginRun('client-lease-a')
    runtime.usageAggregator.beginRun('client-lease-b')

    const runA = runtime.delegateService.delegate(
      'cad-analyst',
      '收集 A 项目的节点证据。',
      {
        parentSessionId: 'conversation-lease-a',
        parentPromptId: 'prompt-lease-a',
        clientRunId: 'client-lease-a',
        projectId: 'project-lease-a',
        projectRoot: fixtureA.projectRoot,
        thinkingMode: 'fast',
      },
    )
    const runB = runtime.delegateService.delegate(
      'cad-analyst',
      '收集 B 项目的节点证据。',
      {
        parentSessionId: 'conversation-lease-b',
        parentPromptId: 'prompt-lease-b',
        clientRunId: 'client-lease-b',
        projectId: 'project-lease-b',
        projectRoot: fixtureB.projectRoot,
        thinkingMode: 'fast',
      },
    )
    const [resultA, resultB] = await Promise.all([runA, runB])
    assert.equal(resultA.details.status, 'completed')
    assert.equal(resultB.details.status, 'completed')
    assert.deepEqual(leaseEvents, [
      `acquire:${fixtureA.projectRoot}`,
      `release:${fixtureA.projectRoot}`,
      `acquire:${fixtureB.projectRoot}`,
      `release:${fixtureB.projectRoot}`,
    ])
  } finally {
    await runtime?.dispose().catch(() => undefined)
    fs.rmSync(fixtureA.fixtureRoot, { recursive: true, force: true })
    fs.rmSync(fixtureB.fixtureRoot, { recursive: true, force: true })
  }
})

test('threshold compaction rewrites the next-turn context and bills as subagent', async () => {
  const fixture = createProjectFixture('xl-subagent-threshold-compact-')
  const compactCalls = []
  const progress = []
  const captured = {}
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const usageAggregator = new subagents.UsageAggregator()
    usageAggregator.beginRun('client-runtime')
    const runner = new subagents.FreshPiSubagentRunner({
      definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
      evidenceWriter: new subagents.EvidencePackWriter(),
      runStore,
      usageAggregator,
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'xl.client-runtime.fake-jwt',
      createModel: () => ({
        id: 'xiaoliang-agent-default',
        contextWindow: 32_768,
        maxTokens: 4096,
      }),
      compactMessages: async (input) => {
        compactCalls.push({ force: input.force, messageCount: input.messages.length })
        return {
          messages: [
            input.messages[0],
            {
              role: 'user',
              content: [{ type: 'text', text: '[subagent_context_checkpoint]\n\nsummary' }],
              timestamp: Date.now(),
            },
            ...input.messages.slice(-1),
          ],
          summary: 'summary',
          usage: {
            input: 11,
            output: 7,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 18,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
          },
        }
      },
      createAgent: (options) => {
        captured.options = options
        const listeners = []
        const state = {
          ...options.initialState,
          messages: [...(options.initialState.messages || [])],
        }
        const emit = async (event) => {
          for (const listener of listeners) await listener(event, new AbortController().signal)
        }
        return {
          state,
          subscribe(listener) {
            listeners.push(listener)
            return () => {}
          },
          abort() {},
          async continue() {},
          async prompt(promptText) {
            const userMessage = { role: 'user', content: promptText, timestamp: Date.now() }
            const toolAssistant = {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-1', name: 'cad_artifacts', arguments: {} }],
              usage: usage(30_000, 10),
              stopReason: 'toolUse',
              timestamp: Date.now(),
            }
            const toolResult = {
              role: 'toolResult',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              content: [{ type: 'text', text: 'ok' }],
              details: { artifact_refs: [fixture.imageRef] },
              isError: false,
              timestamp: Date.now(),
            }
            const finalAssistant = {
              role: 'assistant',
              content: [{ type: 'text', text: createEvidenceBody(fixture.imageRef) }],
              usage: usage(20, 8),
              stopReason: 'stop',
              timestamp: Date.now(),
            }
            state.messages.push(userMessage, toolAssistant, toolResult)
            await emit({ type: 'agent_start' })
            await emit({ type: 'turn_start' })
            await emit({ type: 'message_end', message: toolAssistant })
            await emit({
              type: 'tool_execution_start',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              args: {},
            })
            await emit({
              type: 'tool_execution_end',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              result: { details: toolResult.details },
              isError: false,
            })
            await emit({ type: 'turn_end', message: toolAssistant, toolResults: [toolResult] })
            captured.prepared = await options.prepareNextTurnWithContext({
              message: toolAssistant,
              toolResults: [toolResult],
              context: {
                systemPrompt: state.systemPrompt,
                messages: [...state.messages],
                tools: state.tools,
              },
              newMessages: [...state.messages],
            })
            state.messages.push(finalAssistant)
            await emit({ type: 'turn_start' })
            await emit({ type: 'message_end', message: finalAssistant })
            await emit({ type: 'turn_end', message: finalAssistant, toolResults: [] })
            await emit({ type: 'agent_end', messages: [...state.messages] })
          },
        }
      },
    })

    const summary = await runner.run(request('child-threshold-1', fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: (update) => progress.push(update.phase),
    })
    assert.ok(summary.artifactRefs.includes(
      `.xiaoliang/cad/evidence/child-threshold-1/evidence.md`,
    ))
    assert.deepEqual(compactCalls, [{ force: false, messageCount: 3 }])
    assert.match(captured.prepared.context.messages[1].content[0].text, /subagent_context_checkpoint/)
    assert.ok(progress.includes('compacting'))
    const snapshot = usageAggregator.snapshot('client-runtime')
    const childBucket = snapshot.breakdown.find((item) => (
      item.call_purpose === 'subagent'
      && item.child_run_id === 'child-threshold-1'
    ))
    assert.ok(childBucket)
    assert.equal(childBucket.call_count, 3)
    assert.equal(childBucket.usage.input, 30_000 + 20 + 11)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

/**
 * A child that keeps working but never writes its summary. `prompts` decides what each
 * successive prompt produces: 'tool_only' ends the turn on a tool call, 'summary' ends it
 * with the evidence Markdown.
 */
function createSilentChildAgentFactory(fixture, prompts, seen) {
  return (options) => {
    const listeners = []
    const state = {
      ...options.initialState,
      messages: [...(options.initialState.messages || [])],
    }
    const emit = async (event) => {
      for (const listener of listeners) await listener(event, new AbortController().signal)
    }
    return {
      state,
      subscribe(listener) {
        listeners.push(listener)
        return () => {}
      },
      abort() {},
      async continue() {},
      async prompt(promptText) {
        seen.push(promptText)
        const kind = prompts[seen.length - 1] ?? 'tool_only'
        const toolAssistant = {
          role: 'assistant',
          content: [
            { type: 'text', text: '已完成 3 张局部图，门窗表 handle 已核对，尚未整理成 Markdown。' },
            { type: 'toolCall', id: `tool-${seen.length}`, name: 'cad_capture', arguments: {} },
          ],
          usage: usage(120, 20),
          stopReason: 'toolUse',
          timestamp: Date.now(),
        }
        const toolResult = {
          role: 'toolResult',
          toolCallId: `tool-${seen.length}`,
          toolName: 'cad_capture',
          content: [{ type: 'text', text: 'ok' }],
          details: { artifact_refs: [fixture.imageRef] },
          isError: false,
          timestamp: Date.now(),
        }
        state.messages.push({ role: 'user', content: promptText, timestamp: Date.now() })
        await emit({ type: 'turn_start' })
        state.messages.push(toolAssistant)
        await emit({ type: 'message_end', message: toolAssistant })
        await emit({
          type: 'tool_execution_start',
          toolCallId: toolResult.toolCallId,
          toolName: 'cad_capture',
          args: {},
        })
        await emit({
          type: 'tool_execution_end',
          toolCallId: toolResult.toolCallId,
          toolName: 'cad_capture',
          result: { details: toolResult.details },
          isError: false,
        })
        state.messages.push(toolResult)
        await emit({ type: 'turn_end', message: toolAssistant, toolResults: [toolResult] })
        if (kind !== 'summary') return
        const finalAssistant = {
          role: 'assistant',
          content: [{ type: 'text', text: createEvidenceBody(fixture.imageRef) }],
          usage: usage(30, 300),
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        state.messages.push(finalAssistant)
        await emit({ type: 'turn_start' })
        await emit({ type: 'message_end', message: finalAssistant })
        await emit({ type: 'turn_end', message: finalAssistant, toolResults: [] })
      },
    }
  }
}

function createSalvageRunner(fixture, runStore, usageAggregator, factory) {
  return new subagents.FreshPiSubagentRunner({
    definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
    evidenceWriter: new subagents.EvidencePackWriter(),
    runStore,
    usageAggregator,
    createTools: () => dummyChildTools(),
    resolveApiKey: () => 'xl.client-runtime.fake-jwt',
    createModel: () => ({ id: 'xiaoliang-agent-default', contextWindow: 32_768, maxTokens: 4096 }),
    createAgent: factory,
  })
}

test('a child that stops before its summary is reprompted once and still publishes its pack', async () => {
  const fixture = createProjectFixture('xl-subagent-schema-retry-')
  const seen = []
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const usageAggregator = new subagents.UsageAggregator()
    usageAggregator.beginRun('client-runtime')
    const runner = createSalvageRunner(
      fixture,
      runStore,
      usageAggregator,
      createSilentChildAgentFactory(fixture, ['tool_only', 'summary'], seen),
    )

    const summary = await runner.run(request('child-schema-retry-1', fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })

    assert.equal(seen.length, 2, 'exactly one reprompt')
    assert.match(seen[1], /证据 Markdown 总结/u)
    assert.match(seen[1], /不要再调用工具/u)
    assert.ok(summary.artifactRefs.includes('.xiaoliang/cad/evidence/child-schema-retry-1/evidence.md'))
    // The reprompted turns are real child calls, so they are traced and billed like the
    // first: one assistant message from the initial prompt, two from the reprompt.
    const bucket = usageAggregator.snapshot('client-runtime').breakdown.find((item) => (
      item.call_purpose === 'subagent' && item.child_run_id === 'child-schema-retry-1'
    ))
    assert.equal(bucket.call_count, 3)
    assert.equal(bucket.usage.output, 20 + 20 + 300)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('a child that never summarizes fails with its own notes and the files it wrote', async () => {
  const fixture = createProjectFixture('xl-subagent-schema-salvage-')
  const seen = []
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const usageAggregator = new subagents.UsageAggregator()
    usageAggregator.beginRun('client-runtime')
    const runner = createSalvageRunner(
      fixture,
      runStore,
      usageAggregator,
      createSilentChildAgentFactory(fixture, ['tool_only', 'tool_only'], seen),
    )
    const coordinator = new subagents.SubagentCoordinator({ runner })

    const handle = coordinator.enqueue(request('child-schema-salvage-1', fixture.projectRoot))
    const result = await handle.result

    assert.equal(seen.length, 2, 'the reprompt is bounded to one attempt')
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'MODEL_SCHEMA_INVALID')
    // The work itself survived: the images are published and the child's account of them
    // reaches the parent, which is what stops a full re-run.
    assert.deepEqual(result.artifactRefs, [fixture.imageRef])
    assert.match(result.resultText, /门窗表 handle 已核对/u)

    const projected = subagents.projectSafeSubagentResult(result)
    const text = projected.content[0].text
    assert.match(text, /Error code: MODEL_SCHEMA_INVALID/u)
    assert.match(text, /门窗表 handle 已核对/u)
    assert.match(text, new RegExp(fixture.imageRef.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.doesNotMatch(text, /No evidence pack was published/u)
    assert.deepEqual(projected.details.artifact_refs, [fixture.imageRef])
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('overflow compact-and-retry continues once and keeps the child run alive', async () => {
  const fixture = createProjectFixture('xl-subagent-overflow-compact-')
  const compactCalls = []
  const captured = { continued: 0 }
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const usageAggregator = new subagents.UsageAggregator()
    usageAggregator.beginRun('client-runtime')
    const runner = new subagents.FreshPiSubagentRunner({
      definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
      evidenceWriter: new subagents.EvidencePackWriter(),
      runStore,
      usageAggregator,
      createTools: () => dummyChildTools(),
      resolveApiKey: () => 'xl.client-runtime.fake-jwt',
      createModel: () => ({
        id: 'xiaoliang-agent-default',
        contextWindow: 32_768,
        maxTokens: 4096,
      }),
      compactMessages: async (input) => {
        compactCalls.push({ force: input.force, lastRole: input.messages.at(-1)?.role })
        return {
          messages: [
            input.messages[0],
            {
              role: 'user',
              content: [{ type: 'text', text: '[subagent_context_checkpoint]\n\nsummary' }],
              timestamp: Date.now(),
            },
            ...input.messages.slice(-1),
          ],
          summary: 'summary',
          usage: {
            input: 9,
            output: 4,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 13,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        }
      },
      createAgent: (options) => {
        const listeners = []
        const state = {
          ...options.initialState,
          messages: [...(options.initialState.messages || [])],
        }
        const emit = async (event) => {
          for (const listener of listeners) await listener(event, new AbortController().signal)
        }
        return {
          state,
          subscribe(listener) {
            listeners.push(listener)
            return () => {}
          },
          abort() {},
          async prompt(promptText) {
            const userMessage = { role: 'user', content: promptText, timestamp: Date.now() }
            const toolAssistant = {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'tool-1', name: 'cad_artifacts', arguments: {} }],
              usage: usage(10, 2),
              stopReason: 'toolUse',
              timestamp: Date.now(),
            }
            const toolResult = {
              role: 'toolResult',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              content: [{ type: 'text', text: 'ok' }],
              details: { artifact_refs: [fixture.imageRef] },
              isError: false,
              timestamp: Date.now(),
            }
            const overflowAssistant = {
              role: 'assistant',
              content: [],
              usage: usage(40_000, 0),
              stopReason: 'error',
              errorMessage: 'Your input exceeds the context window of this model',
              timestamp: Date.now(),
            }
            state.messages.push(userMessage, toolAssistant, toolResult, overflowAssistant)
            await emit({ type: 'agent_start' })
            await emit({ type: 'turn_start' })
            await emit({ type: 'message_end', message: toolAssistant })
            await emit({
              type: 'tool_execution_start',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              args: {},
            })
            await emit({
              type: 'tool_execution_end',
              toolCallId: 'tool-1',
              toolName: 'cad_artifacts',
              result: { details: toolResult.details },
              isError: false,
            })
            await emit({ type: 'message_end', message: overflowAssistant })
            await emit({ type: 'turn_end', message: overflowAssistant, toolResults: [] })
            await emit({ type: 'agent_end', messages: [...state.messages] })
          },
          async continue() {
            captured.continued += 1
            const finalAssistant = {
              role: 'assistant',
              content: [{ type: 'text', text: createEvidenceBody(fixture.imageRef) }],
              usage: usage(20, 8),
              stopReason: 'stop',
              timestamp: Date.now(),
            }
            state.messages.push(finalAssistant)
            await emit({ type: 'turn_start' })
            await emit({ type: 'message_end', message: finalAssistant })
            await emit({ type: 'turn_end', message: finalAssistant, toolResults: [] })
            await emit({ type: 'agent_end', messages: [...state.messages] })
          },
        }
      },
    })

    const summary = await runner.run(request('child-overflow-1', fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })
    assert.equal(captured.continued, 1)
    assert.deepEqual(compactCalls, [{ force: true, lastRole: 'toolResult' }])
    assert.ok(summary.artifactRefs.includes(
      `.xiaoliang/cad/evidence/child-overflow-1/evidence.md`,
    ))
    const snapshot = usageAggregator.snapshot('client-runtime')
    const childBucket = snapshot.breakdown.find((item) => (
      item.call_purpose === 'subagent'
      && item.child_run_id === 'child-overflow-1'
    ))
    assert.ok(childBucket)
    assert.equal(childBucket.call_count, 4)
    assert.equal(childBucket.usage.input, 10 + 40_000 + 9 + 20)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('delegate_cad_drafter runs the file channel without requiring an active AutoCAD child', async () => {
  const fixture = createProjectFixture('xl-cad-backup-gate-')
  const childIds = ['child-gate-drafter', 'child-gate-analyst', 'child-gate-drafter-2']
  let childIndex = 0
  let runtime
  try {
    runtime = await subagents.createSubagentRuntime({
      definitionsDir,
      runStoreRoot: path.join(fixture.fixtureRoot, 'gate-runs'),
      mode: 'on',
      drafterMode: 'on',
      backgroundMode: 'on',
      backgroundTaskDelivery: {
        parentExists: () => true,
        isParentBusy: () => true,
        followUp: async () => undefined,
        wake: async () => undefined,
      },
      createTools: (childRequest) => (
        childRequest.type === 'cad-drafter' ? dummyDrafterTools() : dummyChildTools()
      ),
      createChildRunId: () => childIds[childIndex++] ?? `child-gate-extra-${childIndex}`,
      resolveApiKey: () => 'xl.client-gate.fake-jwt',
      createModel: () => ({ id: 'test-gate-model' }),
      createAgent: createScriptedAgentFactory({
        evidenceBody: createEvidenceBody(fixture.imageRef),
        imageRef: fixture.imageRef,
        captured: {},
        stall: true,
      }),
    })
    const tools = runtime.buildDelegateTools({
      projectId: 'project-gate',
      cadContextAvailable: true,
      resolveParentConversationId: () => 'conversation-gate',
      resolveContext: () => ({
        parentSessionId: 'conversation-gate',
        parentPromptId: 'prompt-gate',
        clientRunId: 'client-gate',
        projectId: 'project-gate',
        projectRoot: fixture.projectRoot,
        thinkingMode: 'fast',
      }),
    })
    const drafter = tools.find((tool) => tool.name === 'delegate_cad_drafter')
    const analyst = tools.find((tool) => tool.name === 'delegate_cad')
    assert.ok(drafter)
    assert.ok(analyst)

    const standalone = await drafter.execute('drafter-standalone', { task: '读取图层清单，只收集证据。' })
    assert.equal(standalone.details.agent_type, 'cad-drafter')
    assert.equal(standalone.details.task_id, 'child-gate-drafter')

    const launched = await analyst.execute('analyst-running', { task: '读取墙厚，只收集证据。' })
    assert.equal(launched.details.agent_type, 'cad-analyst')
    assert.equal(launched.details.task_id, 'child-gate-analyst')

    const concurrent = await drafter.execute('drafter-concurrent', { task: '读取门窗表，只收集证据。' })
    assert.equal(concurrent.details.agent_type, 'cad-drafter')
    assert.equal(concurrent.details.task_id, 'child-gate-drafter-2')
  } finally {
    await runtime?.dispose().catch(() => undefined)
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

function createModelFailureAgentFactory(failures, captured) {
  return (options) => {
    const listeners = []
    const state = {
      ...options.initialState,
      messages: [...(options.initialState.messages || [])],
      errorMessage: undefined,
    }
    let responseIndex = 0
    const emit = async (event) => {
      for (const listener of listeners) await listener(event, new AbortController().signal)
    }
    const emitResponse = async () => {
      const failure = failures[responseIndex++]
      state.errorMessage = failure || undefined
      const assistant = failure
        ? {
            role: 'assistant',
            content: [],
            usage: usage(0, 0),
            stopReason: 'error',
            errorMessage: failure,
            timestamp: Date.now(),
          }
        : {
            role: 'assistant',
            content: [{ type: 'text', text: 'Created XL_Test, preserved Camera, and verified the final viewport.' }],
            usage: usage(12, 5),
            stopReason: 'stop',
            timestamp: Date.now(),
          }
      state.messages.push(assistant)
      await emit({ type: 'turn_start' })
      await emit({ type: 'message_end', message: assistant })
      await emit({ type: 'turn_end', message: assistant, toolResults: [] })
      await emit({ type: 'agent_end', messages: [...state.messages] })
    }
    return {
      state,
      subscribe(listener) {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      abort() {},
      async prompt(promptText) {
        state.messages.push({ role: 'user', content: promptText, timestamp: Date.now() })
        await emit({ type: 'agent_start' })
        await emitResponse()
      },
      async continue() {
        captured.continued += 1
        await emitResponse()
      },
    }
  }
}

function createModelFailureRunner(fixture, runStore, failures, captured, retryDelays) {
  return new subagents.FreshPiSubagentRunner({
    definitions: new subagents.AgentDefinitionRegistry({ definitionsDir }),
    evidenceWriter: new subagents.EvidencePackWriter(),
    runStore,
    createTools: () => dummyBlenderTools(),
    resolveApiKey: () => 'xl.client-runtime.fake-jwt',
    createModel: () => ({ id: 'xiaoliang-agent-default', contextWindow: 32_768, maxTokens: 4096 }),
    createAgent: createModelFailureAgentFactory(failures, captured),
    waitForRetry: async (delayMs) => {
      retryDelays.push(delayMs)
    },
  })
}

function blenderRequest(childRunId, projectRoot) {
  return request(childRunId, projectRoot, {
    type: 'blender-modeler',
    task: 'Create a test object and verify the viewport.',
    description: 'Executing isolated Blender task',
  })
}

test('transient model failure retries with backoff and completes on continue', async () => {
  const fixture = createProjectFixture('xl-subagent-transient-retry-')
  const captured = { continued: 0 }
  const retryDelays = []
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = createModelFailureRunner(
      fixture,
      runStore,
      ['HTTP 503 database_busy', null],
      captured,
      retryDelays,
    )

    const summary = await runner.run(blenderRequest('child-transient-success', fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })

    assert.equal(captured.continued, 1)
    assert.equal(retryDelays.length, 1)
    assert.ok(retryDelays[0] >= 1_000 && retryDelays[0] <= 1_250)
    assert.match(summary.resultText, /Created XL_Test/u)
    const metadata = await runStore.readMetadata('child-transient-success')
    assert.equal(metadata.status, 'completed')
    assert.equal(metadata.error_message, null)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('exhausted transient retries preserve the original model error', async () => {
  const fixture = createProjectFixture('xl-subagent-transient-exhausted-')
  const captured = { continued: 0 }
  const retryDelays = []
  const finalMessage = 'HTTP 503 database_busy: QueuePool limit reached'
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = createModelFailureRunner(
      fixture,
      runStore,
      ['HTTP 503 database_busy', 'HTTP 503 database_busy', finalMessage],
      captured,
      retryDelays,
    )

    await assert.rejects(
      runner.run(blenderRequest('child-transient-exhausted', fixture.projectRoot), {
        signal: new AbortController().signal,
        reportProgress: () => {},
      }),
      (error) => {
        assert.equal(error.code, 'MODEL_UNAVAILABLE')
        assert.equal(error.message, finalMessage)
        assert.equal(error.retryable, true)
        return true
      },
    )

    assert.equal(captured.continued, 2)
    assert.equal(retryDelays.length, 2)
    const metadata = await runStore.readMetadata('child-transient-exhausted')
    assert.equal(metadata.error_code, 'MODEL_UNAVAILABLE')
    assert.equal(metadata.error_message, finalMessage)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test('authentication model failure is preserved and never retried', async () => {
  const fixture = createProjectFixture('xl-subagent-auth-failure-')
  const captured = { continued: 0 }
  const retryDelays = []
  const failureMessage = 'HTTP 401 invalid credential'
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = createModelFailureRunner(
      fixture,
      runStore,
      [failureMessage],
      captured,
      retryDelays,
    )

    await assert.rejects(
      runner.run(blenderRequest('child-auth-failure', fixture.projectRoot), {
        signal: new AbortController().signal,
        reportProgress: () => {},
      }),
      (error) => {
        assert.equal(error.code, 'MODEL_UNAVAILABLE')
        assert.equal(error.message, failureMessage)
        assert.equal(error.retryable, false)
        return true
      },
    )

    assert.equal(captured.continued, 0)
    assert.deepEqual(retryDelays, [])
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

// Provider rejections quote token ceilings, temperatures and request ids, so a classifier
// that matched any bare 5xx-looking number burned two extra paid calls per permanent failure.
for (const failureMessage of [
  'Bad request: max_completion_tokens 512 exceeds limit',
  'model qwen3.8-max rejected: invalid value for temperature 1.5, request id req-500-abc',
  'Insufficient balance (code 402), credits 0 of 5000',
]) {
  test(`permanent model rejection is never retried: ${failureMessage.slice(0, 40)}`, async () => {
    const fixture = createProjectFixture('xl-subagent-permanent-failure-')
    const captured = { continued: 0 }
    const retryDelays = []
    try {
      const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
      await runStore.initialize()
      const runner = createModelFailureRunner(
        fixture,
        runStore,
        [failureMessage],
        captured,
        retryDelays,
      )

      await assert.rejects(
        runner.run(blenderRequest('child-permanent-failure', fixture.projectRoot), {
          signal: new AbortController().signal,
          reportProgress: () => {},
        }),
        (error) => {
          assert.equal(error.code, 'MODEL_UNAVAILABLE')
          assert.equal(error.message, failureMessage)
          assert.equal(error.retryable, false)
          return true
        },
      )

      assert.equal(captured.continued, 0)
      assert.deepEqual(retryDelays, [])
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    }
  })
}

// A gateway that reports the pool timeout as a plain 500 must still be retried, so the
// status has to be read from the transport context rather than matched anywhere in the text.
test('gateway 5xx reported without a keyword is still retried', async () => {
  const fixture = createProjectFixture('xl-subagent-gateway-5xx-')
  const captured = { continued: 0 }
  const retryDelays = []
  try {
    const runStore = new subagents.SubagentRunStore({ rootDir: fixture.runStoreRoot })
    await runStore.initialize()
    const runner = createModelFailureRunner(
      fixture,
      runStore,
      ['Request failed with status code 502', null],
      captured,
      retryDelays,
    )

    const summary = await runner.run(blenderRequest('child-gateway-5xx', fixture.projectRoot), {
      signal: new AbortController().signal,
      reportProgress: () => {},
    })

    assert.equal(captured.continued, 1)
    assert.equal(retryDelays.length, 1)
    assert.match(summary.resultText, /Created XL_Test/u)
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})
