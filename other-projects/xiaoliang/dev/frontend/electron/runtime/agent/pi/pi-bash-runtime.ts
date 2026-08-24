import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import yauzl from 'yauzl'
import { getAgentDir, getShellConfig } from '@earendil-works/pi-coding-agent'
import { getBackendBaseUrl } from '../../backend/http'
import { resetPiBashAvailabilityCache } from '../tools/domain/pi-coding'

/**
 * 晓量托管 bash 运行时(MinGit)。
 *
 * Windows 上 Pi 的 bash 工具依赖 Git Bash;造价用户机器大概率没装 Git。
 * 这里把 MinGit(约 37MB,含 bash 5.x + sed/awk/grep/coreutils)下载解压到
 * userData/managed-runtimes/git-bash/current,经 createBashTool 的 shellPath
 * 显式注入,不动系统 PATH、不要求安装 Git。
 *
 * 下载源顺序:后端 OSS(signed URL,版本与哈希由后端下发)→ npmmirror → 华为云。
 * 全部经 SHA-256 校验;解压后把 usr/bin/sh.exe 复制为 bash.exe(MinGit 不带
 * bash.exe,而以 sh 名字启动会进 POSIX 模式,数组等 bash 语法失效),再冒烟
 * 验证工具链可用才切换 current 目录。
 */

export type PiBashSource = 'managed' | 'system' | 'none'

export interface PiBashRuntimeResolution {
  available: boolean
  source: PiBashSource
  /** managed 时为托管 bash.exe 绝对路径;system 时 null(SDK 自行探测 Git Bash)。 */
  shellPath: string | null
  /** managed 时为托管 usr/bin 目录,bash spawn 时需 prepend 到 PATH。 */
  binDir: string | null
  /** managed 安装记录中的版本号。 */
  version: string | null
}

export interface GitBashAssetSource {
  label: string
  url: string
  sha256: string
  sizeBytes: number | null
  version: string
}

export interface BashPrepareProgress {
  phase: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'validating' | 'completed' | 'failed'
  receivedBytes?: number
  totalBytes?: number
  message?: string
}

export interface PrepareManagedBashOptions {
  root?: string
  onProgress?: (progress: BashPrepareProgress) => void
  signal?: AbortSignal
  /** 测试注入:覆盖后端 manifest 获取。 */
  fetchManifest?: () => Promise<GitBashAssetSource | null>
  /** 测试注入:覆盖镜像兜底源。 */
  fallbackSources?: GitBashAssetSource[]
  /** 测试注入:覆盖冒烟验证(默认 smokeTestManagedBash)。 */
  smokeTest?: (bashPath: string, binDir: string) => void
}

/** 镜像兜底常量。SHA-256 与大小为本机实测值,与 git-for-windows 官方 release 页公布一致。 */
const MINGIT_VERSION = '2.55.0.windows.3'
const MINGIT_FILE = 'MinGit-2.55.0.3-64-bit.zip'
const MINGIT_SHA256 = 'f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05'
const MINGIT_SIZE_BYTES = 38791206

export const GIT_BASH_ASSET_FALLBACKS: readonly GitBashAssetSource[] = Object.freeze([
  {
    label: 'npmmirror',
    url: `https://registry.npmmirror.com/-/binary/git-for-windows/v${MINGIT_VERSION}/${MINGIT_FILE}`,
    sha256: MINGIT_SHA256,
    sizeBytes: MINGIT_SIZE_BYTES,
    version: MINGIT_VERSION,
  },
  {
    label: 'huaweicloud',
    url: `https://mirrors.huaweicloud.com/git-for-windows/v${MINGIT_VERSION}/${MINGIT_FILE}`,
    sha256: MINGIT_SHA256,
    sizeBytes: MINGIT_SIZE_BYTES,
    version: MINGIT_VERSION,
  },
])

const RUNTIME_MANIFEST_FILE = '.xiaoliang-runtime.json'
const CURRENT_DIR_NAME = 'current'

export function getManagedGitBashRoot(): string {
  return path.join(app.getPath('userData'), 'managed-runtimes', 'git-bash')
}

interface ManagedBashInfo {
  bashPath: string
  binDir: string
  version: string | null
}

