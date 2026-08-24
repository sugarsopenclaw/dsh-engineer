const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

function electronStub() {
  return {
    name: 'electron-stub',
    setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'electron-stub' }))
      build.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
        contents: [
          'export const app = { getAppPath: () => "", isPackaged: false }',
          'export const BrowserWindow = class {}',
          'export const ipcMain = { on() {}, off() {}, handle() {}, removeHandler() {}, removeListener() {} }',
        ].join('\n'),
        loader: 'js',
      }))
    },
  }
}

async function loadBundledModuleAsync(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins: [electronStub()],
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

let sessionServiceModule
async function loadSessionModule() {
  sessionServiceModule ??= await loadBundledModuleAsync(
    'electron/runtime/cad/mlight/mlight-session-service.ts',
  )
  return sessionServiceModule
}

async function loadSessionService() {
  return (await loadSessionModule()).MLightCadSessionService
}

function createProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-mlight-iso-')))
  const projectRoot = path.join(root, 'project')
  const cadDataRoot = path.join(root, 'cad-data')
  fs.mkdirSync(path.join(projectRoot, 'drawings'), { recursive: true })
  fs.mkdirSync(cadDataRoot, { recursive: true })
  fs.writeFileSync(
    path.join(projectRoot, 'drawings', 'plan.dxf'),
    '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n',
  )
  return { root, projectRoot, cadDataRoot }
}

/**
 * Stands in for the Electron renderer. Records every window that gets built so a test can
 * tell reuse from a fresh open, and whether a window was closed.
 */
function createRuntimeRecorder() {
  const windows = []
  return {
    windows,
    create() {
      const runtime = {
        id: windows.length,
        closed: false,
        opens: 0,
        operations: [],
        get isAlive() {
          return !this.closed
        },
        async send(request) {
          if (this.closed) throw new Error('window is closed')
          if (request.open) this.opens += 1
          this.operations.push(request.operation.kind)
          if (request.operation.kind === 'extract') {
            return {
              kind: 'extract',
              rawJsonl: '{}\n',
              readableMarkdown: '# CAD Entity Index\n',
              summary: {},
              warnings: [],
            }
          }
          return { kind: request.operation.kind, layers: [], summary: {}, warnings: [] }
        },
        close() {
          this.closed = true
        },
      }
      windows.push(runtime)
      return runtime
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

async function createService(fixture, recorder, overrides = {}) {
  const MLightCadSessionService = await loadSessionService()
  return new MLightCadSessionService({
    preloadPath: path.join(fixture.root, 'preload.js'),
    rendererHtmlPath: path.join(fixture.root, 'runtime.html'),
    cadDataRoot: fixture.cadDataRoot,
    createRuntimeWindow: () => recorder.create(),
    ...overrides,
  })
}

test('the window budget is configurable per machine and cannot be uncapped', async () => {
  const { resolveMaxSessions } = await loadSessionModule()
  assert.equal(resolveMaxSessions({}), 3)
  assert.equal(resolveMaxSessions({ XIAOLIANG_MLIGHT_MAX_SESSIONS: ' 6 ' }), 6)
  assert.equal(resolveMaxSessions({ XIAOLIANG_MLIGHT_MAX_SESSIONS: '0' }), 1)
  assert.equal(resolveMaxSessions({ XIAOLIANG_MLIGHT_MAX_SESSIONS: '999' }), 16)
  assert.equal(resolveMaxSessions({ XIAOLIANG_MLIGHT_MAX_SESSIONS: 'many' }), 3)
})

test('a drafting session never lands in the pool that readers share', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  await service.documentInfo(ref)
  await service.documentInfo(ref)
  assert.equal(recorder.windows.length, 1, 'repeat reads of one drawing reuse a single window')

  // Same drawing, same font mode: a pooled implementation would hand back the reader's
  // window, and every later reader would then see whatever the drafter changed.
  const privateWindowId = await service.withPrivateSession(ref, async (session) => {
    await session.send({ kind: 'layers' })
    return recorder.windows.at(-1).id
  })
  assert.equal(recorder.windows.length, 2)
  assert.notEqual(privateWindowId, recorder.windows[0].id)
  assert.equal(recorder.windows[1].closed, true, 'the drafting window is closed on the way out')

  await service.documentInfo(ref)
  assert.equal(recorder.windows.length, 2, 'readers keep their own window across a drafting run')
  assert.equal(recorder.windows[0].closed, false)
  assert.deepEqual(recorder.windows[1].operations, ['document_info', 'layers'])
})

test('a failed drafting run still closes its window and leaves readers untouched', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  await service.documentInfo(ref)
  await assert.rejects(
    service.withPrivateSession(ref, async () => {
      throw new Error('markup failed halfway')
    }),
    /markup failed halfway/u,
  )
  assert.equal(recorder.windows.length, 2)
  assert.equal(recorder.windows[1].closed, true)

  await service.documentInfo(ref)
  assert.equal(recorder.windows.length, 2, 'the reader window survived the failed run')
})

test('drafting windows count against the window budget', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  // A zero wait keeps the old fail-fast behaviour, which is what lets this test observe the
  // budget from inside the drafting run instead of queueing behind itself.
  const service = await createService(fixture, recorder, { maxSessions: 1, sessionWaitMs: 0 })
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  await service.withPrivateSession(ref, async () => {
    await assert.rejects(service.documentInfo(ref), /saturated/u)
  })
  // Once the drafting window is gone its slot comes back rather than staying reserved.
  await service.documentInfo(ref)
  assert.equal(recorder.windows.length, 2)
})

