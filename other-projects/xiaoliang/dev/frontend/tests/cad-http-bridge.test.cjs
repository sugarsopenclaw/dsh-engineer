const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const esbuild = require('esbuild')

function loadBundledModule(relativePath, options = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    alias: options.stubElectron
      ? { electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs') }
      : {},
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const clientModule = loadBundledModule(
  'electron/runtime/cad/drivers/autocad-http/bridge-client.ts',
)
const launcherModule = loadBundledModule(
  'electron/runtime/cad/drivers/autocad-http/bridge-launcher.ts',
)
const facadeModule = loadBundledModule(
  'electron/runtime/cad/drivers/autocad-http/cad-application-facade.ts',
)
const modeModule = loadBundledModule(
  'electron/runtime/cad/drivers/autocad-http/bridge-mode.ts',
)
const runtimeModule = loadBundledModule(
  'electron/runtime/cad/drivers/autocad-http/cad-http-runtime.ts',
  { stubElectron: true },
)

function writeDescriptor(filePath, input) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({
    pid: input.pid ?? process.pid,
    port: input.port,
    token: input.token,
    protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
    project_root: input.projectRoot,
    started_at: new Date().toISOString(),
  }))
}

test('bridge client authenticates, validates protocol and preserves bounded envelopes', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-client-'))
  const projectRoot = path.join(temporary, 'project')
  await fs.promises.mkdir(projectRoot)
  const token = 't'.repeat(64)
  let received
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + token)
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/status') {
      response.end(JSON.stringify({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        data: { running: false },
      }))
      return
    }
    if (request.url === '/v1/capabilities') {
      response.end(JSON.stringify({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        data: { operations: ['app.status', 'extract.read'] },
      }))
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      received = JSON.parse(body)
      if (received.operation === 'capture.plot') {
        response.statusCode = 404
        response.end(JSON.stringify({
          ok: false,
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          error: {
            code: 'OPERATION_NOT_FOUND',
            message: 'Requested CAD operation is not available',
            retryable: false,
            details: {},
          },
        }))
        return
      }
      if (received.operation === 'doc.open') {
        response.statusCode = 500
        response.end(JSON.stringify({
          ok: false,
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failure at C:\\private\\drawing.dwg token=must-not-escape',
            retryable: false,
            details: { token: 'must-not-escape' },
          },
        }))
        return
      }
      response.end(JSON.stringify({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        request_id: received.request_id,
        data: { entities: [], document: {}, errors: [] },
        warnings: ['fixture warning'],
        meta: { queued_ms: 4, executed_ms: 8 },
      }))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )))
    await fs.promises.rm(temporary, { recursive: true, force: true })
  })
  const address = server.address()
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  writeDescriptor(descriptorPath, {
    port: address.port,
    token,
    projectRoot: fs.realpathSync(projectRoot),
  })

  const client = new clientModule.CadHttpBridgeClient({
    descriptorPath,
    projectRoot,
    timeoutMs: 5_000,
  })
  assert.deepEqual(await client.status(), { running: false })
  assert.deepEqual(await client.capabilities(), {
    operations: ['app.status', 'extract.read'],
  })
  const options = clientModule.longCadHttpBridgeCallOptions({
    kind: 'xiaoliang-cad-subagent',
    childRunId: 'child-client-1',
    agentRole: 'cad-analyst',
  })
  const result = await client.execute(
    'extract.read',
    { handles: ['A1'] },
    undefined,
    options,
  )
  assert.match(result.requestId, /^cad-/)
  assert.deepEqual(result.warnings, ['fixture warning'])
  assert.deepEqual(result.meta, { queued_ms: 4, executed_ms: 8 })
  assert.equal(received.protocol_version, clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION)
  assert.equal(received.operation, 'extract.read')
  assert.deepEqual(received.params, { handles: ['A1'] })
  assert.deepEqual(received.client, {
    kind: 'xiaoliang-cad-subagent',
    child_run_id: 'child-client-1',
    agent_role: 'cad-analyst',
  })
  assert.deepEqual(received.deadlines, {
    queue_ms: clientModule.DEFAULT_CAD_QUEUE_MS,
    response_ms: clientModule.LONG_CAD_OPERATION_TIMEOUT_MS,
  })

  await assert.rejects(
    client.execute('capture.plot', {}),
    (error) => (
      error instanceof clientModule.CadHttpBridgeClientError
      && error.code === 'OPERATION_NOT_FOUND'
      && error.statusCode === 404
    ),
  )
  await assert.rejects(
    client.execute('doc.open', { path: 'drawing.dwg' }),
    (error) => (
      error instanceof clientModule.CadHttpBridgeClientError
      && error.code === 'INTERNAL_ERROR'
      && !error.message.includes('C:\\private')
      && !error.message.includes('must-not-escape')
      && Object.keys(error.details).length === 0
    ),
  )
  await assert.rejects(
    new clientModule.CadHttpBridgeClient({
      descriptorPath,
      projectRoot: path.join(temporary, 'other-project'),
    }).status(),
    (error) => (
      error instanceof clientModule.CadHttpBridgeClientError
      && error.code === 'BRIDGE_PROJECT_MISMATCH'
      && !error.message.includes(temporary)
    ),
  )
  await assert.rejects(
    new clientModule.CadHttpBridgeClient({
      descriptorPath: path.join(temporary, 'missing.json'),
    }).status(),
    (error) => (
      error instanceof clientModule.CadHttpBridgeClientError
      && error.code === 'BRIDGE_DESCRIPTOR_INVALID'
      && !error.message.includes(temporary)
    ),
  )
})

