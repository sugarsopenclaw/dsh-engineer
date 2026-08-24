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

const stubManagedModelFactory = {
  name: 'stub-managed-model',
  setup(build) {
    build.onResolve({ filter: /managed-model-factory$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-model',
    }))
    build.onLoad({ filter: /.*/, namespace: 'stub-model' }, () => ({
      contents: `exports.buildManagedPiModel = () => ({
        id: 'fixture-model',
        name: 'fixture-model',
        baseUrl: 'https://gateway.invalid',
        contextWindow: 128000,
        maxTokens: 4096,
      })`,
      loader: 'js',
    }))
  },
}

function tempProject(context, prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
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

let artifactOrdinal = 0
async function publishIndex(root, records) {
  const store = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/artifact-store.ts',
  )
  artifactOrdinal += 1
  const suffix = String(artifactOrdinal).padStart(12, '0')
  const artifactRunId = `run-00000000-0000-0000-0000-${suffix}`
  const source = Buffer.from('fixture-drawing')
  writeFile(root, 'drawings/plan.dwg', source)
  const stage = `.xiaoliang/cad/.staging/${artifactRunId}/entities`
  writeFile(root, `${stage}/entities.raw.jsonl`, records.length
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '')
  writeFile(root, `${stage}/entities.readable.md`, '# CAD Entity Index\n')
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

function extractionFixture(overrides = {}) {
  return {
    source_entity_count: 2,
    indexed_entity_count: 2,
    omitted_geometry_count: 0,
    failed_entity_count: 0,
    type_counts: { line: 2 },
    opaque_entity_counts: {},
    capture_scope: 'database_authored_entities',
    capture_semantics: 'authored database entities; block references are not recursively expanded',
    block_record_count: 1,
    owner_scope_counts: { model_space: 2 },
    owner_block_counts: { '*Model_Space': 2 },
    block_inventory: [],
    layer_count: 1,
    ...overrides,
  }
}

test('complete_index is false when any entity is opaque, failed or unexpanded', () => {
  const { mlightExtractionSummary } = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/entity-index.ts',
  )
  const complete = mlightExtractionSummary(extractionFixture(), drawing())
  const opaque = mlightExtractionSummary(extractionFixture({
    type_counts: { line: 1, proxyentity: 1 },
    opaque_entity_counts: { proxyentity: 1 },
  }), drawing())
  const failed = mlightExtractionSummary(extractionFixture({
    source_entity_count: 3,
    failed_entity_count: 1,
  }), drawing())
  const unexpanded = mlightExtractionSummary(extractionFixture({
    block_record_count: 2,
    block_inventory: [{
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM_TAG',
      declared_entity_count: 4,
    }],
  }), drawing())

  assert.equal(complete.complete_index, true)
  assert.equal(opaque.complete_index, false)
  assert.equal(opaque.opaque_entity_count, 1)
  assert.equal(failed.complete_index, false)
  assert.equal(unexpanded.complete_index, false)
  assert.equal(unexpanded.annotation_blocks_unexpanded, 1)
  assert.deepEqual(unexpanded.block_inventory, [{
    owner_scope: 'block_definition',
    owner_block_name: 'ROOM_TAG',
    declared_entity_count: 4,
  }])
})

test('cad_measure never labels a geometry value as annotated', () => {
  const { measureRecord } = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-drafter/entity-tools.ts',
  )
  const measured = measureRecord({
    handle: 'A1',
    type: 'dimension',
    layer: '轴网标注',
    bbox: { min: [0, 0], max: [100, 10] },
    measurement: 3000,
    text_override: '3600',
  })

  assert.equal(measured.geometry_measurement, 3000)
  assert.equal(Object.hasOwn(measured, 'annotated_measurement'), false)
})

test('text_override is reported whenever the index carries it', () => {
  const { measureRecord } = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-drafter/entity-tools.ts',
  )
  assert.equal(measureRecord({
    handle: 'A2',
    type: 'dimension',
    layer: '房间标注',
    text_override: '',
    measurement: 4200,
  }).text_override, '')
})

