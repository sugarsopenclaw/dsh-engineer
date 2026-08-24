const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

function loadBundledModule(relativePath, plugins = []) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

async function loadBundledModuleWithPlugins(relativePath, plugins) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const GEOMETRY = 'electron/runtime/agent/tools/domain/cad-subagent/entity-geometry.ts'
const DATASET = 'electron/runtime/agent/tools/domain/cad-subagent/detail-dataset.ts'
const STORE = 'electron/runtime/agent/tools/domain/cad-subagent/artifact-store.ts'
const TOOL_RESULT = 'electron/runtime/agent/tools/domain/cad-subagent/tool-result.ts'
const CAD_TOOLS = 'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts'

function tempProject(context, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(root, relative, content = '') {
  const absolute = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
  return absolute
}

function drawing() {
  return {
    name: 'plan.dwg',
    project_relative_path: 'drawings/plan.dwg',
    saved: true,
    dbmod: 0,
  }
}

let runOrdinal = 0
async function publishEntityIndex(root, records) {
  const store = loadBundledModule(STORE)
  runOrdinal += 1
  const suffix = String(runOrdinal).padStart(12, '0')
  const artifactRunId = `run-00000000-0000-0000-0000-${suffix}`
  const source = Buffer.from('fixture-dwg')
  writeFile(root, 'drawings/plan.dwg', source)
  const staging = path.join(root, '.xiaoliang', 'cad', '.staging', artifactRunId, 'entities')
  fs.mkdirSync(staging, { recursive: true })
  fs.writeFileSync(
    path.join(staging, 'entities.raw.jsonl'),
    records.length ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : '',
  )
  fs.writeFileSync(path.join(staging, 'entities.readable.md'), '# CAD Entity Index\n\nfixture\n')
  await store.promoteStagedEntities({
    projectRoot: root,
    drawing: drawing(),
    artifactRunId,
    summary: {
      source_entity_count: records.length,
      indexed_entity_count: records.length,
      omitted_geometry_count: 0,
      failed_entity_count: 0,
    },
    producer: store.CAD_MLIGHT_ENTITIES_PRODUCER,
    sourceFingerprint: {
      size: source.length,
      sha256: createHash('sha256').update(source).digest('hex'),
    },
  })
}

function detailImage(root, id) {
  const relative = `.xiaoliang/cad/previews/plan--fixture/details/${id}.png`
  writeFile(root, relative, Buffer.from('png-fixture'))
  return relative
}

test('shared AABB crossing accepts boundary and zero-area boxes but rejects missing bbox', () => {
  const { intersects, recordBox } = loadBundledModule(GEOMETRY)
  const window = { min: [0, 0], max: [10, 10] }

  assert.equal(intersects(window, { min: [10, 5], max: [10, 5] }), true)
  assert.equal(intersects(window, { min: [5, 5], max: [5, 5] }), true)
  assert.equal(intersects(window, { min: [11, 5], max: [11, 5] }), false)
  assert.equal(recordBox({ bbox: null }), null)
  assert.deepEqual(
    recordBox({ bbox: { min: [5, 7, 2], max: [5, 7, 8] } }),
    { min: [5, 7], max: [5, 7] },
  )
})

test('detail dataset streams intersecting records verbatim and writes its evidence commit marker', async (context) => {
  const root = tempProject(context, 'xl-detail-dataset-')
  const records = [
    { handle: '1', type: 'line', layer: '0', bbox: { min: [1, 1], max: [2, 2] } },
    { handle: '2', type: 'line', layer: '0', bbox: { min: [9, 9], max: [11, 11] } },
    { handle: '3', type: 'text', layer: 'A', bbox: { min: [10, 5], max: [10, 5] } },
    { handle: '4', type: 'line', layer: '0', bbox: { min: [20, 20], max: [30, 30] } },
    { handle: '5', type: 'proxyentity', layer: '0', bbox: null },
    // Authored around its own block origin, which happens to fall inside the plotted
    // window. Crossing it here would claim a room tag sits where no tag was inserted.
    {
      handle: '6',
      type: 'text',
      layer: 'A',
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM-TAG',
      bbox: { min: [3, 3], max: [4, 4] },
    },
  ]
  await publishEntityIndex(root, records)
  const imagePath = detailImage(root, 'detail-0123456789')
  const { captureDetailDataset } = loadBundledModule(DATASET)
  const captureInput = {
    projectRoot: root,
    drawing: drawing(),
    imagePath,
    window: { min: [0, 0], max: [10, 10] },
    anchors: [{ handle: '1', bbox: { min: [1, 1], max: [2, 2] } }],
    handles: ['1'],
    paddingRatio: 0.15,
    channel: 'com_plot',
  }
  const result = await captureDetailDataset(captureInput)
  const repeated = await captureDetailDataset(captureInput)

  const evidence = JSON.parse(fs.readFileSync(
    path.join(root, '.xiaoliang', 'cad', 'previews', 'plan--fixture', 'details', 'detail-0123456789.evidence.json'),
    'utf8',
  ))
  assert.equal(result.status, 'written')
  assert.equal(repeated.status, 'written')
  assert.equal(repeated.entityCount, 3)
  assert.equal(result.entityCount, 3, JSON.stringify(evidence.counts))
  assert.equal(result.entities.endsWith('.entities.jsonl'), true)
  const entityLines = fs.readFileSync(path.join(root, ...result.entities.split('/')), 'utf8').trim().split('\n')
  assert.deepEqual(entityLines, records.slice(0, 3).map((record) => JSON.stringify(record)))

  assert.equal(evidence.schema_version, 1)
  assert.equal(evidence.evidence_id, 'detail-0123456789')
  assert.equal(evidence.selection_semantics, 'top_level_crossing')
  assert.equal(evidence.index.status, 'valid')
  assert.equal(evidence.index.producer, 'mlightcad')
  assert.deepEqual(evidence.counts, {
    scanned: 6,
    matched: 3,
    bbox_missing: 1,
    parse_failed: 0,
    outside_world_space: 1,
  })
})

test('detail evidence records the run identifiers it was given', async (context) => {
  const root = tempProject(context, 'xl-detail-run-ids-')
  await publishEntityIndex(root, [
    { handle: '1', type: 'line', layer: '0', bbox: { min: [1, 1], max: [2, 2] } },
  ])
  const { captureDetailDataset } = loadBundledModule(DATASET)
  const identified = await captureDetailDataset({
    projectRoot: root,
    drawing: drawing(),
    imagePath: detailImage(root, 'detail-1010101010'),
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
    clientRunId: 'client-run-1',
    childRunId: 'child-run-1',
    toolCallId: 'tool-call-1',
  })
  const anonymous = await captureDetailDataset({
    projectRoot: root,
    drawing: drawing(),
    imagePath: detailImage(root, 'detail-1111111112'),
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
  })
  const readEvidence = (id) => JSON.parse(fs.readFileSync(path.join(
    root,
    '.xiaoliang',
    'cad',
    'previews',
    'plan--fixture',
    'details',
    `${id}.evidence.json`,
  ), 'utf8'))
  const evidence = readEvidence('detail-1010101010')
  const anonymousEvidence = readEvidence('detail-1111111112')

  assert.equal(identified.status, 'written')
  assert.equal(evidence.schema_version, 1)
  assert.equal(evidence.client_run_id, 'client-run-1')
  assert.equal(evidence.child_run_id, 'child-run-1')
  assert.equal(evidence.tool_call_id, 'tool-call-1')
  assert.equal(anonymous.status, 'written')
  assert.equal(anonymousEvidence.client_run_id, null)
  assert.equal(anonymousEvidence.child_run_id, null)
  assert.equal(anonymousEvidence.tool_call_id, null)
})

test('missing and stale indexes degrade to evidence-only sidecars', async (context) => {
  const { captureDetailDataset } = loadBundledModule(DATASET)

  const missingRoot = tempProject(context, 'xl-detail-missing-')
  writeFile(missingRoot, 'drawings/plan.dwg', 'fixture-dwg')
  const missingImage = detailImage(missingRoot, 'detail-1111111111')
  const missing = await captureDetailDataset({
    projectRoot: missingRoot,
    drawing: drawing(),
    imagePath: missingImage,
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
  })
  assert.equal(missing.status, 'metadata_only')
  assert.equal(missing.indexStatus, 'missing')
  assert.equal(missing.entities, undefined)

  const staleRoot = tempProject(context, 'xl-detail-stale-')
  await publishEntityIndex(staleRoot, [
    { handle: '1', type: 'line', layer: '0', bbox: { min: [1, 1], max: [2, 2] } },
  ])
  fs.appendFileSync(path.join(staleRoot, 'drawings', 'plan.dwg'), '-changed')
  const staleImage = detailImage(staleRoot, 'detail-2222222222')
  const stale = await captureDetailDataset({
    projectRoot: staleRoot,
    drawing: drawing(),
    imagePath: staleImage,
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
  })
  assert.equal(stale.status, 'metadata_only')
  assert.equal(stale.indexStatus, 'stale_source')
  const staleEvidence = JSON.parse(fs.readFileSync(
    path.join(staleRoot, '.xiaoliang', 'cad', 'previews', 'plan--fixture', 'details', 'detail-2222222222.evidence.json'),
    'utf8',
  ))
  assert.equal(staleEvidence.entities_file, null)
  assert.equal(staleEvidence.index.status, 'stale_source')
})

test('a failed refresh removes the old evidence commit marker', async (context) => {
  const root = tempProject(context, 'xl-detail-refresh-')
  await publishEntityIndex(root, [
    { handle: '1', type: 'line', layer: '0', bbox: { min: [1, 1], max: [2, 2] } },
  ])
  const imagePath = detailImage(root, 'detail-2323232323')
  const { captureDetailDataset } = loadBundledModule(DATASET)
  const input = {
    projectRoot: root,
    drawing: drawing(),
    imagePath,
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
  }
  const first = await captureDetailDataset(input)
  const entitiesAbsolute = path.join(root, ...first.entities.split('/'))
  const evidenceAbsolute = path.join(
    root,
    '.xiaoliang',
    'cad',
    'previews',
    'plan--fixture',
    'details',
    'detail-2323232323.evidence.json',
  )
  fs.rmSync(entitiesAbsolute)
  fs.mkdirSync(entitiesAbsolute)

  const refreshed = await captureDetailDataset(input)

  assert.equal(refreshed.status, 'skipped')
  assert.equal(fs.existsSync(evidenceAbsolute), false)
})

const stubManagedModelFactory = {
  name: 'stub-managed-model',
  setup(build) {
    build.onResolve({ filter: /managed-model-factory$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-model',
    }))
    build.onLoad({ filter: /.*/, namespace: 'stub-model' }, () => ({
      contents: 'exports.buildManagedPiModel = () => ({ name: "stub", contextWindow: 128000, maxTokens: 4096 })',
      loader: 'js',
    }))
  },
}