test('a caller that arrives one window over the budget queues instead of failing', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder, { maxSessions: 1 })
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  const releaseDraft = deferred()
  const draftEntered = deferred()
  const draft = service.withPrivateSession(ref, async () => {
    draftEntered.resolve()
    await releaseDraft.promise
  })
  await draftEntered.promise

  // Concurrent CAD children routinely overlap by one window; the reader waits out the
  // drafting run rather than reporting a failure the model would retry.
  const reader = service.documentInfo(ref)
  releaseDraft.resolve()
  await draft
  const document = await reader
  assert.equal(document.kind, 'document_info')
  assert.equal(recorder.windows.length, 2)
})

test('a queued caller gives up when its own operation is cancelled', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder, { maxSessions: 1 })
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  const releaseDraft = deferred()
  const draftEntered = deferred()
  const draft = service.withPrivateSession(ref, async () => {
    draftEntered.resolve()
    await releaseDraft.promise
  })
  await draftEntered.promise

  const controller = new AbortController()
  const reader = service.documentInfo({ ...ref, signal: controller.signal })
  controller.abort(new Error('child run was cancelled'))
  await assert.rejects(reader, /child run was cancelled/u)
  releaseDraft.resolve()
  await draft
})

test('two drafting windows leave the default third slot for an analyst extraction', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  for (const name of ['draft-a.dxf', 'draft-b.dxf', 'analyst.dxf']) {
    fs.copyFileSync(
      path.join(fixture.projectRoot, 'drawings', 'plan.dxf'),
      path.join(fixture.projectRoot, 'drawings', name),
    )
  }

  const releaseDrafts = deferred()
  const bothDraftsEntered = deferred()
  let draftingWindows = 0
  const holdDraftingWindow = async () => {
    draftingWindows += 1
    if (draftingWindows === 2) bothDraftsEntered.resolve()
    await releaseDrafts.promise
  }
  const firstDraft = service.withPrivateSession({
    projectRoot: fixture.projectRoot,
    sourceRelativePath: 'drawings/draft-a.dxf',
  }, holdDraftingWindow)
  const secondDraft = service.withPrivateSession({
    projectRoot: fixture.projectRoot,
    sourceRelativePath: 'drawings/draft-b.dxf',
  }, holdDraftingWindow)

  await bothDraftsEntered.promise
  try {
    const extracted = await service.extract({
      projectRoot: fixture.projectRoot,
      sourceRelativePath: 'drawings/analyst.dxf',
      artifactRunId: 'run-00000000-0000-4000-8000-000000000001',
    })
    assert.match(extracted.requestId, /^mlight-/u)
    assert.equal(recorder.windows.length, 3)
    assert.equal(recorder.windows.filter((window) => !window.closed).length, 3)
  } finally {
    releaseDrafts.resolve()
    await Promise.all([firstDraft, secondDraft])
  }
})