test('a short numeric term never matches inside coordinates', async (context) => {
  const root = tempProject(context, 'xl-cad-numeric-boundary-')
  const relative = '.xiaoliang/cad/drawings/plan/entities/entities.raw.jsonl'
  writeFile(root, relative, [
    { handle: 'NOISE', type: 'line', layer: '轴线', bbox: { min: [126, 260], max: [226, 360] } },
    { handle: 'TOKEN_INSIDE', type: 'text', layer: '说明', content_clean: '房间 126' },
    { handle: 'TOKEN', type: 'text', layer: '说明', content_clean: '房间 26 号' },
  ].map((record) => JSON.stringify(record)).join('\n'))
  const tools = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/project-files.ts',
  ).buildCadSubagentProjectFileTools(root)
  const search = tools.find((tool) => tool.name === 'cad_search')
  const result = await search.execute('numeric-search', {
    path: relative,
    terms: ['26'],
    max_nearby: 0,
  })

  assert.equal(result.details.match_count, 1)
  assert.deepEqual(result.details.matched_fields, ['content_clean'])
  assert.match(result.content[0].text, /"handle":"TOKEN"/u)
  assert.doesNotMatch(result.content[0].text, /NOISE|TOKEN_INSIDE/u)
})

test('match_count counts field hits only', async (context) => {
  const root = tempProject(context, 'xl-cad-field-hits-')
  const relative = '.xiaoliang/cad/drawings/plan/entities/entities.raw.jsonl'
  writeFile(root, relative, `${JSON.stringify({
    handle: 'B1',
    type: 'block_reference',
    layer: 'M-1',
    name: 'M-1',
    attributes: { 数量: '12', 编号: 'M-1' },
    bbox: { min: [0, 0], max: [1, 1] },
  })}\n`)
  const tools = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/project-files.ts',
  ).buildCadSubagentProjectFileTools(root)
  const search = tools.find((tool) => tool.name === 'cad_search')
  const result = await search.execute('field-search', {
    path: relative,
    terms: ['M-1'],
    max_nearby: 0,
  })

  assert.equal(result.details.match_count, 3)
  assert.deepEqual(result.details.matched_fields, ['attributes.编号', 'layer', 'name'])
  assert.equal(result.details.quantity_kind, 'text_frequency')
  assert.equal(result.details.quantity_basis, null)
  assert.match(result.content[0].text, /Substring matches/u)
  assert.match(result.content[0].text, /"quantity_kind":"bom_attribute"/u)
  assert.match(result.content[0].text, /QuantityBasis\.BOM_DECLARED/u)
})

test('dimension overrides and geometry-only values stay in separate layer-aware columns', async (context) => {
  const root = tempProject(context, 'xl-cad-dimension-columns-')
  await publishIndex(root, [
    {
      handle: 'D1',
      type: 'dimension',
      layer: '轴网标注',
      text_override: '3600',
      measurement: 3000,
      bbox: { min: [0, 0], max: [10, 1] },
    },
    {
      handle: 'D2',
      type: 'dimension',
      layer: '房间标注',
      text_override: '',
      measurement: 4200,
      bbox: { min: [20, 0], max: [30, 1] },
    },
    {
      handle: 'B1',
      type: 'block_reference',
      layer: '设备',
      name: '设备块',
      bbox: { min: [40, 0], max: [41, 1] },
    },
  ])
  let requestBody
  const { buildCadQueryTool } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-query.ts',
    [stubManagedModelFactory],
  )
  const query = buildCadQueryTool(root, {
    apiKey: 'fixture-key',
    clientRunId: 'run-1',
    childRunId: 'child-1',
    fetchFn: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'fixture answer' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  await query.execute('dimension-query', {
    request: '核对开间尺寸显示值',
    drawing_paths: ['drawings/plan.dwg'],
  })
  const userPrompt = requestBody.messages.find((message) => message.role === 'user').content
  const aggregateMatch = userPrompt.match(
    /<deterministic_aggregate>\n([\s\S]+?)\n<\/deterministic_aggregate>/u,
  )
  assert.ok(aggregateMatch)
  const aggregate = JSON.parse(aggregateMatch[1])[0]

  assert.equal(aggregate.override_dimensions[0].layer, '轴网标注')
  assert.equal(aggregate.override_dimensions[0].text_override, '3600')
  assert.equal(aggregate.geometry_only_dimensions[0].layer, '房间标注')
  assert.equal(aggregate.geometry_only_dimensions[0].geometry_measurement, 4200)
  assert.equal(aggregate.dimension_counts.override.quantity_kind, 'annotation_occurrences')
  assert.equal(aggregate.type_counts_quantity_contract.quantity_basis_enum, 'QuantityBasis.DRAWING_OCCURRENCE')
  assert.equal(aggregate.block_references[0].quantity_kind, 'drawing_occurrences')
})

test('a failed switch never reports success', async (context) => {
  const root = tempProject(context, 'xl-cad-switch-failure-')
  let switchCalls = 0
  const documents = [
    {
      index: 0,
      name: 'foreign.dwg',
      project_relative_path: null,
      active: true,
      saved: true,
      dbmod: 0,
    },
  ]
  const { buildCadSubagentCadTools } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts',
    [stubManagedModelFactory],
  )
  const tools = buildCadSubagentCadTools({
    projectRoot: root,
    facade: {
      listDocuments: async () => documents,
      switchDocument: async () => {
        switchCalls += 1
        throw new Error('fixture switch rejected')
      },
    },
    factsBuildService: {},
    cadQuery: { apiKey: 'fixture', clientRunId: 'run', childRunId: 'child' },
    capabilities: async () => ({}),
  })
  const cadApp = tools.find((tool) => tool.name === 'cad_app')
  const first = JSON.parse((await cadApp.execute('switch-1', {
    action: 'switch',
    name: 'foreign.dwg',
  })).content[0].text)
  await cadApp.execute('switch-2', { action: 'switch', name: 'foreign.dwg' })
  const bounded = JSON.parse((await cadApp.execute('switch-3', {
    action: 'switch',
    name: 'foreign.dwg',
  })).content[0].text)

  assert.equal(first.data.status, 'switch_failed')
  assert.match(first.data.reason, /fixture switch rejected/u)
  assert.equal(first.data.active_document, undefined)
  assert.equal(bounded.data.status, 'switch_failed')
  assert.match(bounded.data.reason, /one immediate retry/u)
  assert.equal(switchCalls, 2)
})

