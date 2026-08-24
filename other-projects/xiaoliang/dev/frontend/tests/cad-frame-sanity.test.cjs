const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

/**
 * The visual indexer reaches the managed gateway through the model factory, which refuses to
 * build a model without a signed catalog. The gateway itself is driven through the injected
 * fetch, so only the factory is stubbed here.
 */
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
          + " id: 'xiaoliang-agent-vision',"
          + " baseUrl: 'http://127.0.0.1:9/agent/v1',"
          + ' maxTokens: 4096 })',
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

let sanityModule
async function sanity() {
  sanityModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/frame-sanity.ts',
  )
  return sanityModule
}

let indexModule
async function buildVisualIndex(options) {
  indexModule ??= await loadBundledModule(
    'electron/runtime/agent/tools/domain/cad-subagent/visual-index.ts',
  )
  return indexModule.buildCadVisualIndex(options)
}

function bbox(minX, minY, maxX, maxY) {
  return { min: [minX, minY], max: [maxX, maxY] }
}

/** A floor plan drawn in millimetres: 60 m by 40 m of content. */
const PLAN_EXTENTS = bbox(0, 0, 60_000, 40_000)
const SHEET = bbox(1_000, 1_000, 59_000, 41_000 - 1_000)

function frame(frameId, box, source = 'polyline', confidence = 0.7) {
  return { frameId, bbox: box, source, confidence }
}

test('a sheet-sized frame is captured as detected and keeps the extents in reserve', async () => {
  const { planFrameWindow } = await sanity()
  const plan = planFrameWindow([frame('frame-01', SHEET)], PLAN_EXTENTS, 'frame-01')
  assert.equal(plan.primary.source, 'detected')
  assert.deepEqual(plan.primary.bbox, SHEET)
  assert.deepEqual(plan.primary.warnings, [])
  assert.equal(plan.fallback?.source, 'extents_fallback')
  assert.deepEqual(plan.fallback?.bbox, PLAN_EXTENTS)
})

test('the 335x540 rectangle that produced a blank index is rejected before anything is captured', async () => {
  const { planFrameWindow, describeFrameRejection } = await sanity()
  const stray = frame('frame-01', bbox(12_000, 8_000, 12_335, 8_540))
  const rejection = describeFrameRejection(stray, PLAN_EXTENTS)
  assert.match(rejection, /covers 0\.01% of the drawing extents/u)
  assert.match(rejection, /detail rectangle rather than the sheet border/u)
  const plan = planFrameWindow([stray], PLAN_EXTENTS, 'frame-01')
  assert.equal(plan.primary.source, 'extents_fallback')
  assert.deepEqual(plan.primary.bbox, PLAN_EXTENTS)
  assert.equal(plan.primary.frameId, 'frame-01', 'the artifact keeps the requested frame id')
  assert.match(plan.primary.warnings[0], /Frame sanity check rejected the detected frame/u)
  assert.equal(plan.fallback, null, 'the fallback was already taken')
})

test('a long strip and a degenerate box are both rejected as sheets', async () => {
  const { describeFrameRejection } = await sanity()
  assert.match(
    describeFrameRejection(frame('frame-02', bbox(0, 0, 40_000, 400)), PLAN_EXTENTS),
    /100:1 strip/u,
  )
  assert.match(
    describeFrameRejection(frame('frame-03', bbox(0, 0, 0.4, 0.4)), PLAN_EXTENTS),
    /too small to be a sheet/u,
  )
  assert.equal(describeFrameRejection(frame('frame-04', SHEET), PLAN_EXTENTS), null)
  assert.equal(
    describeFrameRejection(frame('frame-05', bbox(0, 0, 100, 140)), null),
    null,
    'without extents only shape and size can be judged',
  )
})

test('a rejected frame with no extents to fall back to is still captured, with a warning', async () => {
  const { planFrameWindow } = await sanity()
  const stray = frame('frame-01', bbox(0, 0, 335, 540))
  const plan = planFrameWindow([stray], null, 'frame-01')
  assert.equal(plan.primary.source, 'detected')
  assert.equal(plan.fallback, null)
  assert.deepEqual(plan.primary.warnings, [])
})

