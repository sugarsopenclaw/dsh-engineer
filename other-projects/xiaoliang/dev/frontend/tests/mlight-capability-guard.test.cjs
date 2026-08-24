const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

/**
 * The render analysis lives in the renderer bundle next to the MLightCAD imports, so it is
 * bundled with those resolved away: only the pixel maths is under test here.
 */
async function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const stubMLight = {
    name: 'stub-mlight',
    setup(build) {
      build.onResolve({ filter: /^@mlightcad\// }, (args) => ({ path: args.path, namespace: 'stub' }))
      build.onResolve({ filter: /mlight-simple-viewer$/ }, (args) => ({ path: args.path, namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'module.exports = new Proxy({}, { get: () => class Stub {} })',
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
    plugins: [stubMLight],
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

let renderModule
async function describeSolidFillGrid(cells, width, height) {
  renderModule ??= await loadBundledModule('src/mlight-runtime/operations.ts')
  return renderModule.describeSolidFillGrid(cells, width, height)
}

let recordsModule
async function describeOpaqueEntitiesInIndex(absolutePath, window) {
  recordsModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-drafter/entity-records.ts',
  )
  return recordsModule.describeOpaqueEntitiesInIndex(absolutePath, window)
}

const GRID = 64

/** A grid of background with thin dark strokes on it, the way real geometry averages down. */
function drawing() {
  const cells = new Array(GRID * GRID).fill(255)
  for (let row = 0; row < GRID; row += 4) {
    for (let column = 0; column < GRID; column += 1) cells[row * GRID + column] = 40
  }
  for (let column = 0; column < GRID; column += 4) {
    for (let row = 0; row < GRID; row += 1) cells[row * GRID + column] = 40
  }
  return cells
}

/** Paints a filled block of `size` cells, which is how an unparsed entity comes out. */
function withBlock(cells, size) {
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) cells[row * GRID + column] = 255
  }
  return cells
}

test('a render with drawn geometry across it raises nothing', async () => {
  assert.deepEqual(await describeSolidFillGrid(drawing(), GRID, GRID), [])
})

test('a solid block big enough to hide a table is reported as unreadable', async () => {
  // 24×24 of 64×64 is ~14% of the image: a block that size is an embedded object, not a gap
  // between details, and everything behind it is missing from the image.
  const warnings = await describeSolidFillGrid(withBlock(drawing(), 24), GRID, GRID)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /solid light block covers about 14%/u)
  assert.match(warnings[0], /OLE frame/u)
  assert.match(warnings[0], /leave that region to AutoCAD/u)
})

test('an ordinary gap between details stays below the threshold', async () => {
  // 10×10 is ~2%: white space that size is normal drawing margin.
  assert.deepEqual(await describeSolidFillGrid(withBlock(drawing(), 10), GRID, GRID), [])
})

test('a render that came out entirely blank is reported as failed, not as empty space', async () => {
  const warnings = await describeSolidFillGrid(new Array(GRID * GRID).fill(255), GRID, GRID)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /one uniform light surface/u)
  assert.match(warnings[0], /failed rather than as an empty area/u)
})

test('a malformed grid is ignored rather than reported as a fill', async () => {
  assert.deepEqual(await describeSolidFillGrid([], 0, 0), [])
  assert.deepEqual(await describeSolidFillGrid([255, 255], 64, 64), [])
})

function writeIndex(records) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-opaque-'))
  const file = path.join(directory, 'entities.raw.jsonl')
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return { file, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
}

function entity(type, min, max) {
  return { handle: '1A', type, layer: '0', bbox: { min, max } }
}

test('an OLE frame inside the requested window is announced before the image is cited', async () => {
  const index = writeIndex([
    entity('line', [0, 0], [100, 100]),
    entity('ole2frame', [10, 10], [90, 90]),
  ])
  try {
    const warnings = await describeOpaqueEntitiesInIndex(index.file, {
      min: [0, 0],
      max: [100, 100],
    })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /ole2frame×1/u)
    assert.match(warnings[0], /covering about 64% of it/u)
    assert.match(warnings[0], /route that region to AutoCAD/u)
  } finally {
    index.cleanup()
  }
})

test('opaque entities outside the window, and slivers inside it, stay quiet', async () => {
  const index = writeIndex([
    entity('ole2frame', [500, 500], [900, 900]),
    entity('proxyentity', [0, 0], [2, 2]),
  ])
  try {
    assert.deepEqual(
      await describeOpaqueEntitiesInIndex(index.file, { min: [0, 0], max: [100, 100] }),
      [],
    )
  } finally {
    index.cleanup()
  }
})

test('a whole-drawing render counts every opaque entity and reports no share', async () => {
  const index = writeIndex([
    entity('ole2frame', [0, 0], [10, 10]),
    entity('ole2frame', [500, 500], [900, 900]),
    entity('proxyentity', [20, 20], [30, 30]),
    entity('text', [0, 0], [1, 1]),
  ])
  try {
    const warnings = await describeOpaqueEntitiesInIndex(index.file, null)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /ole2frame×2, proxyentity×1/u)
    assert.doesNotMatch(warnings[0], /covering about/u)
  } finally {
    index.cleanup()
  }
})

test('an index without opaque entities produces no warning', async () => {
  const index = writeIndex([entity('line', [0, 0], [100, 100]), entity('text', [1, 1], [2, 2])])
  try {
    assert.deepEqual(
      await describeOpaqueEntitiesInIndex(index.file, { min: [0, 0], max: [100, 100] }),
      [],
    )
  } finally {
    index.cleanup()
  }
})

test('MLight extraction coverage keeps opaque and block-expansion signals visible', async () => {
  const module = await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/entity-index.ts',
  )
  const summary = module.mlightExtractionSummary({
    source_entity_count: 2,
    indexed_entity_count: 2,
    omitted_geometry_count: 0,
    failed_entity_count: 0,
    type_counts: { dimension: 1, proxyentity: 1 },
    opaque_entity_counts: { proxyentity: 1 },
    capture_semantics: 'authored database entities; block references are not recursively expanded',
    owner_block_counts: { '*Model_Space': 2 },
    block_inventory: [{
      owner_scope: 'block_definition',
      owner_block_name: 'ROOM_TAG',
      declared_entity_count: 3,
    }],
    layer_count: 1,
  }, {
    name: 'plan.dwg',
    project_relative_path: 'drawings/plan.dwg',
    saved: true,
    dbmod: 0,
  })

  assert.deepEqual({ ...summary.opaque_entity_counts }, { proxyentity: 1 })
  assert.deepEqual({ ...summary.owner_block_counts }, { '*Model_Space': 2 })
  assert.equal(summary.annotation_blocks_unexpanded, 1)
  assert.equal(summary.complete_index, false)
})
