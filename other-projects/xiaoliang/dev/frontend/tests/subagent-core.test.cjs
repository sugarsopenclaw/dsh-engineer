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
    alias: { electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs') },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const subagents = loadBundledModule('electron/runtime/agent/subagents/index.ts')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitUntil(predicate, message, timeoutMs = 2000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function request(childRunId, overrides = {}) {
  return {
    childRunId,
    type: 'cad-analyst',
    task: '在结构/地下室.dwg 中定位 3 号节点并收集墙厚与局部图证据，只收集证据。',
    description: `CAD evidence ${childRunId}`,
    parentSessionId: 'session-1',
    parentPromptId: 'prompt-1',
    clientRunId: 'client-1',
    projectId: 'project-1',
    projectRoot: path.resolve(__dirname, '..'),
    model: 'xiaoliang-backend/qwen3.8-max',
    thinkingMode: 'fast',
    spawnDepth: 0,
    ...overrides,
  }
}

function evidenceRef(childRunId) {
  return `.xiaoliang/cad/evidence/${childRunId}/evidence.md`
}

function delegateDefinitions() {
  const definition = (name) => ({
    name,
    model: 'xiaoliang-backend/qwen3.8-max',
  })
  return {
    'cad-analyst': definition('cad-analyst'),
    'cad-drafter': definition('cad-drafter'),
    'blender-modeler': definition('blender-modeler'),
  }
}

function delegateContext(overrides = {}) {
  return {
    parentSessionId: 'session-terminal-budget',
    parentPromptId: 'prompt-terminal-budget',
    clientRunId: 'client-terminal-budget',
    projectId: 'project-terminal-budget',
    projectRoot: path.resolve(__dirname, '..'),
    thinkingMode: 'fast',
    ...overrides,
  }
}

function taskServiceStub() {
  return {
    register() {},
    suppressByParent() {},
  }
}

test('CAD subagent feature flag defaults on and canary is project-scoped', () => {
  assert.equal(subagents.getSubagentBackgroundMode({}), 'on')
  assert.equal(subagents.parseSubagentBackgroundMode('off'), 'off')
  assert.equal(subagents.parseSubagentBackgroundMode('false'), 'off')
  assert.equal(subagents.parseSubagentBackgroundMode('on'), 'on')
  assert.equal(subagents.getMainWebFetchMode({}), 'on')
  assert.equal(subagents.getMainWebFetchMode({ XIAOLIANG_MAIN_WEB_FETCH: 'off' }), 'off')
  assert.equal(subagents.isMainWebFetchEnabled({ XIAOLIANG_MAIN_WEB_FETCH: 'false' }), false)
  assert.equal(subagents.getWebRenderMode({}), 'off')
  assert.equal(subagents.getWebRenderMode({ XIAOLIANG_WEB_RENDER: '0' }), 'off')
  assert.equal(subagents.isWebRenderEnabled({ XIAOLIANG_WEB_RENDER: 'on' }), true)
  assert.equal(subagents.getCadSubagentMode({}), 'on')
  assert.equal(subagents.parseCadSubagentMode(' ON '), 'on')
  assert.equal(subagents.parseCadSubagentMode('unexpected'), 'on')
  assert.equal(subagents.getCadDrafterMode({}), 'on')
  assert.equal(subagents.getCadDrafterMode({ XIAOLIANG_CAD_DRAFTER: 'off' }), 'off')
  assert.equal(subagents.parseCadDrafterMode('on'), 'on')
  assert.equal(subagents.parseCadDrafterMode('1'), 'on')
  assert.equal(subagents.parseCadDrafterMode('off'), 'off')
  assert.equal(subagents.parseCadDrafterMode('0'), 'off')
  assert.equal(subagents.parseCadDrafterMode('unexpected'), 'on')
  assert.equal(subagents.isCadDrafterEnabled({ cadEnabled: true, drafterMode: 'off' }), false)
  assert.equal(subagents.isCadDrafterEnabled({ cadEnabled: true, drafterMode: 'on' }), true)
  assert.equal(subagents.isCadDrafterEnabled({ cadEnabled: false, drafterMode: 'on' }), false)
  assert.equal(subagents.isCadSubagentEnabled({ mode: 'off', projectId: 'p1' }), false)
  assert.equal(subagents.isCadSubagentEnabled({ mode: 'on' }), true)
  assert.equal(subagents.isCadSubagentEnabled({
    mode: 'canary',
    projectId: 'p1',
    canaryProjectIds: new Set(['p1']),
  }), true)
  assert.equal(subagents.isCadSubagentEnabled({
    mode: 'canary',
    projectId: 'p2',
    canaryProjectIds: new Set(['p1']),
  }), false)
})

test('drafter parallelism follows the MLightCAD window budget', () => {
  // One window is left for a concurrent analyst extraction, which draws from the same pool.
  assert.equal(subagents.getCadDrafterMaxConcurrent({}), 2)
  assert.equal(subagents.getCadDrafterMaxConcurrent({ XIAOLIANG_MLIGHT_MAX_SESSIONS: '6' }), 5)
  assert.equal(subagents.getCadDrafterMaxConcurrent({}, 5), 4)
  // A budget of one still admits a single drafter: it would otherwise be unreachable.
  assert.equal(subagents.getCadDrafterMaxConcurrent({ XIAOLIANG_MLIGHT_MAX_SESSIONS: '1' }), 1)
  assert.equal(subagents.getCadDrafterMaxConcurrent({
    XIAOLIANG_CAD_DRAFTER_MAX_CONCURRENT: '3',
    XIAOLIANG_MLIGHT_MAX_SESSIONS: '2',
  }), 3)
  // Garbage falls back rather than uncapping parallel renderers.
  assert.equal(subagents.getCadDrafterMaxConcurrent({ XIAOLIANG_MLIGHT_MAX_SESSIONS: 'lots' }), 2)
  assert.equal(subagents.getCadDrafterMaxConcurrent({ XIAOLIANG_CAD_DRAFTER_MAX_CONCURRENT: '999' }), 8)
})