test('bridge client distinguishes caller abort from timeout without exposing descriptor token', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-abort-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  const token = 's'.repeat(64)
  writeDescriptor(descriptorPath, {
    port: 49152,
    token,
    projectRoot: temporary,
  })
  const neverFetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })

  const controller = new AbortController()
  const aborted = new clientModule.CadHttpBridgeClient({
    descriptorPath,
    fetchFn: neverFetch,
    timeoutMs: 5_000,
  }).status(controller.signal)
  controller.abort()
  await assert.rejects(aborted, (error) => (
    error.code === 'BRIDGE_ABORTED'
    && error.retryable === false
    && !error.message.includes(token)
  ))

  await assert.rejects(
    new clientModule.CadHttpBridgeClient({
      descriptorPath,
      fetchFn: neverFetch,
      timeoutMs: 5,
    }).status(),
    (error) => error.code === 'BRIDGE_TIMEOUT' && error.retryable === true,
  )
})

test('bridge launcher reuses only an authenticated healthy descriptor for the same project', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-reuse-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const projectRoot = path.join(temporary, 'project')
  const pythonRoot = path.join(temporary, 'python')
  await fs.promises.mkdir(projectRoot)
  await fs.promises.mkdir(pythonRoot)
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  const lockPath = path.join(temporary, 'cad-bridge.lock')
  const token = 'r'.repeat(64)
  writeDescriptor(descriptorPath, {
    pid: 4321,
    port: 37654,
    token,
    projectRoot: fs.realpathSync(projectRoot),
  })
  const requests = []
  let adoptedAlive = true
  const terminated = []
  const handle = await launcherModule.startCadHttpBridge(projectRoot, {
    pythonRoot,
    descriptorPath,
    lockPath,
    isProcessAlive: (pid) => pid === 4321 && adoptedAlive,
    terminateProcess: (pid) => {
      terminated.push(pid)
      adoptedAlive = false
    },
    fetchFn: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.endsWith('/healthz')) {
        return Response.json({
          status: 'alive',
          worker_state: 'busy',
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        })
      }
      assert.equal(request.headers.get('authorization'), 'Bearer ' + token)
      return Response.json({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        data: { running: false },
      })
    },
  })
  assert.equal(handle.reused, true)
  assert.equal(handle.owned, false)
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ['/healthz', '/v1/capabilities'],
  )
  await handle.stop()
  assert.equal(fs.existsSync(descriptorPath), true)
  await handle.terminate()
  assert.deepEqual(terminated, [4321])
  assert.equal(fs.existsSync(descriptorPath), false)
})

