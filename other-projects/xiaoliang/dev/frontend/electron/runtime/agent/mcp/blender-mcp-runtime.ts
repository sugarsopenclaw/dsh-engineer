import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'

/**
 * Blender MCP 依赖环境预热(uv 托管 Python + blender-mcp 包)。
 *
 * Blender MCP server 由 `uvx blender-mcp` 启动;uv.exe 随安装包预置,但首跑时
 * uv 还要联网下载 managed Python(默认走 GitHub 的 python-build-standalone,
 * 国内基本超时)和 blender-mcp 的 PyPI 依赖。这里提供:
 * - 国内镜像 env(npmmirror 的 python-build-standalone 镜像 + 阿里云 PyPI),
 *   预热与运行时统一注入,用户已显式配置的 UV_* 变量不覆盖;
 * - 一键预热:`uv tool run --from <spec> python -c "import ..."`,与真实启动
 *   链路同构,进程自然退出,uv 缓存即被填满,之后 uvx 启动约 1-2 秒;
 * - 预热完成标记(userData/managed-runtimes/blender-mcp/prepared.json),
 *   供设置页「环境检测与准备」展示状态。
 *
 * 实测(干净缓存 + 强制 managed python + 国内镜像):首次预热约 22 秒,
 * 缓存命中后启动 1.6 秒。
 */

export interface UvExecutableResolution {
  path: string
  /** packaged=安装包预置 resources/uv;system=用户 PATH。 */
  source: 'packaged' | 'system'
}

export interface BlenderMcpPreparedInfo {
  packageSpec: string
  pythonVersion: string | null
  preparedAt: string
}

export interface BlenderMcpPrepareProgress {
  phase: 'resolving' | 'installing' | 'validating' | 'completed' | 'failed'
  message?: string
}

export interface BlenderMcpRuntimeDescription {
  enabled: boolean
  uvAvailable: boolean
  uvPath: string | null
  /** 启动命令不是 uv/uvx 家族时为 true,预热不适用。 */
  customCommand: boolean
  packageSpec: string
  prepared: boolean
  preparedAt: string | null
}

interface RunUvResult {
  code: number | null
  stdout: string
  stderrTail: string
}

export interface PrepareBlenderMcpOptions {
  /** 标记文件根目录;默认 userData/managed-runtimes/blender-mcp。 */
  root?: string
  /** 预热目标包规格;默认 blender-mcp。 */
  packageSpec?: string
  onProgress?: (progress: BlenderMcpPrepareProgress) => void
  /** 测试注入:覆盖 uv 可执行路径。 */
  uvPath?: string
  /** 测试注入:覆盖 uv 进程执行。 */
  runUv?: (uvPath: string, args: string[], onStderrLine: (line: string) => void) => Promise<RunUvResult>
}

export const DEFAULT_BLENDER_MCP_PACKAGE_SPEC = 'blender-mcp'

/** 预热输出中的就绪标记,python 版本跟在其后。 */
const READY_MARKER = 'XIAOLIANG_BLENDER_MCP_READY'
const PREPARED_FILE = 'prepared.json'
const PREPARE_TIMEOUT_MS = 10 * 60 * 1000
const PACKAGED_UV_RESOURCE_DIR = 'uv'

/** python-build-standalone 与 PyPI 的国内镜像;UV_INDEX_URL 兼容旧版 uv。 */
const UV_MIRROR_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  UV_PYTHON_INSTALL_MIRROR: 'https://registry.npmmirror.com/-/binary/python-build-standalone',
  UV_DEFAULT_INDEX: 'https://mirrors.aliyun.com/pypi/simple/',
  UV_INDEX_URL: 'https://mirrors.aliyun.com/pypi/simple/',
  // userData 与 uv 缓存可能跨盘符,hardlink 失败会刷警告,统一退化为复制。
  UV_LINK_MODE: 'copy',
})

