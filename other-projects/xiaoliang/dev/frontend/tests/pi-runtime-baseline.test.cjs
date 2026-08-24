const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath) {
  const filename = path.resolve(projectRoot, relativePath)
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

const flags = loadBundledModule('electron/runtime/agent/pi/feature-flags.ts')

test('completed Pi capabilities default on including coding tools', () => {
  assert.deepEqual(flags.DEFAULT_PI_FEATURE_FLAGS, {
    pi_runtime_v2: true,
    pi_session_jsonl: true,
    pi_branching: true,
    pi_extensions: true,
    pi_coding_tools: true,
  })
  assert.deepEqual(flags.getPiFeatureFlags({}), flags.DEFAULT_PI_FEATURE_FLAGS)
  assert.equal(flags.isPiFeatureEnabled('pi_runtime_v2', {}), true)
  assert.equal(flags.isPiFeatureEnabled('pi_coding_tools', {}), true)
  assert.equal(flags.parsePiFeatureFlag(' ON '), true)
  assert.equal(flags.parsePiFeatureFlag('true'), true)
  assert.equal(flags.parsePiFeatureFlag('0'), false)
  assert.equal(flags.parsePiFeatureFlag('unexpected'), false)

  const overridden = flags.getPiFeatureFlags({
    XIAOLIANG_PI_RUNTIME_V2: '0',
    XIAOLIANG_PI_SESSION_JSONL: 'false',
    XIAOLIANG_PI_BRANCHING: 'off',
    XIAOLIANG_PI_EXTENSIONS: 'unexpected',
    XIAOLIANG_PI_CODING_TOOLS: 'off',
  })
  assert.deepEqual(overridden, {
    pi_runtime_v2: false,
    pi_session_jsonl: false,
    pi_branching: false,
    pi_extensions: false,
    pi_coding_tools: false,
  })
})

test('Pi, Electron, TypeScript and Node baselines stay exactly pinned', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['@earendil-works/pi-agent-core'], '0.84.1')
  assert.equal(manifest.dependencies['@earendil-works/pi-ai'], '0.84.1')
  assert.equal(manifest.dependencies['@earendil-works/pi-coding-agent'], '0.84.1')
  assert.equal(manifest.dependencies['better-sqlite3'], '13.0.3')
  assert.equal(manifest.dependencies.typebox, '1.3.7')
  assert.equal(manifest.dependencies['@mariozechner/pi-agent-core'], undefined)
  assert.equal(manifest.dependencies['@mariozechner/pi-ai'], undefined)
  assert.equal(manifest.devDependencies.electron, '43.2.0')
  assert.equal(manifest.devDependencies['@electron/rebuild'], '4.2.0')
  assert.equal(manifest.devDependencies['node-abi'], '4.33.0')
  assert.equal(manifest.devDependencies.typescript, '5.9.3')
  assert.equal(manifest.engines.node, '>=22.19.0')
})