test('an undetected frame id falls back to the extents instead of failing the whole index', async () => {
  const { planFrameWindow } = await sanity()
  const plan = planFrameWindow([frame('frame-01', SHEET)], PLAN_EXTENTS, 'frame-02')
  assert.equal(plan.primary.source, 'extents_fallback')
  assert.match(plan.primary.warnings[0], /Frame frame-02 was not detected \(available: frame-01\)/u)
  assert.throws(
    () => planFrameWindow([frame('frame-01', SHEET)], null, 'frame-02'),
    /reported no extents/u,
  )
})

test('a frame that detection itself derived from the extents is labelled as the fallback', async () => {
  const { planFrameWindow } = await sanity()
  const plan = planFrameWindow(
    [frame('frame-01', PLAN_EXTENTS, 'extents', 0.25)],
    PLAN_EXTENTS,
    'frame-01',
  )
  assert.equal(plan.primary.source, 'extents_fallback')
  assert.equal(plan.fallback, null)
})

test('blankness is judged from illegible regions that are not even worth zooming', async () => {
  const { allRegionsBlank, hasEmptyPlotSignal } = await sanity()
  const blank = (regionId) => ({
    region_id: regionId,
    legible: false,
    needs_zoom: false,
    summary: '空白',
    labels: [],
  })
  assert.equal(allRegionsBlank(['full', 'q1', 'q2', 'q3', 'q4'].map(blank)), true)
  assert.equal(allRegionsBlank([]), true)
  assert.equal(
    allRegionsBlank([blank('full'), { ...blank('q1'), needs_zoom: true }]),
    false,
    'a region worth zooming into is dense, not blank',
  )
  assert.equal(allRegionsBlank([blank('full'), { ...blank('q1'), legible: true }]), false)
  assert.equal(hasEmptyPlotSignal(['png plot attempt failed: PLOT_EMPTY']), true)
  assert.equal(hasEmptyPlotSignal(['VIEW_RESTORE_FAILED: VIEWCTR']), false)
})

const DRAWING = { name: 'plan.dwg', project_relative_path: 'drawings/plan.dwg' }
const REGIONS = ['full', 'q1', 'q2', 'q3', 'q4']

