const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const managerSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'electron/runtime/agent/sessions/agent-session-manager.ts',
), 'utf8')
const hookSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'src/hooks/use-local-agent-chat.ts',
), 'utf8')

test('stopped run never reports a soft error', () => {
  const abortGuard = managerSource.indexOf('const lastAborted = Boolean(')
  const clearsSoftError = managerSource.indexOf('softError = null', abortGuard)
  const emitsSoftError = managerSource.indexOf("type: 'error'", clearsSoftError)

  assert.ok(abortGuard >= 0)
  assert.ok(clearsSoftError > abortGuard)
  assert.ok(emitsSoftError > clearsSoftError, 'abort normalization must run before the soft-error event')
  assert.match(managerSource.slice(abortGuard, emitsSoftError), /finishStatus = 'stopped'/u)
  assert.match(managerSource.slice(abortGuard, emitsSoftError), /finishError = null/u)
  assert.match(
    hookSource,
    /streamError:\s*stopRequestedConversationsRef\.current\.has\(activeConversationId\)[\s\S]*?\? null/u,
  )
  assert.match(hookSource, /streamError:\s*stopped \? null : errMsg/u)
})

test('abort english never renders a failure card', () => {
  const sourceMatch = managerSource.match(/const ABORT_SOFT_ERROR = \/(.+)\/iu/u)
  assert.ok(sourceMatch)
  const abortEnglish = new RegExp(sourceMatch[1], 'iu')
  for (const message of [
    'Request was aborted',
    'This operation was aborted',
    'The operation was aborted',
  ]) assert.equal(abortEnglish.test(message), true, message)
  assert.equal(abortEnglish.test('The model returned a real failure'), false)
})
