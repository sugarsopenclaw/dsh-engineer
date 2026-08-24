import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import type {
  ProjectAlgorithmExportInput,
  ProjectArtifactEntry,
  ProjectArtifactKind,
  ProjectArtifactWriteResult,
  ProjectArtifactsListResult,
  ProjectDocxArtifactInput,
  ProjectExcelArtifactInput,
  ProjectExcelSheetInput,
  ProjectPptxArtifactInput,
  ProjectTextArtifactInput,
} from '../../../src/shared/local-agent'
import { getProjectSummary } from '../conversations/conversation-repository'
import { readCadAlgorithmExportBundle } from '../agent/algorithms/store'

const OUTPUT_ROOT_NAME = 'xiaoliang-outputs'
const MAX_ARTIFACTS = 500
const MAX_DEPTH = 8
const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_EXCEL_ROWS_PER_SHEET = 20_000
const MAX_EXCEL_SHEETS = 20
const ARTIFACT_WORKER_TIMEOUT_MS = 120_000
const ARTIFACT_WORKER_OUTPUT_LIMIT = 2 * 1024 * 1024
const TIMESTAMP_PATTERN = /\D/g
const SAFE_TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.txt', '.log', '.yaml', '.yml', '.xml', '.html', '.htm', '.toml', '.ini', '.cfg',
  '.sql', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss',
  '.sh', '.ps1', '.bat', '.cmd',
])

interface ProjectOutputRoot {
  projectId: string
  rootPath: string | null
  rootExists: boolean
  rootRealPath: string | null
  outputRootPath: string | null
  outputRootRealPath: string | null
  warning?: string | null
}

interface ResolvedArtifactTarget {
  root: ProjectOutputRoot
  relativePath: string
  absolutePath: string
  finalRelativePath: string
  finalAbsolutePath: string
  overwritten: boolean
  warning?: string | null
}

interface ArtifactWorkerLaunchSpec {
  command: string
  args: string[]
  label: string
}

interface ArtifactWorkerResponse {
  success?: boolean
  output_path?: string
  size_bytes?: number
  sheet_count?: number
  sheets?: Array<{ name?: string; rows?: number; columns?: number }>
  warnings?: string[]
  error?: string
  traceback?: string
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('操作已取消。')
  }
}

function timestampSuffix() {
  return new Date().toISOString().replace(TIMESTAMP_PATTERN, '').slice(0, 14)
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, '/')
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function rejectUnsafeRelativePath(rawPath: string) {
  const normalized = normalizeSlash(rawPath.trim()).replace(/^\/+/, '')
  const withoutOutputPrefix = normalized === OUTPUT_ROOT_NAME
    ? ''
    : normalized.startsWith(`${OUTPUT_ROOT_NAME}/`)
      ? normalized.slice(OUTPUT_ROOT_NAME.length + 1)
      : normalized

  if (!withoutOutputPrefix) {
    throw new Error('输出路径不能为空。')
  }
  if (path.isAbsolute(withoutOutputPrefix) || /^[a-zA-Z]:[\\/]/.test(withoutOutputPrefix)) {
    throw new Error('只允许写入项目产物目录内的相对路径。')
  }

  const segments = withoutOutputPrefix
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    throw new Error('输出路径不能为空。')
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.startsWith('.')) {
      throw new Error('输出路径包含不允许的目录片段。')
    }
    if (segment.startsWith('~$')) {
      throw new Error('输出路径不能使用临时文件名。')
    }
  }
  return segments.join('/')
}

function appendExtension(relativePath: string, extension: string) {
  const normalizedExtension = `.${extension.replace(/^\./, '').toLowerCase()}`
  const existingExtension = path.posix.extname(normalizeSlash(relativePath)).toLowerCase()
  const acceptedExtensions = normalizedExtension === '.md'
    ? new Set(['.md', '.markdown'])
    : normalizedExtension === '.txt'
      ? SAFE_TEXT_ARTIFACT_EXTENSIONS
    : new Set([normalizedExtension])
  if (existingExtension && !acceptedExtensions.has(existingExtension)) {
    throw new Error(`输出文件扩展名 ${existingExtension} 与目标格式 ${normalizedExtension} 不一致。`)
  }
  if (existingExtension) {
    return relativePath
  }
  return `${relativePath}${normalizedExtension}`
}