export function getManagedBashInfo(root?: string): ManagedBashInfo | null {
  try {
    const base = path.join(root ?? getManagedGitBashRoot(), CURRENT_DIR_NAME)
    const binDir = path.join(base, 'usr', 'bin')
    const bashPath = path.join(binDir, 'bash.exe')
    if (!fs.existsSync(bashPath)) return null
    let version: string | null = null
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(base, RUNTIME_MANIFEST_FILE), 'utf8'))
      if (typeof manifest?.version === 'string') version = manifest.version
    } catch {
      // 安装记录缺失不影响可用性。
    }
    return { bashPath, binDir, version }
  } catch {
    return null
  }
}

let cachedResolution: PiBashRuntimeResolution | null = null

/**
 * bash 运行时解析:晓量托管 MinGit 优先,其次系统 Git Bash(SDK 探测),都没有则降级。
 * 结果按进程缓存;一键准备完成后调用 resetPiBashRuntimeCache 即可热生效(会话
 * fingerprint 覆盖了 source/shellPath,下一次对话自动重建 Runtime)。
 */
export function resolvePiBashRuntime(): PiBashRuntimeResolution {
  if (!cachedResolution) {
    const managed = getManagedBashInfo()
    if (managed) {
      cachedResolution = {
        available: true,
        source: 'managed',
        shellPath: managed.bashPath,
        binDir: managed.binDir,
        version: managed.version,
      }
    } else {
      let systemShell: string | null = null
      try {
        systemShell = getShellConfig().shell
      } catch {
        systemShell = null
      }
      cachedResolution = systemShell
        ? { available: true, source: 'system', shellPath: null, binDir: null, version: null }
        : { available: false, source: 'none', shellPath: null, binDir: null, version: null }
    }
  }
  return cachedResolution
}

export function resetPiBashRuntimeCache(): void {
  cachedResolution = null
  resetPiBashAvailabilityCache()
}

/** 设置页展示用:在 resolve 之上补充系统 bash 的具体路径。 */
export function describePiBashEnvironment(): {
  source: PiBashSource
  bashPath: string | null
  version: string | null
} {
  const resolution = resolvePiBashRuntime()
  if (resolution.source === 'system') {
    let shell: string | null = null
    try {
      shell = getShellConfig().shell
    } catch {
      shell = null
    }
    return { source: 'system', bashPath: shell, version: null }
  }
  return {
    source: resolution.source,
    bashPath: resolution.shellPath,
    version: resolution.version,
  }
}