/**
 * 返回 baseEnv 中缺失的 uv 镜像变量。用户已显式配置的键不覆盖。
 * index 镜像成对处理:用户配置了任一 index 变量即视为自带 PyPI 源。
 */
export function getUvMirrorEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {}
  const hasCustomIndex = Boolean(baseEnv.UV_DEFAULT_INDEX || baseEnv.UV_INDEX_URL)
  for (const [key, value] of Object.entries(UV_MIRROR_DEFAULTS)) {
    if (baseEnv[key]) continue
    if (hasCustomIndex && (key === 'UV_DEFAULT_INDEX' || key === 'UV_INDEX_URL')) continue
    result[key] = value
  }
  return result
}

export function resolveUvExecutable(): UvExecutableResolution | null {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, PACKAGED_UV_RESOURCE_DIR, 'uv.exe')
    if (fs.existsSync(packaged)) {
      return { path: packaged, source: 'packaged' }
    }
  }
  const names = process.platform === 'win32' ? ['uv.exe'] : ['uv']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        if (fs.existsSync(candidate)) {
          return { path: candidate, source: 'system' }
        }
      } catch {
        // 不可访问的 PATH 项直接跳过。
      }
    }
  }
  return null
}

/** 判断设置里的启动命令是否 uv/uvx 家族(bare 或绝对路径均可)。 */
export function isUvFamilyCommand(command: string): boolean {
  const base = path.basename(command.trim()).toLowerCase()
  return base === 'uv' || base === 'uv.exe' || base === 'uvx' || base === 'uvx.exe'
}

/**
 * 从设置的 args 推导预热目标包规格。
 * `uvx blender-mcp` → args[0];`uvx --from <spec> cmd` → --from 的值;
 * 解析不出来时退回默认 blender-mcp。
 */
export function resolvePackageSpec(args: readonly string[]): string {
  const fromIndex = args.indexOf('--from')
  if (fromIndex >= 0 && args[fromIndex + 1]) {
    return args[fromIndex + 1]
  }
  const first = args.find((item) => item && !item.startsWith('-'))
  return first ?? DEFAULT_BLENDER_MCP_PACKAGE_SPEC
}

export function getManagedBlenderMcpRoot(): string {
  return path.join(app.getPath('userData'), 'managed-runtimes', 'blender-mcp')
}

export function getBlenderMcpPreparedInfo(root?: string): BlenderMcpPreparedInfo | null {
  try {
    const file = path.join(root ?? getManagedBlenderMcpRoot(), PREPARED_FILE)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof parsed?.packageSpec !== 'string' || typeof parsed?.preparedAt !== 'string') {
      return null
    }
    return {
      packageSpec: parsed.packageSpec,
      pythonVersion: typeof parsed.pythonVersion === 'string' ? parsed.pythonVersion : null,
      preparedAt: parsed.preparedAt,
    }
  } catch {
    return null
  }
}

/** 组装设置页展示的运行时状态;settings 由调用方传入,本模块不读数据库。 */
export function describeBlenderMcpRuntime(
  settings: { enabled: boolean; command: string; args: readonly string[] },
  root?: string,
): BlenderMcpRuntimeDescription {
  const customCommand = !isUvFamilyCommand(settings.command)
  const packageSpec = resolvePackageSpec(settings.args)
  const uv = resolveUvExecutable()
  const preparedInfo = getBlenderMcpPreparedInfo(root)
  const prepared = Boolean(preparedInfo && preparedInfo.packageSpec === packageSpec)
  return {
    enabled: settings.enabled,
    uvAvailable: Boolean(uv),
    uvPath: uv?.path ?? null,
    customCommand,
    packageSpec,
    prepared,
    preparedAt: prepared ? preparedInfo!.preparedAt : null,
  }
}

/** 包规格是简单包名时返回可导入的模块名(blender-mcp → blender_mcp),否则 null。 */
function toImportableModule(packageSpec: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packageSpec)) return null
  return packageSpec.replace(/-/g, '_').replace(/\./g, '_')
}