test('bridge launcher replaces stale descriptor, starts an owned source bridge and cleans it on stop', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-launch-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const projectRoot = path.join(temporary, 'project')
  const pythonRoot = path.join(temporary, 'python')
  await fs.promises.mkdir(projectRoot)
  await fs.promises.mkdir(pythonRoot)
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  const lockPath = path.join(temporary, 'cad-bridge.lock')
  writeDescriptor(descriptorPath, {
    pid: 4444,
    port: 37655,
    token: 'x'.repeat(64),
    projectRoot: fs.realpathSync(projectRoot),
  })

  let alive = true
  let invocation
  const bridgePid = 9876
  const token = 'p'.repeat(64)
  const terminated = []
  const spawnFn = (command, args, options) => {
    invocation = { command, args, options }
    writeDescriptor(descriptorPath, {
      pid: bridgePid,
      port: 37656,
      token,
      projectRoot: fs.realpathSync(projectRoot),
    })
    return { exitCode: null, pid: bridgePid }
  }
  const handle = await launcherModule.startCadHttpBridge(projectRoot, {
    pythonRoot,
    descriptorPath,
    lockPath,
    python: { command: 'C:\\Python312\\python.exe', args: [] },
    spawnFn,
    pollIntervalMs: 1,
    isProcessAlive: (pid) => pid === bridgePid && alive,
    terminateProcess: (pid) => {
      terminated.push(pid)
      if (pid === bridgePid) alive = false
    },
    fetchFn: async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/healthz')) {
        return Response.json({
          status: 'alive',
          worker_state: 'ready',
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        })
      }
      assert.equal(request.headers.get('authorization'), 'Bearer ' + token)
      return Response.json({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        data: {},
      })
    },
  })
  assert.equal(handle.reused, false)
  assert.equal(handle.owned, true)
  assert.equal(invocation.command, 'C:\\Python312\\python.exe')
  assert.deepEqual(invocation.args.slice(0, 2), ['-m', 'xiaoliang_cad_bridge'])
  assert.equal(invocation.args.includes('--project-root'), true)
  assert.equal(invocation.options.detached, false)
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.stdio, 'ignore')
  assert.deepEqual(terminated, [])

  await handle.stop()
  assert.deepEqual(terminated, [bridgePid])
  assert.equal(fs.existsSync(descriptorPath), false)
})

test('bridge launcher probes Python asynchronously before launching source mode', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-probe-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const projectRoot = path.join(temporary, 'project')
  const pythonRoot = path.join(temporary, 'python')
  await fs.promises.mkdir(projectRoot)
  await fs.promises.mkdir(pythonRoot)
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  const bridgePid = 9_321
  const token = 'a'.repeat(64)
  let alive = true
  let launchedCommand = ''
  const handle = await launcherModule.startCadHttpBridge(projectRoot, {
    pythonRoot,
    descriptorPath,
    lockPath: path.join(temporary, 'cad-bridge.lock'),
    environment: { XIAOLIANG_CAD_BRIDGE_PYTHON: 'C:\\Probe\\python.exe' },
    probeSpawnFn: (command) => {
      assert.equal(command, 'C:\\Probe\\python.exe')
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.kill = () => true
      process.nextTick(() => {
        child.stdout.end('C:\\Resolved\\python.exe\n')
        child.emit('close', 0)
      })
      return child
    },
    spawnFn: (command) => {
      launchedCommand = command
      writeDescriptor(descriptorPath, {
        pid: bridgePid,
        port: 39_321,
        token,
        projectRoot: fs.realpathSync(projectRoot),
      })
      return { exitCode: null, pid: bridgePid }
    },
    isProcessAlive: (pid) => pid === bridgePid && alive,
    terminateProcess: () => {
      alive = false
    },
    pollIntervalMs: 1,
    fetchFn: async (input) => {
      const url = String(input)
      if (url.endsWith('/healthz')) {
        return Response.json({
          status: 'alive',
          worker_state: 'ready',
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        })
      }
      return Response.json({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        data: { operations: ['app.status'] },
      })
    },
  })
  assert.equal(launchedCommand, 'C:\\Resolved\\python.exe')
  await handle.stop()
})