test('a render window given its corners in the wrong order is repaired, not refused', async () => {
  const { normalizeWindow } = await loadSessionModule()
  assert.deepEqual(
    normalizeWindow({ min: [900, 700], max: [100, 200] }, 'MLightCAD render window'),
    { min: [100, 200], max: [900, 700] },
  )
  assert.equal(normalizeWindow(undefined, 'MLightCAD render window'), undefined)
  assert.throws(
    () => normalizeWindow({ min: [100, 200], max: [100, 700] }, 'MLightCAD render window'),
    /has no area: x 100\.\.100, y 200\.\.700/u,
  )
  assert.throws(
    () => normalizeWindow({ min: [100], max: [700, 900] }, 'MLightCAD render window'),
    /four finite drawing coordinates/u,
  )
})

test('a renderer that died while parked is reopened once instead of failing the child', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  await service.documentInfo(ref)
  // The window is still registered as alive, then the renderer process goes on the next send:
  // exactly the state a parked session is found in after its process was reaped.
  const parked = recorder.windows[0]
  parked.send = async () => {
    throw new Error('MLightCAD runtime window is closed.')
  }
  const document = await service.documentInfo(ref)
  assert.equal(document.kind, 'document_info')
  assert.equal(recorder.windows.length, 2, 'the drawing was reopened in a fresh window')
  assert.equal(recorder.windows[1].opens, 1)
})

test('a drawing that cannot be parsed is reported once rather than parsed twice', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  const original = recorder.create
  recorder.create = () => {
    const runtime = original.call(recorder)
    runtime.send = async () => {
      throw new Error('MLightCAD could not parse this drawing.')
    }
    return runtime
  }
  await assert.rejects(service.documentInfo(ref), /could not parse this drawing/u)
  assert.equal(recorder.windows.length, 1, 'a content failure must not pay for a second parse')
})

test('a cancelled read is not reopened behind the child that cancelled it', async (t) => {
  const { isRuntimeWindowLifetimeError } = await loadSessionModule()
  assert.equal(isRuntimeWindowLifetimeError(new Error('MLightCAD runtime is unavailable.')), true)
  assert.equal(isRuntimeWindowLifetimeError(new Error('MLightCAD operation timed out.')), false)
  assert.equal(isRuntimeWindowLifetimeError('MLightCAD runtime window is closed.'), false)

  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(async () => {
    await service.dispose()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  const controller = new AbortController()
  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  const original = recorder.create
  recorder.create = () => {
    const runtime = original.call(recorder)
    runtime.send = async () => {
      controller.abort(new Error('child run was cancelled'))
      throw new Error('MLightCAD runtime window is closed.')
    }
    return runtime
  }
  await assert.rejects(
    service.documentInfo({ ...ref, signal: controller.signal }),
    /MLightCAD runtime window is closed/u,
  )
  assert.equal(recorder.windows.length, 1)
})

test('disposing the service closes a drafting window that is still open', async (t) => {
  const fixture = createProject()
  const recorder = createRuntimeRecorder()
  const service = await createService(fixture, recorder)
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))

  const ref = { projectRoot: fixture.projectRoot, sourceRelativePath: 'drawings/plan.dxf' }
  await service.withPrivateSession(ref, async () => {
    await service.dispose()
    assert.equal(recorder.windows[0].closed, true)
  })
  await assert.rejects(service.withPrivateSession(ref, async () => undefined), /closed/u)
})