function buildProbeScript(packageSpec: string): string {
  const moduleName = toImportableModule(packageSpec)
  const importStatement = moduleName ? `import ${moduleName}; ` : ''
  return `${importStatement}import sys; print("${READY_MARKER}", sys.version.split()[0])`
}

function defaultRunUv(
  uvPath: string,
  args: string[],
  onStderrLine: (line: string) => void,
): Promise<RunUvResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(uvPath, args, {
      env: { ...process.env, ...getUvMirrorEnv() },
      windowsHide: true,
    })

    let stdout = ''
    let stderrTail = ''
    let lineBuffer = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`预热超时(${PREPARE_TIMEOUT_MS / 60000} 分钟),已中止 uv 进程。`))
    }, PREPARE_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrTail = (stderrTail + text).slice(-4000)
      lineBuffer += text
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) onStderrLine(trimmed)
      }
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderrTail })
    })
  })
}

let inflightPreparation: Promise<void> | null = null

export function isBlenderMcpPreparationInflight(): boolean {
  return inflightPreparation !== null
}

/**
 * 预热 Blender MCP 依赖环境:用与真实启动同构的
 * `uv tool run --from <spec> python -c "import ..."` 填满 uv 缓存后自然退出。
 * 幂等;成功后写 prepared.json 标记。并发调用复用同一次预热。
 */
export function prepareBlenderMcpRuntime(options: PrepareBlenderMcpOptions = {}): Promise<void> {
  if (inflightPreparation) {
    return inflightPreparation
  }
  inflightPreparation = doPrepare(options).finally(() => {
    inflightPreparation = null
  })
  return inflightPreparation
}

async function doPrepare(options: PrepareBlenderMcpOptions): Promise<void> {
  const report = (progress: BlenderMcpPrepareProgress) => options.onProgress?.(progress)
  const packageSpec = options.packageSpec?.trim() || DEFAULT_BLENDER_MCP_PACKAGE_SPEC
  try {
    report({ phase: 'resolving', message: '定位 uv 运行时…' })
    const uvPath = options.uvPath ?? resolveUvExecutable()?.path
    if (!uvPath) {
      throw new Error('未找到 uv 运行时。重装晓量可恢复预置的 uv.exe,或手动安装 uv 后重试。')
    }

    report({ phase: 'installing', message: '解析并安装 Python 依赖环境(国内镜像)…' })
    const runUv = options.runUv ?? defaultRunUv
    const args = ['tool', 'run', '--from', packageSpec, 'python', '-c', buildProbeScript(packageSpec)]
    const result = await runUv(uvPath, args, (line) => {
      report({ phase: 'installing', message: line })
    })

    report({ phase: 'validating', message: '验证依赖环境…' })
    const readyLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.includes(READY_MARKER))
    if (result.code !== 0 || !readyLine) {
      const detail = result.stderrTail.trim().split(/\r?\n/).slice(-5).join('\n')
      throw new Error(
        `uv 预热进程退出码 ${result.code ?? 'null'}。${detail ? `\n${detail}` : ''}`,
      )
    }
    const pythonVersion = readyLine.trim().split(/\s+/)[1] ?? null

    const root = options.root ?? getManagedBlenderMcpRoot()
    const info: BlenderMcpPreparedInfo = {
      packageSpec,
      pythonVersion,
      preparedAt: new Date().toISOString(),
    }
    await fs.promises.mkdir(root, { recursive: true })
    const tmpFile = path.join(root, `${PREPARED_FILE}.tmp`)
    await fs.promises.writeFile(tmpFile, JSON.stringify(info, null, 2), 'utf8')
    await fs.promises.rename(tmpFile, path.join(root, PREPARED_FILE))

    report({ phase: 'completed', message: `依赖环境已就绪(Python ${pythonVersion ?? '未知版本'})。` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report({ phase: 'failed', message })
    throw error
  }
}