test('facade exposes fixed operations and rejects paths or handles before transport', async () => {
  const calls = []
  const fixtureDocument = {
    index: 0,
    name: '地下室.dwg',
    project_relative_path: '结构/地下室.dwg',
    active: true,
    saved: true,
    dbmod: 0,
  }
  const executor = {
    async execute(operation, params, _signal, options) {
      calls.push({ operation, params, options })
      if (operation === 'app.status' || operation === 'app.start') {
        return {
          data: {
            running: true,
            supported: true,
            document_count: 0,
            documents: [],
          },
          warnings: [],
          meta: {},
          requestId: 'fixture',
        }
      }
      if (operation === 'app.restart') {
        return {
          data: {
            running: true,
            supported: true,
            document_count: 0,
            documents: [],
            restarted: true,
            forced: true,
            quit_mode: 'forced_pid',
          },
          warnings: [],
          meta: {},
          requestId: 'fixture',
        }
      }
      if (operation === 'doc.list') {
        return { data: { documents: [] }, warnings: [], meta: {}, requestId: 'fixture' }
      }
      if (operation === 'extract.read') {
        return {
          data: { document: fixtureDocument, entities: [], errors: [] },
          warnings: [],
          meta: {},
          requestId: 'fixture',
        }
      }
      return { data: { document: {} }, warnings: [], meta: {}, requestId: 'fixture' }
    },
  }
  const facade = new facadeModule.CadApplicationFacade(executor)
  assert.equal((await facade.status()).running, true)
  assert.deepEqual(await facade.restart({ force: true }), {
    running: true,
    supported: true,
    document_count: 0,
    documents: [],
    restarted: true,
    forced: true,
    quitMode: 'forced_pid',
  })
  assert.deepEqual(calls.at(-1).params, { force: true })
  await facade.openDocument('结构/地下室.dwg')
  await facade.readEntities(['0xa1', 'A1', 'FF'])
  assert.deepEqual(calls.at(-1).params, { handles: ['A1', 'FF'] })
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['app.status', 'app.restart', 'doc.open', 'extract.read'],
  )

  await assert.rejects(() => facade.openDocument('C:\\private\\drawing.dwg'), /project-relative/)
  await assert.rejects(() => facade.openDocument('../escape.dwg'), /project-relative/)
  await assert.rejects(() => facade.readEntities(['not-a-handle']), /hexadecimal/)
})

test('bridge mode remains stdio unless trusted configuration explicitly enables HTTP', () => {
  assert.equal(modeModule.getCadBridgeMode({}), 'stdio')
  assert.equal(modeModule.getCadBridgeMode({ XIAOLIANG_CAD_BRIDGE: 'invalid' }), 'stdio')
  assert.equal(modeModule.getCadBridgeMode({ XIAOLIANG_CAD_BRIDGE: 'HTTP' }), 'http')
})

test('descriptor parser rejects protocol drift, relative roots and extra token-bearing fields', () => {
  const base = {
    pid: 1,
    port: 49152,
    token: 'z'.repeat(64),
    protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
    project_root: path.resolve('project'),
    started_at: new Date().toISOString(),
  }
  assert.equal(clientModule.parseCadHttpBridgeDescriptor(base).port, 49152)
  assert.throws(
    () => clientModule.parseCadHttpBridgeDescriptor({
      ...base,
      protocol_version: base.protocol_version + 1,
    }),
    /invalid/,
  )
  assert.throws(
    () => clientModule.parseCadHttpBridgeDescriptor({
      ...base,
      project_root: 'relative',
    }),
    /invalid/,
  )
  assert.throws(
    () => clientModule.parseCadHttpBridgeDescriptor({
      ...base,
      backup_token: 'must-not-be-accepted',
    }),
    /unexpected schema/,
  )
})

