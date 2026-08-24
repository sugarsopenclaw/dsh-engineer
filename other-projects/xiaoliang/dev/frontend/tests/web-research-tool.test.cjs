const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const frontendRoot = path.resolve(__dirname, '..')
const electronStubPath = path.resolve(__dirname, 'fixtures', 'electron-stub.cjs')

function loadBundledModule(relativePath) {
  const filename = path.resolve(frontendRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    alias: { electron: electronStubPath },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const web = loadBundledModule('electron/runtime/agent/tools/domain/web/index.ts')
const flags = loadBundledModule('electron/runtime/agent/subagents/feature-flags.ts')

const searchWeb = async (input) => ({
  query_or_url: input.query,
  model: 'search-stub',
  provider: 'bocha',
  fallback_reason: null,
  status: 'empty',
  answer: '',
  sources: [],
  elapsed_ms: 1,
})

test('the main agent exposes only web_search and web_fetch', () => {
  const tools = web.buildMainAgentWebTools({ searchWeb })
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch'])
  assert.equal(tools.some((tool) => tool.name === 'web_research'), false)
})

test('there is no web_research feature flag or public executor', () => {
  assert.equal(Object.hasOwn(flags, 'isWebResearchEnabled'), false)
  assert.equal(Object.hasOwn(flags, 'getWebResearchMode'), false)
  assert.equal(Object.hasOwn(flags, 'parseWebResearchMode'), false)
  assert.equal(Object.hasOwn(web, 'buildWebResearchRequest'), false)

  const flagSource = fs.readFileSync(
    path.join(frontendRoot, 'electron/runtime/agent/subagents/feature-flags.ts'),
    'utf8',
  )
  assert.doesNotMatch(flagSource, /XIAOLIANG_WEB_RESEARCH|WebResearchMode|webResearchEnabled/u)
})

test('the session manager wires only authenticated /web/search and /web/fetch routes', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )
  assert.match(source, /endpoint: '\/web\/search'/u)
  assert.match(source, /endpoint: '\/web\/fetch'/u)
  assert.match(source, /endpoint: '\/web\/search' \| '\/web\/fetch'/u)
  assert.doesNotMatch(source, /\/web\/research|webResearchEnabled|researchWeb:/u)
})