test('bundled analyst, drafter and Blender definitions are isolated peers with exact tool ceilings', () => {
  const definitionsDir = path.resolve(
    __dirname,
    '..',
    'electron',
    'runtime',
    'agent',
    'subagents',
    'definitions',
  )
  const registry = new subagents.AgentDefinitionRegistry({ definitionsDir })
  const definition = registry.load('cad-analyst')

  assert.equal(definition.name, 'cad-analyst')
  assert.equal(definition.model, 'xiaoliang-backend/qwen3.8-max')
  assert.equal(definition.thinking, 'inherit')
  assert.equal(definition.contextInheritance, 'none')
  assert.equal(definition.maxSubagentDepth, 0)
  assert.deepEqual(definition.tools, [...subagents.CAD_ANALYST_TOOL_CEILING])
  assert.ok(!definition.tools.includes('shell'))
  assert.ok(!definition.tools.includes('write'))
  assert.ok(!definition.tools.includes('delegate'))
  assert.ok(!definition.tools.includes('cad_facts'))
  assert.ok(!definition.tools.includes('cad_ask'))
  assert.ok(!definition.tools.includes('cad_lookup'))
  assert.match(definition.systemPrompt, /不形成用户答案/)
  assert.match(definition.systemPrompt, /正常快路径不得前置调用 `cad_doctor`/)
  assert.match(definition.systemPrompt, /`cad_extract → 一次精确 cad_search → 一次 cad_detail → 一次 read → 立即收尾`/)
  assert.match(definition.systemPrompt, /不得改用 `cad_capture action=plot`/)
  assert.doesNotMatch(definition.systemPrompt, /四层取证顺序是硬合同/)

  const drafterDefinition = registry.load('cad-drafter')
  assert.equal(drafterDefinition.name, 'cad-drafter')
  assert.equal(drafterDefinition.model, 'xiaoliang-backend/qwen3.8-max')
  assert.equal(drafterDefinition.contextInheritance, 'none')
  assert.equal(drafterDefinition.maxSubagentDepth, 0)
  assert.deepEqual(drafterDefinition.tools, [...subagents.CAD_DRAFTER_TOOL_CEILING])
  assert.ok(!drafterDefinition.tools.includes('cad_facts'))
  assert.ok(!drafterDefinition.tools.includes('cad_ask'))
  assert.ok(!drafterDefinition.tools.includes('cad_lookup'))
  assert.match(drafterDefinition.systemPrompt, /正常路径不得触发或等待四层 facts 构建/)
  // cad_capture and cad_detail are shared names. The backup child must never reach the
  // tools that drive the AutoCAD application itself.
  for (const autocadOnlyTool of ['cad_app', 'cad_artifacts', 'cad_doctor']) {
    assert.ok(!drafterDefinition.tools.includes(autocadOnlyTool))
  }
  assert.ok(!drafterDefinition.tools.includes('write'))
  assert.ok(!drafterDefinition.tools.includes('cad_draft'))
  assert.ok(!drafterDefinition.tools.includes('cad_export'))
  assert.match(drafterDefinition.systemPrompt, /只读/)
  assert.doesNotMatch(drafterDefinition.systemPrompt, /MLightCAD|LibreDWG|制图|cad_draft/)
  assert.doesNotMatch(drafterDefinition.description, /MLightCAD|LibreDWG/)

  const blenderDefinition = registry.load('blender-modeler')
  assert.equal(blenderDefinition.name, 'blender-modeler')
  assert.equal(blenderDefinition.model, 'xiaoliang-backend/qwen3.8-max')
  assert.equal(blenderDefinition.thinking, 'inherit')
  assert.equal(blenderDefinition.contextInheritance, 'none')
  assert.equal(blenderDefinition.maxSubagentDepth, 0)
  assert.deepEqual(blenderDefinition.tools, [...subagents.BLENDER_MODELER_TOOL_CEILING])
  assert.ok(!blenderDefinition.tools.includes('shell'))
  assert.ok(!blenderDefinition.tools.includes('delegate_cad'))
  assert.match(blenderDefinition.systemPrompt, /Blender/)
  assert.throws(
    () => registry.load('research-analyst'),
    /Unknown subagent definition/u,
  )
})

