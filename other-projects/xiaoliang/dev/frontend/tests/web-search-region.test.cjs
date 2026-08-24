const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath) {
  const filename = path.resolve(projectRoot, relativePath)
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

const web = loadBundledModule('electron/runtime/agent/tools/domain/web/index.ts')

const SEARCH_SOURCES = [
  {
    title: '一文读懂地下车库装修防火等级',
    url: 'https://zhuanlan.zhihu.com/p/123456',
    snippet: '地下车库地面一律 A 级。',
    site_name: '知乎专栏',
    published_at: '2023-05-01',
  },
  {
    title: '关于发布国家标准《建筑防火通用规范》的公告',
    url: 'https://www.mohurd.gov.cn/gongkai/fdzdgknr/1.html',
    snippet: '现批准《建筑防火通用规范》为国家标准……',
    site_name: '住房和城乡建设部',
    published_at: '2022-01-19',
  },
]

const GROUNDED_RESULT = {
  query_or_url: 'GB 50222 表 5.3.1',
  model: 'bocha-web-search',
  provider: 'bocha',
  fallback_reason: null,
  status: 'ok',
  answer: 'DO_NOT_FORWARD_MODEL_ANSWER',
  elapsed_ms: 120,
  sources: SEARCH_SOURCES,
}

test('the model-stated region reaches the backend request', () => {
  assert.deepEqual(
    web.buildWebSearchRequest({
      query: 'GB 55037 公告',
      region: '河北省石家庄市',
      limit: 6,
      freshness: 'oneYear',
      allowed_domains: [' Gov.Cn ', 'gov.cn'],
    }),
    {
      query: 'GB 55037 公告',
      limit: 6,
      region: '河北省石家庄市',
      freshness: 'oneYear',
      allowed_domains: ['gov.cn'],
    },
  )
  // Blank or absent regions are omitted so the backend applies its own fallback.
  assert.deepEqual(
    web.buildWebSearchRequest({ query: 'GB 55037 公告', region: '   ' }),
    { query: 'GB 55037 公告' },
  )
  assert.throws(
    () => web.buildWebSearchRequest({
      query: '标准',
      allowed_domains: ['gov.cn'],
      blocked_domains: ['example.com'],
    }),
    /不能同时使用/u,
  )
  assert.deepEqual(
    web.buildWebSearchRequest({ query: 'GB 55037 公告' }),
    { query: 'GB 55037 公告' },
  )
})

test('the main web_search callback forwards region rather than dropping it', () => {
  const source = fs.readFileSync(
    path.resolve(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
    'utf8',
  )
  const forwarding = source.match(/this\.searchWeb\(buildWebSearchRequest\(input\), signal\)/g) || []
  assert.equal(forwarding.length, 1, '主 Agent 回调必须经 buildWebSearchRequest')
})

test('web_search preserves provider metadata and provider hit order without forwarding model answer', async () => {
  const calls = []
  const tools = web.buildMainAgentWebTools({
    searchWeb: async (input) => {
      calls.push(input)
      return GROUNDED_RESULT
    },
  })
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch'])
  const [searchTool] = tools
  assert.match(searchTool.description, /结构化标题、URL、snippet/u)
  assert.match(searchTool.description, /不返回模型综述/u)
  assert.match(searchTool.description, /web_fetch/u)

  const result = await searchTool.execute('call-1', {
    query: 'GB 50222 表 5.3.1',
    region: '河北省石家庄市',
    limit: 6,
    freshness: 'oneYear',
    allowed_domains: ['gov.cn'],
  })
  assert.deepEqual(calls, [{
    query: 'GB 50222 表 5.3.1',
    region: '河北省石家庄市',
    limit: 6,
    freshness: 'oneYear',
    allowed_domains: ['gov.cn'],
  }])

  const text = result.content[0].text
  assert.match(text, /^\[结构化搜索结果\]/u)
  assert.match(text, /provider: bocha/u)
  assert.match(text, /status: ok/u)
  assert.match(text, /fallback: none/u)
  assert.match(text, /1\. title: 一文读懂地下车库装修防火等级/u)
  assert.match(text, /url: https:\/\/zhuanlan\.zhihu\.com\/p\/123456/u)
  assert.match(text, /snippet: 地下车库地面一律 A 级。/u)
  assert.match(text, /2\. title: 关于发布国家标准《建筑防火通用规范》的公告/u)
  assert.match(text, /url: https:\/\/www\.mohurd\.gov\.cn\/gongkai\/fdzdgknr\/1\.html/u)
  assert.match(text, /snippet: 现批准《建筑防火通用规范》为国家标准……/u)
  assert.ok(text.indexOf('1. title: 一文') < text.indexOf('2. title: 关于发布'))
  assert.doesNotMatch(text, /DO_NOT_FORWARD_MODEL_ANSWER/u)
  assert.doesNotMatch(JSON.stringify(result.details), /DO_NOT_FORWARD_MODEL_ANSWER/u)
  assert.doesNotMatch(text, /Tier1|Tier2|自动可信/u)
  assert.deepEqual(result.details, {
    query_or_url: GROUNDED_RESULT.query_or_url,
    provider: 'bocha',
    fallback_reason: null,
    status: 'ok',
    elapsed_ms: 120,
    warning: null,
    sources: SEARCH_SOURCES,
  })
})

test('web_search exposes Qwen fallback and partial status without changing structured sources', async () => {
  const sources = [
    {
      title: 'Qwen 候选页',
      url: 'https://example.com/qwen-result',
      snippet: '候选摘要，仅供选源。',
    },
  ]
  const [searchTool] = web.buildMainAgentWebTools({
    searchWeb: async () => ({
      query_or_url: '产品 API 文档',
      model: 'qwen-search',
      provider: 'qwen',
      fallback_reason: 'bocha_unavailable',
      status: 'partial',
      answer: '仍然不应透传的模型综述',
      elapsed_ms: 42,
      warning: '博查不可用，已降级。',
      sources,
    }),
  })

  const result = await searchTool.execute('call-fallback', {
    query: '产品 API 文档',
    region: '不适用（全球）',
  })
  const text = result.content[0].text
  assert.match(text, /provider: qwen/u)
  assert.match(text, /status: partial/u)
  assert.match(text, /fallback: bocha_unavailable/u)
  assert.match(text, /1\. title: Qwen 候选页/u)
  assert.match(text, /snippet: 候选摘要，仅供选源。/u)
  assert.doesNotMatch(text, /仍然不应透传的模型综述/u)
  assert.deepEqual(result.details.sources, sources)
  assert.equal(result.details.provider, 'qwen')
  assert.equal(result.details.fallback_reason, 'bocha_unavailable')
  assert.equal(result.details.status, 'partial')
})

test('engineering sources require body verification and no domain is automatically trusted', () => {
  const source = fs.readFileSync(
    path.resolve(projectRoot, 'electron/runtime/agent/prompts/system/sections/tooling.ts'),
    'utf8',
  )
  assert.match(source, /工程标准、政策或造价依据必须在 web_fetch 正文中核对编号\/条号、发布与实施日期、现行效力、适用范围和实际发布机关 URL/u)
  assert.match(source, /只有搜索 snippet、转载或征求意见稿，标为待核并建议人工复核/u)
  assert.doesNotMatch(source, /gov\.cn[^\n]*自动(?:可信|信任)|自动(?:可信|信任)[^\n]*gov\.cn/u)
})
