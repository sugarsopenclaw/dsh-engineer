const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

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

async function loadRuntimeModule() {
  const filename = path.resolve(
    projectRoot,
    'electron/runtime/agent/mcp/blender-mcp-runtime.ts',
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

test('getUvMirrorEnv 注入国内镜像且不覆盖用户已有配置', async () => {
  const runtime = await loadRuntimeModule()

  const fresh = runtime.getUvMirrorEnv({})
  assert.equal(
    fresh.UV_PYTHON_INSTALL_MIRROR,
    'https://registry.npmmirror.com/-/binary/python-build-standalone',
  )
  assert.equal(fresh.UV_DEFAULT_INDEX, 'https://mirrors.aliyun.com/pypi/simple/')
  assert.equal(fresh.UV_INDEX_URL, 'https://mirrors.aliyun.com/pypi/simple/')
  assert.equal(fresh.UV_LINK_MODE, 'copy')

  const withMirror = runtime.getUvMirrorEnv({
    UV_PYTHON_INSTALL_MIRROR: 'https://example.com/pbs',
    UV_LINK_MODE: 'hardlink',
  })
  assert.equal(withMirror.UV_PYTHON_INSTALL_MIRROR, undefined)
  assert.equal(withMirror.UV_LINK_MODE, undefined)
  assert.equal(withMirror.UV_DEFAULT_INDEX, 'https://mirrors.aliyun.com/pypi/simple/')

  // 用户配置了任一 index 变量即视为自带 PyPI 源,两个 index 键都不注入。
  const withLegacyIndex = runtime.getUvMirrorEnv({ UV_INDEX_URL: 'https://example.com/simple' })
  assert.equal(withLegacyIndex.UV_DEFAULT_INDEX, undefined)
  assert.equal(withLegacyIndex.UV_INDEX_URL, undefined)
  assert.equal(withLegacyIndex.UV_PYTHON_INSTALL_MIRROR, fresh.UV_PYTHON_INSTALL_MIRROR)
})

test('isUvFamilyCommand 识别 uv/uvx 家族命令', async () => {
  const runtime = await loadRuntimeModule()
  assert.equal(runtime.isUvFamilyCommand('uvx'), true)
  assert.equal(runtime.isUvFamilyCommand('uv.exe'), true)
  assert.equal(runtime.isUvFamilyCommand('C:\\tools\\uv\\uvx.exe'), true)
  assert.equal(runtime.isUvFamilyCommand(' UV '), true)
  assert.equal(runtime.isUvFamilyCommand('python'), false)
  assert.equal(runtime.isUvFamilyCommand('C:\\python\\python.exe'), false)
})

test('resolvePackageSpec 从 args 推导预热目标', async () => {
  const runtime = await loadRuntimeModule()
  assert.equal(runtime.resolvePackageSpec(['blender-mcp']), 'blender-mcp')
  assert.equal(
    runtime.resolvePackageSpec(['--from', 'git+https://example.com/repo', 'blender-mcp']),
    'git+https://example.com/repo',
  )
  assert.equal(runtime.resolvePackageSpec(['--verbose']), 'blender-mcp')
  assert.equal(runtime.resolvePackageSpec([]), 'blender-mcp')
})

test('getBlenderMcpPreparedInfo 读取标记文件并容忍损坏内容', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepared-')
  try {
    assert.equal(runtime.getBlenderMcpPreparedInfo(root), null)

    fs.writeFileSync(
      path.join(root, 'prepared.json'),
      JSON.stringify({ packageSpec: 'blender-mcp', pythonVersion: '3.14.2', preparedAt: '2026-08-13T00:00:00.000Z' }),
    )
    const info = runtime.getBlenderMcpPreparedInfo(root)
    assert.equal(info.packageSpec, 'blender-mcp')
    assert.equal(info.pythonVersion, '3.14.2')

    fs.writeFileSync(path.join(root, 'prepared.json'), '{ broken')
    assert.equal(runtime.getBlenderMcpPreparedInfo(root), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('describeBlenderMcpRuntime 组装自定义命令与预热匹配状态', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-describe-')
  try {
    const custom = runtime.describeBlenderMcpRuntime(
      { enabled: true, command: 'C:\\python\\python.exe', args: ['-m', 'blender_mcp'] },
      root,
    )
    assert.equal(custom.customCommand, true)
    assert.equal(custom.prepared, false)

    fs.writeFileSync(
      path.join(root, 'prepared.json'),
      JSON.stringify({ packageSpec: 'blender-mcp', pythonVersion: '3.14.2', preparedAt: '2026-08-13T00:00:00.000Z' }),
    )
    const prepared = runtime.describeBlenderMcpRuntime(
      { enabled: true, command: 'uvx', args: ['blender-mcp'] },
      root,
    )
    assert.equal(prepared.customCommand, false)
    assert.equal(prepared.packageSpec, 'blender-mcp')
    assert.equal(prepared.prepared, true)
    assert.equal(prepared.preparedAt, '2026-08-13T00:00:00.000Z')

    // 用户改了 args 换包后,旧标记失配,回到未预热。
    const mismatched = runtime.describeBlenderMcpRuntime(
      { enabled: true, command: 'uvx', args: ['other-mcp'] },
      root,
    )
    assert.equal(mismatched.prepared, false)
    assert.equal(mismatched.preparedAt, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareBlenderMcpRuntime 成功路径写入标记并按阶段回报进度', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepare-ok-')
  try {
    const phases = []
    const stderrLines = []
    let capturedArgs = null
    await runtime.prepareBlenderMcpRuntime({
      root,
      packageSpec: 'blender-mcp',
      uvPath: 'C:\\fake\\uv.exe',
      onProgress: (progress) => phases.push(progress.phase),
      runUv: async (uvPath, args, onStderrLine) => {
        assert.equal(uvPath, 'C:\\fake\\uv.exe')
        capturedArgs = args
        onStderrLine('Downloaded cpython-3.14.2')
        onStderrLine('Installed 39 packages in 765ms')
        return {
          code: 0,
          stdout: 'XIAOLIANG_BLENDER_MCP_READY 3.14.2\n',
          stderrTail: '',
        }
      },
    })

    assert.deepEqual(
      capturedArgs.slice(0, 4),
      ['tool', 'run', '--from', 'blender-mcp'],
    )
    assert.ok(capturedArgs.join(' ').includes('import blender_mcp'))
    assert.deepEqual(
      [...new Set(phases)],
      ['resolving', 'installing', 'validating', 'completed'],
    )
    void stderrLines

    const info = JSON.parse(fs.readFileSync(path.join(root, 'prepared.json'), 'utf8'))
    assert.equal(info.packageSpec, 'blender-mcp')
    assert.equal(info.pythonVersion, '3.14.2')
    assert.ok(info.preparedAt)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareBlenderMcpRuntime 非简单包名时探测脚本不 import 模块', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepare-git-')
  try {
    let capturedArgs = null
    await runtime.prepareBlenderMcpRuntime({
      root,
      packageSpec: 'git+https://example.com/repo',
      uvPath: 'C:\\fake\\uv.exe',
      runUv: async (_uvPath, args) => {
        capturedArgs = args
        return { code: 0, stdout: 'XIAOLIANG_BLENDER_MCP_READY 3.12.0\n', stderrTail: '' }
      },
    })
    const script = capturedArgs[capturedArgs.length - 1]
    assert.ok(!script.includes('import git'))
    assert.ok(script.includes('XIAOLIANG_BLENDER_MCP_READY'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareBlenderMcpRuntime 失败路径不写标记并回报 failed', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepare-fail-')
  try {
    const phases = []
    await assert.rejects(
      runtime.prepareBlenderMcpRuntime({
        root,
        uvPath: 'C:\\fake\\uv.exe',
        onProgress: (progress) => phases.push(progress.phase),
        runUv: async () => ({
          code: 1,
          stdout: '',
          stderrTail: 'error: Failed to resolve blender-mcp\ncaused by: network unreachable',
        }),
      }),
      /退出码 1/,
    )
    assert.ok(phases.includes('failed'))
    assert.equal(fs.existsSync(path.join(root, 'prepared.json')), false)

    // 退出码为 0 但缺就绪标记同样视为失败(python 起来了但输出被截断)。
    await assert.rejects(
      runtime.prepareBlenderMcpRuntime({
        root,
        uvPath: 'C:\\fake\\uv.exe',
        runUv: async () => ({ code: 0, stdout: 'something else\n', stderrTail: '' }),
      }),
      /退出码 0/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareBlenderMcpRuntime 并发调用复用同一次预热', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepare-share-')
  try {
    let runCount = 0
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const options = {
      root,
      uvPath: 'C:\\fake\\uv.exe',
      runUv: async () => {
        runCount += 1
        await gate
        return { code: 0, stdout: 'XIAOLIANG_BLENDER_MCP_READY 3.14.2\n', stderrTail: '' }
      },
    }
    const first = runtime.prepareBlenderMcpRuntime(options)
    assert.equal(runtime.isBlenderMcpPreparationInflight(), true)
    const second = runtime.prepareBlenderMcpRuntime(options)
    release()
    await Promise.all([first, second])
    assert.equal(runCount, 1)
    assert.equal(runtime.isBlenderMcpPreparationInflight(), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('prepareBlenderMcpRuntime 真实 spawn 失败路径(伪 uv 进程非零退出)', async () => {
  const runtime = await loadRuntimeModule()
  const root = makeTempDir('xl-blender-prepare-spawn-')
  try {
    const lines = []
    // node.exe 收到 uv 参数(tool run ...)会以非零码退出并输出到 stderr,
    // 覆盖 defaultRunUv 的 spawn、stderr 行转发与失败处理。
    await assert.rejects(
      runtime.prepareBlenderMcpRuntime({
        root,
        uvPath: process.execPath,
        onProgress: (progress) => {
          if (progress.phase === 'installing' && progress.message) {
            lines.push(progress.message)
          }
        },
      }),
      /退出码/,
    )
    assert.ok(lines.length > 0, '应转发 stderr 行作为安装进度')
    assert.equal(fs.existsSync(path.join(root, 'prepared.json')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