test('a sidecar failure cannot turn a successful cad_detail into a tool failure', async (context) => {
  const root = tempProject(context, 'xl-detail-tool-')
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = '.xiaoliang/cad/previews/plan--fixture/details/detail-3333333333.png'
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: true,
      dbmod: 0,
    }],
    captureDetail: async () => ({
      drawing: drawing(),
      bbox: { min: [0, 0], max: [10, 10] },
      anchors: [],
      missingHandles: [],
      imagePath,
      strategy: 'png',
      width: 100,
      height: 100,
      pixelCount: 10_000,
      inkRatio: 0.1,
      cropBox: [0, 0, 100, 100],
      warnings: [],
    }),
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const result = await detail.execute('tool-call-1', { handles: ['A1'] })
  const payload = JSON.parse(result.content[0].text)

  assert.equal(payload.ok, true)
  assert.equal(payload.data.image_path, imagePath)
  assert.equal(payload.data.dataset.status, 'skipped')
  assert.match(payload.warnings[0], /dataset sidecar was skipped/u)
  assert.deepEqual(result.details.relative_paths, [imagePath])
})

test('cad_detail allows a view-only DBMOD even when AutoCAD reports Saved=false', async (context) => {
  const root = tempProject(context, 'xl-detail-view-only-')
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = '.xiaoliang/cad/previews/plan--fixture/details/detail-view-only.png'
  let captureCalls = 0
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: false,
      dbmod: 16,
    }],
    captureDetail: async () => {
      captureCalls += 1
      return {
        drawing: drawing(),
        bbox: { min: [0, 0], max: [10, 10] },
        anchors: [],
        missingHandles: [],
        imagePath,
        strategy: 'png',
        width: 100,
        height: 100,
        pixelCount: 10_000,
        inkRatio: 0.1,
        cropBox: [0, 0, 100, 100],
        warnings: [],
      }
    },
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const result = await detail.execute('view-only-detail', { handles: ['A1'] })
  const payload = JSON.parse(result.content[0].text)

  assert.equal(captureCalls, 1)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.image_path, imagePath)
})