test('parent prompts and CAD child definitions do not name the implementation path', () => {
  const leak = /MLightCAD|LibreDWG|内置引擎/
  const delegation = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/delegation.ts',
  )
  const tooling = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/tooling.ts',
  )
  const responseStyle = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/response-style.ts',
  )
  const reminder = loadBundledModule(
    'electron/runtime/agent/prompts/reminders/runtime-reminder-builder.ts',
  )
  const toolNames = ['delegate_cad', 'delegate_cad_drafter', 'delegate_blender', 'subagent_task_status']
  const reminderText = reminder.buildRuntimeReminder({
    now: new Date('2026-08-15T00:00:00Z'),
    conversationTitle: '测试',
    modelId: 'qwen3.8-max',
    provider: 'xiaoliang-backend',
    imageCount: 0,
    toolNames,
    computerRegionCode: 'CN',
    systemLocale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    activeCadEvidenceTask: true,
  })

  const delegationSection = delegation.buildDelegationSection(toolNames)
  assert.doesNotMatch(delegationSection, leak)
  assert.match(delegationSection, /每次委派只针对一个目标/)
  assert.match(delegationSection, /收尾失败/)
  assert.match(delegationSection, /原样保留“快速\/只看\/先汇报”/)
  assert.match(delegationSection, /extract → 精确 search → detail/)
  assert.doesNotMatch(tooling.buildToolingSection(toolNames), leak)
  assert.doesNotMatch(responseStyle.buildResponseStyleSection(toolNames), leak)
  assert.match(reminderText, /文件通道 delegate_cad_drafter/)
  assert.doesNotMatch(reminderText, leak)
  const analystOnlyReminder = reminder.buildRuntimeReminder({
    now: new Date('2026-08-15T00:00:00Z'),
    conversationTitle: '测试',
    modelId: 'qwen3.8-max',
    provider: 'xiaoliang-backend',
    imageCount: 0,
    toolNames: ['delegate_cad', 'delegate_blender', 'subagent_task_status'],
    computerRegionCode: 'CN',
    systemLocale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    activeCadEvidenceTask: true,
  })
  assert.doesNotMatch(analystOnlyReminder, /文件通道 delegate_cad_drafter/)

  const definitionsDir = path.resolve(__dirname, '..', 'electron', 'runtime', 'agent', 'subagents', 'definitions')
  const registry = new subagents.AgentDefinitionRegistry({ definitionsDir })
  assert.doesNotMatch(registry.load('cad-analyst').systemPrompt, leak)
  assert.doesNotMatch(registry.load('cad-drafter').systemPrompt, leak)
})

test('agent registry fails closed when a definition requests a tool outside the ceiling', () => {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-agent-definition-'))
  try {
    const shippedPath = path.resolve(
      __dirname,
      '..',
      'electron',
      'runtime',
      'agent',
      'subagents',
      'definitions',
      'cad-analyst.md',
    )
    const malicious = fs.readFileSync(shippedPath, 'utf8').replace('  - cad_doctor', '  - cad_doctor\n  - shell')
    fs.writeFileSync(path.join(temporaryDir, 'cad-analyst.md'), malicious)
    const registry = new subagents.AgentDefinitionRegistry({ definitionsDir: temporaryDir })
    assert.throws(() => registry.load('cad-analyst'), /outside the runtime ceiling/)
    assert.throws(() => registry.load('project-agent'), /Unknown subagent definition/)
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true })
  }
})

test('safe result projector emits fixed keys and never forwards child transcript fields', () => {
  const result = {
    childRunId: 'run-safe-1',
    type: 'cad-analyst',
    status: 'completed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: {
      input: 100,
      output: 20,
      cache_read: -5,
      cache_write: Number.NaN,
      total: 120.8,
      cost: 0.25,
    },
    durationMs: 1234.9,
    toolCallCount: 3.9,
    artifactRefs: [
      '.xiaoliang/cad/previews/drawing/details/detail-a.png',
      evidenceRef('run-safe-1'),
    ],
    rawTranscript: 'hidden child transcript',
    reasoning: 'hidden reasoning',
  }
  const projected = subagents.projectSafeSubagentResult(result)

  assert.deepEqual(Object.keys(projected.details), [...subagents.SAFE_DETAIL_KEYS])
  assert.deepEqual(Object.keys(projected.details.usage), [...subagents.SAFE_USAGE_KEYS])
  assert.equal(projected.details.model, 'qwen3.8-max')
  assert.equal(projected.details.duration_ms, 1234)
  assert.equal(projected.details.tool_call_count, 3)
  assert.equal(projected.details.usage.cache_read, 0)
  assert.equal(projected.details.usage.cache_write, 0)
  assert.equal(projected.details.usage.total, 120)
  assert.equal(projected.content.length, 1)
  assert.equal(projected.content[0].text, [
    'CAD evidence pack saved.',
    `Project-relative path: ${evidenceRef('run-safe-1')}`,
    'Read this file and inspect its cited images before answering the user. The CAD child did not produce the user-facing conclusion.',
  ].join('\n'))
  assert.doesNotMatch(JSON.stringify(projected), /hidden child transcript|hidden reasoning/)
})

test('safe result projector rejects unsafe refs and exposes only a stable failure code', () => {
  const base = {
    childRunId: 'run-safe-2',
    type: 'cad-analyst',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: {},
    durationMs: 10,
    toolCallCount: 1,
  }
  assert.throws(() => subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: ['C:\\Users\\someone\\drawing.png', evidenceRef('run-safe-2')],
  }), /unsafe artifact ref|project relative|项目相对路径/i)
  assert.throws(() => subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: [`.xiaoliang/cad/${'A'.repeat(2200)}`, evidenceRef('run-safe-2')],
  }), /unsafe artifact ref|exceeds/i)
  assert.throws(() => subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: ['/workspace/private/detail.png', evidenceRef('run-safe-2')],
  }), /unsafe artifact ref|project relative|项目相对路径/i)

  const failed = subagents.projectSafeSubagentResult({
    ...base,
    status: 'failed',
    artifactRefs: [],
    resultText: 'Partial notes at C:\\Users\\someone\\bridge.py',
    error: {
      code: 'CAD_BUSY',
      message: 'sensitive traceback C:\\Users\\someone\\bridge.py',
      retryable: true,
    },
  })
  assert.match(failed.content[0].text, /CAD_BUSY/)
  assert.doesNotMatch(failed.content[0].text, /traceback|Users|bridge\.py/)
})

