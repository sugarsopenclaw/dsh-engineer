const test = require('node:test')
const assert = require('node:assert/strict')

test('normalizeUpdateStatus 为 available 状态生成带版本号的提示', async () => {
  const { normalizeUpdateStatus } = await import('../src/components/update/update-state.mts')
  const result = normalizeUpdateStatus({ phase: 'available', version: '0.5.1' })

  assert.equal(result.phase, 'available')
  assert.equal(result.version, '0.5.1')
  assert.equal(result.percent, null)
  assert.match(result.message, /0\.5\.1/)
})

test('normalizeUpdateStatus 会把 downloading 百分比限制在 0 到 100 之间并取整', async () => {
  const { normalizeUpdateStatus } = await import('../src/components/update/update-state.mts')
  const result = normalizeUpdateStatus({ phase: 'downloading', percent: 44.6 })

  assert.equal(result.phase, 'downloading')
  assert.equal(result.percent, 45)
  assert.match(result.message, /45%/)
})

test('shouldShowUpdateBanner 对 idle 返回 false，对 checking 返回 true', async () => {
  const { normalizeUpdateStatus, shouldShowUpdateBanner } = await import('../src/components/update/update-state.mts')

  assert.equal(shouldShowUpdateBanner(normalizeUpdateStatus({ phase: 'idle' })), false)
  assert.equal(shouldShowUpdateBanner(normalizeUpdateStatus({ phase: 'checking' })), true)
})

test('normalizeUpdateStatus 为 error 状态提供兜底文案', async () => {
  const { normalizeUpdateStatus } = await import('../src/components/update/update-state.mts')
  const result = normalizeUpdateStatus({ phase: 'error' })

  assert.equal(result.phase, 'error')
  assert.match(result.message, /更新失败/)
})