test('cad_detail captures a content-dirty live drawing and keeps the offline dataset metadata-only', async (context) => {
  const root = tempProject(context, 'xl-detail-dirty-')
  await publishEntityIndex(root, [
    { handle: 'A1', type: 'line', layer: '0', bbox: { min: [1, 1], max: [2, 2] } },
  ])
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = detailImage(root, 'detail-content-dirty')
  const dirtyDrawing = { ...drawing(), saved: false, dbmod: 17 }
  let captureCalls = 0
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: false,
      dbmod: 17,
    }],
    captureDetail: async () => {
      captureCalls += 1
      return {
        drawing: dirtyDrawing,
        bbox: { min: [0, 0], max: [10, 10] },
        anchors: [],
        missingHandles: [],
        imagePath,
        strategy: 'png',
        width: 100,
        height: 100,
        pixelCount: 10_000,
        inkRatio: 0.1,
        cropBox: [0, 0, 100, 100],
        warnings: [],
      }
    },
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const result = await detail.execute('dirty-detail', { handles: ['A1'] })
  const payload = JSON.parse(result.content[0].text)

  assert.equal(captureCalls, 1)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.image_path, imagePath)
  assert.equal(payload.data.dataset.status, 'metadata_only')
  assert.match(payload.warnings[0], /live unsaved drawing/u)
  const detailRoot = path.join(root, '.xiaoliang', 'cad', 'previews', 'plan--fixture', 'details')
  assert.equal(fs.existsSync(path.join(detailRoot, 'detail-content-dirty.evidence.json')), true)
  assert.equal(fs.existsSync(path.join(detailRoot, 'detail-content-dirty.entities.jsonl')), false)
})

