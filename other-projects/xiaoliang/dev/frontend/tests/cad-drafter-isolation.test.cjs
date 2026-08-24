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

const DRAFTER_ROOT = 'electron/runtime/agent/tools/domain/cad-drafter'
const layerPolicy = loadBundledModule(`${DRAFTER_ROOT}/layer-policy.ts`)
const { DrafterWorkspace, DRAFTER_OUTPUT_ROOT } = loadBundledModule(`${DRAFTER_ROOT}/workspace.ts`)

function createProject() {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-drafter-iso-')))
  const drawingRelativePath = 'drawings/plan.dxf'
  const drawingPath = path.join(projectRoot, ...drawingRelativePath.split('/'))
  fs.mkdirSync(path.dirname(drawingPath), { recursive: true })
  fs.writeFileSync(drawingPath, '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')
  return {
    projectRoot,
    drawing: {
      name: 'plan.dxf',
      project_relative_path: drawingRelativePath,
      saved: true,
      dbmod: 0,
    },
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  }
}

function readLedger(projectRoot) {
  const ledgerPath = path.join(projectRoot, ...DRAFTER_OUTPUT_ROOT.split('/'), '.provenance.jsonl')
  if (!fs.existsSync(ledgerPath)) return []
  return fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

test('layer policy admits only XL- names the agent can own', () => {
  assert.equal(layerPolicy.DRAFTER_LAYER_PREFIX, 'XL-')
  assert.equal(layerPolicy.assertDrafterLayerName('XL-NOTE'), 'XL-NOTE')
  assert.equal(layerPolicy.assertDrafterLayerName('  XL-标注  '), 'XL-标注')

  // The drawing's own layers, including the ones every drawing has, stay unreachable.
  for (const drawingLayer of ['0', 'Defpoints', 'S-BEAM', 'xl-note', 'XL']) {
    assert.throws(() => layerPolicy.assertDrafterLayerName(drawingLayer), /XL-|something after/u)
  }
  assert.throws(() => layerPolicy.assertDrafterLayerName(''), /empty/u)
  assert.throws(() => layerPolicy.assertDrafterLayerName(`XL-${'x'.repeat(300)}`), /255/u)
  // Characters AutoCAD forbids in symbol names would produce a DXF that will not reopen.
  for (const invalid of ['XL-a/b', 'XL-a<b', 'XL-a"b', 'XL-a|b', 'XL-a,b', 'XL-a=b', 'XL-a;b']) {
    assert.throws(() => layerPolicy.assertDrafterLayerName(invalid), /cannot contain/u)
  }
  assert.throws(() => layerPolicy.assertDrafterLayerName('XL-a\u0007b'), /control characters/u)
})

test('layer ownership guard refuses edits to the drawing own layers', () => {
  assert.equal(layerPolicy.isDrafterLayer('XL-NOTE'), true)
  assert.equal(layerPolicy.isDrafterLayer('S-BEAM'), false)
  layerPolicy.assertDrafterOwnsLayer('XL-NOTE', 'cad_markup')
  assert.throws(
    () => layerPolicy.assertDrafterOwnsLayer('S-BEAM', 'cad_markup'),
    /belongs to the drawing/u,
  )
})

test('workspace writes into the project output root and records provenance', async () => {
  const fixture = createProject()
  try {
    const workspace = new DrafterWorkspace(fixture.projectRoot, 'child-drafter-abcdef12')
    const written = await workspace.write({
      name: '平面图 markup',
      extension: '.dxf',
      bytes: Buffer.from('0\nSECTION\n0\nEOF\n'),
      provenance: { source: fixture.drawing, layers: ['XL-NOTE'] },
    })

    assert.match(written.relativePath, /^xiaoliang-outputs\/cad\/.+-abcdef12\.dxf$/u)
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, ...written.relativePath.split('/'))))

    const [record] = readLedger(fixture.projectRoot)
    assert.equal(record.path, written.relativePath)
    assert.equal(record.child_run_id, 'child-drafter-abcdef12')
    assert.equal(record.source.project_relative_path, 'drawings/plan.dxf')
    assert.match(record.source.sha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(record.layers, ['XL-NOTE'])
  } finally {
    fixture.cleanup()
  }
})

test('workspace never replaces an existing file, including a real drawing left in outputs', async () => {
  const fixture = createProject()
  try {
    const workspace = new DrafterWorkspace(fixture.projectRoot, 'child-drafter-abcdef12')
    const first = await workspace.write({
      name: 'plan',
      extension: '.dxf',
      bytes: Buffer.from('first'),
      provenance: {},
    })
    await assert.rejects(
      workspace.write({
        name: 'plan',
        extension: '.dxf',
        bytes: Buffer.from('second'),
        provenance: {},
      }),
      /already exists/u,
    )
    assert.equal(
      fs.readFileSync(path.join(fixture.projectRoot, ...first.relativePath.split('/')), 'utf8'),
      'first',
    )
    // The rejected write leaves no provenance line, so the ledger cannot claim a file it
    // did not produce.
    assert.equal(readLedger(fixture.projectRoot).length, 1)
  } finally {
    fixture.cleanup()
  }
})

test('workspace confines names and formats to what the drafter may produce', async () => {
  const fixture = createProject()
  try {
    const workspace = new DrafterWorkspace(fixture.projectRoot, 'child-drafter-abcdef12')
    for (const extension of ['.dwg', '.exe', '.js', '.json']) {
      await assert.rejects(
        workspace.write({ name: 'x', extension, bytes: Buffer.from('x'), provenance: {} }),
        /cannot write/u,
      )
    }
    // Traversal cannot survive slugging, so an escape attempt becomes an ordinary name.
    const escaped = await workspace.allocate('../../etc/passwd', '.dxf')
    assert.match(escaped.relativePath, /^xiaoliang-outputs\/cad\/etc-passwd-abcdef12\.dxf$/u)

    await assert.rejects(
      workspace.write({ name: 'empty', extension: '.dxf', bytes: Buffer.alloc(0), provenance: {} }),
      /empty/u,
    )
  } finally {
    fixture.cleanup()
  }
})

test('workspace refuses an output root that symlinks outside the project', async (t) => {
  const fixture = createProject()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-drafter-outside-')))
  try {
    const outputRoot = path.join(fixture.projectRoot, ...DRAFTER_OUTPUT_ROOT.split('/'))
    fs.mkdirSync(path.dirname(outputRoot), { recursive: true })
    try {
      fs.symlinkSync(outsideRoot, outputRoot, 'dir')
    } catch {
      t.skip('this platform does not allow creating directory symlinks unprivileged')
      return
    }
    const workspace = new DrafterWorkspace(fixture.projectRoot, 'child-drafter-abcdef12')
    await assert.rejects(
      workspace.write({ name: 'x', extension: '.dxf', bytes: Buffer.from('x'), provenance: {} }),
      /outside the project root/u,
    )
    assert.deepEqual(fs.readdirSync(outsideRoot), [])
  } finally {
    fixture.cleanup()
    fs.rmSync(outsideRoot, { recursive: true, force: true })
  }
})
