const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const Database = require('better-sqlite3')

const projectRoot = path.resolve(__dirname, '..')

async function loadBundledModule(relativePath, plugins = []) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    external: ['better-sqlite3'],
    plugins,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

test('power settings migration and repository persist the singleton switch', async () => {
  const { runMigrations } = await loadBundledModule('electron/runtime/db/schema.ts')
  const db = new Database(':memory:')
  runMigrations(db)

  const columns = db.prepare('PRAGMA table_info(power_settings)').all()
  assert.deepEqual(
    columns.map((column) => column.name),
    ['id', 'prevent_sleep', 'updated_at'],
  )
  assert.equal(db.prepare('SELECT version FROM schema_version').get().version, 39)

  globalThis.__xiaoliangPowerSettingsTestDb = db
  const repository = await loadBundledModule(
    'electron/runtime/settings/power-settings-repository.ts',
    [{
      name: 'power-settings-db-stub',
      setup(build) {
        build.onResolve({ filter: /^\.\.\/db$/ }, () => ({
          path: 'power-settings-db-stub',
          namespace: 'power-settings-test',
        }))
        build.onLoad({ filter: /.*/, namespace: 'power-settings-test' }, () => ({
          contents: 'exports.getDB = () => globalThis.__xiaoliangPowerSettingsTestDb',
          loader: 'js',
        }))
      },
    }],
  )

  assert.deepEqual(repository.getPowerSettings(), { preventSleep: false, updatedAt: '' })
  assert.equal(repository.savePowerSettings({ preventSleep: true }).preventSleep, true)
  assert.equal(repository.getPowerSettings().preventSleep, true)
  assert.equal(repository.savePowerSettings({ preventSleep: false }).preventSleep, false)

  delete globalThis.__xiaoliangPowerSettingsTestDb
  db.close()
})

test('power save manager starts and stops prevent-app-suspension idempotently', async () => {
  const calls = []
  const active = new Set()
  let nextId = 10
  globalThis.__xiaoliangPowerSaveBlockerTest = {
    start(mode) {
      calls.push(['start', mode])
      const id = nextId++
      active.add(id)
      return id
    },
    stop(id) {
      calls.push(['stop', id])
      active.delete(id)
    },
    isStarted(id) {
      return active.has(id)
    },
  }
  const manager = await loadBundledModule(
    'electron/runtime/power/power-save-manager.ts',
    [{
      name: 'electron-power-save-stub',
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron-power-save-stub',
          namespace: 'power-save-test',
        }))
        build.onLoad({ filter: /.*/, namespace: 'power-save-test' }, () => ({
          contents: 'exports.powerSaveBlocker = globalThis.__xiaoliangPowerSaveBlockerTest',
          loader: 'js',
        }))
      },
    }],
  )

  manager.syncPowerSaveBlocker(true)
  manager.syncPowerSaveBlocker(true)
  manager.syncPowerSaveBlocker(false)
  manager.syncPowerSaveBlocker(false)

  assert.deepEqual(calls, [
    ['start', 'prevent-app-suspension'],
    ['stop', 10],
  ])
  delete globalThis.__xiaoliangPowerSaveBlockerTest
})

test('power setting is wired through IPC and rendered as an immediate checkbox', () => {
  const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
  const ipc = read('src/shared/ipc-contract.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const bridge = read('src/services/electron-bridge.ts')
  const panel = read('src/components/runtime/llm-settings-panel.tsx')
  const main = read('electron/main.ts')

  assert.match(ipc, /SETTINGS_GET_POWER_CONFIG: 'settings:getPowerConfig'/)
  assert.match(ipc, /SETTINGS_SAVE_POWER_CONFIG: 'settings:savePowerConfig'/)
  assert.match(handlers, /syncPowerSaveBlocker\(next\.preventSleep\)/)
  assert.match(bridge, /savePowerConfig\(input: PowerSettingsInput\)/)
  assert.match(panel, /阻止系统休眠（应用运行期间）/)
  assert.match(panel, /onChange=\{\(event\) => void savePreventSleep\(event\.target\.checked\)\}/)
  assert.match(main, /syncPowerSaveBlocker\(getPowerSettings\(\)\.preventSleep\)/)
})