test('cad_detail still captures an unsaved drawing when DBMOD is unavailable', async (context) => {
  const root = tempProject(context, 'xl-detail-no-dbmod-')
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = detailImage(root, 'detail-no-dbmod')
  const dirtyDrawing = { ...drawing(), saved: false, dbmod: null }
  let captureCalls = 0
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: false,
      dbmod: null,
    }],
    captureDetail: async () => {
      captureCalls += 1
      return {
        drawing: dirtyDrawing,
        bbox: { min: [0, 0], max: [10, 10] },
        anchors: [],
        missingHandles: [],
        imagePath,
        strategy: 'png',
        width: 100,
        height: 100,
        pixelCount: 10_000,
        inkRatio: 0.1,
        cropBox: [0, 0, 100, 100],
        warnings: [],
      }
    },
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const result = await detail.execute('no-dbmod-detail', { handles: ['A1'] })
  const payload = JSON.parse(result.content[0].text)

  assert.equal(captureCalls, 1)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.dataset.status, 'metadata_only')
  assert.match(payload.warnings[0], /live unsaved drawing/u)
})

test('empty window never returns a successful capture', async (context) => {
  const root = tempProject(context, 'xl-detail-empty-window-')
  await publishEntityIndex(root, [])
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = detailImage(root, 'detail-6666666666')
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: true,
      dbmod: 0,
    }],
    captureDetail: async () => ({
      drawing: drawing(),
      bbox: { min: [0, 0], max: [10, 10] },
      anchors: [],
      missingHandles: [],
      imagePath,
      strategy: 'png',
      width: 100,
      height: 100,
      pixelCount: 10_000,
      inkRatio: 0.1,
      cropBox: [0, 0, 100, 100],
      warnings: [],
    }),
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const payload = JSON.parse((await detail.execute('empty-window', {
    window: { min: [0, 0], max: [10, 10] },
  })).content[0].text)

  assert.equal(payload.data.status, 'empty_window')
  assert.equal(payload.data.dataset.status, 'written')
  assert.equal(payload.data.dataset.entity_count, 0)
  assert.match(payload.data.next_step, /cad_app action=list/u)
  assert.match(payload.warnings.join('\n'), /not successful detail evidence/u)
})

