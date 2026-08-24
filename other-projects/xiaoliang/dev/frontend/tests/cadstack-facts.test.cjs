const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
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

const runtimeModule = loadBundledModule('electron/runtime/cad/facts/cadstack-runtime.ts')
const factsModule = loadBundledModule('electron/runtime/cad/facts/facts-build-service.ts')
const factsToolsModule = loadBundledModule('electron/runtime/agent/tools/domain/cad-subagent/facts-tools.ts')
const dxfEncodingModule = loadBundledModule('electron/runtime/cad/mlight/mlight-dxf-encoding.ts')

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeScript(root, name, source) {
  const target = path.join(root, name)
  fs.writeFileSync(target, source, 'utf8')
  return target
}

test('cadstack runtime probes repository Python and parses only the final JSON line', async () => {
  const specs = runtimeModule.resolveCadstackLaunchSpecs(path.resolve(__dirname, '..'), {})
  assert.ok(specs.length >= 2)
  assert.ok(specs.some((spec) => spec.args.includes('-I') && spec.args.includes('-B')))
  assert.ok(specs.some((spec) => spec.args.includes('-X') && spec.args.includes('utf8')))
  assert.ok(specs.some((spec) => spec.label.includes('cadstack')))

  const root = temporaryDirectory('xl-cadstack-runtime-')
  try {
    const success = writeScript(root, 'success.cjs', [
      "process.stdout.write('dependency diagnostic\\n')",
      "process.stdout.write(JSON.stringify({ ok: true, command: 'status', drawings: [] }) + '\\n')",
    ].join('\n'))
    const runtime = new runtimeModule.CadstackRuntime({
      launchSpecs: [
        { command: path.join(root, 'missing-python'), args: [], label: 'missing' },
        { command: process.execPath, args: [success], label: 'node fixture' },
      ],
    })
    const result = await runtime.run(['status'], { timeoutMs: 2_000 })
    assert.equal(result.ok, true)
    assert.equal(result.command, 'status')
    assert.deepEqual(result.drawings, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('MLight DXF export advertises UTF-8 without rewriting entity text', () => {
  const unicodeDxf = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1014\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n1\n剖面线层\n0\nENDSEC\n0\nEOF\n'
  const bytes = Buffer.from(unicodeDxf, 'utf8')
  const normalized = dxfEncodingModule.normalizeMlightDxfEncoding({
    kind: 'export_dxf',
    dxfBase64: bytes.toString('base64'),
    byteLength: bytes.byteLength,
    warnings: [],
  })
  const text = Buffer.from(normalized.dxfBase64, 'base64').toString('utf8')
  assert.match(text, /\$ACADVER\n1\nAC1021/u)
  assert.match(text, /剖面线层/u)
  assert.equal(normalized.warnings.length, 1)

  const asciiDxf = Buffer.from(unicodeDxf.replace('剖面线层', 'HATCH'), 'ascii')
  const asciiResult = {
    kind: 'export_dxf',
    dxfBase64: asciiDxf.toString('base64'),
    byteLength: asciiDxf.byteLength,
    warnings: [],
  }
  assert.equal(dxfEncodingModule.normalizeMlightDxfEncoding(asciiResult), asciiResult)
})

test('cadstack runtime enforces business errors, timeout and stdout ceiling', async () => {
  const root = temporaryDirectory('xl-cadstack-guards-')
  try {
    const failure = writeScript(root, 'failure.cjs', [
      "process.stdout.write(JSON.stringify({ ok: false, command: 'build', error: { type: 'ValueError', message: 'bad binding' } }) + '\\n')",
      'process.exitCode = 1',
    ].join('\n'))
    const success = writeScript(root, 'should-not-run.cjs', [
      "process.stdout.write(JSON.stringify({ ok: true, command: 'build' }) + '\\n')",
    ].join('\n'))
    const business = new runtimeModule.CadstackRuntime({
      launchSpecs: [
        { command: process.execPath, args: [failure], label: 'business fixture' },
        { command: process.execPath, args: [success], label: 'fallback fixture' },
      ],
    })
    await assert.rejects(
      business.run(['build'], { timeoutMs: 2_000 }),
      (error) => error.name === 'CadstackCommandError' && /bad binding/u.test(error.message),
    )

    const mismatch = writeScript(root, 'mismatch.cjs', [
      "process.stdout.write(JSON.stringify({ ok: true, command: 'status' }) + '\\n')",
    ].join('\n'))
    const mismatched = new runtimeModule.CadstackRuntime({
      launchSpecs: [{ command: process.execPath, args: [mismatch], label: 'mismatch fixture' }],
    })
    await assert.rejects(
      mismatched.run(['build'], { timeoutMs: 2_000 }),
      (error) => error.name === 'CadstackCommandError' && /did not match build/u.test(error.message),
    )

    const hanging = writeScript(root, 'hanging.cjs', 'setInterval(() => {}, 1000)\n')
    const timeout = new runtimeModule.CadstackRuntime({
      launchSpecs: [{ command: process.execPath, args: [hanging], label: 'timeout fixture' }],
    })
    await assert.rejects(timeout.run(['status'], { timeoutMs: 50 }), /timed out/u)

    const noisy = writeScript(root, 'noisy.cjs', "process.stdout.write('x'.repeat(4096))\n")
    const ceiling = new runtimeModule.CadstackRuntime({
      launchSpecs: [{ command: process.execPath, args: [noisy], label: 'noisy fixture' }],
    })
    await assert.rejects(
      ceiling.run(['status'], { timeoutMs: 2_000, stdoutLimitBytes: 1024 }),
      /stdout exceeded/u,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('cadstack runtime uses short query and real-drawing build timeouts', () => {
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('status'), 20_000)
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('lookup'), 60_000)
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('ingest'), 60 * 60_000)
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('build'), 60 * 60_000)
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('bind'), 30 * 60_000)
  assert.equal(runtimeModule.cadstackCommandTimeoutMs('ask'), 30 * 60_000)
})

test('facts build service deduplicates L1 and keeps L2-L4 independent of child signals', async () => {
  const projectRoot = temporaryDirectory('xl-cad-facts-service-')
  const sourceRelativePath = 'drawings/plan.dxf'
  const source = path.join(projectRoot, ...sourceRelativePath.split('/'))
  const indexRelativePath = '.xiaoliang/cad/drawings/fixture/entities/entities.raw.jsonl'
  const index = path.join(projectRoot, ...indexRelativePath.split('/'))
  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.mkdirSync(path.dirname(index), { recursive: true })
  fs.writeFileSync(source, 'DXF fixture')
  fs.writeFileSync(index, '{"type":"line","layer":"0"}\n')

  const calls = []
  let l1Ready = false
  let l3Ready = false
  let l4Ready = false
  let mlightIndexSha256 = null
  const ingestArgs = []
  let releaseBuild
  const buildGate = new Promise((resolve) => { releaseBuild = resolve })
  let buildStarted
  const buildStartedPromise = new Promise((resolve) => { buildStarted = resolve })
  let bound
  const boundPromise = new Promise((resolve) => { bound = resolve })
  const drawingKey = 'plan--' + require('node:crypto')
    .createHash('sha256')
    .update(sourceRelativePath)
    .digest('hex')
    .slice(0, 12)
  const response = (command) => ({
    ok: true,
    command,
    status: l4Ready ? 'ready' : l1Ready ? 'partial' : 'missing',
    drawings: l1Ready
      ? [{
          drawing_key: drawingKey,
          source_sha256: require('node:crypto').createHash('sha256').update('DXF fixture').digest('hex'),
          mlight_index_sha256: mlightIndexSha256,
          layers: {
            l1: 'ready',
            l2: l3Ready ? 'ready' : 'missing',
            l3: l3Ready ? 'ready' : 'missing',
            l4: l4Ready ? 'ready' : 'missing',
          },
        }]
      : [],
  })
  const runner = {
    async run(args) {
      const command = args[0]
      calls.push(command)
      if (command === 'status') return response(command)
      if (command === 'ingest') {
        ingestArgs.push([...args])
        const indexPosition = args.indexOf('--mlight-index')
        mlightIndexSha256 = indexPosition < 0
          ? null
          : require('node:crypto').createHash('sha256').update(fs.readFileSync(args[indexPosition + 1])).digest('hex')
        l1Ready = true
        return response(command)
      }
      if (command === 'build') {
        buildStarted()
        await buildGate
        l3Ready = true
        return response(command)
      }
      if (command === 'bind') {
        l4Ready = true
        bound()
        return response(command)
      }
      throw new Error(`unexpected command ${command}`)
    },
  }
  const service = new factsModule.FactsBuildService({
    engine: { async exportDxf() { throw new Error('DXF sources must not be re-exported') } },
    runtime: runner,
  })
  try {
    const input = {
      projectRoot,
      drawing: { name: 'plan.dxf', project_relative_path: sourceRelativePath },
      mlightIndexPath: indexRelativePath,
    }
    const child = new AbortController()
    const first = service.ensureL1(input)
    const second = service.ensureL1(input)
    child.abort(new Error('child finished'))
    const [left, right] = await Promise.all([first, second])
    await buildStartedPromise
    assert.equal(left.drawingKey, drawingKey)
    assert.equal(right.drawingKey, drawingKey)
    assert.equal(calls.filter((value) => value === 'ingest').length, 1)
    assert.equal(calls.filter((value) => value === 'build').length, 1)

    const refreshed = await service.ensureL1({ ...input, force: true })
    assert.equal(refreshed.cacheHit, false)
    assert.equal(calls.filter((value) => value === 'ingest').length, 2)
    assert.equal(calls.filter((value) => value === 'build').length, 1)

    releaseBuild()
    await boundPromise
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.filter((value) => value === 'bind').length, 1)

    const cached = await service.ensureL1(input)
    assert.equal(cached.cacheHit, true)
    assert.equal(cached.backgroundScheduled, false)
    assert.equal(calls.filter((value) => value === 'ingest').length, 2)

    const { mlightIndexPath: _ignored, ...withoutMlightIndex } = input
    const comFallback = await service.ensureL1({ ...withoutMlightIndex, force: true })
    assert.equal(comFallback.status.drawings[0].mlight_index_sha256, null)
    assert.equal(ingestArgs.at(-1).includes('--mlight-index'), false)
  } finally {
    releaseBuild()
    await service.dispose()
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('a failed background build surfaces as build_error through status', async () => {
  const projectRoot = temporaryDirectory('xl-cad-facts-build-error-')
  const sourceRelativePath = 'drawings/plan.dxf'
  const source = path.join(projectRoot, ...sourceRelativePath.split('/'))
  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.writeFileSync(source, 'DXF fixture')
  const drawingKey = 'plan--' + require('node:crypto')
    .createHash('sha256')
    .update(sourceRelativePath)
    .digest('hex')
    .slice(0, 12)
  let l3Ready = false
  let buildCalls = 0
  let releaseBuild
  const buildGate = new Promise((resolve) => { releaseBuild = resolve })
  let buildStarted
  const buildStartedPromise = new Promise((resolve) => { buildStarted = resolve })
  const response = (command) => ({
    ok: true,
    command,
    status: 'partial',
    drawings: [{
      drawing_key: drawingKey,
      source_sha256: require('node:crypto').createHash('sha256').update('DXF fixture').digest('hex'),
      mlight_index_sha256: null,
      layers: {
        l1: 'ready',
        l2: 'missing',
        l3: l3Ready ? 'ready' : 'missing',
        l4: 'missing',
      },
    }],
  })
  const runner = {
    async run(args) {
      const command = args[0]
      if (command === 'status') return response(command)
      if (command === 'ingest') return response(command)
      if (command === 'build') {
        buildCalls += 1
        buildStarted()
        await buildGate
        if (buildCalls === 1) throw new Error('fixture L3 build exploded')
        l3Ready = true
        return response(command)
      }
      if (command === 'bind') return response(command)
      throw new Error(`unexpected command ${command}`)
    },
  }
  const service = new factsModule.FactsBuildService({
    engine: { async exportDxf() { throw new Error('DXF sources must not be re-exported') } },
    runtime: runner,
  })
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      const drawing = (await service.status(projectRoot, drawingKey)).drawings[0]
      if (predicate(drawing)) return drawing
    }
    return (await service.status(projectRoot, drawingKey)).drawings[0]
  }
  try {
    const input = {
      projectRoot,
      drawing: { name: 'plan.dxf', project_relative_path: sourceRelativePath },
    }
    await service.ensureL1(input)
    await buildStartedPromise
    releaseBuild()
    const failed = await waitFor((drawing) => drawing.build_error)
    assert.match(failed.build_error, /fixture L3 build exploded/u)

    // A new attempt supersedes the recorded failure, and a clean build leaves none behind.
    const retry = await service.ensureL1({ ...input, force: true })
    assert.equal(retry.cacheHit, false)
    const recovered = await waitFor((drawing) => !drawing.building && !drawing.build_error)
    assert.equal(recovered.build_error, undefined)
    assert.equal(buildCalls, 2)
  } finally {
    releaseBuild()
    await service.dispose()
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('CAD facts tools expose the hard schemas and reject incomplete evidence requests', async () => {
  const projectRoot = temporaryDirectory('xl-cad-facts-tools-')
  const drawingRelative = 'drawings/plan.dxf'
  const drawingPath = path.join(projectRoot, ...drawingRelative.split('/'))
  fs.mkdirSync(path.dirname(drawingPath), { recursive: true })
  fs.writeFileSync(drawingPath, 'DXF fixture')
  const calls = []
  const service = {
    async status(root, drawingKey) {
      calls.push(['status', root, drawingKey])
      return {
        ok: true,
        command: 'status',
        status: 'missing',
        drawings: [],
        facts_paths: { project_index: '.xiaoliang/cad/facts/INDEX.md' },
      }
    },
    async ask(root, request) {
      calls.push(['ask', root, request])
      return {
        ok: true,
        command: 'ask',
        capability_gap: [{ missing: 'core.measured_value' }],
        capability_gap_count: 7,
      }
    },
    async lookup(input) {
      calls.push(['lookup', input])
      return { ok: true, command: 'lookup', evidence: [] }
    },
  }
  try {
    const tools = factsToolsModule.buildCadFactsTools({ projectRoot, factsBuildService: service })
    assert.deepEqual(tools.map((tool) => tool.name), ['cad_facts', 'cad_ask', 'cad_lookup'])
    for (const tool of tools) assert.equal(tool.parameters.additionalProperties, false)

    const taskTypeSchema = tools[1].parameters.properties.task_type
    assert.deepEqual(
      taskTypeSchema.anyOf.map((entry) => entry.const),
      ['count', 'measure', 'locate', 'identify', 'describe', 'check', 'audit', 'reconcile', 'trace'],
    )
    assert.deepEqual(
      tools[1].parameters.properties.truth_basis.anyOf.map((entry) => entry.const),
      ['file_fact', 'drawing_expression', 'design_intent', 'bom_declaration', 'physical_reality'],
    )
    assert.equal(
      tools[1].parameters.properties.evidence_policy.additionalProperties,
      false,
    )
    await assert.rejects(
      tools[0].execute('facts-build', { action: 'build' }),
      /requires drawing_path/u,
    )
    await assert.rejects(
      tools[2].execute('lookup-empty', { drawing_path: drawingRelative }),
      /requires class, bounds, representation, or text/u,
    )

    const status = await tools[0].execute('facts-status', { action: 'status' })
    assert.equal(status.details.operation, 'facts.status')
    assert.deepEqual(status.details.relative_paths, ['.xiaoliang/cad/facts/INDEX.md'])
    const ask = await tools[1].execute('facts-ask', {
      task_type: 'measure',
      target: { semantic_class: 'generic.Component' },
    })
    assert.equal(ask.details.operation, 'facts.ask')
    assert.match(ask.details.warnings[0], /7 explicit capability gap/u)
    const lookup = await tools[2].execute('facts-lookup', {
      drawing_path: drawingRelative,
      text: 'T1',
      limit: 10,
    })
    assert.equal(lookup.details.operation, 'facts.lookup')
    assert.deepEqual(calls.map((entry) => entry[0]), ['status', 'ask', 'lookup'])
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})