test('a document outside the project is marked foreign', async (context) => {
  const root = tempProject(context, 'xl-cad-foreign-document-')
  const documents = [{
    index: 0,
    name: 'outside.dwg',
    project_relative_path: null,
    active: true,
    saved: true,
    dbmod: 0,
  }]
  const { buildCadSubagentCadTools } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts',
    [stubManagedModelFactory],
  )
  const tools = buildCadSubagentCadTools({
    projectRoot: root,
    facade: { listDocuments: async () => documents },
    factsBuildService: {},
    cadQuery: { apiKey: 'fixture', clientRunId: 'run', childRunId: 'child' },
    capabilities: async () => ({}),
  })
  const cadApp = tools.find((tool) => tool.name === 'cad_app')
  const listed = JSON.parse((await cadApp.execute('list-documents', {
    action: 'list',
  })).content[0].text)

  assert.equal(listed.data.documents[0].status, 'foreign_document')
})

test('a foreign document is refused as a status instead of an exception', async (context) => {
  const root = tempProject(context, 'xl-cad-foreign-refusal-')
  const documents = [{
    index: 0,
    name: 'outside.dwg',
    project_relative_path: null,
    active: true,
    saved: true,
    dbmod: 0,
  }]
  const { buildCadSubagentCadTools } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts',
    [stubManagedModelFactory],
  )
  const tools = buildCadSubagentCadTools({
    projectRoot: root,
    facade: { listDocuments: async () => documents },
    factsBuildService: {},
    cadQuery: { apiKey: 'fixture', clientRunId: 'run', childRunId: 'child' },
    capabilities: async () => ({}),
  })
  const inspected = JSON.parse((await tools.find((tool) => tool.name === 'cad_artifacts')
    .execute('inspect-foreign', { action: 'status' })).content[0].text)
  const extracted = JSON.parse((await tools.find((tool) => tool.name === 'cad_extract')
    .execute('extract-foreign', { action: 'run' })).content[0].text)

  assert.equal(inspected.data.status, 'foreign_document')
  assert.equal(extracted.data.status, 'foreign_document')
  assert.equal(extracted.data.document.name, 'outside.dwg')
  assert.deepEqual(extracted.data.project_documents, [])
})