test('an invalid index is not reported as an empty window', async (context) => {
  const root = tempProject(context, 'xl-detail-invalid-window-')
  writeFile(root, 'drawings/plan.dwg', 'fixture-dwg')
  const toolsModule = await loadBundledModuleWithPlugins(CAD_TOOLS, [stubManagedModelFactory])
  const imagePath = detailImage(root, 'detail-7777777777')
  const facade = {
    listDocuments: async () => [{
      index: 0,
      name: 'plan.dwg',
      project_relative_path: 'drawings/plan.dwg',
      active: true,
      saved: true,
      dbmod: 0,
    }],
    captureDetail: async () => ({
      drawing: drawing(),
      bbox: { min: [0, 0], max: [10, 10] },
      anchors: [],
      missingHandles: [],
      imagePath,
      strategy: 'png',
      width: 100,
      height: 100,
      pixelCount: 10_000,
      inkRatio: 0.1,
      cropBox: [0, 0, 100, 100],
      warnings: [],
    }),
  }
  const tools = toolsModule.buildCadSubagentCadTools({
    projectRoot: root,
    facade,
    cadQuery: { apiKey: 'fixture', clientRunId: 'run-1', childRunId: 'child-1' },
    capabilities: async () => ({}),
  })
  const detail = tools.find((tool) => tool.name === 'cad_detail')
  const payload = JSON.parse((await detail.execute('invalid-window', {
    window: { min: [0, 0], max: [10, 10] },
  })).content[0].text)

  assert.notEqual(payload.data.status, 'empty_window')
  assert.equal(payload.data.dataset.status, 'metadata_only')
  assert.equal(payload.data.dataset.entity_count, 0)
})

test('segmented flushes across the 256KiB buffer keep record order verbatim', async (context) => {
  const root = tempProject(context, 'xl-detail-flush-')
  const filler = (seed) => `${seed}${'x'.repeat(90 * 1024)}`
  const records = ['1', '2', '3', '4'].map((handle) => ({
    handle,
    type: 'line',
    layer: '0',
    bbox: { min: [1, 1], max: [2, 2] },
    note: filler(handle),
  }))
  await publishEntityIndex(root, records)
  const imagePath = detailImage(root, 'detail-5555555555')
  const { captureDetailDataset } = loadBundledModule(DATASET)
  const result = await captureDetailDataset({
    projectRoot: root,
    drawing: drawing(),
    imagePath,
    window: { min: [0, 0], max: [10, 10] },
    anchors: [],
    channel: 'com_plot',
  })

  assert.equal(result.status, 'written')
  assert.equal(result.entityCount, 4)
  const written = fs.readFileSync(path.join(root, ...result.entities.split('/')), 'utf8')
  assert.equal(written, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
})

test('dataset.entities stays out of CAD artifact refs', () => {
  const { cadToolResult } = loadBundledModule(TOOL_RESULT)
  const imagePath = '.xiaoliang/cad/previews/plan/details/detail-4444444444.png'
  const entities = '.xiaoliang/cad/previews/plan/details/detail-4444444444.entities.jsonl'
  const result = cadToolResult('capture.detail', 'tool-call-2', {
    image_path: imagePath,
    dataset: { entities },
  })
  assert.deepEqual(result.details.relative_paths, [imagePath])
})