test('safe result projector returns only a bounded Blender execution report', () => {
  const projected = subagents.projectSafeSubagentResult({
    childRunId: 'run-blender-safe-1',
    type: 'blender-modeler',
    status: 'completed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: { input: 12, output: 4, total: 16 },
    durationMs: 250,
    toolCallCount: 3,
    artifactRefs: [],
    resultText: 'Created XL_Wall, preserved Camera, verified the final viewport screenshot, and saved a backup to C:\\Users\\operator\\AppData\\Local\\Temp\\scene.blend.',
  })

  assert.deepEqual(Object.keys(projected.details), [...subagents.SAFE_DETAIL_KEYS])
  assert.equal(projected.details.agent_type, 'blender-modeler')
  assert.deepEqual(projected.details.artifact_refs, [])
  assert.match(projected.content[0].text, /Created XL_Wall/)
  assert.ok(projected.content[0].text.includes('C:\\Users\\operator\\AppData\\Local\\Temp\\scene.blend'))
  assert.doesNotMatch(JSON.stringify(projected), /reasoning|transcript/)
})

test('safe result projector holds the drafter to the same evidence-pack contract', () => {
  const base = {
    childRunId: 'run-drafter-safe-1',
    type: 'cad-drafter',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: { input: 40, output: 8, total: 48 },
    durationMs: 900,
    toolCallCount: 2,
  }

  const projected = subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: ['.xiaoliang/cad/evidence/run-drafter-safe-1/evidence.md'],
  })
  assert.deepEqual(Object.keys(projected.details), [...subagents.SAFE_DETAIL_KEYS])
  assert.equal(projected.details.agent_type, 'cad-drafter')
  assert.match(projected.content[0].text, /CAD evidence pack saved/)
  assert.doesNotMatch(projected.content[0].text, /MLightCAD/)
  assert.match(projected.content[0].text, /run-drafter-safe-1\/evidence\.md/)

  assert.throws(() => subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: ['.xiaoliang/cad/evidence/run-drafter-safe-1/evidence.md'],
    resultText: 'The drawing has 12 layers.',
  }), /cannot expose direct child text/)

  assert.throws(() => subagents.projectSafeSubagentResult({
    ...base,
    status: 'completed',
    artifactRefs: [],
  }), /canonical evidence pack ref/)

  // A drafter failure should point the parent at the AutoCAD fallback rather than
  // leaving it to conclude the drawing is unreadable.
  const failed = subagents.projectSafeSubagentResult({
    ...base,
    status: 'failed',
    artifactRefs: [],
    error: { code: 'INTERNAL_ERROR', message: 'boom', retryable: false },
  })
  assert.match(failed.content[0].text, /in-flight CAD evidence/)
  assert.doesNotMatch(failed.content[0].text, /MLightCAD|cad-analyst/)
})

