const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const JSZip = require('jszip')

const projectRoot = path.resolve(__dirname, '..')

const bundleOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  banner: {
    js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__bundledImportMetaUrl',
  },
}

function compileBundledModule(filename, output) {
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function electronStub() {
  return {
    name: 'electron-stub',
    setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({
        path: 'electron',
        namespace: 'electron-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
        contents: 'export const app = { getPath() { return "" }, isPackaged: false }',
        loader: 'js',
      }))
    },
  }
}

async function loadBashRuntimeModule() {
  const filename = path.resolve(
    projectRoot,
    'electron/runtime/agent/pi/pi-bash-runtime.ts',
  )
  const output = await esbuild.build({
    ...bundleOptions,
    entryPoints: [filename],
    plugins: [electronStub()],
  })
  return compileBundledModule(filename, output)
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

async function buildMinGitFixtureZip() {
  const zip = new JSZip()
  zip.file('LICENSE.txt', 'fixture license')
  zip.file('cmd/git.exe', 'fake git binary')
  zip.file('usr/bin/sh.exe', 'fake bash binary payload')
  zip.file('usr/bin/sed.exe', 'fake sed binary')
  zip.folder('etc')
  return zip.generateAsync({ type: 'nodebuffer' })
}

function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

test('GIT_BASH_ASSET_FALLBACKS 指向国内镜像且带完整校验信息', async () => {
  const runtime = await loadBashRuntimeModule()
  const sources = runtime.GIT_BASH_ASSET_FALLBACKS
  assert.ok(sources.length >= 2, '至少 npmmirror 与华为云两个兜底源')
  assert.deepEqual(sources.map((source) => source.label), ['npmmirror', 'huaweicloud'])
  for (const source of sources) {
    assert.match(source.url, /^https:\/\//)
    assert.match(source.url, /MinGit-.*-64-bit\.zip$/)
    assert.match(source.sha256, /^[0-9a-f]{64}$/)
    assert.ok(source.sizeBytes > 10 * 1024 * 1024, '大小元数据应为完整包体积')
  }
  assert.ok(
    sources[0].url.includes('registry.npmmirror.com'),
    '首选兜底应为 npmmirror',
  )
})

test('verifyFileSha256 校验通过与篡改检测', async () => {
  const runtime = await loadBashRuntimeModule()
  const dir = makeTempDir('xl-bash-sha-')
  const filePath = path.join(dir, 'payload.bin')
  const payload = Buffer.from('xiaoliang-bash-runtime-payload')
  fs.writeFileSync(filePath, payload)

  await runtime.verifyFileSha256(filePath, sha256Of(payload))
  await assert.rejects(
    () => runtime.verifyFileSha256(filePath, 'a'.repeat(64)),
    /文件校验失败/,
  )
})

test('extractZipArchive 解压 MinGit 平铺结构并防护 zip-slip', async () => {
  const runtime = await loadBashRuntimeModule()
  const dir = makeTempDir('xl-bash-zip-')
  const zipPath = path.join(dir, 'mingit.zip')
  fs.writeFileSync(zipPath, await buildMinGitFixtureZip())

  const targetDir = path.join(dir, 'out')
  await runtime.extractZipArchive(zipPath, targetDir)
  assert.ok(fs.existsSync(path.join(targetDir, 'usr', 'bin', 'sh.exe')))
  assert.ok(fs.existsSync(path.join(targetDir, 'cmd', 'git.exe')))
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'usr', 'bin', 'sh.exe'), 'utf8'),
    'fake bash binary payload',
  )

  // zip-slip:包含 ../ 越界条目的 zip 必须拒绝。
  const evil = new JSZip()
  // JSZip 默认会剥离开头的 ../,这里直接改内部条目名构造恶意包。
  evil.file('placeholder.txt', 'x')
  evil.files['../evil.txt'] = evil.files['placeholder.txt']
  delete evil.files['placeholder.txt']
  evil.files['../evil.txt'].name = '../evil.txt'
  const evilPath = path.join(dir, 'evil.zip')
  fs.writeFileSync(evilPath, await evil.generateAsync({ type: 'nodebuffer' }))
  // yauzl 自身会拒绝 ../ 相对路径条目;extractZipArchive 的 resolve 检查是第二道防线。
  await assert.rejects(
    () => runtime.extractZipArchive(evilPath, path.join(dir, 'out-evil')),
    /越界|invalid relative path/,
  )
  assert.ok(!fs.existsSync(path.join(dir, 'evil.txt')), '越界文件不得落盘')
})

