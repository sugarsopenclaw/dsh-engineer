const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath, alias) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    external: ['pdfjs-dist'],
    alias: {
      electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs'),
      ...(alias ?? {}),
    },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

const webResearch = loadBundledModule('electron/runtime/web-research/index.ts')
const httpClient = loadBundledModule('electron/runtime/web-research/http-client.ts')
const ssrf = loadBundledModule('electron/runtime/web-research/ssrf.ts')

function createFixture() {
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-research-')))
  return {
    fixtureRoot,
    cleanup: () => fs.rmSync(fixtureRoot, { recursive: true, force: true }),
  }
}

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
  })
}

function redirectResponse(location, status = 302) {
  return new Response('', { status, headers: { location } })
}

/** Every hop is treated as public so the tests exercise fetch logic, not DNS. */
const allowAnyHost = async () => ['203.0.113.10']

test('non-2xx responses fail instead of being converted to Markdown', async () => {
  await assert.rejects(
    () => httpClient.fetchResource('https://www.mohurd.gov.cn/blocked', {
      resolveHost: allowAnyHost,
      fetchImpl: async () => htmlResponse('<html><body><h1>403 Forbidden</h1></body></html>', { status: 403 }),
    }),
    (error) => {
      assert.equal(error.name, 'WebReadError')
      assert.equal(error.code, 'HTTP_ERROR')
      assert.match(error.message, /403/)
      return true
    },
  )
})

test('explicit HTTP and same-host redirects preserve HTTP while unsafe redirects are rejected', async () => {
  const requested = []
  const resource = await httpClient.fetchResource('http://www.gov.cn/a', {
    resolveHost: allowAnyHost,
    fetchImpl: async (url) => {
      requested.push(url)
      return url.endsWith('/a')
        ? redirectResponse('/b')
        : htmlResponse('<html><body><main><p>正文</p></main></body></html>')
    },
  })
  assert.deepEqual(requested, ['http://www.gov.cn/a', 'http://www.gov.cn/b'])
  assert.equal(resource.finalUrl, 'http://www.gov.cn/b')
  assert.deepEqual(resource.redirects, ['http://www.gov.cn/b'])

  await assert.rejects(
    () => httpClient.fetchResource('https://www.gov.cn/a', {
      resolveHost: allowAnyHost,
      fetchImpl: async () => redirectResponse('https://mirror.example.com/a'),
    }),
    (error) => {
      assert.equal(error.code, 'CROSS_HOST_REDIRECT')
      assert.match(error.message, /mirror\.example\.com/)
      return true
    },
  )

  await assert.rejects(
    () => httpClient.fetchResource('https://www.gov.cn/a', {
      resolveHost: allowAnyHost,
      fetchImpl: async () => redirectResponse('http://www.gov.cn/a'),
    }),
    (error) => error.code === 'INSECURE_REDIRECT',
  )

  await assert.rejects(
    () => httpClient.fetchResource('https://user:secret@www.gov.cn/a', {
      resolveHost: allowAnyHost,
      fetchImpl: async () => htmlResponse('<html></html>'),
    }),
    (error) => error.code === 'INVALID_URL' && /用户名或密码/u.test(error.message),
  )
})

