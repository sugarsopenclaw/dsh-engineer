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
      build.onResolve({ filter: /^electron$/ }, () => ({
        path: 'electron',
        namespace: 'electron-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
        contents: [
          'export const app = { getAppPath: () => "", isPackaged: false }',
          'export const BrowserWindow = class {}',
          'export const ipcMain = { on() {}, off() {}, handle() {}, removeHandler() {} }',
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

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-cad-preview-'))
  const projectRoot = path.join(root, 'project')
  const cadDataRoot = path.join(root, 'cad-data')
  fs.mkdirSync(path.join(projectRoot, 'drawings'), { recursive: true })
  fs.mkdirSync(path.join(cadDataRoot, 'fonts'), { recursive: true })
  // `AC10xx` is the DWG magic the asset server checks before it will stream a file.
  fs.writeFileSync(path.join(projectRoot, 'drawings', 'plan.dwg'), `AC1032${'\0'.repeat(200)}`)
  fs.writeFileSync(path.join(projectRoot, 'drawings', 'plan.dxf'), '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n')
  fs.writeFileSync(path.join(projectRoot, 'drawings', 'imposter.dwg'), 'this is not a drawing')
  fs.writeFileSync(path.join(projectRoot, 'notes.txt'), 'plain text')
  fs.writeFileSync(path.join(root, 'outside.dwg'), `AC1032${'\0'.repeat(200)}`)
  fs.writeFileSync(path.join(cadDataRoot, 'fonts', 'fonts.json'), '{"fonts":[]}')
  fs.writeFileSync(path.join(root, 'secret.json'), '{"token":"leaked"}')
  return { root, projectRoot, cadDataRoot }
}

async function fetchStatus(url) {
  const response = await fetch(url)
  await response.arrayBuffer()
  return response.status
}

test('preview grants are single-use, drawing-shaped, and confined to the project root', async (t) => {
  const workspace = createWorkspace()
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }))

  const { CadPreviewService } = await loadBundledModuleAsync(
    'electron/runtime/cad/mlight/cad-preview-service.ts',
  )
  const service = new CadPreviewService(workspace.cadDataRoot)
  t.after(() => service.dispose())

  const grant = await service.grant({
    projectRoot: workspace.projectRoot,
    relativePath: 'drawings/plan.dwg',
  })
  assert.equal(grant.fileName, 'plan.dwg')
  assert.match(grant.sourceUrl, /^http:\/\/127\.0\.0\.1:\d+\/source\//)
  assert.match(grant.cadDataBaseUrl, /^http:\/\/127\.0\.0\.1:\d+\/cad-data\//)

  const first = await fetch(grant.sourceUrl)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('content-type'), 'application/vnd.dwg')
  assert.equal((await first.arrayBuffer()).byteLength, 206)
  // Replaying a redeemed capability must not hand the drawing out a second time.
  assert.equal(await fetchStatus(grant.sourceUrl), 404)

  const dxf = await service.grant({
    projectRoot: workspace.projectRoot,
    relativePath: 'drawings/plan.dxf',
  })
  const dxfResponse = await fetch(dxf.sourceUrl)
  assert.equal(dxfResponse.status, 200)
  assert.equal(dxfResponse.headers.get('content-type'), 'application/dxf')
  await dxfResponse.arrayBuffer()

  for (const escape of ['../outside.dwg', path.join(workspace.root, 'outside.dwg'), 'drawings/../../outside.dwg']) {
    await assert.rejects(
      () => service.grant({ projectRoot: workspace.projectRoot, relativePath: escape }),
      /must be project-relative/,
    )
  }
  await assert.rejects(
    () => service.grant({ projectRoot: workspace.projectRoot, relativePath: 'notes.txt' }),
    /only DWG and DXF/,
  )
  await assert.rejects(
    () => service.grant({ projectRoot: workspace.projectRoot, relativePath: 'drawings/imposter.dwg' }),
    /signature does not match/,
  )
})

test('the preview origin serves only the bundled cad-data corpus', async (t) => {
  const workspace = createWorkspace()
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }))

  const { CadPreviewService } = await loadBundledModuleAsync(
    'electron/runtime/cad/mlight/cad-preview-service.ts',
  )
  const service = new CadPreviewService(workspace.cadDataRoot)
  t.after(() => service.dispose())

  const grant = await service.grant({
    projectRoot: workspace.projectRoot,
    relativePath: 'drawings/plan.dwg',
  })
  const origin = new URL(grant.cadDataBaseUrl).origin

  const fonts = await fetch(`${grant.cadDataBaseUrl}fonts/fonts.json`)
  assert.equal(fonts.status, 200)
  assert.equal(await fonts.text(), '{"fonts":[]}')

  assert.equal(await fetchStatus(`${grant.cadDataBaseUrl}fonts/${encodeURIComponent('../../secret.json')}`), 404)
  assert.equal(await fetchStatus(`${grant.cadDataBaseUrl}secrets/fonts.json`), 404)
  assert.equal(await fetchStatus(`${origin}/cad-data/wrong-token/fonts/fonts.json`), 404)
  assert.equal(await fetchStatus(`${origin}/`), 404)
})

test('unredeemed preview capabilities do not accumulate across a browsing session', async (t) => {
  const workspace = createWorkspace()
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }))

  const { CadPreviewService } = await loadBundledModuleAsync(
    'electron/runtime/cad/mlight/cad-preview-service.ts',
  )
  const service = new CadPreviewService(workspace.cadDataRoot)
  t.after(() => service.dispose())

  const grants = []
  for (let index = 0; index < 9; index += 1) {
    grants.push(await service.grant({
      projectRoot: workspace.projectRoot,
      relativePath: 'drawings/plan.dwg',
    }))
  }

  assert.equal(await fetchStatus(grants[0].sourceUrl), 404)
  assert.equal(await fetchStatus(grants.at(-1).sourceUrl), 200)
})

test('a disposed preview service stops serving and stops granting', async (t) => {
  const workspace = createWorkspace()
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }))

  const { CadPreviewService } = await loadBundledModuleAsync(
    'electron/runtime/cad/mlight/cad-preview-service.ts',
  )
  const service = new CadPreviewService(workspace.cadDataRoot)
  const grant = await service.grant({
    projectRoot: workspace.projectRoot,
    relativePath: 'drawings/plan.dwg',
  })
  await service.dispose()

  await assert.rejects(() => fetch(grant.sourceUrl))
  await assert.rejects(
    () => service.grant({ projectRoot: workspace.projectRoot, relativePath: 'drawings/plan.dwg' }),
    /closed/,
  )
})