test('a repeated open or index switch is capped like a repeated name', async (context) => {
  const root = tempProject(context, 'xl-cad-activation-cap-')
  writeFile(root, 'drawings/plan.dwg', 'fixture-drawing')
  let openCalls = 0
  let switchCalls = 0
  const { buildCadSubagentCadTools } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-tools.ts',
    [stubManagedModelFactory],
  )
  const tools = buildCadSubagentCadTools({
    projectRoot: root,
    facade: {
      listDocuments: async () => [],
      openDocument: async () => {
        openCalls += 1
        throw new Error('fixture open rejected')
      },
      switchDocument: async () => {
        switchCalls += 1
        throw new Error('fixture switch rejected')
      },
    },
    factsBuildService: {},
    cadQuery: { apiKey: 'fixture', clientRunId: 'run', childRunId: 'child' },
    capabilities: async () => ({}),
  })
  const cadApp = tools.find((tool) => tool.name === 'cad_app')
  for (const id of ['open-1', 'open-2', 'open-3']) {
    await cadApp.execute(id, { action: 'open', path: 'drawings/plan.dwg' })
  }
  const boundedOpen = JSON.parse((await cadApp.execute('open-4', {
    action: 'open',
    path: 'drawings/plan.dwg',
  })).content[0].text)
  for (const id of ['index-1', 'index-2', 'index-3']) {
    await cadApp.execute(id, { action: 'switch', index: 3 })
  }
  const boundedIndex = JSON.parse((await cadApp.execute('index-4', {
    action: 'switch',
    index: 3,
  })).content[0].text)

  assert.equal(openCalls, 2)
  assert.equal(switchCalls, 2)
  assert.match(boundedOpen.data.reason, /one immediate retry/u)
  assert.match(boundedIndex.data.reason, /one immediate retry/u)
})

test('every aggregate count declares its quantity kind', async (context) => {
  const root = tempProject(context, 'xl-cad-quantity-coverage-')
  await publishIndex(root, [{
    handle: 'L1',
    type: 'line',
    layer: '轴线',
    bbox: { min: [0, 0], max: [10, 1] },
  }])
  let requestBody
  const { buildCadQueryTool } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-query.ts',
    [stubManagedModelFactory],
  )
  const query = buildCadQueryTool(root, {
    apiKey: 'fixture-key',
    clientRunId: 'run-1',
    childRunId: 'child-1',
    fetchFn: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'fixture answer' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  await query.execute('coverage-query', {
    request: '统计图层实体分布',
    drawing_paths: ['drawings/plan.dwg'],
  })
  const aggregate = JSON.parse(
    requestBody.messages.find((message) => message.role === 'user').content
      .match(/<deterministic_aggregate>\n([\s\S]+?)\n<\/deterministic_aggregate>/u)[1],
  )[0]

  assert.equal(
    aggregate.layer_counts_quantity_contract.quantity_basis_enum,
    'QuantityBasis.DRAWING_OCCURRENCE',
  )
  assert.equal(aggregate.bbox_entity_count_quantity_contract.quantity_kind, 'unknown')
  assert.equal(aggregate.bbox_entity_count_quantity_contract.quantity_basis, null)
  assert.equal(Object.hasOwn(aggregate, 'type_counts_quantity_kind'), false)
})

test('the published index reaches layouts and block definitions', async (context) => {
  const root = tempProject(context, 'xl-cad-index-scope-')
  writeFile(root, 'drawings/plan.dwg', Buffer.from('fixture-drawing'))
  const { buildMLightEntityIndex } = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/entity-index.ts',
  )
  const requests = []
  const built = await buildMLightEntityIndex({
    projectRoot: root,
    drawing: drawing(),
    extractor: {
      extract: async (request) => {
        requests.push(request)
        const stage = `.xiaoliang/cad/.staging/${request.artifactRunId}/entities`
        writeFile(root, `${stage}/entities.raw.jsonl`, '')
        writeFile(root, `${stage}/entities.readable.md`, '# CAD Entity Index\n')
        return {
          rawPath: `${stage}/entities.raw.jsonl`,
          readablePath: `${stage}/entities.readable.md`,
          summary: extractionFixture({
            source_entity_count: 0,
            indexed_entity_count: 0,
            type_counts: {},
            owner_scope_counts: {},
            owner_block_counts: {},
          }),
          warnings: [],
        }
      },
    },
  })

  // Model space alone leaves room names, door and window marks and legends unsearchable,
  // because a drawing keeps most of its annotation inside block definitions.
  assert.equal(requests.length, 1)
  assert.equal(requests[0].filters.scope, 'database')
  assert.equal(requests[0].filters.includeGeometry, true)
  assert.equal(built.summary.backend, 'mlight')
})