test('SSRF guard rejects loopback names, private literals and rebinding answers', async () => {
  await assert.rejects(
    () => ssrf.assertPublicHost('localhost'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('169.254.169.254'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('::1'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('fec0::1'),
    (error) => error.name === 'SsrfBlockedError',
  )
  // Hex-only IPv4-mapped spelling of 127.0.0.1; net.isIP accepts it, so it must not slip through.
  await assert.rejects(
    () => ssrf.assertPublicHost('::ffff:7f00:1'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('metadata.google.internal'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('router.local'),
    (error) => error.name === 'SsrfBlockedError',
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('rebind.example.com', {
      lookup: async () => [{ address: '203.0.113.7' }, { address: '127.0.0.1' }],
    }),
    (error) => {
      assert.equal(error.name, 'SsrfBlockedError')
      assert.match(error.message, /127\.0\.0\.1/)
      return true
    },
  )
  await assert.rejects(
    () => ssrf.assertPublicHost('mixed-fake-ip.example.com', {
      lookup: async () => [{ address: '198.18.0.10' }, { address: '127.0.0.1' }],
    }),
    (error) => error.name === 'SsrfBlockedError' && error.reason === 'private_dns',
  )
  assert.deepEqual(
    await ssrf.assertPublicHost('www.mohurd.gov.cn', {
      lookup: async () => [{ address: '203.0.113.7' }],
    }),
    ['203.0.113.7'],
  )

  // A blocked host surfaces through web_read's own error code, not a raw DNS failure.
  await assert.rejects(
    () => httpClient.fetchResource('https://localhost/x', {
      fetchImpl: async () => htmlResponse('<html></html>'),
    }),
    (error) => error.code === 'BLOCKED_HOST',
  )

  for (const target of [
    'http://[::1]/private',
    'http://[fc00::1]/private',
    'http://[fe80::1]/private',
    'http://[fec0::1]/private',
  ]) {
    let proxyCalls = 0
    let fetchCalls = 0
    await assert.rejects(
      () => httpClient.fetchResource(target, {
        resolveProxy: async () => {
          proxyCalls += 1
          return 'PROXY 127.0.0.1:7890'
        },
        fetchImpl: async () => {
          fetchCalls += 1
          return htmlResponse('<html></html>')
        },
      }),
      (error) => error.code === 'BLOCKED_HOST',
    )
    assert.equal(proxyCalls, 0, target)
    assert.equal(fetchCalls, 0, target)
  }

  let mixedFetchCalls = 0
  await assert.rejects(
    () => httpClient.fetchResource('https://mixed-fake-ip.example.com/private', {
      resolveProxy: async () => 'DIRECT',
      resolveHost: (hostname) => ssrf.assertPublicHost(hostname, {
        lookup: async () => [{ address: '198.18.0.10' }, { address: '10.0.0.8' }],
      }),
      fetchImpl: async () => {
        mixedFetchCalls += 1
        return htmlResponse('<html></html>')
      },
    }),
    (error) => error.code === 'BLOCKED_HOST',
  )
  assert.equal(mixedFetchCalls, 0)
})

test('system proxy is default-off and an explicitly selected proxy receives the hostname', async () => {
  assert.equal(httpClient.isWebSystemProxyEnabled({}), false)
  assert.equal(httpClient.isWebSystemProxyEnabled({ XIAOLIANG_WEB_SYSTEM_PROXY: 'on' }), true)
  assert.deepEqual(httpClient.parseProxyRoute('SOCKS5 127.0.0.1:1080'), {
    kind: 'proxy',
    proxyUrl: 'socks5://127.0.0.1:1080',
  })
  assert.throws(
    () => httpClient.parseProxyRoute('SOCKS 127.0.0.1:1080'),
    (error) => error.code === 'UNSUPPORTED_PROXY' && /SOCKS/u.test(error.message),
  )
  globalThis.__proxyAgents = []
  globalThis.__proxyResolutionUrls = []
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-undici-proxy-stub-'))
  const stubPath = path.join(stubDir, 'undici.mjs')
  const electronStubPath = path.join(stubDir, 'electron.mjs')
  fs.writeFileSync(stubPath, `export class Agent {
  constructor(options) { this.options = options }
  async close() {}
}
export class ProxyAgent {
  constructor(proxyUrl) {
    this.proxyUrl = proxyUrl
    globalThis.__proxyAgents.push(this)
  }
  async close() {}
}
`)
  fs.writeFileSync(electronStubPath, `export const session = {
  defaultSession: {
    async resolveProxy(url) {
      globalThis.__proxyResolutionUrls.push(url)
      return 'PROXY 127.0.0.1:7890; DIRECT'
    }
  }
}
`)
  const proxyClient = loadBundledModule('electron/runtime/web-research/http-client.ts', {
    electron: electronStubPath,
    undici: stubPath,
  })
  let targetDnsCalls = 0
  let requestedUrl = ''
  let requestDispatcher

  try {
    const directResult = await proxyClient.fetchResource('https://www.nhc.gov.cn/direct.html', {
      resolveHost: async () => {
        targetDnsCalls += 1
        return ['203.0.113.8']
      },
      fetchImpl: async () => htmlResponse('<html><body><main>直连原文</main></body></html>'),
    })
    assert.equal(directResult.status, 200)
    assert.equal(globalThis.__proxyResolutionUrls.length, 0)
    assert.equal(globalThis.__proxyAgents.length, 0)

    const result = await proxyClient.fetchResource('https://www.nhc.gov.cn/article.html', {
      resolveHost: async () => {
        targetDnsCalls += 1
        return ['198.18.0.174']
      },
      resolveProxy: async (url) => {
        globalThis.__proxyResolutionUrls.push(url)
        return 'PROXY 127.0.0.1:7890; DIRECT'
      },
      fetchImpl: async (url, init) => {
        requestedUrl = url
        requestDispatcher = init.dispatcher
        return htmlResponse('<html><body><main>原文</main></body></html>')
      },
    })
    assert.equal(result.status, 200)
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true })
  }

  assert.equal(targetDnsCalls, 1)
  assert.deepEqual(globalThis.__proxyResolutionUrls, ['https://www.nhc.gov.cn/article.html'])
  assert.equal(requestedUrl, 'https://www.nhc.gov.cn/article.html')
  assert.equal(globalThis.__proxyAgents.length, 1)
  assert.equal(globalThis.__proxyAgents[0].proxyUrl, 'http://127.0.0.1:7890/')
  assert.equal(requestDispatcher, globalThis.__proxyAgents[0])
})

test('DIRECT keeps blocking Fake-IP answers with one actionable retry instruction', async () => {
  let fetchCalls = 0
  await assert.rejects(
    () => httpClient.fetchResource('https://www.mohurd.gov.cn/article.html', {
      resolveProxy: async () => 'DIRECT',
      resolveHost: (hostname) => ssrf.assertPublicHost(hostname, {
        lookup: async () => [{ address: '198.18.0.182' }],
      }),
      fetchImpl: async () => {
        fetchCalls += 1
        return htmlResponse('<html></html>')
      },
    }),
    (error) => {
      assert.equal(error.code, 'FAKE_IP_DNS')
      assert.match(error.message, /198\.18\.0\.0\/15/u)
      assert.match(error.message, /Fake-IP/u)
      assert.match(error.message, /XIAOLIANG_WEB_SYSTEM_PROXY/u)
      assert.match(error.message, /不要更换域名重复抓取/u)
      return true
    },
  )
  assert.equal(fetchCalls, 0)
})

test('a proxy never makes a literal Fake-IP target fetchable', async () => {
  let proxyResolutionCalls = 0
  await assert.rejects(
    () => httpClient.fetchResource('https://198.18.0.174/private', {
      resolveProxy: async () => {
        proxyResolutionCalls += 1
        return 'PROXY 127.0.0.1:7890'
      },
      fetchImpl: async () => htmlResponse('<html></html>'),
    }),
    (error) => error.code === 'BLOCKED_HOST' && /198\.18\.0\.174/u.test(error.message),
  )
  assert.equal(proxyResolutionCalls, 0)
})

test('a rebind between validation and connect cannot move the connection off the validated address', async () => {
  globalThis.__pinnedAgents = []
  // The undici stub records each constructed Agent so the test can call the connect
  // lookup fetchResource pinned the hop to.
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-undici-stub-'))
  const stubPath = path.join(stubDir, 'undici.mjs')
  fs.writeFileSync(stubPath, `export class Agent {
  constructor(options) {
    this.options = options
    globalThis.__pinnedAgents.push(this)
  }
  async close() {}
}
export class ProxyAgent {
  async close() {}
}
`)
  const pinnedClient = loadBundledModule('electron/runtime/web-research/http-client.ts', { undici: stubPath })
  let resolutions = 0
  const resolveHost = async () => {
    resolutions += 1
    // A TTL=0 attacker name would answer with a loopback on a second lookup at connect time.
    return resolutions === 1 ? ['203.0.113.7'] : ['127.0.0.1']
  }

  try {
    await pinnedClient.fetchResource('https://rebind.example.com/', {
      resolveHost,
      fetchImpl: async () => htmlResponse('<html></html>'),
    })
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true })
  }

  assert.equal(resolutions, 1)
  assert.equal(globalThis.__pinnedAgents.length, 1)
  const lookup = globalThis.__pinnedAgents[0].options.connect.lookup
  const connected = await new Promise((resolve, reject) => {
    lookup('rebind.example.com', {}, (error, address, family) => (
      error ? reject(error) : resolve({ address, family })
    ))
  })
  // The connect lookup answers with the validated address; no second resolution happens.
  assert.deepEqual(connected, { address: '203.0.113.7', family: 4 })
})

test('a fetched page is stored in full and only its head is returned inline', async () => {
  const fixture = createFixture()
  try {
    const paragraphs = Array.from(
      { length: 400 },
      (_, index) => `<p>第 ${index} 段：建筑内部装修设计防火规范条文正文内容。</p>`,
    ).join('')
    const result = await webResearch.readWebPage({
      projectRoot: fixture.fixtureRoot,
      url: 'https://www.mohurd.gov.cn/gongkai/notice/12345.html',
      maxChars: 2_000,
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: async () => htmlResponse(
        '<html><head><title>关于发布国家标准的公告</title></head><body>'
        + '<nav>导航不应进入正文</nav>'
        + `<main>${paragraphs}</main>`
        + '<footer>版权信息</footer>'
        + '</body></html>',
      ),
    })

    assert.equal(result.kind, 'html')
    assert.equal(result.title, '关于发布国家标准的公告')
    assert.equal(result.truncated, true)
    assert.equal(result.preview.length, 2_000)
    assert.ok(result.totalChars > result.preview.length)

    assert.match(result.stored.relativePath, /^\.xiaoliang\/web\/pages\/.+\.md$/u)
    const stored = fs.readFileSync(
      path.join(fixture.fixtureRoot, ...result.stored.relativePath.split('/')),
      'utf8',
    )
    assert.match(stored, /^---\n/u)
    assert.match(stored, /url: "https:\/\/www\.mohurd\.gov\.cn\/gongkai\/notice\/12345\.html"/)
    assert.match(stored, /http_status: 200/)
    assert.doesNotMatch(stored, /source_tier:/u)
    assert.match(stored, new RegExp(`sha256: "${result.stored.sha256}"`))
    // The whole document is on disk even though the model only saw the head.
    assert.ok(stored.includes('第 399 段'))
    assert.ok(!result.preview.includes('第 399 段'))
    // Chrome the extractor is expected to drop.
    assert.ok(!stored.includes('导航不应进入正文'))
    assert.ok(!stored.includes('版权信息'))
  } finally {
    fixture.cleanup()
  }
})

test('GB2312/GBK Chinese short pages are decoded and remain inline-only', async () => {
  const fixture = createFixture()
  try {
    const body = Buffer.concat([
      Buffer.from('<html><head><title>GBK</title></head><body><main><p>', 'ascii'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), // “中文” in GB2312/GBK.
      Buffer.from(' GB 55037-2022</p></main></body></html>', 'ascii'),
    ])
    const result = await webResearch.readWebPage({
      projectRoot: fixture.fixtureRoot,
      url: 'https://www.mohurd.gov.cn/legacy/gbk.html',
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=gb2312' },
      }),
    })

    assert.match(result.preview, /中文 GB 55037-2022/u)
    assert.doesNotMatch(result.preview, /�/u)
    assert.equal(result.stored, undefined)
    assert.equal(result.truncated, false)
  } finally {
    fixture.cleanup()
  }
})