/** 后端 runtime-assets manifest;未配置(404)或后端不可达时返回 null 走镜像兜底。 */
export async function fetchGitBashManifestFromBackend(): Promise<GitBashAssetSource | null> {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/runtime-assets/git-bash`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const payload = await response.json() as Record<string, unknown>
    const record = (payload && typeof payload === 'object' && 'data' in payload && payload.data
      && typeof payload.data === 'object')
      ? payload.data as Record<string, unknown>
      : payload
    const url = typeof record.download_url === 'string' ? record.download_url.trim() : ''
    const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim().toLowerCase() : ''
    if (!url || !/^[0-9a-f]{64}$/.test(sha256)) return null
    return {
      label: 'oss',
      url,
      sha256,
      sizeBytes: typeof record.size_bytes === 'number' && record.size_bytes > 0
        ? record.size_bytes
        : null,
      version: typeof record.version === 'string' && record.version.trim()
        ? record.version.trim()
        : MINGIT_VERSION,
    }
  } catch {
    return null
  }
}

const MAX_REDIRECTS = 5

export async function downloadFileWithProgress(
  url: string,
  targetPath: string,
  options: {
    expectedSizeBytes?: number | null
    onProgress?: (receivedBytes: number, totalBytes: number | null) => void
    signal?: AbortSignal
  } = {},
): Promise<void> {
  let currentUrl = url
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const parsed = new URL(currentUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`不支持的下载协议: ${parsed.protocol}`)
    }
    const client = parsed.protocol === 'https:' ? https : http
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = client.get(parsed, { signal: options.signal }, resolve)
      request.on('error', reject)
    })
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume()
      currentUrl = new URL(response.headers.location, currentUrl).toString()
      continue
    }
    if (status !== 200) {
      response.resume()
      throw new Error(`下载失败(HTTP ${status})`)
    }
    const headerLength = Number(response.headers['content-length'])
    const totalBytes = Number.isFinite(headerLength) && headerLength > 0
      ? headerLength
      : options.expectedSizeBytes ?? null
    let receivedBytes = 0
    let lastReportAt = 0
    // 进度统计必须放在管道内部(Transform),提前挂 data 监听会把响应流切到
    // flowing 模式,数据在管道建立前流失,落盘文件为空。
    const progressCounter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        const now = Date.now()
        if (now - lastReportAt >= 300) {
          lastReportAt = now
          options.onProgress?.(receivedBytes, totalBytes)
        }
        callback(null, chunk)
      },
    })
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await pipeline(
      response,
      progressCounter,
      fs.createWriteStream(targetPath),
      { signal: options.signal },
    )
    options.onProgress?.(receivedBytes, totalBytes)
    return
  }
  throw new Error('下载重定向次数过多。')
}

export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<void> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  const actual = hash.digest('hex')
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(`文件校验失败:期望 SHA-256 ${expectedSha256},实际 ${actual}。`)
  }
}

/** 解压 zip 到目标目录,带 zip-slip 防护。MinGit 为顶层平铺结构(cmd/ usr/ mingw64/ ...)。 */
export async function extractZipArchive(zipPath: string, targetDir: string): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true })
  const resolvedTarget = path.resolve(targetDir)
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, file) => {
      if (error || !file) reject(error ?? new Error('无法打开 zip 文件。'))
      else resolve(file)
    })
  })
  await new Promise<void>((resolve, reject) => {
    zipFile.on('error', reject)
    zipFile.on('end', () => resolve())
    zipFile.on('entry', (entry: yauzl.Entry) => {
      const entryName = entry.fileName.replace(/\\/g, '/')
      const destination = path.resolve(resolvedTarget, entryName)
      if (destination !== resolvedTarget
        && !destination.startsWith(resolvedTarget + path.sep)) {
        reject(new Error(`zip 条目路径越界: ${entry.fileName}`))
        return
      }
      if (entryName.endsWith('/')) {
        fs.promises.mkdir(destination, { recursive: true })
          .then(() => zipFile.readEntry())
          .catch(reject)
        return
      }
      zipFile.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) {
          reject(error ?? new Error(`无法读取 zip 条目: ${entry.fileName}`))
          return
        }
        fs.promises.mkdir(path.dirname(destination), { recursive: true })
          .then(() => pipeline(readStream, fs.createWriteStream(destination)))
          .then(() => zipFile.readEntry())
          .catch(reject)
      })
    })
    zipFile.readEntry()
  })
}

/**
 * MinGit 布局修正:usr/bin 下只有 sh.exe(实为 bash 5.x),复制为 bash.exe
 * 以恢复完整 bash 模式(以 sh 名字启动会进 POSIX 模式)。
 */
export async function finalizeMinGitLayout(extractedDir: string): Promise<string> {
  const binDir = path.join(extractedDir, 'usr', 'bin')
  const shPath = path.join(binDir, 'sh.exe')
  const bashPath = path.join(binDir, 'bash.exe')
  if (!fs.existsSync(shPath)) {
    throw new Error('解压结果缺少 usr/bin/sh.exe,不是有效的 MinGit 包。')
  }
  if (!fs.existsSync(bashPath)) {
    await fs.promises.copyFile(shPath, bashPath)
  }
  return bashPath
}

/** 冒烟验证:bash 语义 + sed/coreutils 管道可用(PATH 注入托管 usr/bin)。 */
export function smokeTestManagedBash(bashPath: string, binDir: string): void {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const result = spawnSync(
    bashPath,
    ['-c', 'x=(ok); printf "%s" "${x[0]}" | sed "s/ok/__XL_BASH_OK__/" && ls . > /dev/null'],
    {
      cwd: binDir,
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      env: { ...process.env, [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}` },
    },
  )
  if (result.status !== 0 || !result.stdout.includes('__XL_BASH_OK__')) {
    throw new Error(
      `bash 运行时验证失败(exit ${result.status}): ${(result.stderr || result.stdout || '').slice(0, 300)}`,
    )
  }
}

let inflightPreparation: Promise<PiBashRuntimeResolution> | null = null

/**
 * 一键准备托管 bash 运行时。幂等:进行中的准备会被复用。
 * 成功后重置解析缓存;会话在下一次对话时因 fingerprint 变化自动重建并注册 bash。
 */
export function prepareManagedBashRuntime(
  options: PrepareManagedBashOptions = {},
): Promise<PiBashRuntimeResolution> {
  if (inflightPreparation) return inflightPreparation
  inflightPreparation = runPreparation(options).finally(() => {
    inflightPreparation = null
  })
  return inflightPreparation
}

export function isBashPreparationInflight(): boolean {
  return inflightPreparation !== null
}

