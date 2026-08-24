const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const preloadRoot = process.env.XIAOLIANG_PRELOAD_ROOT
  ? path.resolve(process.env.XIAOLIANG_PRELOAD_ROOT)
  : path.resolve(__dirname, '..', 'dist-electron')

const checks = [
  {
    name: 'desktop',
    preload: path.join(preloadRoot, 'preload.js'),
    expression: `({
      invoke: typeof window.electronAPI?.invoke,
      platform: window.electronAPI?.environment?.platform,
    })`,
    verify(result) {
      assert.equal(result.invoke, 'function')
      assert.equal(typeof result.platform, 'string')
    },
  },
  {
    name: 'mlight',
    preload: path.join(preloadRoot, 'runtime', 'cad', 'mlight', 'preload.js'),
    expression: `({
      register: typeof window.mlightCadRuntime?.register,
    })`,
    verify(result) {
      assert.equal(result.register, 'function')
    },
  },
]

async function verifyPreload(check) {
  const preloadErrors = []
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: check.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    preloadErrors.push(error)
  })

  try {
    const html = encodeURIComponent('<!doctype html><title>preload-smoke</title>')
    await window.loadURL(`data:text/html;charset=utf-8,${html}`)
    assert.deepEqual(preloadErrors, [], `${check.name} preload emitted an error`)
    const result = await window.webContents.executeJavaScript(check.expression)
    check.verify(result)
    return window
  } catch (error) {
    window.destroy()
    throw error
  }
}

const timeout = setTimeout(() => {
  console.error('[preload-smoke] timed out')
  process.exitCode = 1
  app.exit(1)
}, 15_000)

app.whenReady().then(async () => {
  const windows = []
  try {
    for (const check of checks) {
      windows.push(await verifyPreload(check))
    }
  } finally {
    for (const window of windows) window.destroy()
  }
  clearTimeout(timeout)
  console.log(JSON.stringify({
    electron: process.versions.electron,
    node: process.versions.node,
    preloadRoot,
    preloads: checks.map(({ name }) => name),
  }))
  app.exit(0)
}).catch((error) => {
  clearTimeout(timeout)
  console.error(error)
  process.exitCode = 1
  app.exit(1)
})
