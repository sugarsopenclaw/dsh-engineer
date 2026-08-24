const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8'))
}

const ARTIFACT_STORE = 'electron/runtime/agent/tools/domain/cad-subagent/artifact-store.ts'

test('CAD artifact paths reject drive-relative and repeated-dot prefixes', () => {
  const { normalizeProjectRelativePath } = loadBundledModule(ARTIFACT_STORE)

  assert.equal(normalizeProjectRelativePath('./drawings/plan.dwg'), 'drawings/plan.dwg')
  for (const value of ['C:drive-relative.dwg', '././outside.dwg', 'bad\0name.dwg']) {
    assert.throws(() => normalizeProjectRelativePath(value), /safe project-relative/u)
  }
})

test('MLight entity producer version tracks the pinned @mlightcad packages', () => {
  const { CAD_MLIGHT_ENTITIES_PRODUCER } = loadBundledModule(ARTIFACT_STORE)
  const { dependencies } = readJson('package.json')

  assert.equal(
    CAD_MLIGHT_ENTITIES_PRODUCER.version,
    `data-model@${dependencies['@mlightcad/data-model']}`
    + `+cad-simple-viewer@${dependencies['@mlightcad/cad-simple-viewer']}`
    + '+serializer@1',
    'Bump the MLIGHT_* version constants in artifact-store.ts whenever the @mlightcad pins move, '
    + 'otherwise artifacts extracted by the new parser keep the old fingerprint and stale caches survive.',
  )
})

test('pinned @mlightcad versions are exactly what is installed', () => {
  const { dependencies } = readJson('package.json')
  for (const name of ['@mlightcad/data-model', '@mlightcad/cad-simple-viewer']) {
    const pinned = dependencies[name]
    assert.match(pinned, /^\d+\.\d+\.\d+$/u, `${name} must stay exactly pinned, got ${pinned}`)
    assert.equal(readJson(`node_modules/${name}/package.json`).version, pinned)
  }
})

test('entity producers stay distinguishable and are all trusted for cache reuse', () => {
  const store = loadBundledModule(ARTIFACT_STORE)
  const mlight = store.CAD_MLIGHT_ENTITIES_PRODUCER
  const com = store.CAD_COM_ENTITIES_PRODUCER

  assert.equal(mlight.name, 'mlightcad')
  assert.equal(com.name, 'xiaoliang-cad-http-com')
  assert.notEqual(mlight.fingerprint, com.fingerprint)
  for (const producer of [mlight, com]) {
    assert.match(producer.fingerprint, /^[0-9a-f]{64}$/u)
  }

  // The compatibility alias must keep pointing at COM: callers that publish real AutoCAD
  // output rely on it, and repointing it would mislabel every COM artifact as MLight.
  assert.equal(store.CAD_ENTITIES_PRODUCER, com)
})
