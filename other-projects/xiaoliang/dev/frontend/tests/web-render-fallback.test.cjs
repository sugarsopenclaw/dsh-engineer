const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const frontendRoot = path.resolve(__dirname, '..')

function loadBundledModule(relativePath) {
  const filename = path.resolve(frontendRoot, relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    external: ['pdfjs-dist'],
    alias: { electron: path.resolve(__dirname, 'fixtures', 'electron-stub.cjs') },
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function loadWebResearch() {
  return loadBundledModule('electron/runtime/web-research/index.ts')
}

const webResearch = loadWebResearch()
const allowAnyHost = async () => ['203.0.113.10']

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-web-render-')))
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function staticHtml(body) {
  return async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

test('empty static HTML automatically falls back to the renderer and records extraction mode', async () => {
  const testRoot = fixture()
  const calls = []
  try {
    const result = await webResearch.readWebPage({
      projectRoot: testRoot.root,
      url: 'https://spa.example.com/app',
      maxChars: 1_000,
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: staticHtml('<html><body><div id="root"></div><script>boot()</script></body></html>'),
      renderEnabled: true,
      renderPage: async (url) => {
        calls.push(url)
        return {
          finalUrl: url,
          title: '渲染后的页面',
          html: `<html><head><title>渲染后的页面</title></head><body><main><p>${'脚本生成的完整正文。'.repeat(300)}</p></main></body></html>`,
          redirects: [],
        }
      },
    })

    assert.deepEqual(calls, ['https://spa.example.com/app'])
    assert.equal(result.title, '渲染后的页面')
    assert.match(result.preview, /脚本生成的完整正文/u)
    assert.match(fs.readFileSync(result.stored.absolutePath, 'utf8'), /extraction: "rendered:/u)
  } finally {
    testRoot.cleanup()
  }
})

test('render=true skips static HTML extraction even when static text exists', async () => {
  const testRoot = fixture()
  let renders = 0
  try {
    const result = await webResearch.readWebPage({
      projectRoot: testRoot.root,
      url: 'https://spa.example.com/force',
      render: true,
      maxChars: 1_000,
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: staticHtml('<html><body><main><p>静态旧正文</p></main></body></html>'),
      renderEnabled: true,
      renderPage: async (url) => {
        renders += 1
        return {
          finalUrl: url,
          title: '动态新正文',
          html: `<html><body><main><p>${'动态新正文。'.repeat(300)}</p></main></body></html>`,
          redirects: [],
        }
      },
    })

    assert.equal(renders, 1)
    assert.match(result.preview, /动态新正文/u)
    assert.doesNotMatch(result.preview, /静态旧正文/u)
    assert.match(result.stored.relativePath, /^\.xiaoliang\/web\/pages\//u)
  } finally {
    testRoot.cleanup()
  }
})

test('a non-empty application shell conservatively triggers rendering', async () => {
  const testRoot = fixture()
  let renders = 0
  try {
    const result = await webResearch.readWebPage({
      url: 'https://spa.example.com/loading',
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: staticHtml(
        '<html><body><div id="app"><p>Loading...</p></div>'
        + '<script src="/runtime.js"></script><script src="/app.js"></script></body></html>',
      ),
      renderEnabled: true,
      renderPage: async (url) => {
        renders += 1
        return {
          finalUrl: url,
          title: 'Rendered shell',
          html: '<html><body><main><p>渲染后的业务正文</p></main></body></html>',
          redirects: [],
        }
      },
    })
    assert.equal(renders, 1)
    assert.match(result.preview, /渲染后的业务正文/u)
    assert.doesNotMatch(result.preview, /Loading/u)
  } finally {
    testRoot.cleanup()
  }
})

test('forced renderer failures do not claim static extraction was empty', async () => {
  const testRoot = fixture()
  try {
    await assert.rejects(
      () => webResearch.readWebPage({
        projectRoot: testRoot.root,
        url: 'https://spa.example.com/force-failure',
        render: true,
      }, {
        resolveHost: allowAnyHost,
        fetchImpl: staticHtml('<html><body><main><p>静态正文未被读取</p></main></body></html>'),
        renderEnabled: true,
        renderPage: async () => {
          throw new Error('renderer crashed')
        },
      }),
      (error) => error.code === 'RENDER_FAILED'
        && /强制脚本渲染失败/u.test(error.message)
        && !/静态页面没有可提取正文/u.test(error.message),
    )
  } finally {
    testRoot.cleanup()
  }
})

test('render flag off never invokes the renderer', async () => {
  const testRoot = fixture()
  let renders = 0
  try {
    await assert.rejects(
      () => webResearch.readWebPage({
        projectRoot: testRoot.root,
        url: 'https://spa.example.com/disabled',
      }, {
        resolveHost: allowAnyHost,
        fetchImpl: staticHtml('<html><body><div id="root"></div></body></html>'),
        renderEnabled: false,
        renderPage: async () => {
          renders += 1
          throw new Error('must not run')
        },
      }),
      (error) => error.code === 'EMPTY_DOCUMENT' && /渲染当前已关闭/u.test(error.message),
    )
    assert.equal(renders, 0)
  } finally {
    testRoot.cleanup()
  }
})

test('a non-empty application shell is rejected when hidden rendering is not opted in', async () => {
  let renders = 0
  await assert.rejects(
    () => webResearch.readWebPage({
      url: 'https://spa.example.com/loading-safe-default',
    }, {
      resolveHost: allowAnyHost,
      fetchImpl: staticHtml(
        '<html><body><div id="app"><p>Loading...</p></div>'
        + '<script src="/runtime.js"></script><script src="/app.js"></script></body></html>',
      ),
      renderEnabled: false,
      renderPage: async () => {
        renders += 1
        throw new Error('must not run')
      },
    }),
    (error) => error.code === 'EMPTY_DOCUMENT' && /应用骨架/u.test(error.message),
  )
  assert.equal(renders, 0)
})

test('loading text inside inline scripts or img attributes does not mark a short page as a shell', async () => {
  let renders = 0
  const result = await webResearch.readWebPage({
    url: 'https://notice.example.com/bid',
  }, {
    resolveHost: allowAnyHost,
    fetchImpl: staticHtml(
      '<html><body><main><p>2026年第一标段钢材招标公告正文，详见附件。</p>'
      + '<img src="banner.png" loading="lazy" alt=""></main>'
      + '<script>var loading = false; tracker(loading);</script></body></html>',
    ),
    renderEnabled: false,
    renderPage: async () => {
      renders += 1
      throw new Error('must not run')
    },
  })
  assert.equal(renders, 0)
  assert.match(result.preview, /招标公告正文/u)
})

test('hidden renderer keeps the planned security and serialisation guards', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'electron/runtime/web-research/render-window.ts'),
    'utf8',
  )
  assert.match(source, /show: false/u)
  assert.match(source, /sandbox: true/u)
  assert.match(source, /nodeIntegration: false/u)
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u)
  assert.match(source, /setPermissionRequestHandler/u)
  assert.match(source, /resourceType === 'image'/u)
  assert.match(source, /safeNavigation\(target\.toString\(\), expectedHost, mainFrameProtocol\)/u)
  assert.match(source, /assertSafeTargetHost\(target\.hostname\)/u)
  assert.match(source, /target\.protocol === 'https:'/u)
  assert.match(source, /mainFrameProtocol === 'http:'/u)
  assert.match(source, /webContents\.on\('will-redirect', \(event\) =>/u)
  assert.match(source, /event\.isMainFrame === false/u)
  assert.match(source, /safeNavigation\(event\.url, expectedHost, mainFrameProtocol\)/u)
  assert.match(source, /assertSafeTargetHost\(requested\.hostname\)/u)
  assert.match(source, /session\.resolveProxy\(requested\.toString\(\)\)/u)
  assert.match(source, /isWebSystemProxyEnabled/u)
  assert.match(source, /session\.setProxy\(\{ mode: 'direct' \}\)/u)
  assert.match(source, /route\.kind === 'direct'/u)
  assert.match(source, /renderQueue\.then/u)
  assert.match(source, /Subresources use Chromium's normal resolver and are not DNS-pinned/u)
})

test('hidden renderer navigation policy rejects protocol downgrade and host changes', () => {
  const { safeNavigation, shouldCancelRenderRequest } = loadBundledModule(
    'electron/runtime/web-research/render-window.ts',
  )
  assert.equal(
    safeNavigation('https://example.com/next', 'example.com')?.toString(),
    'https://example.com/next',
  )
  assert.equal(safeNavigation('http://example.com/next', 'example.com'), null)
  assert.equal(
    safeNavigation('http://example.com/next', 'example.com', 'http:')?.toString(),
    'http://example.com/next',
  )
  assert.equal(
    safeNavigation('https://example.com/next', 'example.com', 'http:')?.toString(),
    'https://example.com/next',
  )
  assert.equal(safeNavigation('http://user:secret@example.com/next', 'example.com', 'http:'), null)
  assert.equal(safeNavigation('https://other.example/next', 'example.com'), null)
  assert.equal(safeNavigation('https://example.com:444/next', 'example.com'), null)

  assert.equal(
    shouldCancelRenderRequest('https://cdn.example.net/app.js', 'script', 'example.com', 'https:'),
    false,
  )
  assert.equal(
    shouldCancelRenderRequest('https://127.0.0.1/private.js', 'script', 'example.com', 'https:'),
    true,
  )
  assert.equal(
    shouldCancelRenderRequest('https://localhost/private.js', 'script', 'example.com', 'https:'),
    true,
  )
  assert.equal(
    shouldCancelRenderRequest('http://169.254.169.254/latest', 'script', 'example.com', 'http:'),
    true,
  )
  assert.equal(
    shouldCancelRenderRequest('https://example.com/upgrade', 'mainFrame', 'example.com', 'http:'),
    false,
  )
  assert.equal(
    shouldCancelRenderRequest('http://example.com/downgrade', 'mainFrame', 'example.com', 'https:'),
    true,
  )
  assert.equal(
    shouldCancelRenderRequest('https://other.example/leave', 'mainFrame', 'example.com', 'https:'),
    true,
  )
})