function pngHeader(width, height) {
  const buffer = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function quadrantBBox(box, region) {
  const midX = (box.min[0] + box.max[0]) / 2
  const midY = (box.min[1] + box.max[1]) / 2
  if (region === 'q1') return bbox(box.min[0], midY, midX, box.max[1])
  if (region === 'q2') return bbox(midX, midY, box.max[0], box.max[1])
  if (region === 'q3') return bbox(box.min[0], box.min[1], midX, midY)
  if (region === 'q4') return bbox(midX, box.min[1], box.max[0], midY)
  return box
}

/**
 * Stands in for the bridge: writes the capture files the indexer reads back and records which
 * window each pass asked for.
 */
function fakeFacade(input) {
  const captured = []
  return {
    captured,
    detectFrames: async () => ({
      drawing: DRAWING,
      frames: input.frames,
      extents: input.extents,
      warnings: [],
    }),
    captureVisualSet: async (request) => {
      captured.push(request.bbox)
      const directory = path.join(
        input.projectRoot,
        '.xiaoliang', 'cad', '.staging', request.artifactRunId, 'visual', 'captures', request.frameId,
      )
      fs.mkdirSync(directory, { recursive: true })
      const captures = REGIONS.map((region) => {
        const filename = region === 'full' ? 'full.png' : `${region}.png`
        fs.writeFileSync(path.join(directory, filename), pngHeader(1_024, 768))
        return {
          drawing: DRAWING,
          frameId: request.frameId,
          quadrant: region === 'full' ? null : region,
          bbox: quadrantBBox(request.bbox, region),
          imagePath: `.xiaoliang/cad/.staging/${request.artifactRunId}/visual/captures/${request.frameId}/${filename}`,
          warnings: [],
        }
      })
      return {
        drawing: DRAWING,
        frameId: request.frameId,
        bbox: request.bbox,
        captures,
        warnings: input.setWarnings?.(request.bbox) ?? [],
      }
    },
  }
}

function assessment(legible) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          overview: {
            title: legible ? '一层平面图' : null,
            drawing_type: legible ? '平面图' : null,
            scale: null,
            summary: legible ? '可见轴网与房间' : '画面空白',
            visible_sections: legible ? ['轴网'] : [],
          },
          regions: REGIONS.map((region) => ({
            region_id: region,
            legible,
            needs_zoom: false,
            summary: legible ? '可读' : '空白',
            labels: [],
          })),
          warnings: [],
        }),
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function visualIndexOptions(context, input) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-frame-'))
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const facade = fakeFacade({ ...input, projectRoot })
  const assessed = []
  return {
    facade,
    assessed,
    projectRoot,
    options: {
      facade,
      projectRoot,
      artifactRunId: 'run-frame-test',
      artifactDirectory: '.xiaoliang/cad/drawings/plan--abcdef123456',
      document: { index: 0 },
      frameId: 'frame-01',
      usage: {
        apiKey: 'test-key',
        clientRunId: 'client-1',
        childRunId: 'child-1',
        fetchFn: async (_url, request) => {
          const body = JSON.parse(request.body)
          const window = facade.captured[facade.captured.length - 1]
          assessed.push(window)
          const legible = input.legibleWindow ? input.legibleWindow(window) : true
          assert.equal(body.xiaoliang_call_purpose, 'visual_index')
          return new Response(JSON.stringify(assessment(legible)), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      },
    },
  }
}

function stagedIndexPath(projectRoot) {
  return path.join(
    projectRoot, '.xiaoliang', 'cad', '.staging', 'run-frame-test', 'visual', 'visual-index.json',
  )
}

test('a mis-detected frame is indexed from the drawing extents and says so', async (context) => {
  const harness = visualIndexOptions(context, {
    frames: [frame('frame-01', bbox(12_000, 8_000, 12_335, 8_540))],
    extents: PLAN_EXTENTS,
  })
  const result = await buildVisualIndex(harness.options)
  assert.equal(result.frame_source, 'extents_fallback')
  assert.equal(result.frame_id, 'frame-01')
  assert.deepEqual(result.bbox, PLAN_EXTENTS)
  assert.equal(harness.facade.captured.length, 1, 'the bogus frame is never captured')
  assert.deepEqual(harness.facade.captured[0], PLAN_EXTENTS)
  assert.ok(result.warnings.some((warning) => /Frame sanity check rejected/u.test(warning)))
  const staged = JSON.parse(fs.readFileSync(stagedIndexPath(harness.projectRoot), 'utf8'))
  assert.equal(staged.frame_source, 'extents_fallback')
  assert.deepEqual(staged.bbox, PLAN_EXTENTS)
})

test('a plausible frame that comes back blank is retried once against the extents', async (context) => {
  const harness = visualIndexOptions(context, {
    frames: [frame('frame-01', SHEET)],
    extents: PLAN_EXTENTS,
    legibleWindow: (window) => window.max[0] === PLAN_EXTENTS.max[0],
  })
  const result = await buildVisualIndex(harness.options)
  assert.equal(result.frame_source, 'extents_fallback')
  assert.deepEqual(harness.facade.captured, [SHEET, PLAN_EXTENTS])
  assert.equal(harness.assessed.length, 2, 'exactly one retry, not a loop')
  assert.ok(result.warnings.some((warning) => /found every region of the detected frame-01 blank/u.test(warning)))
  assert.equal(fs.existsSync(stagedIndexPath(harness.projectRoot)), true)
})

test('an inkless plot widens the window before a vision call is paid for', async (context) => {
  const harness = visualIndexOptions(context, {
    frames: [frame('frame-01', SHEET)],
    extents: PLAN_EXTENTS,
    setWarnings: (window) => (
      window.max[0] === SHEET.max[0] ? ['png plot attempt failed: PLOT_EMPTY'] : []
    ),
  })
  const result = await buildVisualIndex(harness.options)
  assert.equal(result.frame_source, 'extents_fallback')
  assert.deepEqual(harness.facade.captured, [SHEET, PLAN_EXTENTS])
  assert.equal(harness.assessed.length, 1, 'the blank window is not sent to the vision model')
  assert.ok(result.warnings.some((warning) => /came back without ink/u.test(warning)))
})

test('a drawing that is blank everywhere publishes nothing and says what to do next', async (context) => {
  const harness = visualIndexOptions(context, {
    frames: [frame('frame-01', SHEET)],
    extents: PLAN_EXTENTS,
    legibleWindow: () => false,
  })
  await assert.rejects(() => buildVisualIndex(harness.options), (error) => {
    assert.match(error.message, /Every captured region is blank/u)
    assert.match(error.message, /extents_fallback/u)
    assert.match(error.message, /cad_capture action=plot/u)
    return true
  })
  assert.equal(harness.assessed.length, 2)
  assert.equal(
    fs.existsSync(stagedIndexPath(harness.projectRoot)),
    false,
    'a blank index must never reach staging, let alone publication',
  )
})