test('evidence writer validates four sections and atomically publishes a project-relative pack', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-evidence-project-'))
  const imageRef = '.xiaoliang/cad/previews/drawing/details/detail-a.png'
  const imagePath = path.join(projectRoot, ...imageRef.split('/'))
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const taskText = '在结构/地下室.dwg 中定位 3 号节点并核验墙厚。'
  const evidenceBody = [
    '## 目标定位',
    '- 图纸：结构/地下室.dwg；区域：frame-01 / q2。',
    '',
    '## 图片证据',
    `- [IMG-001] \`${imageRef}\`，可见节点标题与相邻墙线。`,
    '',
    '## 实体与文件摘录',
    '- [ENT-001] handle=A12，type=DIMENSION，measurement=200。',
    '',
    '## 限制与未采用材料',
    '- q4 与目标不在同一区域，未采用。',
  ].join('\n')

  try {
    const writer = new subagents.EvidencePackWriter()
    const result = await writer.write({
      projectRoot,
      childRunId: 'run-evidence-1',
      task: taskText,
      evidenceBody,
      artifactRefs: [imageRef],
    })
    const content = fs.readFileSync(result.absolutePath, 'utf8')

    assert.equal(result.relativePath, evidenceRef('run-evidence-1'))
    assert.deepEqual(result.artifactRefs, [imageRef, evidenceRef('run-evidence-1')])
    assert.match(content, /^# CAD Evidence Pack\n\n## 委派任务\n/m)
    assert.ok(content.includes(taskText))
    assert.equal((content.match(/^## 委派任务$/gm) || []).length, 1)
    assert.ok(content.indexOf('## 目标定位') < content.indexOf('## 图片证据'))
    assert.ok(content.indexOf('## 图片证据') < content.indexOf('## 实体与文件摘录'))
    assert.ok(content.indexOf('## 实体与文件摘录') < content.indexOf('## 限制与未采用材料'))
    assert.equal(fs.readdirSync(path.dirname(result.absolutePath)).filter((name) => name.endsWith('.tmp')).length, 0)
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-evidence-1',
      task: taskText,
      evidenceBody,
      artifactRefs: [imageRef],
    }), /EEXIST|exist/i)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('evidence writer rejects answer sections, embedded binary, and path escape', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-evidence-reject-'))
  const validBody = [
    '## 目标定位',
    '- 无。',
    '## 图片证据',
    '- 无。',
    '## 实体与文件摘录',
    '- 无。',
    '## 限制与未采用材料',
    '- 无。',
  ].join('\n')
  const writer = new subagents.EvidencePackWriter()

  try {
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-reject-1',
      task: '收集指定节点证据。',
      evidenceBody: `${validBody}\n\n### 最终答案\n节点满足要求。`,
    }), /conclusion or recommendation heading/i)
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-reject-2',
      task: '收集指定节点证据。',
      evidenceBody: validBody.replace('- 无。', '- data:image/png;base64,AAAA'),
    }), /二进制|敏感信息/)
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-reject-task-path',
      task: '读取 C:\\Users\\operator\\drawing.dwg 并收集证据。',
      evidenceBody: validBody,
    }), /绝对路径|相对路径/)
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-reject-body-path',
      task: '收集指定节点证据。',
      evidenceBody: validBody.replace('- 无。', '- 来源：/home/operator/drawing.dwg'),
    }), /绝对路径|相对路径/)
    await assert.rejects(() => writer.write({
      projectRoot,
      childRunId: 'run-reject-4',
      task: '收集指定节点证据。',
      evidenceBody: validBody,
      artifactRefs: ['../outside.txt'],
    }), /artifact ref/i)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('evidence writer drops missing, non-file and undeclared refs with warnings instead of rejecting', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-evidence-downgrade-'))
  const existingRef = '.xiaoliang/cad/previews/drawing/details/detail-b.png'
  const existingPath = path.join(projectRoot, ...existingRef.split('/'))
  fs.mkdirSync(path.dirname(existingPath), { recursive: true })
  fs.writeFileSync(existingPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  // Exists on disk, but no tool result declared it: it is left out of the pack.
  const existingUndeclaredRef = '.xiaoliang/cad/previews/drawing/details/detail-c.png'
  fs.writeFileSync(
    path.join(projectRoot, ...existingUndeclaredRef.split('/')),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  )
  // A planned facts store directory and a still-missing binding file stand in for L2/L3
  // outputs that a background build has not produced yet.
  const directoryRef = '.xiaoliang/cad/facts/drawings/demo/semantic'
  fs.mkdirSync(path.join(projectRoot, ...directoryRef.split('/')), { recursive: true })
  const missingRef = '.xiaoliang/cad/facts/binding.json'
  const body = [
    '## 目标定位',
    '- 无。',
    '',
    '## 图片证据',
    `- [IMG-001] \`${existingRef}\`，可见节点标题。`,
    `- [IMG-002] \`${existingUndeclaredRef}\`，可见两侧墙线。`,
    '',
    '## 实体与文件摘录',
    `- 索引见 \`${missingRef}\`。`,
    '',
    '## 限制与未采用材料',
    '- 无。',
  ].join('\n')
  const writer = new subagents.EvidencePackWriter()

  try {
    const result = await writer.write({
      projectRoot,
      childRunId: 'run-downgrade-1',
      task: '收集指定节点证据。',
      evidenceBody: body,
      artifactRefs: [existingRef, missingRef, directoryRef],
    })

    assert.deepEqual(result.artifactRefs, [existingRef, evidenceRef('run-downgrade-1')])
    assert.ok(fs.existsSync(result.absolutePath))
    assert.equal(result.warnings.length, 2)
    assert.match(result.warnings[0], /not existing regular files/u)
    assert.ok(result.warnings[0].includes(missingRef))
    assert.ok(result.warnings[0].includes(directoryRef))
    assert.match(result.warnings[1], /undeclared artifacts/u)
    assert.ok(result.warnings[1].includes(existingUndeclaredRef))
    assert.ok(result.warnings[1].includes(missingRef))
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('only completed Blender reports may contain host paths', () => {
  const {
    assertSafeCompletedBlenderReportText,
    assertSafeSubagentText,
  } = loadBundledModule(
    'electron/runtime/agent/subagents/security.ts',
  )

  const hostPathReports = [
    '把成果保存到 E:\\projects\\demo\\out.blend',
    '读取 /home/user/model.blend 后建模',
    '备份位于 file:///C:/Users/operator/model.blend',
  ]
  for (const report of hostPathReports) {
    assert.throws(
      () => assertSafeSubagentText('Subagent task', report),
      /相对路径[\s\S]*子代理未启动/,
    )
    assert.doesNotThrow(
      () => assertSafeCompletedBlenderReportText('Blender report', report),
    )
  }
  assert.throws(
    () => assertSafeSubagentText('Subagent task', '用 api_key=sk-live-1234 调用服务'),
    /凭证或密钥/,
  )
  assert.throws(
    () => assertSafeCompletedBlenderReportText('Blender report', '用 api_key=sk-live-1234 调用服务'),
    /凭证或密钥/,
  )
  assert.doesNotThrow(
    () => assertSafeSubagentText('Subagent task', '在 xiaoliang-outputs/demo.blend 建立 1m 立方体，截图自检。'),
  )
})

test('coordinator reports an active AutoCAD analyst only while that child is unfinished', async () => {
  const gate = deferred()
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run() {
        return gate.promise
      },
    },
  })
  assert.equal(coordinator.hasActiveType('session-active', 'cad-analyst'), false)
  const handle = coordinator.enqueue(request('run-active-analyst', {
    parentSessionId: 'session-active',
  }))
  await waitUntil(() => handle.snapshot().status === 'running', 'analyst did not start')
  assert.equal(coordinator.hasActiveType('session-active', 'cad-analyst'), true)
  assert.equal(coordinator.hasActiveType('session-other', 'cad-analyst'), false)
  assert.equal(coordinator.hasActiveType('session-active', 'cad-drafter'), false)
  gate.resolve({ artifactRefs: [evidenceRef('run-active-analyst')] })
  await handle.result
  assert.equal(coordinator.hasActiveType('session-active', 'cad-analyst'), false)
})

