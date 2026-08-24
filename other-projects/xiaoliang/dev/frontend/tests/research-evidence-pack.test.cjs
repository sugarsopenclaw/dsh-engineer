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
    alias: { electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs') },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const subagents = loadBundledModule('electron/runtime/agent/subagents/index.ts')
const RESEARCH_TYPE = 'research-analyst'

test('evidence writer rejects the retired research type before creating artifacts', async () => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-retired-research-')))
  try {
    await assert.rejects(
      () => new subagents.EvidencePackWriter().write({
        projectRoot,
        childRunId: 'run-retired-research',
        task: 'This legacy type must not write a new pack.',
        evidenceBody: '',
        type: RESEARCH_TYPE,
      }),
      (error) => {
        assert.equal(error.name, 'EvidencePackRejection')
        assert.match(error.message, /not available.*research-analyst/i)
        return true
      },
    )
    assert.ok(!fs.existsSync(path.join(projectRoot, '.xiaoliang')))
    assert.match(
      subagents.inspectEvidenceBody('', RESEARCH_TYPE),
      /not available.*research-analyst/i,
    )
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('historical research evidence packs remain safely projectable', () => {
  const projected = subagents.projectSafeSubagentResult({
    childRunId: 'run-research-1',
    type: RESEARCH_TYPE,
    status: 'completed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: { input: 10, output: 20, cache_read: 0, cache_write: 0, total: 30, cost: 0.1 },
    durationMs: 1234,
    toolCallCount: 5,
    artifactRefs: [
      '.xiaoliang/research/pages/mohurd-gov-cn-1.md',
      '.xiaoliang/research/evidence/run-research-1/evidence.md',
    ],
  })
  const text = projected.content[0].text
  assert.match(text, /\.xiaoliang\/research\/evidence\/run-research-1\/evidence\.md/)
  assert.match(text, /待核/)
  assert.match(text, /Tier2/)
  assert.equal(projected.details.agent_type, RESEARCH_TYPE)
  assert.deepEqual(projected.details.artifact_refs, [
    '.xiaoliang/research/evidence/run-research-1/evidence.md',
  ])

  assert.throws(() => subagents.projectSafeSubagentResult({
    childRunId: 'run-research-2',
    type: RESEARCH_TYPE,
    status: 'completed',
    model: 'xiaoliang-backend/qwen3.8-max',
    usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 },
    durationMs: 1,
    toolCallCount: 1,
    artifactRefs: ['.xiaoliang/cad/evidence/run-research-2/evidence.md'],
  }), /artifact ref 必须位于 \.xiaoliang\/research\//)
})