test('a page-store symlink failure preserves the preview and never writes outside the project', async (t) => {
  const fixture = createFixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-outside-')))
  try {
    const webRoot = path.join(fixture.fixtureRoot, '.xiaoliang', 'web')
    fs.mkdirSync(webRoot, { recursive: true })
    try {
      fs.symlinkSync(
        outsideRoot,
        path.join(webRoot, 'pages'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (error) {
      t.skip(`symlink/junction unavailable: ${error.message}`)
      return
    }

    const result = await webResearch.readWebPage({
        projectRoot: fixture.fixtureRoot,
        url: 'https://www.gov.cn/escape.html',
        maxChars: 1_000,
      }, {
        resolveHost: allowAnyHost,
        fetchImpl: async () => htmlResponse(`<html><body><main><p>${'不应写到项目外。'.repeat(500)}</p></main></body></html>`),
      })
    assert.equal(result.preview.length, 1_000)
    assert.equal(result.stored, undefined)
    assert.match(result.storageWarning, /符号链接|junction/u)
    assert.doesNotMatch(result.storageWarning, new RegExp(fixture.fixtureRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.doesNotMatch(result.storageWarning, /[A-Za-z]:[\\/]/u)
    assert.deepEqual(fs.readdirSync(outsideRoot), [])
  } finally {
    fixture.cleanup()
    fs.rmSync(outsideRoot, { recursive: true, force: true })
  }
})

test('unchanged pages reuse one immutable record while changed wording gets a new path', async () => {
  const fixture = createFixture()
  try {
    const read = (paragraph) => webResearch.readWebPage({
      projectRoot: fixture.fixtureRoot,
      url: 'https://www.gov.cn/zhengce/content/x.htm',
      maxChars: 1_000,
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: async () => htmlResponse(`<html><body><main><p>${paragraph.repeat(500)}</p></main></body></html>`),
    })

    const first = await read('第一次抓取的正文')
    const repeated = await read('第一次抓取的正文')
    // The process cache intentionally shields the origin for 15 minutes. Clear it here to
    // exercise the page store's immutable-content behaviour after a later network refresh.
    webResearch.clearWebReadCache()
    const changed = await read('第二次抓取的正文')
    assert.equal(first.stored.relativePath, repeated.stored.relativePath)
    assert.notEqual(first.stored.relativePath, changed.stored.relativePath)

    const pagesDir = path.join(fixture.fixtureRoot, '.xiaoliang', 'web', 'pages')
    assert.deepEqual(fs.readdirSync(pagesDir).sort(), [
      path.basename(first.stored.relativePath),
      path.basename(changed.stored.relativePath),
    ].sort())
    assert.match(fs.readFileSync(first.stored.absolutePath, 'utf8'), /第一次抓取的正文/)
    assert.match(fs.readFileSync(changed.stored.absolutePath, 'utf8'), /第二次抓取的正文/)
  } finally {
    fixture.cleanup()
  }
})

test('a page with no extractable body is an error rather than an empty quotation', async () => {
  const fixture = createFixture()
  try {
    await assert.rejects(
      () => webResearch.readWebPage({
        projectRoot: fixture.fixtureRoot,
        url: 'https://spa.example.com/app',
      }, {
        resolveHost: allowAnyHost,
        fetchImpl: async () => htmlResponse('<html><body><div id="root"></div><script>render()</script></body></html>'),
        renderEnabled: false,
      }),
      (error) => error.code === 'EMPTY_DOCUMENT',
    )
    assert.ok(!fs.existsSync(path.join(fixture.fixtureRoot, '.xiaoliang', 'web', 'pages')))
  } finally {
    fixture.cleanup()
  }
})
