const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('Electron dev launch waits for a fresh build with bundled assets', () => {
  const packageJson = JSON.parse(read('package.json'))
  const devScript = packageJson.scripts.dev

  assert.equal(
    packageJson.scripts['prepare:electron-dev'],
    'node scripts/prepare-electron-dev.mjs',
  )
  assert.ok(devScript.indexOf('npm run prepare:electron-dev') < devScript.indexOf('concurrently'))
  assert.match(devScript, /wait-on dist-electron\/\.dev-build-ready/)
  assert.doesNotMatch(devScript, /wait-on dist-electron\/main\.js/)
})

test('watch builds copy bundled assets once before publishing readiness', () => {
  const buildScript = read('build-electron.mjs')

  assert.match(buildScript, /let bundledAssetsReady = false/)
  assert.match(buildScript, /if \(!watch \|\| !bundledAssetsReady\)/)
  assert.match(buildScript, /result\.errors\.length === 0/)
  assert.match(buildScript, /markDevBuildReady\(\)/)
  assert.match(buildScript, /clearDevBuildReady\(\)/)
})

test('dev preparation only removes the generated Electron output directory', () => {
  const prepareScript = read('scripts/prepare-electron-dev.mjs')

  assert.match(prepareScript, /path\.basename\(outDir\) !== 'dist-electron'/)
  assert.match(prepareScript, /fs\.rmSync\(outDir/)
  assert.match(prepareScript, /maxRetries: 10/)
  assert.match(prepareScript, /Close every running Xiaoliang\/Electron development instance/)
})

test('Vite does not watch Electron output directories on Windows', () => {
  const viteConfig = read('vite.config.ts')

  assert.match(viteConfig, /'\*\*\/dist-electron\/\*\*'/)
  assert.match(viteConfig, /'\*\*\/dist-electron-pkg\/\*\*'/)
})

test('release cleanup preserves diagnostic logs that trigger the Node Windows path bug', () => {
  const cleanRelease = read('scripts/clean-release.mjs')

  assert.match(cleanRelease, /entry\.toLowerCase\(\)\.endsWith\('\.log'\)/)
  assert.match(cleanRelease, /shouldPreserveLegacyEntry\(entry\)/)
})
