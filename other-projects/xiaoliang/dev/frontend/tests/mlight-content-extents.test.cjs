const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

/**
 * The measurement lives in the renderer bundle next to the MLightCAD imports, so it is
 * bundled with those resolved away: only the pure box maths is under test here, and the
 * end-to-end framing is covered by the write probe against real drawings.
 */
async function loadMeasurement() {
  const filename = path.resolve(__dirname, '..', 'src/mlight-runtime/operations.ts')
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

let measurementModule
async function measureBoxes(boxes) {
  measurementModule ??= await loadMeasurement()
  return measurementModule.measureBoxes(boxes)
}

/** A grid of small entities standing in for the drawn content of a sheet. */
function sheet(originX, originY, count = 100, step = 100) {
  const boxes = []
  const side = Math.ceil(Math.sqrt(count))
  for (let index = 0; index < count; index += 1) {
    const x = originX + (index % side) * step
    const y = originY + Math.floor(index / side) * step
    boxes.push({ minX: x, minY: y, maxX: x + step / 2, maxY: y + step / 2 })
  }
  return boxes
}

test('a drawing that fills its extents is left alone', async () => {
  const measurement = await measureBoxes(sheet(0, 0))
  assert.deepEqual(measurement.extents, { min: [0, 0], max: [950, 950] })
  // Null means "extents is already the right frame", which callers rely on rather than
  // comparing the two boxes themselves.
  assert.equal(measurement.contentExtents, null)
  assert.equal(measurement.omittedEntityCount, 0)
})

test('one stray entity parked far away no longer decides the frame', async () => {
  const boxes = [...sheet(0, 0), { minX: 500_000, minY: 500_000, maxX: 500_001, maxY: 500_001 }]
  const measurement = await measureBoxes(boxes)

  assert.deepEqual(measurement.extents, { min: [0, 0], max: [500_001, 500_001] })
  assert.deepEqual(measurement.contentExtents, { min: [0, 0], max: [950, 950] })
  assert.equal(measurement.omittedEntityCount, 1)
})

test('strays on one side only still collapse onto the content', async () => {
  // A percentile pair would keep the low end and trim real content; the interval has to
  // slide to sit where the entities actually are.
  const boxes = [
    ...sheet(1_000_000, 0),
    { minX: -900_000, minY: -900_000, maxX: -899_999, maxY: -899_999 },
    { minX: -800_000, minY: -800_000, maxX: -799_999, maxY: -799_999 },
  ]
  const measurement = await measureBoxes(boxes)
  assert.deepEqual(measurement.contentExtents, { min: [1_000_000, 0], max: [1_000_950, 950] })
  assert.equal(measurement.omittedEntityCount, 2)
})

test('an entity that reaches past the dense area is framed whole, not cut', async () => {
  // The border and title block of a real sheet are single entities much larger than the
  // things they surround, so the frame is unioned from kept entities rather than clipped
  // to the dense interval.
  const border = { minX: -200, minY: -200, maxX: 1_150, maxY: 1_150 }
  const measurement = await measureBoxes([
    ...sheet(0, 0),
    border,
    { minX: 900_000, minY: 900_000, maxX: 900_001, maxY: 900_001 },
  ])
  assert.deepEqual(measurement.contentExtents, { min: [-200, -200], max: [1_150, 1_150] })
})

test('a drawing genuinely spread over its extents keeps the full frame', async () => {
  // Two sheets side by side are both content: trimming one away would hide half the
  // drawing, so the area guard has to decline.
  const measurement = await measureBoxes([...sheet(0, 0, 100), ...sheet(1_200, 0, 100)])
  assert.equal(measurement.contentExtents, null)
  assert.equal(measurement.omittedEntityCount, 0)
})

test('degenerate inputs report no measurement instead of a broken frame', async () => {
  assert.deepEqual(await measureBoxes([]), { extents: null, contentExtents: null, omittedEntityCount: 0 })
  const single = await measureBoxes([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }])
  assert.deepEqual(single.extents, { min: [0, 0], max: [10, 10] })
  assert.equal(single.contentExtents, null)
})