function withTimestamp(relativePath: string) {
  const parsed = path.posix.parse(relativePath)
  return path.posix.join(parsed.dir, `${parsed.name}-${timestampSuffix()}${parsed.ext}`)
}

function ensureKindFromExtension(relativePath: string, fallback: ProjectArtifactKind): ProjectArtifactKind {
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.json') return 'json'
  if (extension === '.csv') return 'csv'
  if (extension === '.txt') return 'text'
  if (extension === '.xlsx') return 'excel'
  if (extension === '.docx') return 'docx'
  if (extension === '.pptx') return 'pptx'
  if (extension === '.py') return 'algorithm'
  return fallback
}

function shouldIgnoreArtifactEntry(name: string) {
  const lower = name.toLowerCase()
  return name.startsWith('.') || name.startsWith('~$') || lower.endsWith('.tmp') || lower === 'thumbs.db'
}

async function getProjectOutputRoot(projectId: string, create = false): Promise<ProjectOutputRoot> {
  const project = getProjectSummary(projectId)
  if (!project) {
    return {
      projectId,
      rootPath: null,
      rootExists: false,
      rootRealPath: null,
      outputRootPath: null,
      outputRootRealPath: null,
      warning: `未找到项目: ${projectId}`,
    }
  }

  const rootPath = project.rootPath?.trim() || null
  if (!rootPath) {
    return {
      projectId: project.id,
      rootPath: null,
      rootExists: false,
      rootRealPath: null,
      outputRootPath: null,
      outputRootRealPath: null,
      warning: '当前项目尚未绑定本地资料与产物目录。请先在项目工作台绑定项目目录。',
    }
  }

  try {
    const stat = await fs.promises.stat(rootPath)
    if (!stat.isDirectory()) {
      return {
        projectId: project.id,
        rootPath,
        rootExists: false,
        rootRealPath: null,
        outputRootPath: null,
        outputRootRealPath: null,
        warning: '项目目录路径存在，但不是文件夹。',
      }
    }

    const rootRealPath = await fs.promises.realpath(rootPath)
    const outputRootPath = path.join(rootRealPath, OUTPUT_ROOT_NAME)
    if (create) {
      await fs.promises.mkdir(outputRootPath, { recursive: true })
    }

    let outputRootRealPath: string | null = null
    if (fs.existsSync(outputRootPath)) {
      const outputStat = await fs.promises.stat(outputRootPath)
      if (!outputStat.isDirectory()) {
        throw new Error(`${OUTPUT_ROOT_NAME} 已存在但不是文件夹。`)
      }
      outputRootRealPath = await fs.promises.realpath(outputRootPath)
      if (!isPathInsideRoot(rootRealPath, outputRootRealPath)) {
        throw new Error(`${OUTPUT_ROOT_NAME} 指向项目目录之外，已拒绝。`)
      }
    }

    return {
      projectId: project.id,
      rootPath,
      rootExists: true,
      rootRealPath,
      outputRootPath,
      outputRootRealPath,
      warning: null,
    }
  } catch (error) {
    return {
      projectId: project.id,
      rootPath,
      rootExists: false,
      rootRealPath: null,
      outputRootPath: null,
      outputRootRealPath: null,
      warning: `项目产物目录不可访问：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function resolveArtifactTarget(input: {
  projectId: string
  relativePath: string
  overwriteConfirmed?: boolean
}): Promise<ResolvedArtifactTarget> {
  const root = await getProjectOutputRoot(input.projectId, true)
  if (!root.rootExists || !root.outputRootRealPath) {
    throw new Error(root.warning || '项目产物目录不可访问。')
  }

  const relativePath = rejectUnsafeRelativePath(input.relativePath)
  const absolutePath = path.resolve(root.outputRootRealPath, relativePath.replace(/[\\/]+/g, path.sep))
  if (!isPathInsideRoot(root.outputRootRealPath, absolutePath)) {
    throw new Error('拒绝写入项目产物目录之外的位置。')
  }

  const parentDir = path.dirname(absolutePath)
  await fs.promises.mkdir(parentDir, { recursive: true })
  const parentRealPath = await fs.promises.realpath(parentDir)
  if (!isPathInsideRoot(root.outputRootRealPath, parentRealPath)) {
    throw new Error('输出目录指向项目产物目录之外，已拒绝。')
  }

  const exists = fs.existsSync(absolutePath)
  if (!exists || input.overwriteConfirmed) {
    return {
      root,
      relativePath,
      absolutePath,
      finalRelativePath: relativePath,
      finalAbsolutePath: absolutePath,
      overwritten: exists,
    }
  }

  const finalRelativePath = withTimestamp(relativePath)
  const finalAbsolutePath = path.resolve(root.outputRootRealPath, finalRelativePath.replace(/[\\/]+/g, path.sep))
  if (!isPathInsideRoot(root.outputRootRealPath, finalAbsolutePath)) {
    throw new Error('自动改名后的输出路径非法。')
  }
  return {
    root,
    relativePath,
    absolutePath,
    finalRelativePath,
    finalAbsolutePath,
    overwritten: false,
    warning: `目标文件已存在，已自动写入 ${path.posix.join(OUTPUT_ROOT_NAME, finalRelativePath)}。`,
  }
}

async function atomicWriteBuffer(targetPath: string, buffer: Buffer) {
  const directory = path.dirname(targetPath)
  await fs.promises.mkdir(directory, { recursive: true })
  const extension = path.extname(targetPath) || '.tmp'
  const tempPath = path.join(directory, `.tmp-xiaoliang-${process.pid}-${Date.now()}-${randomUUID()}${extension}`)
  try {
    await fs.promises.writeFile(tempPath, buffer)
    await fs.promises.rename(tempPath, targetPath)
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function resultFromTarget(
  target: ResolvedArtifactTarget,
  kind: ProjectArtifactKind,
  sizeBytes: number,
  warning?: string | null,
): ProjectArtifactWriteResult {
  return {
    projectId: target.root.projectId,
    rootPath: target.root.rootPath,
    outputRootPath: target.root.outputRootPath,
    path: path.posix.join(OUTPUT_ROOT_NAME, target.finalRelativePath),
    absolutePath: target.finalAbsolutePath,
    kind,
    created: !target.overwritten,
    overwritten: target.overwritten,
    sizeBytes,
    warning: [target.warning, warning].filter(Boolean).join('；') || null,
  }
}

function normalizeArrayRows(rows: unknown[][]) {
  return rows.map((row) => row.map((cell) => cell ?? ''))
}

function normalizeObjectRows(rows: ProjectExcelSheetInput['rows']) {
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return row.reduce<Record<string, unknown>>((record, cell, index) => {
        record[`列${index + 1}`] = cell ?? ''
        return record
      }, {})
    }
    if (row && typeof row === 'object') return row as Record<string, unknown>
    return { value: row ?? '' }
  })
}

function sheetName(input: string, index: number) {
  const normalized = input.trim().replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31)
  return normalized || `Sheet${index + 1}`
}

function validateExcelInput(input: ProjectExcelArtifactInput) {
  if (!Array.isArray(input.sheets) || input.sheets.length === 0) {
    throw new Error('Excel 产物至少需要一个 sheet。')
  }
  input.sheets.slice(0, MAX_EXCEL_SHEETS).forEach((sheet, index) => {
    const rawRows = sheet.rows ?? []
    if (!Array.isArray(rawRows)) {
      throw new Error(`Sheet ${sheet.name || index + 1} rows 必须是数组。`)
    }
    if (rawRows.length > MAX_EXCEL_ROWS_PER_SHEET) {
      throw new Error(`Sheet ${sheet.name || index + 1} 行数超过 ${MAX_EXCEL_ROWS_PER_SHEET}。`)
    }
  })
}

function buildBasicExcelBuffer(input: ProjectExcelArtifactInput) {
  const workbook = XLSX.utils.book_new()
  input.sheets.slice(0, MAX_EXCEL_SHEETS).forEach((sheet, index) => {
    const rawRows = sheet.rows ?? []
    const worksheet = rawRows.every((row) => Array.isArray(row))
      ? XLSX.utils.aoa_to_sheet(normalizeArrayRows(rawRows as unknown[][]))
      : XLSX.utils.json_to_sheet(normalizeObjectRows(rawRows))
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName(sheet.name, index))
  })
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    const metadataRows = Object.entries(input.metadata).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadataRows), 'metadata')
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function getProcessResourcesPath() {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
}

function uniquePaths(paths: string[]) {
  const seen = new Set<string>()
  return paths
    .map((item) => path.resolve(item))
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function artifactWorkerLaunchSpecs(): ArtifactWorkerLaunchSpec[] {
  const cwd = process.cwd()
  const resourcesPath = getProcessResourcesPath()
  const workerRoots = uniquePaths([
    resourcesPath ? path.join(resourcesPath, 'project-files', 'python') : '',
    path.join(cwd, 'electron', 'runtime', 'project-files', 'python'),
    path.join(cwd, 'dev', 'frontend', 'electron', 'runtime', 'project-files', 'python'),
  ].filter(Boolean))

  const specs: ArtifactWorkerLaunchSpec[] = []
  for (const root of workerRoots) {
    const exePath = path.join(root, 'packaged-bin', 'artifact_worker.exe')
    if (process.platform === 'win32' && fs.existsSync(exePath)) {
      specs.push({
        command: exePath,
        args: [],
        label: `artifact_worker.exe (${exePath})`,
      })
    }
  }

  const pythonCandidates: Array<{ command: string; prefixArgs: string[]; label: string }> = [
    process.env.XIAOLIANG_ARTIFACT_PYTHON_PATH
      ? {
          command: process.env.XIAOLIANG_ARTIFACT_PYTHON_PATH,
          prefixArgs: [],
          label: 'XIAOLIANG_ARTIFACT_PYTHON_PATH',
        }
      : null,
    process.env.ARTIFACT_PYTHON_PATH
      ? {
          command: process.env.ARTIFACT_PYTHON_PATH,
          prefixArgs: [],
          label: 'ARTIFACT_PYTHON_PATH',
        }
      : null,
    process.env.PYTHON_PATH
      ? {
          command: process.env.PYTHON_PATH,
          prefixArgs: [],
          label: 'PYTHON_PATH',
        }
      : null,
    { command: 'py', prefixArgs: ['-3'], label: 'py -3' },
    { command: 'python', prefixArgs: [], label: 'python' },
  ].filter(Boolean) as Array<{ command: string; prefixArgs: string[]; label: string }>

  for (const root of workerRoots) {
    const scriptPath = path.join(root, 'artifact_worker.py')
    if (!fs.existsSync(scriptPath)) continue
    for (const python of pythonCandidates) {
      specs.push({
        command: python.command,
        args: [...python.prefixArgs, '-I', '-B', '-X', 'utf8', scriptPath],
        label: `${python.label} (${scriptPath})`,
      })
    }
  }
  return specs
}

function parseWorkerResponse(stdout: string): ArtifactWorkerResponse {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const rawJson = lines[lines.length - 1]
  if (!rawJson) {
    throw new Error('worker 未返回 JSON。')
  }
  return JSON.parse(rawJson) as ArtifactWorkerResponse
}

function runArtifactWorker(
  spec: ArtifactWorkerLaunchSpec,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ArtifactWorkerResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const done = (response: ArtifactWorkerResponse) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }
    const onAbort = () => {
      child.kill()
      fail(new Error('操作已取消。'))
    }
    const timeout = setTimeout(() => {
      child.kill()
      fail(new Error(`Python 文档 worker 超时（${Math.round(ARTIFACT_WORKER_TIMEOUT_MS / 1000)} 秒）。`))
    }, ARTIFACT_WORKER_TIMEOUT_MS)

    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      fail(new Error(`${spec.label}: ${error.message}`))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
      if (stdout.length > ARTIFACT_WORKER_OUTPUT_LIMIT) {
        child.kill()
        fail(new Error(`${spec.label}: worker 输出过大。`))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
      if (stderr.length > ARTIFACT_WORKER_OUTPUT_LIMIT) {
        stderr = stderr.slice(-ARTIFACT_WORKER_OUTPUT_LIMIT)
      }
    })
    child.on('close', (code) => {
      if (settled) return
      let response: ArtifactWorkerResponse | null = null
      try {
        response = stdout.trim() ? parseWorkerResponse(stdout) : null
      } catch {
        response = null
      }
      if (code !== 0) {
        const message = response?.error || stderr.trim() || `worker 退出码 ${code}`
        fail(new Error(`${spec.label}: ${message}`))
        return
      }
      try {
        response = response || parseWorkerResponse(stdout)
        if (!response.success) {
          throw new Error(response.error || 'worker 返回失败。')
        }
        done(response)
      } catch (error) {
        fail(new Error(`${spec.label}: ${error instanceof Error ? error.message : String(error)}`))
      }
    })

    try {
      child.stdin.end(JSON.stringify(payload))
    } catch (error) {
      child.kill()
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function runArtifactWorkerWithFallback(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ArtifactWorkerResponse> {
  const specs = artifactWorkerLaunchSpecs()
  if (specs.length === 0) {
    throw new Error('未找到 Python 文档 worker。')
  }

  const errors: string[] = []
  for (const spec of specs) {
    throwIfAborted(signal)
    try {
      return await runArtifactWorker(spec, payload, signal)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(errors.slice(0, 3).join('；') || 'Python 文档 worker 执行失败。')
}

function tempPathForTarget(targetPath: string) {
  const parsed = path.parse(targetPath)
  const extension = parsed.ext || '.xlsx'
  return path.join(parsed.dir, `.tmp-xiaoliang-${process.pid}-${Date.now()}-${randomUUID()}${extension}`)
}

async function writeExcelWithPythonWorker(
  target: ResolvedArtifactTarget,
  input: ProjectExcelArtifactInput,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number; warning?: string | null }> {
  const tempPath = tempPathForTarget(target.finalAbsolutePath)
  try {
    const response = await runArtifactWorkerWithFallback({
      action: 'write_excel',
      output_path: tempPath,
      sheets: input.sheets,
      metadata: input.metadata ?? null,
    }, signal)
    const stat = await fs.promises.stat(tempPath)
    await fs.promises.rename(tempPath, target.finalAbsolutePath)
    return {
      sizeBytes: typeof response.size_bytes === 'number' && Number.isFinite(response.size_bytes)
        ? response.size_bytes
        : stat.size,
      warning: Array.isArray(response.warnings) && response.warnings.length > 0
        ? response.warnings.filter(Boolean).join('；')
        : null,
    }
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function validateDocxInput(input: ProjectDocxArtifactInput) {
  if (!input.title?.trim()) throw new Error('DOCX 产物必须提供 title。')
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error('DOCX 产物至少需要一个 block。')
  }
  if (input.blocks.length > 300) throw new Error('DOCX blocks 不能超过 300 个。')
}

function validatePptxInput(input: ProjectPptxArtifactInput) {
  if (!input.title?.trim()) throw new Error('PPTX 产物必须提供 title。')
  if (!Array.isArray(input.slides) || input.slides.length === 0) {
    throw new Error('PPTX 产物至少需要一页 slide。')
  }
  if (input.slides.length > 80) throw new Error('PPTX slides 不能超过 80 页。')
}

async function writeOfficeWithPythonWorker(
  target: ResolvedArtifactTarget,
  action: 'write_docx' | 'write_pptx',
  input: ProjectDocxArtifactInput | ProjectPptxArtifactInput,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number; warning?: string | null }> {
  const tempPath = tempPathForTarget(target.finalAbsolutePath)
  try {
    const response = await runArtifactWorkerWithFallback({
      ...input,
      action,
      output_path: tempPath,
    }, signal)
    const stat = await fs.promises.stat(tempPath)
    await fs.promises.rename(tempPath, target.finalAbsolutePath)
    return {
      sizeBytes: typeof response.size_bytes === 'number' && Number.isFinite(response.size_bytes)
        ? response.size_bytes
        : stat.size,
      warning: Array.isArray(response.warnings) && response.warnings.length > 0
        ? response.warnings.filter(Boolean).join('；')
        : null,
    }
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function artifactEntryFromStat(rootRealPath: string, absolutePath: string, stat: fs.Stats): ProjectArtifactEntry {
  const name = path.basename(absolutePath)
  const relative = normalizeSlash(path.relative(rootRealPath, absolutePath))
  const extension = path.extname(name).toLowerCase()
  return {
    path: path.posix.join(OUTPUT_ROOT_NAME, relative),
    name,
    extension,
    kind: ensureKindFromExtension(relative, 'other'),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

export class ProjectArtifactService {
  async listArtifacts(projectId: string, signal?: AbortSignal): Promise<ProjectArtifactsListResult> {
    const root = await getProjectOutputRoot(projectId, false)
    const artifacts: ProjectArtifactEntry[] = []
    let truncated = false

    if (!root.rootExists || !root.outputRootPath) {
      return {
        projectId: root.projectId,
        rootPath: root.rootPath,
        outputRootPath: root.outputRootPath,
        rootExists: root.rootExists,
        artifacts,
        artifactCount: 0,
        truncated: false,
        warning: root.warning,
      }
    }

    if (!root.outputRootRealPath) {
      return {
        projectId: root.projectId,
        rootPath: root.rootPath,
        outputRootPath: root.outputRootPath,
        rootExists: true,
        artifacts,
        artifactCount: 0,
        truncated: false,
        warning: '项目产物目录尚未创建。',
      }
    }

    const walk = async (directory: string, depth: number): Promise<void> => {
      throwIfAborted(signal)
      if (truncated) return
      if (depth > MAX_DEPTH) return
      const entries = await fs.promises.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        throwIfAborted(signal)
        if (truncated) return
        if (shouldIgnoreArtifactEntry(entry.name)) continue
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(absolutePath, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        const realPath = await fs.promises.realpath(absolutePath)
        if (!isPathInsideRoot(root.outputRootRealPath!, realPath)) continue
        const stat = await fs.promises.stat(realPath)
        artifacts.push(artifactEntryFromStat(root.outputRootRealPath!, realPath, stat))
        if (artifacts.length >= MAX_ARTIFACTS) {
          truncated = true
          return
        }
      }
    }

    await walk(root.outputRootRealPath, 0)
    artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return {
      projectId: root.projectId,
      rootPath: root.rootPath,
      outputRootPath: root.outputRootPath,
      rootExists: true,
      artifacts,
      artifactCount: artifacts.length,
      truncated,
      warning: truncated ? `项目产物较多，仅列出前 ${MAX_ARTIFACTS} 个文件。` : null,
    }
  }

  async writeText(
    projectId: string,
    input: ProjectTextArtifactInput,
    signal?: AbortSignal,
  ): Promise<ProjectArtifactWriteResult> {
    throwIfAborted(signal)
    const kind = input.kind ?? ensureKindFromExtension(input.path, 'text')
    const relativePath = appendExtension(input.path, kind === 'json' ? 'json' : kind === 'csv' ? 'csv' : kind === 'markdown' ? 'md' : 'txt')
    const buffer = Buffer.from(input.content, 'utf-8')
    if (buffer.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`文本产物超过 ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)}MB，已拒绝写入。`)
    }
    const target = await resolveArtifactTarget({
      projectId,
      relativePath,
      overwriteConfirmed: input.overwrite_confirmed,
    })
    await atomicWriteBuffer(target.finalAbsolutePath, buffer)
    return resultFromTarget(target, kind, buffer.byteLength)
  }

  async writeExcel(
    projectId: string,
    input: ProjectExcelArtifactInput,
    signal?: AbortSignal,
  ): Promise<ProjectArtifactWriteResult> {
    throwIfAborted(signal)
    validateExcelInput(input)
    const target = await resolveArtifactTarget({
      projectId,
      relativePath: appendExtension(input.path, 'xlsx'),
      overwriteConfirmed: input.overwrite_confirmed,
    })

    try {
      const pythonResult = await writeExcelWithPythonWorker(target, input, signal)
      return resultFromTarget(target, 'excel', pythonResult.sizeBytes, pythonResult.warning)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn('[project-artifact] Python Excel worker unavailable, falling back to JS xlsx:', reason)
      const buffer = buildBasicExcelBuffer(input)
      await atomicWriteBuffer(target.finalAbsolutePath, buffer)
      return resultFromTarget(
        target,
        'excel',
        buffer.byteLength,
        `Python Excel worker 不可用，已使用基础 XLSX 写入：${reason}`,
      )
    }
  }

  async writeDocx(
    projectId: string,
    input: ProjectDocxArtifactInput,
    signal?: AbortSignal,
  ): Promise<ProjectArtifactWriteResult> {
    throwIfAborted(signal)
    validateDocxInput(input)
    const target = await resolveArtifactTarget({
      projectId,
      relativePath: appendExtension(input.path, 'docx'),
      overwriteConfirmed: input.overwrite_confirmed,
    })
    const workerResult = await writeOfficeWithPythonWorker(target, 'write_docx', input, signal)
    return resultFromTarget(target, 'docx', workerResult.sizeBytes, workerResult.warning)
  }

  async writePptx(
    projectId: string,
    input: ProjectPptxArtifactInput,
    signal?: AbortSignal,
  ): Promise<ProjectArtifactWriteResult> {
    throwIfAborted(signal)
    validatePptxInput(input)
    const target = await resolveArtifactTarget({
      projectId,
      relativePath: appendExtension(input.path, 'pptx'),
      overwriteConfirmed: input.overwrite_confirmed,
    })
    const workerResult = await writeOfficeWithPythonWorker(target, 'write_pptx', input, signal)
    return resultFromTarget(target, 'pptx', workerResult.sizeBytes, workerResult.warning)
  }

  async exportAlgorithm(
    projectId: string,
    input: ProjectAlgorithmExportInput,
    signal?: AbortSignal,
  ): Promise<ProjectArtifactWriteResult[]> {
    throwIfAborted(signal)
    const bundle = readCadAlgorithmExportBundle({
      algorithmSlug: input.algorithm_slug,
      source: input.source ?? 'saved',
    })
    const targetDir = rejectUnsafeRelativePath(
      input.target_dir?.trim() || path.posix.join('algorithms', bundle.slug),
    )
    const root = await getProjectOutputRoot(projectId, true)
    if (!root.rootExists || !root.outputRootRealPath) {
      throw new Error(root.warning || '项目产物目录不可访问。')
    }

    const hasConflict = bundle.files.some((file) =>
      fs.existsSync(path.join(root.outputRootRealPath!, targetDir, file.name)),
    )
    const finalTargetDir = hasConflict && !input.overwrite_confirmed
      ? `${targetDir}-${timestampSuffix()}`
      : targetDir

    const results: ProjectArtifactWriteResult[] = []
    for (const file of bundle.files) {
      throwIfAborted(signal)
      const target = await resolveArtifactTarget({
        projectId,
        relativePath: path.posix.join(finalTargetDir, file.name),
        overwriteConfirmed: input.overwrite_confirmed,
      })
      const buffer = await fs.promises.readFile(file.path)
      await atomicWriteBuffer(target.finalAbsolutePath, buffer)
      results.push(resultFromTarget(
        target,
        file.name === 'calculator.py' ? 'algorithm' : 'json',
        buffer.byteLength,
        hasConflict && !input.overwrite_confirmed
          ? `目标算法目录已存在，已自动导出到 ${path.posix.join(OUTPUT_ROOT_NAME, finalTargetDir)}。`
          : null,
      ))
    }
    return results
  }
}