test('coordinator runs CAD children FIFO with max concurrency one and emits safe snapshots', async () => {
  const calls = []
  const gates = new Map()
  const events = []
  let active = 0
  let maxActive = 0
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest, context) {
        calls.push(childRequest.childRunId)
        active += 1
        maxActive = Math.max(maxActive, active)
        context.reportProgress({ phase: 'extracting', lastToolName: 'cad_extract', toolCallCount: 1 })
        const gate = deferred()
        gates.set(childRequest.childRunId, gate)
        return gate.promise.finally(() => {
          active -= 1
        })
      },
    },
  })
  coordinator.subscribe((snapshot) => events.push(snapshot))

  const first = coordinator.enqueue(request('run-fifo-1'))
  const second = coordinator.enqueue(request('run-fifo-2'))
  await waitUntil(() => gates.has('run-fifo-1'), 'first child did not start')
  assert.deepEqual(calls, ['run-fifo-1'])
  assert.equal(first.snapshot().status, 'running')
  assert.equal(second.snapshot().status, 'queued')
  assert.equal(second.snapshot().queuePosition, 1)
  assert.ok(!Object.hasOwn(first.snapshot(), 'task'))
  assert.ok(!Object.hasOwn(first.snapshot(), 'projectRoot'))

  gates.get('run-fifo-1').resolve({
    usage: { input: 10, output: 2, total: 12, cost: 0.1 },
    toolCallCount: 2,
    artifactRefs: [evidenceRef('run-fifo-1')],
  })
  const firstResult = await first.result
  await waitUntil(() => gates.has('run-fifo-2'), 'second child did not start after first completion')
  assert.equal(firstResult.status, 'completed')
  assert.equal(firstResult.usage.total, 12)
  assert.deepEqual(calls, ['run-fifo-1', 'run-fifo-2'])

  gates.get('run-fifo-2').resolve({
    toolCallCount: 1,
    artifactRefs: [evidenceRef('run-fifo-2')],
  })
  assert.equal((await second.result).status, 'completed')
  assert.equal(maxActive, 1)
  assert.ok(events.some((event) => event.childRunId === 'run-fifo-1' && event.status === 'initializing'))
  assert.ok(events.some((event) => event.childRunId === 'run-fifo-1' && event.status === 'running'))
  assert.ok(events.some((event) => event.childRunId === 'run-fifo-1' && event.status === 'completed'))
})

test('coordinator schedules CAD, drafter and Blender as independent peer queues', async () => {
  const gates = new Map()
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest) {
        const gate = deferred()
        gates.set(childRequest.childRunId, gate)
        return gate.promise
      },
    },
  })

  const cad = coordinator.enqueue(request('run-peer-cad'))
  const drafter = coordinator.enqueue(request('run-peer-drafter', {
    type: 'cad-drafter',
    task: '读取 图纸/平面.dwg 的图层清单并说明各层实体分布，只收集证据。',
    description: 'Reading the drawing with the built-in CAD engine',
  }))
  const blender = coordinator.enqueue(request('run-peer-blender', {
    type: 'blender-modeler',
    task: '在 Blender 中创建一个 2m × 3m × 0.2m 的墙体并截图自检。',
    description: 'Building and verifying the Blender scene',
  }))
  await waitUntil(
    () => gates.has('run-peer-cad') && gates.has('run-peer-drafter') && gates.has('run-peer-blender'),
    'peer child queues did not start independently',
  )
  assert.equal(cad.snapshot().status, 'running')
  assert.equal(drafter.snapshot().status, 'running')
  assert.equal(blender.snapshot().status, 'running')

  gates.get('run-peer-cad').resolve({ artifactRefs: [evidenceRef('run-peer-cad')] })
  gates.get('run-peer-drafter').resolve({ artifactRefs: [evidenceRef('run-peer-drafter')] })
  gates.get('run-peer-blender').resolve({
    artifactRefs: [],
    resultText: 'Created XL_Wall and verified it in the viewport.',
  })
  assert.equal((await cad.result).type, 'cad-analyst')
  assert.equal((await drafter.result).type, 'cad-drafter')
  assert.equal((await blender.result).type, 'blender-modeler')
})

test('drafter runs two children at once while the AutoCAD analyst stays serial', async () => {
  const gates = new Map()
  let activeDrafters = 0
  let maxActiveDrafters = 0
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest) {
        if (childRequest.type === 'cad-drafter') {
          activeDrafters += 1
          maxActiveDrafters = Math.max(maxActiveDrafters, activeDrafters)
        }
        const gate = deferred()
        gates.set(childRequest.childRunId, gate)
        return gate.promise.finally(() => {
          if (childRequest.type === 'cad-drafter') activeDrafters -= 1
        })
      },
    },
  })

  const drafterRequest = (childRunId) => request(childRunId, {
    type: 'cad-drafter',
    task: '读取 图纸/平面.dwg 的图层清单，只收集证据。',
    description: 'Reading the drawing with the built-in CAD engine',
  })
  const first = coordinator.enqueue(drafterRequest('run-drafter-1'))
  const second = coordinator.enqueue(drafterRequest('run-drafter-2'))
  const third = coordinator.enqueue(drafterRequest('run-drafter-3'))

  await waitUntil(
    () => gates.has('run-drafter-1') && gates.has('run-drafter-2'),
    'drafter did not admit two concurrent children',
  )
  assert.equal(gates.has('run-drafter-3'), false)
  assert.equal(third.snapshot().status, 'queued')

  gates.get('run-drafter-1').resolve({ artifactRefs: [evidenceRef('run-drafter-1')] })
  assert.equal((await first.result).status, 'completed')
  await waitUntil(() => gates.has('run-drafter-3'), 'queued drafter child never started')

  gates.get('run-drafter-2').resolve({ artifactRefs: [evidenceRef('run-drafter-2')] })
  gates.get('run-drafter-3').resolve({ artifactRefs: [evidenceRef('run-drafter-3')] })
  assert.equal((await second.result).status, 'completed')
  assert.equal((await third.result).status, 'completed')
  assert.equal(maxActiveDrafters, 2)
})