test('block definition text is searchable without anchoring a world-space window', async (context) => {
  const root = tempProject(context, 'xl-cad-block-search-')
  const relative = '.xiaoliang/cad/drawings/plan/entities/entities.raw.jsonl'
  writeFile(root, relative, [
    // The room name is authored inside the block, around the block's own origin.
    {
      handle: 'TAG',
      type: 'text',
      layer: '房间名',
      content_clean: '主卧室',
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM-TAG',
      bbox: { min: [0, 0], max: [2, 1] },
    },
    // World-space geometry that merely sits near the block's local origin. Treating the
    // tag's box as world space would drag this in as its neighbour.
    { handle: 'FAR', type: 'line', layer: '墙', bbox: { min: [1, 1], max: [3, 3] } },
  ].map((record) => JSON.stringify(record)).join('\n'))
  const tools = loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/project-files.ts',
  ).buildCadSubagentProjectFileTools(root)
  const search = tools.find((tool) => tool.name === 'cad_search')
  const result = await search.execute('block-search', { path: relative, terms: ['主卧室'] })

  // The text itself has to come back: this is the content model space cannot reach.
  assert.equal(result.details.match_count, 1)
  assert.match(result.content[0].text, /"handle":"TAG"/u)
  assert.match(result.content[0].text, /"owner_block_name":"ROOM-TAG"/u)
  assert.match(result.content[0].text, /"position_semantics":"block_definition_local"/u)
  // Its box anchors nothing, so no neighbourhood and no detail window came out of it.
  assert.equal(result.details.outside_world_space_match_count, 1)
  assert.equal(result.details.suggested_detail_window, undefined)
  assert.equal(result.details.nearby_count, 0)
  assert.doesNotMatch(result.content[0].text, /"handle":"FAR"/u)
  assert.match(result.content[0].text, /block_reference insertion points/u)
})

test('block definition contents stay out of the sheet counts and the bbox union', async (context) => {
  const root = tempProject(context, 'xl-cad-block-aggregate-')
  await publishIndex(root, [
    { handle: 'W1', type: 'line', layer: '墙', bbox: { min: [1_000, 1_000], max: [2_000, 1_000] } },
    {
      handle: 'B1',
      type: 'block_reference',
      layer: '房间名',
      name: 'ROOM-TAG',
      owner_scope: 'model_space',
      bbox: { min: [1_500, 1_200], max: [1_505, 1_202] },
    },
    {
      handle: 'T1',
      type: 'text',
      layer: '房间名',
      content_clean: '主卧室',
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM-TAG',
      bbox: { min: [0, 0], max: [5, 2] },
    },
    // A reference nested inside a definition is not an occurrence on any sheet either.
    {
      handle: 'B2',
      type: 'block_reference',
      layer: '房间名',
      name: 'ARROW',
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM-TAG',
      bbox: { min: [0, 0], max: [1, 1] },
    },
  ])
  let requestBody
  const { buildCadQueryTool } = await loadBundledModuleWithPlugins(
    'electron/runtime/agent/tools/domain/cad-subagent/cad-query.ts',
    [stubManagedModelFactory],
  )
  const query = buildCadQueryTool(root, {
    apiKey: 'fixture-key',
    clientRunId: 'run-1',
    childRunId: 'child-1',
    fetchFn: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'fixture answer' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  await query.execute('block-aggregate-query', {
    request: '统计房间名分布',
    drawing_paths: ['drawings/plan.dwg'],
  })
  const aggregate = JSON.parse(
    requestBody.messages.find((message) => message.role === 'user').content
      .match(/<deterministic_aggregate>\n([\s\S]+?)\n<\/deterministic_aggregate>/u)[1],
  )[0]

  assert.equal(aggregate.parsed_entity_count, 4)
  assert.equal(aggregate.sheet_entity_count, 2)
  assert.equal(aggregate.block_definition_entity_count, 2)
  assert.deepEqual(aggregate.type_counts, { line: 1, block_reference: 1 })
  assert.deepEqual(aggregate.block_definition_type_counts, { text: 1, block_reference: 1 })
  // Only the placed reference is a drawing occurrence; the nested one is not on a sheet.
  assert.deepEqual(aggregate.block_references.map((item) => item.name), ['ROOM-TAG'])
  // The definition's local box would otherwise drag the union back to the origin.
  assert.deepEqual(aggregate.bbox_union, { min: [1_000, 1_000], max: [2_000, 1_202] })
  assert.equal(aggregate.bbox_entity_count, 2)
  assert.equal(aggregate.bbox_coverage_ratio, 1)
  assert.equal(aggregate.block_definition_type_counts_quantity_contract.quantity_kind, 'unknown')
})
