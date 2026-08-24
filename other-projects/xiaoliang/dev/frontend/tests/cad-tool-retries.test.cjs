const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

/** The gateway is driven through the injected fetch, so only the model factory is stubbed. */
async function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const stubModelFactory = {
    name: 'stub-managed-model',
    setup(build) {
      build.onResolve({ filter: /managed-model-factory$/ }, (args) => ({
        path: args.path,
        namespace: 'stub-model',
      }))
      build.onLoad({ filter: /.*/, namespace: 'stub-model' }, () => ({
        contents: 'exports.buildManagedPiModel = () => ({'
          + " id: 'xiaoliang-agent-default',"
          + " name: 'qwen3.8-max',"
          + " baseUrl: 'http://127.0.0.1:9/agent/v1',"
          + ' contextWindow: 262144,'
          + ' maxTokens: 8192 })',
        loader: 'js',
      }))
    },
  }
  const output = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins: [stubModelFactory],
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

let projectFilesModule
async function loadProjectFileTools(projectRoot) {
  projectFilesModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/project-files.ts',
  )
  const tools = projectFilesModule.buildCadSubagentProjectFileTools(projectRoot)
  return new Map(tools.map((tool) => [tool.name, tool]))
}

let queryModule
async function loadCadQueryTool(projectRoot, usageContext) {
  queryModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-query.ts',
  )
  return queryModule.buildCadQueryTool(projectRoot, usageContext)
}

let cadToolsModule
async function loadCadTools(projectRoot, options) {
  cadToolsModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts',
  )
  return cadToolsModule.buildCadSubagentCadTools({
    projectRoot,
    cadQuery: {
      apiKey: 'test-key',
      clientRunId: 'client-cad-tools',
      childRunId: 'child-cad-tools',
    },
    capabilities: async () => ({
      operations: ['app.status', 'app.start', 'app.restart'],
      drawing_write_operations: [],
      stateful_operations: ['app.start', 'app.restart'],
    }),
    ...options,
  })
}

function entityLine(handle, type, text) {
  return JSON.stringify({
    handle,
    type,
    layer: 'A-DOOR',
    bbox: { min: [0, 0], max: [1_000, 1_000] },
    ...(text ? { content_clean: text } : {}),
  })
}

function createProject(drawings) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-cad-retry-')))
  for (const drawing of drawings) {
    const directory = path.join(root, '.xiaoliang', 'cad', 'drawings', drawing, 'entities')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      path.join(directory, 'entities.raw.jsonl'),
      `${entityLine('2A1', 'text', 'M-1 door')}\n${entityLine('2A2', 'line')}\n`,
    )
  }
  return root
}

test('a guessed cad_search path answers with the indexes the project actually has', async (t) => {
  const projectRoot = createProject(['plan--111111111111', 'facade--222222222222'])
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const tools = await loadProjectFileTools(projectRoot)
  const cadSearch = tools.get('cad_search')

  await assert.rejects(
    () => cadSearch.execute('call-1', {
      path: '.xiaoliang/cad/drawings/plan/entities/entities.raw.jsonl',
      terms: ['M-1'],
    }),
    (error) => {
      assert.match(error.message, /found no artifact at/u)
      assert.match(error.message, /drawings\/plan--111111111111\/entities\/entities\.raw\.jsonl/u)
      assert.match(error.message, /drawings\/facade--222222222222\/entities\/entities\.raw\.jsonl/u)
      return true
    },
  )

  await assert.rejects(
    () => cadSearch.execute('call-2', {
      path: '.xiaoliang/cad/drawings/plan--111111111111/entities/entities.readable.md',
      terms: ['M-1'],
    }),
    (error) => {
      assert.match(error.message, /only accepts an entities\.raw\.jsonl artifact/u)
      assert.match(error.message, /Available entity indexes:/u)
      return true
    },
  )

  const found = await cadSearch.execute('call-3', {
    path: '.xiaoliang/cad/drawings/plan--111111111111/entities/entities.raw.jsonl',
    terms: ['M-1'],
  })
  assert.equal(found.details.match_count, 1)
})

test('a project with no entity index says what to run instead of listing nothing', async (t) => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-cad-empty-')))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const tools = await loadProjectFileTools(projectRoot)
  await assert.rejects(
    () => tools.get('cad_search').execute('call-1', {
      path: '.xiaoliang/cad/drawings/plan/entities/entities.raw.jsonl',
      terms: ['M-1'],
    }),
    /No entities\.raw\.jsonl exists in this project yet; run cad_extract action=run/u,
  )
})