test('queued cancellation never invokes the runner', async () => {
  const calls = []
  const firstGate = deferred()
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest) {
        calls.push(childRequest.childRunId)
        if (childRequest.childRunId === 'run-cancel-1') return firstGate.promise
        return Promise.resolve({ artifactRefs: [evidenceRef(childRequest.childRunId)] })
      },
    },
  })

  const first = coordinator.enqueue(request('run-cancel-1'))
  const queued = coordinator.enqueue(request('run-cancel-2'))
  await waitUntil(() => first.snapshot().status === 'running', 'first child did not enter running')
  assert.equal(queued.cancel('user cancelled'), true)
  const cancelled = await queued.result
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.error.code, 'SUBAGENT_CANCELLED')
  assert.deepEqual(calls, ['run-cancel-1'])

  firstGate.resolve({ artifactRefs: [evidenceRef('run-cancel-1')] })
  await first.result
})

test('parent prompt cancellation aborts only owned runs and releases the CAD slot', async () => {
  const calls = []
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest, context) {
        calls.push(childRequest.childRunId)
        if (childRequest.childRunId !== 'run-parent-a') {
          return Promise.resolve({ artifactRefs: [evidenceRef(childRequest.childRunId)] })
        }
        return new Promise((resolve, reject) => {
          if (context.signal.aborted) reject(new Error('aborted'))
          else context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    },
  })

  const running = coordinator.enqueue(request('run-parent-a', {
    parentSessionId: 'session-owned',
    parentPromptId: 'prompt-owned',
  }))
  await waitUntil(() => running.snapshot().status === 'running', 'owned child did not enter running')
  const queuedOwned = coordinator.enqueue(request('run-parent-b', {
    parentSessionId: 'session-owned',
    parentPromptId: 'prompt-owned',
  }))
  const unrelated = coordinator.enqueue(request('run-parent-c', {
    parentSessionId: 'session-owned',
    parentPromptId: 'prompt-other',
  }))

  assert.equal(coordinator.cancelByParent('session-owned', 'prompt-owned'), 2)
  assert.equal((await running.result).status, 'cancelled')
  assert.equal((await queuedOwned.result).status, 'cancelled')
  assert.equal((await unrelated.result).status, 'completed')
  assert.deepEqual(calls, ['run-parent-a', 'run-parent-c'])
})

test('coordinator rejects model override, nested spawn, and context-bearing request fields', () => {
  let runnerCalls = 0
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run: async () => {
        runnerCalls += 1
        return {}
      },
    },
  })
  assert.throws(() => coordinator.enqueue(request('run-invalid-model', { model: 'other/model' })), /not allowed/)
  assert.throws(() => coordinator.enqueue(request('run-invalid-depth', { spawnDepth: 1 })), /spawnDepth exceeds/)
  assert.throws(() => coordinator.enqueue({
    ...request('run-invalid-context'),
    messages: [{ role: 'user', content: 'parent transcript' }],
  }), /unsupported fields: messages/)
  assert.throws(() => coordinator.enqueue(request('run-invalid-path', {
    task: '读取 C:\\Users\\operator\\drawing.dwg 并收集证据。',
  })), /绝对路径|相对路径/)
  assert.equal(runnerCalls, 0)
})

test('selectCompactionCut pins the delegated task and never starts the tail on a tool result', () => {
  const compaction = loadBundledModule('electron/runtime/agent/subagents/subagent-compaction.ts')
  const user = (text) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 })
  const assistant = (text) => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 1,
  })
  const tool = (text) => ({
    role: 'toolResult',
    toolCallId: 'tool-1',
    toolName: 'cad_search',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 1,
  })
  const task = user('--- BEGIN DELEGATED TASK ---\ncollect evidence\n--- END DELEGATED TASK ---')
  const asst1 = assistant('x'.repeat(400))
  const tool1 = tool('y'.repeat(400))
  const asst2 = assistant('z'.repeat(400))
  const tool2 = tool('a'.repeat(40))
  const asst3 = assistant('b'.repeat(40))
  const messages = [task, asst1, tool1, asst2, tool2, asst3]

  const cut = compaction.selectCompactionCut(messages, 50)
  assert.equal(cut.pinned, task)
  assert.deepEqual(cut.middle, [asst1, tool1])
  assert.deepEqual(cut.tail, [asst2, tool2, asst3])
  assert.notEqual(cut.tail[0].role, 'toolResult')
  assert.equal(compaction.selectCompactionCut(messages, 10_000), null)

  const tight = compaction.selectCompactionCut(messages, 5)
  assert.equal(tight.pinned, task)
  assert.equal(tight.tail[0], asst3)
  assert.ok(tight.middle.includes(asst2))

  const small = [task, asst3]
  assert.equal(compaction.selectCompactionCut(small, 50), null)
  const forced = compaction.selectCompactionCut(small, 50, { force: true })
  assert.deepEqual(forced.middle, [asst3])
  assert.deepEqual(forced.tail, [])
})

