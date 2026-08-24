const assert = require('node:assert/strict')

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version)
  assert.ok(match, `Invalid runtime version: ${version}`)
  return match.slice(1).map(Number)
}

function assertVersionAtLeast(actual, expected) {
  const actualParts = parseVersion(actual)
  const expectedParts = parseVersion(expected)
  for (let index = 0; index < expectedParts.length; index += 1) {
    if (actualParts[index] > expectedParts[index]) return
    if (actualParts[index] < expectedParts[index]) {
      assert.fail(`Expected runtime >= ${expected}, received ${actual}`)
    }
  }
}

assert.ok(process.versions.electron, 'This check must run inside Electron')
assertVersionAtLeast(process.versions.node, '22.19.0')

const Database = require('better-sqlite3')
const database = new Database(':memory:')
try {
  const row = database.prepare('SELECT 1 AS ok').get()
  assert.deepEqual(row, { ok: 1 })
} finally {
  database.close()
}

const keytar = require('keytar')
for (const method of ['getPassword', 'setPassword', 'deletePassword']) {
  assert.equal(typeof keytar[method], 'function', `keytar.${method} is unavailable`)
}

console.log(JSON.stringify({
  electron: process.versions.electron,
  node: process.versions.node,
  modules: process.versions.modules,
  napi: process.versions.napi,
  nativeModules: ['better-sqlite3', 'keytar'],
}))
