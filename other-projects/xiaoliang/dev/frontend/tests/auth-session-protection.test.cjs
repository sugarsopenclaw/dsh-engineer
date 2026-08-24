const test = require('node:test')
const assert = require('node:assert/strict')
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

test('auth client preserves the backend error code used by refresh protection', async () => {
  const originalFetch = global.fetch
  const { BackendAuthApiClient, BackendApiError } = loadBundledModule(
    'electron/runtime/backend/client.ts',
  )
  global.fetch = async () => new Response(JSON.stringify({
    success: false,
    error: '刷新令牌无效或已失效。',
    code: 'invalid_refresh_token',
  }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

  try {
    await assert.rejects(
      () => new BackendAuthApiClient().refresh('refresh-token-for-test'),
      (error) => {
        assert.ok(error instanceof BackendApiError)
        assert.equal(error.status, 401)
        assert.equal(error.code, 'invalid_refresh_token')
        return true
      },
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('only an explicit invalid refresh token response is destructive', () => {
  const {
    BackendApiError,
    isInvalidRefreshTokenError,
  } = loadBundledModule('electron/runtime/backend/client.ts')

  assert.equal(
    isInvalidRefreshTokenError(
      new BackendApiError('刷新令牌无效或已失效。', 401, 'invalid_refresh_token'),
    ),
    true,
  )
  assert.equal(
    isInvalidRefreshTokenError(new BackendApiError('临时网关故障', 503, 'gateway_unavailable')),
    false,
  )
  assert.equal(
    isInvalidRefreshTokenError(new BackendApiError('临时鉴权故障', 401, 'temporary_auth_error')),
    false,
  )
  assert.equal(isInvalidRefreshTokenError(new TypeError('network failed')), false)
})

test('backend request surfaces FastAPI validation fields instead of a generic 422', async () => {
  const originalFetch = global.fetch
  const { backendRequest, BackendApiError } = loadBundledModule(
    'electron/runtime/backend/http.ts',
  )
  global.fetch = async () => new Response(JSON.stringify({
    detail: [{
      type: 'greater_than_equal',
      loc: ['body', 'event_count'],
      msg: 'Input should be greater than or equal to 1',
      input: 0,
    }],
  }), {
    status: 422,
    headers: { 'content-type': 'application/json' },
  })

  try {
    await assert.rejects(
      () => backendRequest('/subagent-traces/prepare', {
        method: 'POST',
        body: { event_count: 0 },
      }),
      (error) => {
        assert.ok(error instanceof BackendApiError)
        assert.equal(error.status, 422)
        assert.equal(error.message, 'event_count: Input should be greater than or equal to 1')
        return true
      },
    )
  } finally {
    global.fetch = originalFetch
  }
})