test('compactSubagentMessages writes a host checkpoint and rolls previous summaries', async () => {
  const compaction = loadBundledModule('electron/runtime/agent/subagents/subagent-compaction.ts')
  const task = {
    role: 'user',
    content: [{ type: 'text', text: '--- BEGIN DELEGATED TASK ---\ncollect\n--- END DELEGATED TASK ---' }],
    timestamp: 1,
  }
  const asst1 = {
    role: 'assistant',
    content: [{ type: 'text', text: 'x'.repeat(400) }],
    stopReason: 'stop',
    timestamp: 2,
  }
  const captured = {}
  const result = await compaction.compactSubagentMessages({
    messages: [task, asst1],
    model: { id: 'test', maxTokens: 4096, contextWindow: 32_768 },
    apiKey: 'test-key',
    force: true,
    previousSummary: 'old summary',
    generateSummary: async (_messages, _model, _reserve, apiKey, _headers, _signal, _custom, previous) => {
      captured.apiKey = apiKey
      captured.previous = previous
      return {
        text: 'Goal: collect evidence',
        usage: {
          input: 3,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
    },
  })
  assert.equal(captured.apiKey, 'test-key')
  assert.equal(captured.previous, 'old summary')
  assert.equal(result.messages[0], task)
  assert.equal(result.messages[1].role, 'user')
  assert.match(result.messages[1].content[0].text, /\[subagent_context_checkpoint\]/)
  assert.match(result.messages[1].content[0].text, /Goal: collect evidence/)
  assert.equal(result.summary, 'Goal: collect evidence')
})

test('coordinator cannot mark a child completed before its canonical evidence pack exists', async () => {
  const coordinator = new subagents.SubagentCoordinator({
    runner: { run: async () => ({ artifactRefs: [] }) },
  })
  const result = await coordinator.enqueue(request('run-no-evidence')).result
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'ARTIFACT_MISSING')
  assert.deepEqual(result.artifactRefs, [])
})

test('a schema-invalid failure is projected as terminal', () => {
  const salvageRef = '.xiaoliang/cad/previews/drawing/details/schema-salvage.png'
  const projected = subagents.projectSafeSubagentResult({
    childRunId: 'run-schema-terminal-1',
    type: 'cad-analyst',
    status: 'failed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: {},
    durationMs: 250,
    toolCallCount: 2,
    artifactRefs: [salvageRef],
    resultText: '已定位到图框，但最终证据包未通过结构校验。',
    error: {
      code: 'MODEL_SCHEMA_INVALID',
      message: 'sensitive child detail',
      retryable: false,
    },
  })

  assert.equal(projected.details.terminal, true)
  assert.match(projected.content[0].text, /本轮终态失败/u)
  assert.match(projected.content[0].text, /不得只说“重试中”/u)
  assert.match(projected.content[0].text, /salvage/u)
  assert.ok(projected.content[0].text.includes(salvageRef))
  assert.match(projected.content[0].text, /delegate_cad_drafter/u)
  assert.doesNotMatch(projected.content[0].text, /sensitive child detail/u)
})

test('a second delegate for the same user task is refused after a schema failure', async () => {
  let childSequence = 0
  let runnerCalls = 0
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      async run() {
        runnerCalls += 1
        throw new subagents.SubagentRunError(
          'MODEL_SCHEMA_INVALID',
          'Child returned an invalid schema.',
        )
      },
    },
  })
  const service = new subagents.SubagentDelegateService({
    coordinator,
    definitions: delegateDefinitions(),
    cadMode: 'on',
    backgroundEnabled: true,
    taskService: taskServiceStub(),
    createChildRunId: () => `child-terminal-budget-${++childSequence}`,
  })
  const context = delegateContext()

  const first = await service.delegate('cad-analyst', '收集指定节点的 CAD 证据。', context)
  assert.ok(['queued', 'initializing', 'running'].includes(first.details.status))
  await waitUntil(
    () => coordinator.getSnapshot('child-terminal-budget-1')?.status === 'failed',
    'first schema-invalid child did not settle',
  )
  await new Promise((resolve) => setImmediate(resolve))

  const refused = await service.delegate('cad-analyst', '再次收集同一节点的 CAD 证据。', context)
  assert.equal(refused.details.status, 'failed')
  assert.equal(refused.details.terminal, true)
  assert.match(refused.content[0].text, /终态失败一次/u)
  assert.match(refused.content[0].text, /不得再次启动 child/u)
  assert.equal(runnerCalls, 1)
  assert.equal(coordinator.listSnapshots().length, 1)
})

test('a completed run clears the failure budget', async () => {
  const firstGate = deferred()
  let childSequence = 0
  const coordinator = new subagents.SubagentCoordinator({
    runner: {
      run(childRequest) {
        if (childRequest.childRunId === 'child-clear-budget-1') return firstGate.promise
        return Promise.resolve({ artifactRefs: [evidenceRef(childRequest.childRunId)] })
      },
    },
  })
  const service = new subagents.SubagentDelegateService({
    coordinator,
    definitions: delegateDefinitions(),
    cadMode: 'on',
    backgroundEnabled: true,
    taskService: taskServiceStub(),
    createChildRunId: () => `child-clear-budget-${++childSequence}`,
  })
  const context = delegateContext({
    parentSessionId: 'session-clear-budget',
    parentPromptId: 'prompt-clear-budget',
  })

  await service.delegate('cad-analyst', '收集第一组 CAD 证据。', context)
  await waitUntil(
    () => coordinator.getSnapshot('child-clear-budget-1')?.status === 'running',
    'first child did not start',
  )
  await service.delegate('cad-analyst', '收集同任务的并行补充证据。', context)
  firstGate.reject(new subagents.SubagentRunError(
    'MODEL_SCHEMA_INVALID',
    'First child returned an invalid schema.',
  ))

  await waitUntil(
    () => coordinator.getSnapshot('child-clear-budget-1')?.status === 'failed'
      && coordinator.getSnapshot('child-clear-budget-2')?.status === 'completed',
    'the failed/completed pair did not settle',
  )
  await new Promise((resolve) => setImmediate(resolve))

  const third = await service.delegate('cad-analyst', '完成后重新收集 CAD 证据。', context)
  assert.ok(['queued', 'initializing', 'running'].includes(third.details.status))
  assert.equal(coordinator.listSnapshots().length, 3)
  await waitUntil(
    () => coordinator.getSnapshot('child-clear-budget-3')?.status === 'completed',
    'cleared budget did not admit a new child',
  )
})
