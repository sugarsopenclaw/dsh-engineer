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

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

test('desktop conversations resolve to a2ui and feishu stays unavailable', () => {
  const { resolveInteractionModeForConversation } = loadBundledModule(
    'electron/runtime/agent/sessions/interaction-mode.ts',
  )

  assert.equal(resolveInteractionModeForConversation('desktop_first_message'), 'a2ui')
  assert.equal(resolveInteractionModeForConversation('desktop_new_button'), 'a2ui')
  assert.equal(resolveInteractionModeForConversation('desktop_tree_branch'), 'a2ui')
  assert.equal(resolveInteractionModeForConversation('legacy_unknown'), 'a2ui')
  assert.equal(resolveInteractionModeForConversation(undefined), 'a2ui')
  assert.equal(resolveInteractionModeForConversation('feishu'), 'unavailable')
})

test('wake no longer hardcodes unavailable and confirmation still keys off a2ui', () => {
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const wakeStart = manager.indexOf('wake: async (conversationId, message, context)')
  assert.ok(wakeStart >= 0)
  const wake = manager.slice(wakeStart, wakeStart + 700)
  assert.match(wake, /resolveInteractionModeForConversation\(parent\?\.creationSource\)/)
  assert.doesNotMatch(wake, /interactionMode:\s*'unavailable'/)

  const gate = manager.slice(
    manager.indexOf('private async guardToolExecution'),
    manager.indexOf('getPendingInteraction('),
  )
  assert.match(gate, /activeInteractionModes\.get\(conversationId\) !== 'a2ui'/)
  assert.match(gate, /guardPlanModeTool/)

  const ipc = read('electron/runtime/ipc/ipc-handlers.ts')
  assert.match(ipc, /interactionMode:\s*'a2ui'/)
  const feishu = read('electron/runtime/feishu/feishu-channel-service.ts')
  assert.match(
    feishu,
    /this\.deps\.agent\.sendPromptWhenIdle\(\s*conversationId,\s*input\.prompt,\s*input\.images/,
  )
})
