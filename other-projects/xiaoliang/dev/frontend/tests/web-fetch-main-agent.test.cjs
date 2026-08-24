const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const frontendRoot = path.resolve(__dirname, '..')
const electronStubPath = path.resolve(__dirname, 'fixtures', 'electron-stub.cjs')

const bundleOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  alias: { electron: electronStubPath },
  banner: {
    js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__bundledImportMetaUrl',
  },
}

function compile(filename, output) {
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function loadBundledModule(relativePath) {
  const filename = path.resolve(frontendRoot, relativePath)
  return compile(filename, esbuild.buildSync({ ...bundleOptions, entryPoints: [filename] }))
}

const web = loadBundledModule('electron/runtime/agent/tools/domain/web/index.ts')
const webResearch = loadBundledModule('electron/runtime/web-research/index.ts')

const searchWeb = async () => ({
  query_or_url: 'test',
  model: 'stub',
  answer: '',
  sources: [],
  elapsed_ms: 1,
})

test('web fetch stores the full page in the generic web tree and returns a bounded preview', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-main-web-')))
  try {
    const body = `<html><body><main><p>${'一般参考正文。'.repeat(600)}</p></main></body></html>`
    const result = await webResearch.readWebPage({
      projectRoot: fixtureRoot,
      url: 'https://docs.example.com/reference',
      maxChars: 1_000,
    }, {
      resolveHost: async () => ['203.0.113.10'],
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    })

    assert.equal(result.preview.length, 1_000)
    assert.equal(result.truncated, true)
    assert.match(result.stored.relativePath, /^\.xiaoliang\/web\/pages\/.+\.md$/u)
    assert.ok(fs.existsSync(result.stored.absolutePath))
    assert.ok(!fs.existsSync(path.join(fixtureRoot, '.xiaoliang', 'research')))
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('parallel web fetches can initialise and populate one page store safely', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-parallel-web-')))
  try {
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => (
      webResearch.readWebPage({
        projectRoot: fixtureRoot,
        url: `https://www.gov.cn/topic-${index}.html`,
        maxChars: 1_000,
      }, {
        resolveHost: async () => ['203.0.113.10'],
        fetchImpl: async () => new Response(
          `<html><body><main><p>${`专题 ${index} 的正文。`.repeat(300)}</p></main></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      })
    )))

    assert.equal(new Set(results.map((result) => result.stored.relativePath)).size, 4)
    assert.equal(
      fs.readdirSync(path.join(fixtureRoot, '.xiaoliang', 'web', 'pages')).length,
      4,
    )
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('main web_fetch reports persistence, forwards limits and degrades to inline-only without a project', async () => {
  const calls = []
  const tools = web.buildMainAgentWebTools({
    projectRoot: 'C:\\project',
    searchWeb,
    readPage: async (input) => {
      calls.push(input)
      return {
        url: input.url,
        finalUrl: input.url,
        title: '动态参考页',
        httpStatus: 200,
        contentType: 'text/html',
        kind: 'html',
        stored: {
          relativePath: '.xiaoliang/web/pages/reference.md',
          absolutePath: 'C:\\project\\.xiaoliang\\web\\pages\\reference.md',
          lineCount: 120,
          byteLength: 5_000,
          sha256: 'abc',
        },
        preview: '正文开头',
        truncated: true,
        totalChars: 50_000,
        redirects: [],
        cacheAgeMs: 125_000,
      }
    },
  })
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch'])

  const fetched = await tools[1].execute('fetch-1', {
    url: 'https://docs.example.com/dynamic',
    max_chars: 2_500,
    max_pdf_pages: 80,
    render: true,
  })
  assert.deepEqual(calls, [{
    projectRoot: 'C:\\project',
    url: 'https://docs.example.com/dynamic',
    maxChars: 2_500,
    maxPdfPages: 80,
    render: true,
  }])
  assert.match(fetched.content[0].text, /\.xiaoliang\/web\/pages\/reference\.md/)
  assert.match(fetched.content[0].text, /安全边界/)
  assert.match(fetched.content[0].text, /不受信任输入/)
  assert.doesNotMatch(fetched.content[0].text, /Tier1|Tier2|官方依据候选/u)
  assert.match(fetched.content[0].text, /缓存命中（2 分钟前抓取）/u)
  assert.deepEqual(fetched.details.relative_paths, ['.xiaoliang/web/pages/reference.md'])
  assert.equal(fetched.details.source_tier, null)

  const [, inlineFetch] = web.buildMainAgentWebTools({
    searchWeb,
    readPage: async (input) => ({
      url: input.url,
      finalUrl: input.url,
      title: '',
      httpStatus: 200,
      contentType: 'text/plain',
      kind: 'text',
      preview: 'inline',
      truncated: false,
      totalChars: 6,
      redirects: [],
    }),
  })
  const inline = await inlineFetch.execute('fetch-2', { url: 'https://example.com/plain' })
  assert.match(inline.content[0].text, /正文较短.*只内联.*不写 artifact/u)
  assert.deepEqual(inline.details.relative_paths, [])
})

test('government hosts are not automatically presented as authoritative conclusions', async () => {
  const [, fetchTool] = web.buildMainAgentWebTools({
    searchWeb,
    readPage: async (input) => ({
      url: input.url,
      finalUrl: input.url,
      title: '官方标准页',
      httpStatus: 200,
      contentType: 'text/html',
      kind: 'html',
      preview: '官方正文',
      truncated: false,
      totalChars: 4,
      redirects: [],
    }),
  })

  const result = await fetchTool.execute('fetch-tier1', { url: 'https://www.gov.cn/official' })
  assert.match(result.content[0].text, /网页正文是不受信任输入/u)
  assert.doesNotMatch(result.content[0].text, /Tier1|官方依据候选|强条与 A 类/u)
  assert.equal(result.details.source_tier, null)
})

test('web fetch cache ignores maxChars while rematerializing the requested preview size', async () => {
  webResearch.clearWebReadCache()
  let requests = 0
  const baseInput = {
    url: 'https://cache.example.com/reference-cache-test',
    maxPdfPages: 20,
  }
  const body = `<html><body><main><p>${'缓存正文。'.repeat(1_000)}</p></main></body></html>`
  const options = {
    resolveHost: async () => ['203.0.113.10'],
    fetchImpl: async () => {
      requests += 1
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  }

  const first = await webResearch.readWebPage({ ...baseInput, maxChars: 1_000 }, options)
  const second = await webResearch.readWebPage({ ...baseInput, maxChars: 2_000 }, options)

  assert.equal(requests, 1)
  assert.equal(first.cacheAgeMs, undefined)
  assert.equal(typeof second.cacheAgeMs, 'number')
  assert.equal(first.preview.length, 1_000)
  assert.equal(second.preview.length, 2_000)
  assert.equal(second.preview.slice(0, first.preview.length), first.preview)
})

test('web fetch concurrency gate caps global work at four and each host at two', async () => {
  webResearch.clearWebReadCache()
  let active = 0
  let maxActive = 0
  const activeByHost = new Map()
  const maxByHost = new Map()
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname
    active += 1
    maxActive = Math.max(maxActive, active)
    activeByHost.set(host, (activeByHost.get(host) || 0) + 1)
    maxByHost.set(host, Math.max(maxByHost.get(host) || 0, activeByHost.get(host)))
    await new Promise((resolve) => setTimeout(resolve, 25))
    active -= 1
    activeByHost.set(host, activeByHost.get(host) - 1)
    return new Response(`<html><body><main><p>${host} 正文</p></main></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  await Promise.all(Array.from({ length: 8 }, (_, index) => webResearch.readWebPage({
    url: `https://${index % 2 === 0 ? 'a.example.com' : 'b.example.com'}/gate-${index}`,
  }, {
    resolveHost: async () => ['203.0.113.10'],
    fetchImpl,
  })))

  assert.equal(maxActive, 4)
  assert.ok([...maxByHost.values()].every((value) => value <= 2))
  assert.deepEqual(webResearch.getWebReadConcurrencySnapshot(), {
    active: 0,
    queued: 0,
    activeByHost: {},
  })
})

test('web fetch retries one HTTP 5xx response before succeeding', async () => {
  webResearch.clearWebReadCache()
  let requests = 0
  const result = await webResearch.readWebPage({
    url: 'https://retry.example.com/transient-503',
  }, {
    resolveHost: async () => ['203.0.113.10'],
    fetchImpl: async () => {
      requests += 1
      if (requests === 1) return new Response('temporary', { status: 503 })
      return new Response('<html><body><main><p>重试成功正文</p></main></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })

  assert.equal(requests, 2)
  assert.match(result.preview, /重试成功正文/u)
})

test('eligible local fetch failures use labelled Qwen extraction without writing short content', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-fallback-')))
  try {
    const [, fetchTool] = web.buildMainAgentWebTools({
      projectRoot: fixtureRoot,
      searchWeb,
      readPage: async () => {
        throw new web.WebReadError('EMPTY_DOCUMENT', '页面没有可提取正文')
      },
      fetchWebFallback: async (input) => ({
        query_or_url: input.url,
        model: 'server-extractor',
        answer: '兼容字段不应优先',
        content: 'Qwen 抽取正文',
        sources: [{ title: '候选页', url: input.url }],
        elapsed_ms: 25,
        warning: '关键内容仍需原文核验。',
        provider: 'qwen',
        fallback_reason: 'local_fetch_failed',
        status: 'partial',
        content_type: 'text/markdown',
        final_url: input.url,
      }),
    })

    const result = await fetchTool.execute('fallback-1', {
      url: 'https://example.com/no-body',
    })

    assert.match(result.content[0].text, /^\[本机抓取失败 · 后端 Qwen 网页抓取\]/u)
    assert.match(result.content[0].text, /provider: qwen/u)
    assert.match(result.content[0].text, /status: partial/u)
    assert.match(result.content[0].text, /Qwen 抽取正文/u)
    assert.doesNotMatch(result.content[0].text, /兼容字段不应优先|Tier1|Tier2/u)
    assert.equal(result.details.provenance, 'server_extract')
    assert.deepEqual(result.details.relative_paths, [])
    assert.equal(fs.existsSync(path.join(fixtureRoot, '.xiaoliang')), false)
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('network, HTTP, and disabled-render failures use Qwen fallback but blocked hosts do not', async () => {
  for (const code of [
    'NETWORK_ERROR',
    'DNS_ERROR',
    'FAKE_IP_DNS',
    'TIMEOUT',
    'HTTP_ERROR',
    'RENDER_DISABLED',
    'INSECURE_REDIRECT',
  ]) {
    let fallbackCalls = 0
    const [, fetchTool] = web.buildMainAgentWebTools({
      searchWeb,
      readPage: async () => { throw new web.WebReadError(code, `${code} local`) },
      fetchWebFallback: async (input) => {
        fallbackCalls += 1
        return {
          query_or_url: input.url,
          model: 'qwen',
          answer: '',
          content: `${code} fallback body`,
          sources: [],
          elapsed_ms: 1,
          provider: 'qwen',
          status: 'ok',
        }
      },
    })
    const result = await fetchTool.execute(`fallback-${code}`, { url: 'https://example.com/page' })
    assert.match(result.content[0].text, new RegExp(`${code} fallback body`, 'u'))
    assert.equal(fallbackCalls, 1)
  }

  let blockedFallbackCalls = 0
  const [, blockedFetch] = web.buildMainAgentWebTools({
    searchWeb,
    readPage: async () => { throw new web.WebReadError('BLOCKED_HOST', 'private target') },
    fetchWebFallback: async () => {
      blockedFallbackCalls += 1
      throw new Error('must not run')
    },
  })
  await assert.rejects(
    () => blockedFetch.execute('blocked', { url: 'http://169.254.169.254/latest' }),
    /BLOCKED_HOST/u,
  )
  assert.equal(blockedFallbackCalls, 0)
})

test('long Qwen fallback spills to a readable project artifact when generic Pi read is absent', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-artifact-read-')))
  try {
    const body = Array.from({ length: 500 }, (_, index) => `第 ${index + 1} 行 Qwen 抓取正文`).join('\n')
    const tools = web.buildMainAgentWebTools({
      projectRoot: fixtureRoot,
      artifactReadOnly: true,
      searchWeb,
      readPage: async () => { throw new web.WebReadError('NETWORK_ERROR', 'offline') },
      fetchWebFallback: async (input) => ({
        query_or_url: input.url,
        final_url: input.url,
        model: 'qwen',
        answer: '',
        content: body,
        sources: [],
        elapsed_ms: 1,
        provider: 'qwen',
        status: 'ok',
        content_type: 'text/markdown',
      }),
    })
    assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'web_fetch', 'read'])
    const fetched = await tools[1].execute('fetch-long', {
      url: 'https://example.com/long',
      max_chars: 1_000,
    })
    const artifactPath = fetched.details.artifact.path
    assert.match(artifactPath, /^\.xiaoliang\/web\/pages\/.+\.md$/u)
    assert.equal(fetched.details.truncated, true)
    assert.ok(fs.existsSync(path.join(fixtureRoot, ...artifactPath.split('/'))))

    const read = await tools[2].execute('read-long', { path: artifactPath, offset: 490, limit: 30 })
    assert.match(read.content[0].text, /第 500 行 Qwen 抓取正文/u)
    await assert.rejects(
      () => tools[2].execute('read-escape', { path: '.xiaoliang/web/pages/../secret.md' }),
      /只允许/u,
    )

    const rebuiltTools = web.buildMainAgentWebTools({
      projectRoot: fixtureRoot,
      artifactReadOnly: true,
      searchWeb,
    })
    const rebuiltRead = rebuiltTools.find((tool) => tool.name === 'read')
    const reread = await rebuiltRead.execute('read-after-rebuild', {
      path: artifactPath,
      offset: 490,
      limit: 30,
    })
    assert.match(reread.content[0].text, /第 500 行 Qwen 抓取正文/u)
    await assert.rejects(
      () => rebuiltRead.execute('read-missing', {
        path: '.xiaoliang/web/pages/missing.md',
      }),
      (error) => {
        assert.match(error.message, /不存在或已被移除/u)
        assert.doesNotMatch(error.message, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
        assert.doesNotMatch(error.message, /[A-Za-z]:[\\/]/u)
        return true
      },
    )
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('artifact read bounds a single long line and exposes a resumable character offset', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-long-line-')))
  try {
    const body = 'x'.repeat(200_000)
    const tools = web.buildMainAgentWebTools({
      projectRoot: fixtureRoot,
      artifactReadOnly: true,
      searchWeb,
      readPage: async () => { throw new web.WebReadError('NETWORK_ERROR', 'offline') },
      fetchWebFallback: async (input) => ({
        query_or_url: input.url,
        final_url: input.url,
        model: 'qwen',
        answer: '',
        content: body,
        sources: [],
        elapsed_ms: 1,
        provider: 'qwen',
        status: 'ok',
      }),
    })
    const fetched = await tools[1].execute('fetch-long-line', {
      url: 'https://example.com/one-long-line',
      max_chars: 1_000,
    })
    const artifactPath = fetched.details.artifact.path
    const absolutePath = path.join(fixtureRoot, ...artifactPath.split('/'))
    const bodyLine = fs.readFileSync(absolutePath, 'utf8')
      .split('\n')
      .findIndex((line) => line.startsWith('xxxx')) + 1
    assert.ok(bodyLine > 0)

    const first = await tools[2].execute('read-long-line', {
      path: artifactPath,
      offset: bodyLine,
      limit: 1,
    })
    assert.equal(first.details.output_chars, 60_000)
    assert.equal(first.details.output_truncated, true)
    assert.equal(first.details.next_offset, bodyLine)
    assert.equal(first.details.next_char_offset, 60_000)
    assert.ok(first.content[0].text.length < 61_000)

    const second = await tools[2].execute('read-long-line-next', {
      path: artifactPath,
      offset: first.details.next_offset,
      char_offset: first.details.next_char_offset,
      limit: 1,
    })
    assert.equal(second.details.char_offset, 60_000)
    assert.equal(second.details.next_char_offset, 120_000)

    const oversizedPath = path.join(fixtureRoot, '.xiaoliang', 'web', 'pages', 'oversized.md')
    fs.writeFileSync(oversizedPath, 'z'.repeat(8 * 1024 * 1024 + 1))
    await assert.rejects(
      () => tools[2].execute('read-oversized', {
        path: '.xiaoliang/web/pages/oversized.md',
      }),
      /超过 8 MB 读取上限/u,
    )
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('artifact write failures and the 8 MB storage limit preserve a bounded inline preview', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-storage-warning-')))
  try {
    const body = 'x'.repeat(8 * 1024 * 1024 + 10)
    const result = await webResearch.readWebPage({
      projectRoot: fixtureRoot,
      url: 'https://example.com/oversize.txt',
      maxChars: 1_000,
    }, {
      resolveHost: async () => ['203.0.113.10'],
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    })
    assert.equal(result.preview.length, 1_000)
    assert.equal(result.truncated, true)
    assert.equal(result.stored, undefined)
    assert.match(result.storageWarning, /8 MB/u)
    assert.doesNotMatch(result.storageWarning, /[A-Za-z]:[\\/]/u)
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('Qwen empty output stays empty and Qwen artifact failures preserve a bounded preview', async () => {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-qwen-storage-warning-')))
  try {
    const nonDirectoryRoot = path.join(fixtureRoot, 'not-a-project-directory')
    fs.writeFileSync(nonDirectoryRoot, 'file')
    const build = (content, projectRoot) => web.buildMainAgentWebTools({
      projectRoot,
      searchWeb,
      readPage: async () => { throw new web.WebReadError('HTTP_ERROR', 'HTTP 503') },
      fetchWebFallback: async (input) => ({
        query_or_url: input.url,
        final_url: input.url,
        model: 'qwen',
        answer: '',
        content,
        sources: [],
        elapsed_ms: 1,
        provider: 'qwen',
        status: content ? 'ok' : 'empty',
      }),
    })[1]

    const empty = await build('', fixtureRoot).execute('empty-qwen', {
      url: 'https://example.com/empty',
    })
    assert.match(empty.content[0].text, /status: empty/u)
    assert.match(empty.content[0].text, /后端没有返回可用正文/u)
    assert.equal(empty.details.total_chars, 0)
    assert.equal(empty.details.artifact, null)

    const longBody = 'Qwen 正文。'.repeat(1_000)
    const warning = await build(longBody, nonDirectoryRoot).execute('warning-qwen', {
      url: 'https://example.com/long-warning',
      max_chars: 1_000,
    })
    assert.match(warning.content[0].text, /Qwen 正文/u)
    assert.match(warning.content[0].text, /artifact 提示/u)
    assert.equal(warning.details.preview_chars, 1_000)
    assert.equal(warning.details.artifact, null)
    assert.match(warning.details.storage_warning, /artifact 写入失败/u)
    assert.doesNotMatch(warning.details.storage_warning, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.doesNotMatch(warning.details.storage_warning, /[A-Za-z]:[\\/]/u)
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('the main fetch flag removes only web_fetch', () => {
  const tools = web.buildMainAgentWebTools({
    searchWeb,
    projectRoot: 'C:\\project',
    webFetchEnabled: false,
  })
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search'])
})

test('parent assembly allows web_fetch but still rejects evidence-grade web_read and web_pdf', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'electron/runtime/agent/tools/index.ts'),
    'utf8',
  )
  assert.match(source, /CHILD_ONLY_WEB_TOOL_NAMES = new Set\(\['web_read', 'web_pdf'\]\)/u)
  assert.doesNotMatch(source, /CHILD_ONLY_WEB_TOOL_NAMES = new Set\([^\n]*web_fetch/u)
  assert.match(source, /buildMainAgentWebTools\(\{[\s\S]*webFetchEnabled:/u)
})