test('finalizeMinGitLayout 把 sh.exe 复制为 bash.exe 并校验包结构', async () => {
  const runtime = await loadBashRuntimeModule()
  const dir = makeTempDir('xl-bash-layout-')
  await assert.rejects(
    () => runtime.finalizeMinGitLayout(dir),
    /不是有效的 MinGit 包/,
  )

  const binDir = path.join(dir, 'usr', 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'sh.exe'), 'fake bash')
  const bashPath = await runtime.finalizeMinGitLayout(dir)
  assert.equal(bashPath, path.join(binDir, 'bash.exe'))
  assert.equal(fs.readFileSync(bashPath, 'utf8'), 'fake bash')
})

test('downloadFileWithProgress 跟随重定向并回报进度', async () => {
  const runtime = await loadBashRuntimeModule()
  const payload = Buffer.from('redirected-download-payload'.repeat(64))
  const { server, port } = await startServer((req, res) => {
    if (req.url === '/entry') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/real` })
      res.end()
      return
    }
    if (req.url === '/real') {
      res.writeHead(200, { 'content-length': String(payload.length) })
      res.end(payload)
      return
    }
    res.writeHead(404)
    res.end()
  })
  try {
    const dir = makeTempDir('xl-bash-dl-')
    const target = path.join(dir, 'nested', 'payload.bin')
    const reports = []
    await runtime.downloadFileWithProgress(`http://127.0.0.1:${port}/entry`, target, {
      onProgress: (received, total) => reports.push([received, total]),
    })
    assert.ok(fs.existsSync(target))
    assert.equal(sha256Of(fs.readFileSync(target)), sha256Of(payload))
    assert.ok(reports.length >= 1)
    assert.deepEqual(reports.at(-1), [payload.length, payload.length])

    await assert.rejects(
      () => runtime.downloadFileWithProgress(`http://127.0.0.1:${port}/missing`, target, {}),
      /HTTP 404/,
    )
  } finally {
    server.close()
  }
})

test('prepareManagedBashRuntime 端到端:下载源兜底、校验、解压、原子切换', async () => {
  const runtime = await loadBashRuntimeModule()
  const fixture = await buildMinGitFixtureZip()
  const fixtureSha = sha256Of(fixture)
  let brokenHits = 0
  const { server, port } = await startServer((req, res) => {
    if (req.url === '/broken.zip') {
      brokenHits += 1
      res.writeHead(500)
      res.end('boom')
      return
    }
    if (req.url === '/mingit.zip') {
      res.writeHead(200, { 'content-length': String(fixture.length) })
      res.end(fixture)
      return
    }
    res.writeHead(404)
    res.end()
  })
  try {
    const root = makeTempDir('xl-bash-prepare-')
    const phases = []
    const smokeCalls = []
    const resolution = await runtime.prepareManagedBashRuntime({
      root,
      fetchManifest: async () => null,
      fallbackSources: [
        {
          label: 'broken-source',
          url: `http://127.0.0.1:${port}/broken.zip`,
          sha256: fixtureSha,
          sizeBytes: fixture.length,
          version: 'test-1',
        },
        {
          label: 'good-source',
          url: `http://127.0.0.1:${port}/mingit.zip`,
          sha256: fixtureSha,
          sizeBytes: fixture.length,
          version: 'test-1',
        },
      ],
      smokeTest: (bashPath, binDir) => {
        smokeCalls.push([bashPath, binDir])
      },
      onProgress: (progress) => phases.push(progress.phase),
    })

    assert.equal(brokenHits, 1, '第一个源失败后应切换下一个源')
    assert.equal(resolution.source, 'managed')
    assert.equal(resolution.available, true)
    assert.equal(resolution.version, 'test-1')
    assert.equal(
      resolution.shellPath,
      path.join(root, 'current', 'usr', 'bin', 'bash.exe'),
    )
    assert.equal(resolution.binDir, path.join(root, 'current', 'usr', 'bin'))
    assert.equal(smokeCalls.length, 1)
    assert.ok(fs.existsSync(resolution.shellPath))

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'current', '.xiaoliang-runtime.json'), 'utf8'),
    )
    assert.equal(manifest.version, 'test-1')
    assert.equal(manifest.source, 'good-source')

    assert.ok(phases.includes('downloading'))
    assert.ok(phases.includes('verifying'))
    assert.ok(phases.includes('extracting'))
    assert.ok(phases.includes('validating'))
    assert.equal(phases.at(-1), 'completed')

    // 安装记录可被 getManagedBashInfo 读出(供设置页展示版本)。
    const info = runtime.getManagedBashInfo(root)
    assert.equal(info.version, 'test-1')

    // 冒烟验证失败时不得切换 current。
    await assert.rejects(
      () => runtime.prepareManagedBashRuntime({
        root,
        fetchManifest: async () => null,
        fallbackSources: [
          {
            label: 'good-source',
            url: `http://127.0.0.1:${port}/mingit.zip`,
            sha256: fixtureSha,
            sizeBytes: fixture.length,
            version: 'test-2',
          },
        ],
        smokeTest: () => {
          throw new Error('模拟 bash 验证失败')
        },
      }),
      /模拟 bash 验证失败/,
    )
    assert.equal(
      runtime.getManagedBashInfo(root).version,
      'test-1',
      '验证失败后应保留旧版本',
    )
  } finally {
    server.close()
  }
})