test('a rejected COM call is reported as a closed AutoCAD only when AutoCAD is really closed', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-busy-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const projectRoot = path.join(temporary, 'project')
  const pythonRoot = path.join(temporary, 'python')
  await fs.promises.mkdir(projectRoot)
  await fs.promises.mkdir(pythonRoot)
  const alive = new Set()
  let autocadRunning = false
  let statusCalls = 0
  let statusProbeBusy = false

  const runtime = new runtimeModule.ProjectScopedCadHttpRuntime({
    pythonRoot,
    descriptorPath: path.join(temporary, 'cad-bridge.json'),
    lockPath: path.join(temporary, 'cad-bridge.lock'),
    python: { command: 'C:\\Python312\\python.exe', args: [] },
    watchdogIntervalMs: 60_000,
    pollIntervalMs: 1,
    spawnFn: () => {
      alive.add(21_000)
      writeDescriptor(path.join(temporary, 'cad-bridge.json'), {
        pid: 21_000,
        port: 39_100,
        token: 'b'.repeat(64),
        projectRoot: fs.realpathSync(projectRoot),
      })
      return { exitCode: null, pid: 21_000 }
    },
    isProcessAlive: (pid) => alive.has(pid),
    terminateProcess: (pid) => alive.delete(pid),
    fetchFn: async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/healthz')) {
        return Response.json({
          status: 'alive',
          worker_state: 'ready',
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        })
      }
      if (request.url.endsWith('/v1/capabilities')) {
        return Response.json({
          ok: true,
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          data: {
            operations: ['app.status', 'app.doctor', 'capture.plot'],
            drawing_write_operations: [],
            stateful_operations: [],
          },
        })
      }
      const body = await request.json()
      if (body.operation === 'app.status') {
        statusCalls += 1
        if (statusProbeBusy) {
          return Response.json({
            ok: false,
            protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
            error: {
              code: 'CAD_BUSY',
              message: 'AutoCAD rejected the status probe',
              retryable: true,
              details: {},
            },
          }, { status: 503 })
        }
        return Response.json({
          ok: true,
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          request_id: body.request_id,
          data: { running: autocadRunning, supported: true, document_count: 0, documents: [] },
          warnings: [],
          meta: { queued_ms: 0, executed_ms: 1 },
        })
      }
      return Response.json({
        ok: false,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        error: {
          code: 'CAD_BUSY',
          message: 'AutoCAD rejected the operation after three retries',
          retryable: true,
          details: {},
        },
      }, { status: 503 })
    },
  })

  const lease = await runtime.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
  await assert.rejects(() => lease.facade.doctor(), (error) => {
    assert.equal(error.code, runtimeModule.AUTOCAD_NOT_RUNNING_CODE)
    assert.match(error.message, /AutoCAD is not running/)
    assert.match(error.message, /MLightCAD file channel/)
    assert.equal(error.retryable, false)
    return true
  })
  assert.equal(statusCalls, 1, 'the busy report is settled with a single status probe')

  const closedDiagnosis = await lease.diagnose()
  assert.equal(closedDiagnosis.autocad.state, 'not_running')
  assert.equal(closedDiagnosis.autocad.errorCode, runtimeModule.AUTOCAD_NOT_RUNNING_CODE)
  assert.equal(closedDiagnosis.plot.state, 'autocad_not_running')

  autocadRunning = true
  await assert.rejects(() => lease.facade.doctor(), (error) => {
    assert.equal(error.code, 'CAD_BUSY')
    assert.match(error.message, /rejected the operation/)
    return true
  })
  const busyDiagnosis = await lease.diagnose()
  assert.equal(busyDiagnosis.autocad.state, 'busy')
  assert.equal(busyDiagnosis.plot.state, 'busy')

  statusProbeBusy = true
  await assert.rejects(() => lease.facade.doctor(), (error) => {
    assert.equal(error.code, 'CAD_BUSY')
    assert.match(error.message, /Run cad_doctor first/)
    assert.match(error.message, /cad_app action=restart/)
    return true
  })
  const callsBeforeRestart = statusCalls
  await assert.rejects(() => lease.facade.restart({ force: true }), (error) => {
    assert.equal(error.code, 'CAD_BUSY')
    assert.doesNotMatch(error.message, /Run cad_doctor first/)
    return true
  })
  assert.equal(statusCalls, callsBeforeRestart, 'app.restart must not trigger a busy status probe')
  await lease.release()
  await runtime.dispose()
})