async function runPreparation(options: PrepareManagedBashOptions): Promise<PiBashRuntimeResolution> {
  const report = (progress: BashPrepareProgress) => {
    try {
      options.onProgress?.(progress)
    } catch {
      // 进度回调失败不影响准备流程。
    }
  }
  try {
    const root = options.root ?? getManagedGitBashRoot()
    report({ phase: 'resolving', message: '正在获取下载源…' })
    const fetchManifest = options.fetchManifest ?? fetchGitBashManifestFromBackend
    const manifest = await fetchManifest()
    const sources: GitBashAssetSource[] = [
      ...(manifest ? [manifest] : []),
      ...(options.fallbackSources ?? GIT_BASH_ASSET_FALLBACKS),
    ]

    await fs.promises.mkdir(root, { recursive: true })
    const downloadPath = path.join(root, '.download.zip')
    let selected: GitBashAssetSource | null = null
    let lastError: Error | null = null
    for (const source of sources) {
      try {
        report({
          phase: 'downloading',
          receivedBytes: 0,
          totalBytes: source.sizeBytes ?? undefined,
          message: `正在从 ${source.label} 下载 bash 运行时…`,
        })
        await downloadFileWithProgress(source.url, downloadPath, {
          expectedSizeBytes: source.sizeBytes,
          signal: options.signal,
          onProgress: (receivedBytes, totalBytes) => {
            report({
              phase: 'downloading',
              receivedBytes,
              totalBytes: totalBytes ?? undefined,
              message: `正在从 ${source.label} 下载 bash 运行时…`,
            })
          },
        })
        report({ phase: 'verifying', message: '正在校验文件完整性…' })
        await verifyFileSha256(downloadPath, source.sha256)
        selected = source
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (options.signal?.aborted) throw lastError
      }
    }
    if (!selected) {
      throw lastError ?? new Error('所有下载源均不可用。')
    }

    report({ phase: 'extracting', message: '正在解压运行时…' })
    const stagingDir = path.join(root, `.staging-${Date.now()}`)
    await fs.promises.rm(stagingDir, { recursive: true, force: true })
    await extractZipArchive(downloadPath, stagingDir)
    const bashPath = await finalizeMinGitLayout(stagingDir)
    await fs.promises.writeFile(
      path.join(stagingDir, RUNTIME_MANIFEST_FILE),
      JSON.stringify(
        {
          name: 'git-bash',
          version: selected.version,
          sha256: selected.sha256,
          source: selected.label,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )

    report({ phase: 'validating', message: '正在验证 bash 运行时…' })
    ;(options.smokeTest ?? smokeTestManagedBash)(bashPath, path.dirname(bashPath))

    const currentDir = path.join(root, CURRENT_DIR_NAME)
    const trashDir = path.join(root, `.trash-${Date.now()}`)
    if (fs.existsSync(currentDir)) {
      await fs.promises.rename(currentDir, trashDir)
    }
    await fs.promises.rename(stagingDir, currentDir)
    void fs.promises.rm(trashDir, { recursive: true, force: true }).catch(() => {})
    void fs.promises.rm(downloadPath, { force: true }).catch(() => {})

    resetPiBashRuntimeCache()
    const managed = getManagedBashInfo(root)
    if (!managed) {
      throw new Error('安装完成但未找到托管 bash 运行时。')
    }
    const resolution: PiBashRuntimeResolution = {
      available: true,
      source: 'managed',
      shellPath: managed.bashPath,
      binDir: managed.binDir,
      version: managed.version,
    }
    report({ phase: 'completed', message: 'bash 运行时已就绪。' })
    return resolution
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report({ phase: 'failed', message })
    throw error instanceof Error ? error : new Error(message)
  }
}

/** rg/fd 检索组件状态:Pi 托管 bin 目录或 PATH 上可用即视为就绪。 */
export function getSearchToolsStatus(): { rg: boolean; fd: boolean } {
  const probe = (binary: 'rg' | 'fd'): boolean => {
    try {
      const suffix = process.platform === 'win32' ? '.exe' : ''
      if (fs.existsSync(path.join(getAgentDir(), 'bin', `${binary}${suffix}`))) return true
    } catch {
      // SDK 目录探测失败继续查 PATH。
    }
    try {
      const command = process.platform === 'win32' ? 'where' : 'which'
      const result = spawnSync(command, [process.platform === 'win32' ? `${binary}.exe` : binary], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      })
      return result.status === 0 && Boolean(result.stdout.trim())
    } catch {
      return false
    }
  }
  return { rg: probe('rg'), fd: probe('fd') }
}