test('prepareManagedBashRuntime:哈希不匹配的源被拒绝并兜底', async () => {
  const runtime = await loadBashRuntimeModule()
  const fixture = await buildMinGitFixtureZip()
  const fixtureSha = sha256Of(fixture)
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-length': String(fixture.length) })
    res.end(fixture)
  })
  try {
    const root = makeTempDir('xl-bash-hash-')
    const resolution = await runtime.prepareManagedBashRuntime({
      root,
      // manifest 源哈希不匹配(模拟 OSS 资产被篡改/配置错误),必须回退镜像。
      fetchManifest: async () => ({
        label: 'oss',
        url: `http://127.0.0.1:${port}/tampered.zip`,
        sha256: 'b'.repeat(64),
        sizeBytes: fixture.length,
        version: 'bad-1',
      }),
      fallbackSources: [
        {
          label: 'mirror',
          url: `http://127.0.0.1:${port}/mingit.zip`,
          sha256: fixtureSha,
          sizeBytes: fixture.length,
          version: 'good-2',
        },
      ],
      smokeTest: () => {},
    })
    assert.equal(resolution.version, 'good-2')
  } finally {
    server.close()
  }
})

test('buildBashToolOptions:托管 shellPath 注入与 PATH prepend', async () => {
  const filename = path.resolve(
    projectRoot,
    'electron/runtime/agent/tools/domain/pi-coding/index.ts',
  )
  const output = await esbuild.build({ ...bundleOptions, entryPoints: [filename] })
  const piCoding = compileBundledModule(filename, output)

  assert.equal(piCoding.buildBashToolOptions({}), undefined)
  assert.equal(
    piCoding.buildBashToolOptions({ bashShellPath: null, bashBinDir: null }),
    undefined,
  )

  const managedBash = path.join('C:', 'managed', 'usr', 'bin', 'bash.exe')
  const managedBin = path.join('C:', 'managed', 'usr', 'bin')
  const options = piCoding.buildBashToolOptions({
    bashShellPath: managedBash,
    bashBinDir: managedBin,
  })
  assert.equal(options.shellPath, managedBash)
  assert.equal(typeof options.spawnHook, 'function')

  const hooked = options.spawnHook({
    command: 'ls',
    cwd: 'C:\\project',
    env: { Path: 'C:\\Windows\\system32' },
  })
  assert.ok(hooked.env.Path.startsWith(managedBin + path.delimiter))
  assert.ok(hooked.env.Path.includes('C:\\Windows\\system32'))

  // 已包含托管 bin 时不重复注入。
  const idempotent = options.spawnHook(hooked)
  assert.equal(idempotent.env.Path, hooked.env.Path)

  // 无 binDir 时只注入 shellPath。
  const shellOnly = piCoding.buildBashToolOptions({ bashShellPath: managedBash })
  assert.equal(shellOnly.shellPath, managedBash)
  assert.equal(shellOnly.spawnHook, undefined)
})

test('createBashTool 接受托管 shellPath 配置(SDK 集成)', async () => {
  const filename = path.resolve(
    projectRoot,
    'electron/runtime/agent/tools/domain/pi-coding/index.ts',
  )
  const output = await esbuild.build({ ...bundleOptions, entryPoints: [filename] })
  const piCoding = compileBundledModule(filename, output)

  const tools = piCoding.buildPiCodingTools({
    cwd: projectRoot,
    includeBash: true,
    bashShellPath: path.join('C:', 'managed', 'usr', 'bin', 'bash.exe'),
    bashBinDir: path.join('C:', 'managed', 'usr', 'bin'),
  })
  const bashTool = tools.find((tool) => tool.name === 'bash')
  assert.ok(bashTool, '带托管配置时 bash 工具应注册')
  assert.equal(typeof bashTool.execute, 'function')
})