test('host CAD runtime shares one bridge, gates manual restart and recovers failed health', async (context) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xl-cad-http-runtime-'))
  context.after(() => fs.promises.rm(temporary, { recursive: true, force: true }))
  const projectRoot = path.join(temporary, 'project')
  const pythonRoot = path.join(temporary, 'python')
  await fs.promises.mkdir(projectRoot)
  await fs.promises.mkdir(pythonRoot)
  const descriptorPath = path.join(temporary, 'cad-bridge.json')
  const lockPath = path.join(temporary, 'cad-bridge.lock')
  const alive = new Set()
  let healthy = true
  let spawnCount = 0
  let currentPid = 0

  const runtime = new runtimeModule.ProjectScopedCadHttpRuntime({
    pythonRoot,
    descriptorPath,
    lockPath,
    python: { command: 'C:\\Python312\\python.exe', args: [] },
    watchdogIntervalMs: 250,
    healthFailureThreshold: 2,
    restartBackoffMs: [0],
    pollIntervalMs: 1,
    spawnFn: () => {
      spawnCount += 1
      currentPid = 12_000 + spawnCount
      alive.add(currentPid)
      healthy = true
      writeDescriptor(descriptorPath, {
        pid: currentPid,
        port: 39_000,
        token: String(spawnCount).repeat(64),
        projectRoot: fs.realpathSync(projectRoot),
      })
      return { exitCode: null, pid: currentPid }
    },
    isProcessAlive: (pid) => alive.has(pid),
    terminateProcess: (pid) => alive.delete(pid),
    fetchFn: async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/healthz')) {
        return Response.json({
          status: healthy ? 'alive' : 'degraded',
          worker_state: healthy ? 'ready' : 'degraded',
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        })
      }
      if (request.url.endsWith('/v1/capabilities')) {
        return Response.json({
          ok: true,
          protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          data: {
            operations: ['app.doctor', 'app.status', 'capture.plot'],
            drawing_write_operations: [],
            stateful_operations: [],
          },
        })
      }
      const body = await request.json()
      assert.equal(body.operation, 'app.doctor')
      return Response.json({
        ok: true,
        protocol_version: clientModule.CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
        request_id: body.request_id,
        data: {
          application: {
            running: true,
            supported: true,
            visible: true,
            version: '24.3',
            document_count: 1,
            documents: [{
              index: 0,
              name: 'drawing.dwg',
              project_relative_path: 'drawing.dwg',
              active: true,
              saved: true,
              dbmod: 0,
            }],
          },
          installation: {
            full_installed: true,
            lt_installed: false,
            com_registered: true,
          },
          plot: {
            ready: true,
            dependencies: { pywin32: true, pillow: true, pdfium: true },
            configurations: { pdf: true, png: true },
            warnings: [],
          },
        },
        warnings: [],
        meta: { queued_ms: 0, executed_ms: 1 },
      })
    },
  })

  const first = await runtime.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
  const second = await runtime.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
  assert.equal(spawnCount, 1)
  assert.equal(runtime.snapshot().activeLeases, 2)
  await assert.rejects(() => runtime.restart(projectRoot), /while CAD work is active/)
  const diagnosis = await first.diagnose()
  assert.equal(diagnosis.bridge.reachable, true)
  assert.equal(diagnosis.plot.ready, true)
  await first.release()
  await second.release()

  const restarted = await runtime.restart(projectRoot)
  assert.equal(spawnCount, 2)
  assert.equal(restarted.restartCount, 1)
  assert.equal(alive.has(12_001), false)
  assert.equal(alive.has(12_002), true)

  healthy = false
  await new Promise((resolve) => setTimeout(resolve, 325))
  assert.equal(spawnCount, 2, 'one failed health probe must not restart the bridge')
  const recoveryDeadline = Date.now() + 3_000
  while (spawnCount < 3 && Date.now() < recoveryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(spawnCount, 3)
  assert.equal(runtime.snapshot().state, 'healthy')
  assert.equal(runtime.snapshot().restartCount, 2)
  assert.equal(alive.has(12_002), false)

  const finalLease = await runtime.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
  let disposeSettled = false
  const disposePromise = runtime.dispose().then(() => {
    disposeSettled = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(disposeSettled, false)
  await finalLease.release()
  await disposePromise
  assert.equal(runtime.snapshot().state, 'disposed')
  assert.equal(alive.has(currentPid), false)
})