function gatewayResponse(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

test('cad_app restart is bounded and cad_doctor emits a deterministic recovery action', async (t) => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-cad-app-restart-')))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const restartCalls = []
  const diagnosis = {
    bridge: {
      state: 'healthy',
      projectRoot,
      pid: 100,
      adopted: false,
      activeLeases: 1,
      consecutiveHealthFailures: 0,
      restartCount: 0,
      lastHealthAt: null,
      lastHealthyAt: null,
      lastError: null,
      events: [],
      reachable: true,
      protocolVersion: 1,
      operations: ['app.status', 'app.start', 'app.restart'],
      drawingWriteOperations: [],
      statefulOperations: ['app.start', 'app.restart'],
    },
    autocad: {
      state: 'busy',
      fullInstalled: null,
      ltInstalled: null,
      comRegistered: null,
      running: false,
      supported: true,
      visible: null,
      version: null,
      documentCount: 0,
      documents: [],
      errorCode: 'CAD_BUSY',
      message: 'AutoCAD is busy. Run cad_doctor first, then consider cad_app action=restart.',
    },
    plot: {
      state: 'busy',
      ready: false,
      operationAvailable: true,
      activeDocument: null,
      dependencies: { pywin32: null, pillow: null, pdfium: null },
      configurations: { pdf: null, png: null },
      warnings: [],
      message: 'AutoCAD is busy.',
    },
    updatedAt: new Date().toISOString(),
  }
  const tools = await loadCadTools(projectRoot, {
    facade: {
      async restart(options) {
        restartCalls.push(options)
        return {
          running: true,
          supported: true,
          visible: true,
          version: '24.3',
          document_count: 0,
          documents: [],
          restarted: true,
          forced: true,
          quitMode: 'forced_pid',
        }
      },
    },
    diagnose: async () => diagnosis,
  })
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  const restarted = JSON.parse((await byName.get('cad_app').execute(
    'restart-call',
    { action: 'restart', force: true },
  )).content[0].text)
  assert.deepEqual(restartCalls, [{ force: true }])
  assert.equal(restarted.operation, 'app.restart')
  assert.equal(restarted.data.forced, true)
  assert.equal(restarted.data.quit_mode, 'forced_pid')

  const doctor = JSON.parse((await byName.get('cad_doctor').execute(
    'doctor-call',
    {},
  )).content[0].text)
  assert.equal(doctor.data.recommended_action, 'restart')

  diagnosis.autocad.message = 'AutoCAD is processing another operation.'
  const transientBusy = JSON.parse((await byName.get('cad_doctor').execute(
    'doctor-transient-busy-call',
    {},
  )).content[0].text)
  assert.equal(transientBusy.data.recommended_action, 'report')

  diagnosis.autocad.state = 'not_running'
  diagnosis.autocad.comRegistered = true
  diagnosis.autocad.message = 'AutoCAD is not running.'
  const stopped = JSON.parse((await byName.get('cad_doctor').execute(
    'doctor-stopped-call',
    {},
  )).content[0].text)
  assert.equal(stopped.data.recommended_action, 'start')
})

function completion(content, tokens) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: tokens, completion_tokens: tokens, total_tokens: tokens * 2 },
  }
}

async function runQuery(projectRoot, responses) {
  const recorded = []
  const tool = await loadCadQueryTool(projectRoot, {
    apiKey: 'test-key',
    clientRunId: 'client-1',
    childRunId: 'child-1',
    recordUsage: (attempt, usage) => recorded.push({ attempt, usage }),
    fetchFn: async () => gatewayResponse(responses.shift()),
  })
  const result = await tool.execute('call-1', {
    request: '门 M-1 出现在哪些图层',
    drawing_paths: ['drawings/plan.dwg'],
  })
  return { result, recorded }
}

/**
 * cad_query needs a valid published entity artifact, so the manifest is produced by the same
 * publisher the tool validates against instead of being hand-written here.
 */
async function publishIndex(projectRoot) {
  const store = await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/artifact-store.ts',
  )
  const drawing = { name: 'plan.dwg', project_relative_path: 'drawings/plan.dwg' }
  const paths = store.drawingArtifactPaths(drawing)
  const entities = path.join(projectRoot, ...paths.artifactDirectory.split('/'), 'entities')
  fs.mkdirSync(entities, { recursive: true })
  const raw = `${entityLine('2A1', 'text', 'M-1 door')}\n${entityLine('2A2', 'line')}\n`
  fs.writeFileSync(path.join(entities, 'entities.raw.jsonl'), raw)
  fs.writeFileSync(
    path.join(entities, 'entities.readable.md'),
    '# CAD Entity Index\n\nhandle | type\n--- | ---\n2A1 | text\n',
  )
  fs.mkdirSync(path.join(projectRoot, 'drawings'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'drawings', 'plan.dwg'), 'AC1032 fixture')
  const entityIndex = await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/entity-index.ts',
  )
  const source = await entityIndex.sourceFingerprint(projectRoot, drawing)
  await store.publishEntitiesManifest(
    projectRoot,
    drawing,
    {
      backend: 'mlight',
      source_entity_count: 2,
      indexed_entity_count: 2,
      omitted_geometry_count: 0,
      failed_entity_count: 0,
      layer_count: 1,
      type_counts: { text: 1, line: 1 },
    },
    undefined,
    store.CAD_MLIGHT_ENTITIES_PRODUCER,
    source,
  )
  return store
}

test('an empty gateway answer is retried once and the retry is what gets reported', async (t) => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-cad-query-')))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  await publishIndex(projectRoot)

  const { result, recorded } = await runQuery(projectRoot, [
    completion('   ', 100),
    completion('M-1 出现在 A-DOOR 图层。', 40),
  ])
  const payload = JSON.parse(result.content[0].text)
  assert.equal(payload.data.gateway_attempt_count, 2)
  assert.match(payload.data.answer, /A-DOOR/u)
  assert.equal(recorded.length, 1)
  // The empty answer was generated and billed, so its tokens stay in the reported total.
  assert.equal(recorded[0].usage.input, 140)
  assert.equal(recorded[0].usage.total, 280)
  assert.ok(result.details.warnings.some((warning) => /after 2 attempts/u.test(warning)))
})

test('two empty answers become an error that points at the deterministic path', async (t) => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-cad-query-empty-')))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  await publishIndex(projectRoot)

  await assert.rejects(
    () => runQuery(projectRoot, [completion('', 10), completion(null, 10)]),
    (error) => {
      assert.match(error.message, /returned an empty answer twice/u)
      assert.match(error.message, /entity packs were read successfully/u)
      assert.match(error.message, /cad_search/u)
      return true
    },
  )
})
