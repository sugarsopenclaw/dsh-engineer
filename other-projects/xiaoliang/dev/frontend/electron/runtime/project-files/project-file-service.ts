import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import * as XLSX from 'xlsx'
import type {
  ProjectDirectoryEntry,
  ProjectFileEntry,
  ProjectFileKind,
  ProjectFilePreviewResult,
  ProjectFileReadResult,
  ProjectFileSourceFilter,
  ProjectFilesListResult,
  ProjectFileSearchMatch,
  ProjectFilesSearchResult,
  ProjectContextIndexEntry,
  ProjectPreviewDirectoryResult,
  ProjectPreviewMode,
  ProjectSpreadsheetPreviewSheet,
} from '../../../src/shared/local-agent'
import { getProjectSummary } from '../conversations/conversation-repository'
import { validateProjectOoxmlPreview } from './project-preview-validator'

const MAX_SCAN_FILES = 500
const MAX_SCAN_DIRECTORIES = 500
const MAX_SCAN_DEPTH = 6
const MAX_ARTIFACT_SCAN_DEPTH = 8
const MAX_LOCAL_FILE_BYTES = 25 * 1024 * 1024
const MAX_CLOUD_DOCUMENT_BYTES = 150 * 1024 * 1024
const DEFAULT_MAX_CHARS = 40_000
const SEARCH_MIN_BYTES_PER_FILE = 16 * 1024
const SEARCH_MAX_BYTES_PER_FILE = 2 * 1024 * 1024
const SEARCH_MAX_TOTAL_BYTES = 32 * 1024 * 1024
const SEARCH_READ_CHUNK_BYTES = 64 * 1024
const SEARCH_SNIPPET_CONTEXT_CHARS = 220
const CONTEXT_INDEX_RELATIVE_PATH = '.xiaoliang/project-index.json'
const MAX_PREVIEW_DIRECTORY_ENTRIES = 1_000
const TEXT_PREVIEW_CHUNK_BYTES = 256 * 1024
const MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_PDF_PREVIEW_BYTES = 32 * 1024 * 1024
const MAX_OFFICE_PREVIEW_BYTES = 15 * 1024 * 1024
/** Drawings stream over loopback rather than through IPC, so the cap guards parser memory. */
const MAX_CAD_PREVIEW_BYTES = 128 * 1024 * 1024
const MAX_PREVIEW_SHEETS = 8
const MAX_PREVIEW_ROWS_PER_SHEET = 160
const MAX_PREVIEW_COLUMNS_PER_SHEET = 40
const MAX_PREVIEW_CELLS = 40_000
const MAX_PREVIEW_CELL_CHARS = 500

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'release',
  'coverage',
  '__pycache__',
])

const SUPPORTED_KIND_BY_EXTENSION: Record<string, ProjectFileKind> = {
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.jsonl': 'json',
  '.yaml': 'text',
  '.yml': 'text',
  '.toml': 'text',
  '.ini': 'text',
  '.cfg': 'text',
  '.xml': 'text',
  '.html': 'text',
  '.htm': 'text',
  '.css': 'text',
  '.scss': 'text',
  '.less': 'text',
  '.js': 'text',
  '.mjs': 'text',
  '.cjs': 'text',
  '.ts': 'text',
  '.tsx': 'text',
  '.jsx': 'text',
  '.py': 'text',
  '.pyi': 'text',
  '.sql': 'text',
  '.sh': 'text',
  '.ps1': 'text',
  '.bat': 'text',
  '.cmd': 'text',
  '.log': 'text',
  '.doc': 'document',
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.xls': 'document',
  '.xlsx': 'xlsx',
  '.ppt': 'document',
  '.pptx': 'document',
  '.epub': 'document',
  '.mobi': 'document',
  '.dwg': 'cad',
  '.dxf': 'cad',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image',
}

const CLOUD_DOCUMENT_KINDS = new Set<ProjectFileKind>([
  'document',
  'docx',
  'pdf',
  'xlsx',
  'image',
])

interface ProjectRootInfo {
  projectId: string
  rootPath: string | null
  rootExists: boolean
  rootRealPath: string | null
  warning?: string | null
}

interface ResolvedProjectFile {
  root: ProjectRootInfo
  absolutePath: string
  relativePath: string
  stat: fs.Stats
}

export interface ProjectResolvedFile extends ProjectFileEntry {
  projectId: string
  rootPath: string | null
  absolutePath: string
}

interface ProjectFileExtractOptions {
  pageRange?: string
  sheetNames?: string[]
  maxRowsPerSheet?: number
  maxColsPerSheet?: number
  includeFormulas?: boolean
  signal?: AbortSignal
}

export interface ProjectFilesListOptions {
  path?: string
  depth?: number
  source?: ProjectFileSourceFilter
  sort?: 'path' | 'modified_desc'
  limit?: number
  cursor?: string
}

export interface ProjectCloudDocumentReadInput extends ProjectFileExtractOptions {
  projectId: string
  relativePath: string
  absolutePath: string
  sizeBytes: number
  modifiedAt: string
  instruction?: string
  maxChars: number
}

export interface ProjectCloudDocumentReadResult {
  content: string
  parser: string
  warning: string | null
  metadata: Record<string, unknown>
  truncated: boolean
}

export type ProjectCloudDocumentReader = (
  input: ProjectCloudDocumentReadInput,
) => Promise<ProjectCloudDocumentReadResult>

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('操作已取消。')
  }
}

function kindForExtension(extension: string): ProjectFileKind {
  return SUPPORTED_KIND_BY_EXTENSION[extension.toLowerCase()] ?? 'unsupported'
}

function isSupportedKind(kind: ProjectFileKind) {
  return kind !== 'unsupported'
}

function previewModeForKind(kind: ProjectFileKind): ProjectPreviewMode {
  if (kind === 'markdown') return 'markdown'
  if (kind === 'text' || kind === 'json') return 'text'
  if (kind === 'csv' || kind === 'xlsx') return 'spreadsheet'
  if (kind === 'image' || kind === 'pdf' || kind === 'docx' || kind === 'cad') return kind
  return 'unsupported'
}

function normalizeProjectPreviewPath(value: string, allowEmpty: boolean) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    if (allowEmpty) return ''
    throw new Error('文件路径不能为空。')
  }
  if (raw.length > 2_048 || raw.includes('\0')) {
    throw new Error('项目相对路径无效。')
  }
  const normalized = raw.replace(/\\/g, '/')
  if (
    normalized.startsWith('/')
    || /^[a-zA-Z]:/.test(normalized)
    || path.isAbsolute(normalized)
  ) {
    throw new Error('只允许访问项目目录内的相对路径。')
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('项目路径必须是规范的相对路径。')
  }
  return segments.join('/')
}

function shouldIgnoreDir(name: string) {
  return name.startsWith('.') || IGNORED_DIR_NAMES.has(name.toLowerCase())
}

function shouldIgnoreFile(name: string) {
  return name.startsWith('.') || name.startsWith('~$') || name.endsWith('.tmp')
}

function shouldIgnorePreviewDir(name: string) {
  return IGNORED_DIR_NAMES.has(name.toLowerCase())
}

function shouldIgnorePreviewFile(name: string) {
  return name.startsWith('~$') || name.endsWith('.tmp')
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/')
}

function normalizeScopePath(value?: string) {
  const normalized = normalizeRelativePath(value?.trim() || '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+|\/+$/g, '')
  return normalized === '.' ? '' : normalized
}

function inferFileSource(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase()
  return normalized === 'xiaoliang-outputs' || normalized.startsWith('xiaoliang-outputs/')
    ? 'artifact' as const
    : 'user' as const
}

function matchesSource(relativePath: string, source: ProjectFileSourceFilter) {
  return source === 'all' || inferFileSource(relativePath) === source
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function sameFilesystemPath(left: string, right: string) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function clipContent(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return { content, truncated: false }
  }
  return {
    content: `${content.slice(0, Math.max(0, maxChars - 80))}\n\n[内容过长，已截断。]`,
    truncated: true,
  }
}

function compactSnippet(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function encodeListCursor(input: {
  projectId: string
  offset: number
  scopePath: string
  depth: number
  source: ProjectFileSourceFilter
  sort: 'path' | 'modified_desc'
}) {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')
}

function decodeListCursor(
  cursor: string | undefined,
  expected: {
    projectId: string
    scopePath: string
    depth: number
    source: ProjectFileSourceFilter
    sort: 'path' | 'modified_desc'
  },
) {
  if (!cursor?.trim()) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor.trim(), 'base64url').toString('utf8')) as {
      offset?: unknown
      projectId?: unknown
      scopePath?: unknown
      depth?: unknown
      source?: unknown
      sort?: unknown
    }
    if (
      !Number.isInteger(parsed.offset)
      || Number(parsed.offset) < 0
      || parsed.projectId !== expected.projectId
      || parsed.scopePath !== expected.scopePath
      || parsed.depth !== expected.depth
      || parsed.source !== expected.source
      || parsed.sort !== expected.sort
    ) {
      throw new Error('mismatch')
    }
    return Number(parsed.offset)
  } catch {
    throw new Error('项目文件列表 cursor 无效，或与当前 path/depth/source/sort 不匹配。')
  }
}

function globPatternToRegExp(pattern: string) {
  const normalized = normalizeRelativePath(pattern.trim())
  if (!normalized) return null
  if (normalized.length > 200) {
    throw new Error('glob 不能超过 200 个字符。')
  }
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`, 'i')
}

function fileEntryFromStat(rootRealPath: string, absolutePath: string, stat: fs.Stats): ProjectFileEntry {
  const name = path.basename(absolutePath)
  const extension = path.extname(name).toLowerCase()
  const kind = kindForExtension(extension)
  const relativePath = normalizeRelativePath(path.relative(rootRealPath, absolutePath))
  return {
    path: relativePath,
    name,
    extension,
    kind,
    supported: isSupportedKind(kind),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    source: inferFileSource(relativePath),
  }
}

async function readContextIndex(root: ProjectRootInfo) {
  const result = new Map<string, ProjectContextIndexEntry>()
  if (!root.rootExists || !root.rootRealPath) return result
  try {
    const indexPath = path.join(root.rootRealPath, CONTEXT_INDEX_RELATIVE_PATH)
    const realPath = await fs.promises.realpath(indexPath)
    if (!isPathInsideRoot(root.rootRealPath, realPath)) return result
    const raw = await fs.promises.readFile(realPath, 'utf-8')
    const parsed = JSON.parse(raw) as { entries?: unknown[] }
    for (const item of parsed.entries ?? []) {
      const entry = item as Partial<ProjectContextIndexEntry>
      if (!entry.path || typeof entry.path !== 'string') continue
      result.set(normalizeRelativePath(entry.path), {
        path: normalizeRelativePath(entry.path),
        name: String(entry.name || path.basename(entry.path)),
        extension: String(entry.extension || path.extname(entry.path)),
        kind: String(entry.kind || 'unsupported'),
        supported: Boolean(entry.supported),
        sizeBytes: Number(entry.sizeBytes || 0),
        modifiedAt: String(entry.modifiedAt || ''),
        title: String(entry.title || path.basename(entry.path)),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        description: String(entry.description || ''),
        source: entry.source === 'artifact' ? 'artifact' : 'user',
      })
    }
  } catch {
    // Index is optional; fall back to live filesystem scan.
  }
  return result
}

function enrichFileEntry(file: ProjectFileEntry, metadata?: ProjectContextIndexEntry): ProjectFileEntry {
  if (!metadata) return file
  return {
    ...file,
    title: metadata.title,
    tags: metadata.tags,
    description: metadata.description,
    source: metadata.source,
  }
}

async function getProjectRoot(projectId: string): Promise<ProjectRootInfo> {
  const project = getProjectSummary(projectId)
  if (!project) {
    return {
      projectId,
      rootPath: null,
      rootExists: false,
      rootRealPath: null,
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
      warning: '当前项目尚未绑定本地资料目录。请先在项目工作台绑定项目目录。',
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
        warning: '项目目录路径存在，但不是文件夹。',
      }
    }

    return {
      projectId: project.id,
      rootPath,
      rootExists: true,
      rootRealPath: await fs.promises.realpath(rootPath),
      warning: null,
    }
  } catch (error) {
    return {
      projectId: project.id,
      rootPath,
      rootExists: false,
      rootRealPath: null,
      warning: `项目目录不可访问：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function resolveProjectDirectory(root: ProjectRootInfo, scopePath: string) {
  if (!root.rootExists || !root.rootRealPath) {
    throw new Error(root.warning || '项目目录不可访问。')
  }
  if (path.isAbsolute(scopePath) || /^[a-zA-Z]:[\\/]/.test(scopePath)) {
    throw new Error('只允许列出项目目录内的相对路径。')
  }
  const candidate = path.resolve(root.rootRealPath, scopePath.replace(/[\\/]+/g, path.sep))
  let realPath: string
  try {
    realPath = await fs.promises.realpath(candidate)
  } catch {
    throw new Error(`项目目录不存在：${scopePath || '.'}`)
  }
  if (!isPathInsideRoot(root.rootRealPath, realPath)) {
    throw new Error('拒绝列出项目目录之外的位置。')
  }
  const stat = await fs.promises.stat(realPath)
  if (!stat.isDirectory()) {
    throw new Error(`项目路径不是目录：${scopePath || '.'}`)
  }
  return realPath
}

async function resolveProjectFile(
  projectId: string,
  relativePath: string,
): Promise<ResolvedProjectFile> {
  const root = await getProjectRoot(projectId)
  return resolveProjectFileFromRoot(root, relativePath)
}

async function resolveProjectFileFromRoot(
  root: ProjectRootInfo,
  relativePath: string,
): Promise<ResolvedProjectFile> {
  if (!root.rootExists || !root.rootRealPath) {
    throw new Error(root.warning || '项目目录不可访问。')
  }

  const normalizedInput = relativePath.trim()
  if (!normalizedInput) {
    throw new Error('文件路径不能为空。')
  }
  if (path.isAbsolute(normalizedInput)) {
    throw new Error('只允许读取项目目录内的相对路径。')
  }

  const candidatePath = path.resolve(root.rootRealPath, normalizedInput.replace(/[\\/]+/g, path.sep))
  let realPath: string
  try {
    realPath = await fs.promises.realpath(candidatePath)
  } catch {
    throw new Error(`项目文件不存在：${relativePath}`)
  }

  if (!isPathInsideRoot(root.rootRealPath, realPath)) {
    throw new Error('拒绝读取项目目录之外的文件。')
  }

  const stat = await fs.promises.stat(realPath)
  if (!stat.isFile()) {
    throw new Error('只允许读取普通文件。')
  }

  return {
    root,
    absolutePath: realPath,
    relativePath: normalizeRelativePath(path.relative(root.rootRealPath, realPath)),
    stat,
  }
}

async function resolveProjectPreviewDirectory(root: ProjectRootInfo, relativePath: string) {
  if (!root.rootExists || !root.rootRealPath) {
    throw new Error(root.warning || '项目目录不可访问。')
  }
  const normalizedPath = normalizeProjectPreviewPath(relativePath, true)
  let candidatePath = root.rootRealPath
  for (const segment of normalizedPath ? normalizedPath.split('/') : []) {
    candidatePath = path.join(candidatePath, segment)
    const entry = await fs.promises.lstat(candidatePath).catch(() => null)
    if (!entry) throw new Error(`项目目录不存在：${normalizedPath}`)
    if (entry.isSymbolicLink()) throw new Error('文件预览不允许经过符号链接。')
    if (!entry.isDirectory()) throw new Error(`项目路径不是目录：${normalizedPath}`)
  }
  const realPath = await fs.promises.realpath(candidatePath)
  if (!isPathInsideRoot(root.rootRealPath, realPath)) {
    throw new Error('拒绝列出项目目录之外的位置。')
  }
  return { normalizedPath, realPath }
}

async function resolveProjectPreviewFile(
  projectId: string,
  relativePath: string,
): Promise<ResolvedProjectFile> {
  const root = await getProjectRoot(projectId)
  if (!root.rootExists || !root.rootRealPath) {
    throw new Error(root.warning || '项目目录不可访问。')
  }
  const normalizedPath = normalizeProjectPreviewPath(relativePath, false)
  let candidatePath = root.rootRealPath
  const segments = normalizedPath.split('/')
  for (const [index, segment] of segments.entries()) {
    candidatePath = path.join(candidatePath, segment)
    const entry = await fs.promises.lstat(candidatePath).catch(() => null)
    if (!entry) throw new Error(`项目文件不存在：${normalizedPath}`)
    if (entry.isSymbolicLink()) throw new Error('文件预览不允许经过符号链接。')
    if (index < segments.length - 1 && !entry.isDirectory()) {
      throw new Error(`项目路径不是目录：${segments.slice(0, index + 1).join('/')}`)
    }
    if (index === segments.length - 1 && !entry.isFile()) {
      throw new Error('只允许预览普通文件。')
    }
  }
  const realPath = await fs.promises.realpath(candidatePath)
  if (!isPathInsideRoot(root.rootRealPath, realPath)) {
    throw new Error('拒绝读取项目目录之外的文件。')
  }
  const stat = await fs.promises.stat(realPath)
  return {
    root,
    absolutePath: realPath,
    relativePath: normalizeRelativePath(path.relative(root.rootRealPath, realPath)),
    stat,
  }
}

function sameOpenedFile(expected: fs.Stats, actual: fs.Stats) {
  if (expected.dev && expected.ino && actual.dev && actual.ino) {
    return expected.dev === actual.dev && expected.ino === actual.ino
  }
  return expected.size === actual.size && expected.mtimeMs === actual.mtimeMs
}

function sameOpenedSnapshot(expected: fs.Stats, actual: fs.Stats) {
  return sameOpenedFile(expected, actual)
    && expected.size === actual.size
    && expected.mtimeMs === actual.mtimeMs
}

async function assertOpenedSnapshotUnchanged(
  handle: fs.promises.FileHandle,
  expected: fs.Stats,
) {
  const actual = await handle.stat()
  if (!sameOpenedSnapshot(expected, actual)) {
    throw new Error('文件在预览读取期间发生变化，请刷新后重试。')
  }
}

async function readOpenedFileBounded(
  handle: fs.promises.FileHandle,
  expected: fs.Stats,
  maxBytes: number,
) {
  if (expected.size > maxBytes) {
    throw new Error(`文件超过 ${maxBytes / 1024 / 1024}MB，已拒绝在界面中加载。`)
  }

  // Allocate from the opened snapshot, plus one byte to detect in-place growth.
  // This keeps a concurrently growing file from turning readFile() into an
  // unbounded main-process allocation.
  const buffer = Buffer.allocUnsafe(expected.size + 1)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const read = await handle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      bytesRead,
    )
    if (read.bytesRead === 0) break
    bytesRead += read.bytesRead
  }

  await assertOpenedSnapshotUnchanged(handle, expected)
  if (bytesRead !== expected.size || bytesRead > maxBytes) {
    throw new Error('文件在预览读取期间发生变化，请刷新后重试。')
  }
  return buffer.subarray(0, bytesRead)
}

async function readUtf8PreviewChunk(
  handle: fs.promises.FileHandle,
  sizeBytes: number,
  requestedOffset: number,
) {
  const previewSizeBytes = Math.min(sizeBytes, MAX_TEXT_PREVIEW_BYTES)
  if (
    !Number.isSafeInteger(requestedOffset)
    || requestedOffset < 0
    || requestedOffset > previewSizeBytes
  ) {
    throw new Error('文本预览 offset 无效。')
  }
  if (requestedOffset === previewSizeBytes) {
    return {
      content: '',
      offset: requestedOffset,
      nextOffset: null,
      truncated: requestedOffset < sizeBytes,
      limitReached: requestedOffset < sizeBytes,
    }
  }

  const requestedBytes = Math.min(TEXT_PREVIEW_CHUNK_BYTES, previewSizeBytes - requestedOffset)
  const buffer = Buffer.allocUnsafe(requestedBytes)
  const { bytesRead } = await handle.read(buffer, 0, requestedBytes, requestedOffset)
  const chunk = buffer.subarray(0, bytesRead)
  let decoded: string | null = null
  let consumedBytes = bytesRead
  const minimumLength = Math.max(0, bytesRead - 3)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let length = bytesRead; length >= minimumLength; length -= 1) {
    try {
      decoded = decoder.decode(chunk.subarray(0, length))
      consumedBytes = length
      break
    } catch {
      // A UTF-8 character may straddle the byte window. Back up at most three bytes.
    }
  }
  if (decoded === null || (consumedBytes === 0 && bytesRead > 0)) {
    throw new Error('文件不是有效的 UTF-8 文本，无法安全预览。')
  }
  if (decoded.includes('\0')) {
    throw new Error('文件包含二进制内容，无法作为文本预览。')
  }
  if (requestedOffset === 0) decoded = decoded.replace(/^\uFEFF/, '')
  const nextOffset = requestedOffset + consumedBytes
  const limitReached = requestedOffset + bytesRead >= previewSizeBytes && previewSizeBytes < sizeBytes
  return {
    content: decoded,
    offset: requestedOffset,
    nextOffset: !limitReached && nextOffset < previewSizeBytes ? nextOffset : null,
    truncated: nextOffset < sizeBytes,
    limitReached,
  }
}

function imagePreviewMime(extension: string, buffer: Buffer) {
  if (
    extension === '.png'
    && buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png'
  if (
    (extension === '.jpg' || extension === '.jpeg')
    && buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) return 'image/jpeg'
  if (
    extension === '.gif'
    && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a'
      || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) return 'image/gif'
  if (extension === '.bmp' && buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp'
  }
  if (
    extension === '.webp'
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  throw new Error('图片扩展名与文件签名不匹配。')
}

function buildSpreadsheetPreview(buffer: Buffer, extension: string) {
  if (
    extension === '.xlsx'
    && (
      buffer[0] !== 0x50
      || buffer[1] !== 0x4b
    )
  ) {
    throw new Error('Excel 扩展名与 OOXML 文件结构不匹配。')
  }
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellText: true,
  })
  const sheets: ProjectSpreadsheetPreviewSheet[] = []
  let remainingCells = MAX_PREVIEW_CELLS
  let truncated = workbook.SheetNames.length > MAX_PREVIEW_SHEETS

  for (const sheetName of workbook.SheetNames.slice(0, MAX_PREVIEW_SHEETS)) {
    const sheet = workbook.Sheets[sheetName]
    const reference = sheet?.['!ref']
    if (!sheet || !reference) {
      sheets.push({ name: sheetName, rows: [], totalRows: 0, totalColumns: 0, truncated: false })
      continue
    }
    const range = XLSX.utils.decode_range(reference)
    const totalRows = Math.max(0, range.e.r - range.s.r + 1)
    const totalColumns = Math.max(0, range.e.c - range.s.c + 1)
    const returnedColumns = Math.min(totalColumns, MAX_PREVIEW_COLUMNS_PER_SHEET)
    const cellLimitedRows = returnedColumns > 0 ? Math.floor(remainingCells / returnedColumns) : 0
    const returnedRows = Math.min(totalRows, MAX_PREVIEW_ROWS_PER_SHEET, cellLimitedRows)
    const rows: string[][] = []
    for (let rowOffset = 0; rowOffset < returnedRows; rowOffset += 1) {
      const row: string[] = []
      for (let columnOffset = 0; columnOffset < returnedColumns; columnOffset += 1) {
        const address = XLSX.utils.encode_cell({
          r: range.s.r + rowOffset,
          c: range.s.c + columnOffset,
        })
        row.push(formatExcelCell(sheet[address], false).slice(0, MAX_PREVIEW_CELL_CHARS))
      }
      rows.push(row)
    }
    remainingCells -= returnedRows * returnedColumns
    const sheetTruncated = returnedRows < totalRows || returnedColumns < totalColumns
    truncated ||= sheetTruncated
    sheets.push({
      name: sheetName,
      rows,
      totalRows,
      totalColumns,
      truncated: sheetTruncated,
    })
    if (remainingCells <= 0) {
      truncated = true
      break
    }
  }
  return { sheets, sheetCount: workbook.SheetNames.length, truncated }
}

async function extractPlainText(filePath: string) {
  const buffer = await fs.promises.readFile(filePath)
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

function selectTextLines(content: string, fromLine?: number, lineCount?: number) {
  if (fromLine === undefined && lineCount === undefined) {
    return { content, truncated: false, metadata: {} as Record<string, unknown> }
  }
  const lines = content.split(/\r?\n/)
  const start = Math.max(0, Math.min(lines.length, (fromLine ?? 1) - 1))
  const count = Math.max(1, Math.min(lineCount ?? 400, 2_000))
  const end = Math.min(lines.length, start + count)
  return {
    content: lines.slice(start, end).join('\n'),
    truncated: start > 0 || end < lines.length,
    metadata: {
      line_range: {
        from: start + 1,
        to: end,
        total: lines.length,
      },
    },
  }
}

function formatExcelCell(cell: XLSX.CellObject | undefined, includeFormulas: boolean) {
  if (!cell) return ''
  const formatted = XLSX.utils.format_cell(cell)
  if (includeFormulas && cell.f) {
    return formatted && formatted !== `=${cell.f}`
      ? `=${cell.f} → ${formatted}`
      : `=${cell.f}`
  }
  return formatted
}

async function extractLocalExcel(
  filePath: string,
  options: ProjectFileExtractOptions,
): Promise<ProjectCloudDocumentReadResult> {
  throwIfAborted(options.signal)
  const buffer = await fs.promises.readFile(filePath)
  throwIfAborted(options.signal)
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: options.includeFormulas !== false,
    cellText: true,
  })
  const requested = (options.sheetNames ?? []).map((name) => name.trim()).filter(Boolean)
  const selectedNames = requested.length > 0
    ? workbook.SheetNames.filter((name) => requested.includes(name))
    : workbook.SheetNames
  const missingNames = requested.filter((name) => !workbook.SheetNames.includes(name))
  const maxRows = Math.max(1, Math.min(options.maxRowsPerSheet ?? 80, 500))
  const maxCols = Math.max(1, Math.min(options.maxColsPerSheet ?? 30, 120))
  const includeFormulas = options.includeFormulas !== false
  const lines: string[] = []
  const sheetMetadata: Array<Record<string, unknown>> = []
  let truncated = false

  for (const sheetName of selectedNames) {
    throwIfAborted(options.signal)
    const sheet = workbook.Sheets[sheetName]
    const reference = sheet?.['!ref']
    lines.push(`## 工作表：${sheetName}`)
    if (!sheet || !reference) {
      lines.push('[空工作表]', '')
      sheetMetadata.push({ name: sheetName, rows: 0, columns: 0, truncated: false })
      continue
    }
    const range = XLSX.utils.decode_range(reference)
    const totalRows = range.e.r - range.s.r + 1
    const totalCols = range.e.c - range.s.c + 1
    const outputRows = Math.min(totalRows, maxRows)
    const outputCols = Math.min(totalCols, maxCols)
    const sheetTruncated = outputRows < totalRows || outputCols < totalCols
    truncated ||= sheetTruncated
    for (let rowOffset = 0; rowOffset < outputRows; rowOffset += 1) {
      const values: string[] = []
      for (let colOffset = 0; colOffset < outputCols; colOffset += 1) {
        const address = XLSX.utils.encode_cell({
          r: range.s.r + rowOffset,
          c: range.s.c + colOffset,
        })
        values.push(formatExcelCell(sheet[address], includeFormulas).replace(/[\r\n\t]+/g, ' '))
      }
      lines.push(values.join('\t'))
    }
    if (sheetTruncated) {
      lines.push(`[工作表已截取：返回 ${outputRows}/${totalRows} 行、${outputCols}/${totalCols} 列]`)
    }
    lines.push('')
    sheetMetadata.push({
      name: sheetName,
      rows: totalRows,
      columns: totalCols,
      returned_rows: outputRows,
      returned_columns: outputCols,
      truncated: sheetTruncated,
    })
  }

  return {
    content: lines.join('\n').trim(),
    parser: 'node-xlsx',
    warning: missingNames.length > 0 ? `未找到工作表：${missingNames.join('、')}` : null,
    metadata: {
      sheets: workbook.SheetNames,
      selected_sheets: selectedNames,
      sheet_details: sheetMetadata,
    },
    truncated,
  }
}

async function searchPlainTextFile(input: {
  file: { absolutePath: string; sizeBytes: number }
  terms: string[]
  phrase: string
  maxBytes: number
  signal?: AbortSignal
}) {
  const handle = await fs.promises.open(input.file.absolutePath, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.allocUnsafe(Math.min(SEARCH_READ_CHUNK_BYTES, input.maxBytes))
  const termHits = new Set<string>()
  const snippets: string[] = []
  let phraseHit = false
  let bytesRead = 0
  let carry = ''

  const inspect = (text: string) => {
    const lower = text.toLowerCase()
    if (input.phrase && lower.includes(input.phrase)) phraseHit = true
    for (const term of input.terms) {
      const index = lower.indexOf(term)
      if (index < 0) continue
      termHits.add(term)
      if (snippets.length < 2) {
        const start = Math.max(0, index - 90)
        const end = Math.min(text.length, index + 180)
        const snippet = compactSnippet(text.slice(start, end))
        if (snippet && !snippets.includes(snippet)) snippets.push(snippet)
      }
    }
  }

  try {
    while (bytesRead < input.maxBytes) {
      throwIfAborted(input.signal)
      const length = Math.min(buffer.byteLength, input.maxBytes - bytesRead)
      const result = await handle.read(buffer, 0, length, bytesRead)
      if (result.bytesRead <= 0) break
      bytesRead += result.bytesRead
      const decoded = decoder.write(buffer.subarray(0, result.bytesRead))
      const window = `${carry}${decoded}`
      inspect(window)
      carry = window.slice(-SEARCH_SNIPPET_CONTEXT_CHARS)
    }
    const tail = decoder.end()
    if (tail) inspect(`${carry}${tail}`)
  } finally {
    await handle.close()
  }

  return {
    bytesRead,
    termHits,
    phraseHit,
    snippets,
    truncated: input.file.sizeBytes > bytesRead,
  }
}

function isCloudDocumentKind(kind: ProjectFileKind) {
  return CLOUD_DOCUMENT_KINDS.has(kind)
}

/**
 * Drawings are previewable but never text: grepping or dumping a DWG only yields
 * binary noise, and their content belongs to the CAD subagents' drawing tools.
 */
function isDrawingKind(kind: ProjectFileKind) {
  return kind === 'cad'
}

function allocateSearchByteBudgets(files: ProjectFileEntry[]) {
  const budgets = new Map<string, number>()
  const caps = new Map<string, number>()
  let remainingBytes = SEARCH_MAX_TOTAL_BYTES

  for (const file of files) {
    const cap = Math.min(file.sizeBytes, SEARCH_MAX_BYTES_PER_FILE)
    const baseline = Math.min(cap, SEARCH_MIN_BYTES_PER_FILE)
    caps.set(file.path, cap)
    budgets.set(file.path, baseline)
    remainingBytes -= baseline
  }

  let activePaths = files
    .map((file) => file.path)
    .filter((filePath) => (budgets.get(filePath) ?? 0) < (caps.get(filePath) ?? 0))
  while (remainingBytes > 0 && activePaths.length > 0) {
    const fairShare = Math.max(1, Math.floor(remainingBytes / activePaths.length))
    let allocatedThisRound = 0
    for (const filePath of activePaths) {
      if (remainingBytes <= 0) break
      const current = budgets.get(filePath) ?? 0
      const capacity = caps.get(filePath) ?? 0
      const added = Math.min(capacity - current, fairShare, remainingBytes)
      if (added <= 0) continue
      budgets.set(filePath, current + added)
      remainingBytes -= added
      allocatedThisRound += added
    }
    if (allocatedThisRound <= 0) break
    activePaths = activePaths.filter(
      (filePath) => (budgets.get(filePath) ?? 0) < (caps.get(filePath) ?? 0),
    )
  }

  return budgets
}

/**
 * Mints a short-lived loopback URL the CAD preview frame can stream a drawing from.
 * Optional so the service stays constructible without the MLightCAD runtime; without
 * it, drawings simply report as not previewable.
 */
export type ProjectCadPreviewGranter = (request: {
  projectRoot: string
  relativePath: string
}) => Promise<{ sourceUrl: string; cadDataBaseUrl: string }>

export class ProjectFileService {
  constructor(
    private readonly cloudDocumentReader?: ProjectCloudDocumentReader,
    private readonly cadPreviewGranter?: ProjectCadPreviewGranter,
  ) {}

  async listPreviewDirectory(
    projectId: string,
    relativePath = '',
  ): Promise<ProjectPreviewDirectoryResult> {
    const root = await getProjectRoot(projectId)
    const normalizedPath = normalizeProjectPreviewPath(relativePath, true)
    if (!root.rootExists || !root.rootRealPath) {
      return {
        projectId: root.projectId,
        rootExists: false,
        path: normalizedPath,
        entries: [],
        truncated: false,
        ignoredCount: 0,
        warning: root.warning,
      }
    }

    const directory = await resolveProjectPreviewDirectory(root, normalizedPath)
    const dirents = await fs.promises.readdir(directory.realPath, { withFileTypes: true })
    const entries: ProjectPreviewDirectoryResult['entries'] = []
    let ignoredCount = 0
    let truncated = false

    for (const dirent of dirents) {
      if (
        (dirent.isDirectory() && shouldIgnorePreviewDir(dirent.name))
        || (!dirent.isDirectory() && shouldIgnorePreviewFile(dirent.name))
      ) {
        ignoredCount += 1
        continue
      }
      if (entries.length >= MAX_PREVIEW_DIRECTORY_ENTRIES) {
        truncated = true
        continue
      }
      const absolutePath = path.join(directory.realPath, dirent.name)
      try {
        const stat = await fs.promises.lstat(absolutePath)
        if (stat.isSymbolicLink()) {
          ignoredCount += 1
          continue
        }
        const childPath = normalizedPath ? `${normalizedPath}/${dirent.name}` : dirent.name
        if (stat.isDirectory()) {
          entries.push({
            type: 'directory',
            path: childPath,
            name: dirent.name,
            extension: '',
            kind: 'directory',
            previewMode: null,
            supported: true,
            sizeBytes: 0,
            modifiedAt: stat.mtime.toISOString(),
          })
          continue
        }
        if (!stat.isFile()) {
          ignoredCount += 1
          continue
        }
        const realPath = await fs.promises.realpath(absolutePath)
        if (!isPathInsideRoot(root.rootRealPath, realPath)) {
          ignoredCount += 1
          continue
        }
        const file = fileEntryFromStat(root.rootRealPath, realPath, stat)
        const previewMode = previewModeForKind(file.kind)
        entries.push({
          type: 'file',
          path: childPath,
          name: file.name,
          extension: file.extension,
          kind: file.kind,
          previewMode,
          supported: previewMode !== 'unsupported',
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        })
      } catch {
        ignoredCount += 1
      }
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
    return {
      projectId: root.projectId,
      rootExists: true,
      path: normalizedPath,
      entries,
      truncated,
      ignoredCount,
      warning: truncated ? `当前目录最多显示 ${MAX_PREVIEW_DIRECTORY_ENTRIES} 项。` : null,
    }
  }

  async readFilePreview(input: {
    projectId: string
    path: string
    offset?: number
  }): Promise<ProjectFilePreviewResult> {
    const resolved = await resolveProjectPreviewFile(input.projectId, input.path)
    const previewMode = previewModeForKind(kindForExtension(path.extname(resolved.relativePath)))
    const handle = await fs.promises.open(resolved.absolutePath, 'r')
    try {
      const candidatePath = path.join(
        resolved.root.rootRealPath!,
        resolved.relativePath.replace(/\//g, path.sep),
      )
      const currentEntry = await fs.promises.lstat(candidatePath)
      const currentRealPath = await fs.promises.realpath(candidatePath)
      if (
        currentEntry.isSymbolicLink()
        || !isPathInsideRoot(resolved.root.rootRealPath!, currentRealPath)
        || !sameFilesystemPath(currentRealPath, resolved.absolutePath)
      ) {
        throw new Error('文件在预览打开期间发生变化，请刷新后重试。')
      }
      const openedStat = await handle.stat()
      if (!sameOpenedFile(resolved.stat, openedStat)) {
        throw new Error('文件在预览打开期间发生变化，请刷新后重试。')
      }
      const file = fileEntryFromStat(
        resolved.root.rootRealPath!,
        resolved.absolutePath,
        openedStat,
      )
      const base = {
        projectId: resolved.root.projectId,
        path: resolved.relativePath,
        name: file.name,
        extension: file.extension,
        kind: file.kind,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
      }
      if (previewMode === 'unsupported') {
        return {
          ...base,
          mode: 'unsupported',
          reason: `暂不支持预览 ${file.extension || '该'} 格式文件。`,
        }
      }
      if (previewMode === 'text' || previewMode === 'markdown') {
        const chunk = await readUtf8PreviewChunk(handle, openedStat.size, input.offset ?? 0)
        await assertOpenedSnapshotUnchanged(handle, openedStat)
        return { ...base, mode: previewMode, ...chunk }
      }
      if (previewMode === 'spreadsheet') {
        if (openedStat.size > MAX_OFFICE_PREVIEW_BYTES) {
          return {
            ...base,
            mode: 'unsupported',
            reason: `表格超过 ${MAX_OFFICE_PREVIEW_BYTES / 1024 / 1024}MB，已拒绝在界面中解析。`,
          }
        }
        const buffer = await readOpenedFileBounded(handle, openedStat, MAX_OFFICE_PREVIEW_BYTES)
        try {
          if (file.extension === '.xlsx') await validateProjectOoxmlPreview(buffer, 'xlsx')
          return {
            ...base,
            mode: 'spreadsheet',
            ...buildSpreadsheetPreview(buffer, file.extension),
          }
        } catch (error) {
          return {
            ...base,
            mode: 'unsupported',
            reason: `表格解析失败：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      if (previewMode === 'cad') {
        if (openedStat.size > MAX_CAD_PREVIEW_BYTES) {
          return {
            ...base,
            mode: 'unsupported',
            reason: `图纸超过 ${MAX_CAD_PREVIEW_BYTES / 1024 / 1024}MB，已拒绝在界面中打开。`,
          }
        }
        if (!this.cadPreviewGranter) {
          return { ...base, mode: 'unsupported', reason: 'CAD 预览运行时不可用。' }
        }
        try {
          const grant = await this.cadPreviewGranter({
            projectRoot: resolved.root.rootRealPath!,
            relativePath: resolved.relativePath,
          })
          return { ...base, mode: 'cad', ...grant }
        } catch (error) {
          return {
            ...base,
            mode: 'unsupported',
            reason: `图纸打开失败：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      const maxBytes = previewMode === 'image'
        ? MAX_IMAGE_PREVIEW_BYTES
        : previewMode === 'pdf'
          ? MAX_PDF_PREVIEW_BYTES
          : MAX_OFFICE_PREVIEW_BYTES
      if (openedStat.size > maxBytes) {
        return {
          ...base,
          mode: 'unsupported',
          reason: `文件超过 ${maxBytes / 1024 / 1024}MB，已拒绝在界面中加载。`,
        }
      }
      const buffer = await readOpenedFileBounded(handle, openedStat, maxBytes)
      try {
        let mimeType: string
        if (previewMode === 'image') {
          mimeType = imagePreviewMime(file.extension, buffer)
        } else if (previewMode === 'pdf') {
          if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
            throw new Error('PDF 扩展名与文件签名不匹配。')
          }
          mimeType = 'application/pdf'
        } else {
          if (
            buffer[0] !== 0x50
            || buffer[1] !== 0x4b
          ) {
            throw new Error('DOCX 扩展名与 OOXML 文件结构不匹配。')
          }
          await validateProjectOoxmlPreview(buffer, 'docx')
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
        return {
          ...base,
          mode: previewMode,
          mimeType,
          dataBase64: buffer.toString('base64'),
        }
      } catch (error) {
        return {
          ...base,
          mode: 'unsupported',
          reason: `文件解析失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    } finally {
      await handle.close()
    }
  }

  async listFiles(
    projectId: string,
    signal?: AbortSignal,
    options?: ProjectFilesListOptions,
  ): Promise<ProjectFilesListResult> {
    const root = await getProjectRoot(projectId)
    const rawScopePath = options?.path?.trim() || ''
    if (rawScopePath && (path.isAbsolute(rawScopePath) || /^[a-zA-Z]:[\\/]/.test(rawScopePath))) {
      throw new Error('只允许列出项目目录内的相对路径。')
    }
    const source = options?.source ?? 'all'
    if (!['all', 'user', 'artifact'].includes(source)) {
      throw new Error(`不支持的项目文件来源：${source}`)
    }
    const scopePath = normalizeScopePath(options?.path)
    const maxDepth = source === 'artifact' ? MAX_ARTIFACT_SCAN_DEPTH : MAX_SCAN_DEPTH
    const depth = Math.max(1, Math.min(options?.depth ?? maxDepth, maxDepth))
    const sort = options?.sort ?? (source === 'artifact' ? 'modified_desc' : 'path')
    if (!['path', 'modified_desc'].includes(sort)) {
      throw new Error(`不支持的项目文件排序：${sort}`)
    }
    const files: ProjectFileEntry[] = []
    const directories: ProjectDirectoryEntry[] = []
    let ignoredCount = 0
    let fileScanTruncated = false
    let directoryListTruncated = false

    if (!root.rootExists || !root.rootRealPath) {
      return {
        projectId: root.projectId,
        rootPath: root.rootPath,
        rootExists: root.rootExists,
        scopePath,
        depth,
        source,
        directories,
        directoryCount: 0,
        files,
        fileCount: 0,
        returnedCount: 0,
        nextCursor: null,
        truncated: false,
        ignoredCount: 0,
        warning: root.warning,
      }
    }

    const scopeAbsolutePath = await resolveProjectDirectory(root, scopePath)
    const walk = async (directory: string, level: number): Promise<void> => {
      throwIfAborted(signal)
      if (fileScanTruncated) return

      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true })
      } catch {
        ignoredCount += 1
        return
      }

      for (const entry of entries) {
        throwIfAborted(signal)
        if (fileScanTruncated) return
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (shouldIgnoreDir(entry.name)) {
            ignoredCount += 1
            continue
          }
          const relativePath = normalizeRelativePath(path.relative(root.rootRealPath!, absolutePath))
          const entrySource = inferFileSource(relativePath)
          if (source === 'all' || source === entrySource) {
            if (directories.length < MAX_SCAN_DIRECTORIES) {
              directories.push({
                path: relativePath,
                name: entry.name,
                source: entrySource,
              })
            } else {
              directoryListTruncated = true
            }
          }
          const shouldTraverseSource = source === 'all'
            || (source === 'artifact' && entrySource === 'artifact')
            || (source === 'user' && entrySource === 'user')
          if (shouldTraverseSource && level + 1 <= depth) {
            await walk(absolutePath, level + 1)
          }
          continue
        }

        if (entry.isSymbolicLink() || shouldIgnoreFile(entry.name)) {
          ignoredCount += 1
          continue
        }

        if (!entry.isFile()) {
          ignoredCount += 1
          continue
        }

        try {
          const realPath = await fs.promises.realpath(absolutePath)
          if (!isPathInsideRoot(root.rootRealPath!, realPath)) {
            ignoredCount += 1
            continue
          }
          const stat = await fs.promises.stat(realPath)
          const file = fileEntryFromStat(root.rootRealPath!, realPath, stat)
          if (matchesSource(file.path, source)) {
            files.push(file)
          }
          if (files.length >= MAX_SCAN_FILES) {
            fileScanTruncated = true
            return
          }
        } catch {
          ignoredCount += 1
        }
      }
    }

    await walk(scopeAbsolutePath, 0)
    files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    directories.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    const index = await readContextIndex(root)
    const enrichedFiles = files.map((file) => enrichFileEntry(file, index.get(file.path)))
    const allEntries = [
      ...directories.map((entry) => ({ type: 'directory' as const, path: entry.path, entry })),
      ...enrichedFiles.map((entry) => ({ type: 'file' as const, path: entry.path, entry })),
    ].sort((a, b) => {
      if (sort === 'modified_desc') {
        if (a.type === 'file' && b.type === 'file') {
          return b.entry.modifiedAt.localeCompare(a.entry.modifiedAt)
            || a.path.localeCompare(b.path, 'zh-CN')
        }
        if (a.type !== b.type) return a.type === 'file' ? -1 : 1
      }
      return a.path.localeCompare(b.path, 'zh-CN') || a.type.localeCompare(b.type)
    })
    const offset = decodeListCursor(options?.cursor, {
      projectId: root.projectId,
      scopePath,
      depth,
      source,
      sort,
    })
    if (offset > allEntries.length) {
      throw new Error('项目文件列表 cursor 已过期，请从第一页重新列出。')
    }
    const pageSize = options?.limit === undefined
      ? Math.max(1, allEntries.length)
      : Math.max(1, Math.min(options.limit, 200))
    const page = allEntries.slice(offset, offset + pageSize)
    const pageDirectories = page.flatMap((item) => item.type === 'directory' ? [item.entry] : [])
    const pageFiles = page.flatMap((item) => item.type === 'file' ? [item.entry] : [])
    const nextOffset = offset + page.length
    const nextCursor = nextOffset < allEntries.length
      ? encodeListCursor({ projectId: root.projectId, offset: nextOffset, scopePath, depth, source, sort })
      : null
    const truncated = fileScanTruncated || directoryListTruncated
    const warnings = [
      fileScanTruncated ? `项目资料较多，单次扫描最多处理 ${MAX_SCAN_FILES} 个文件。` : null,
      directoryListTruncated
        ? `目录超过 ${MAX_SCAN_DIRECTORIES} 个，仅省略多余目录名称；文件扫描仍继续。`
        : null,
      nextCursor ? `当前页后还有 ${allEntries.length - nextOffset} 项；继续列出时传 cursor。` : null,
    ].filter(Boolean)

    return {
      projectId: root.projectId,
      rootPath: root.rootPath,
      rootExists: true,
      scopePath,
      depth,
      source,
      directories: pageDirectories,
      directoryCount: directories.length,
      files: pageFiles,
      fileCount: enrichedFiles.length,
      returnedCount: page.length,
      nextCursor,
      truncated,
      ignoredCount,
      warning: warnings.join('；') || null,
    }
  }

  async resolveFile(input: {
    projectId: string
    path: string
    signal?: AbortSignal
  }): Promise<ProjectResolvedFile> {
    throwIfAborted(input.signal)
    const resolved = await resolveProjectFile(input.projectId, input.path)
    throwIfAborted(input.signal)
    const entry = fileEntryFromStat(resolved.root.rootRealPath!, resolved.absolutePath, resolved.stat)
    return {
      projectId: resolved.root.projectId,
      rootPath: resolved.root.rootPath,
      absolutePath: resolved.absolutePath,
      path: resolved.relativePath,
      name: entry.name,
      extension: entry.extension,
      kind: entry.kind,
      supported: entry.supported,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      title: entry.title,
      tags: entry.tags,
      description: entry.description,
      source: entry.source,
    }
  }

  async readFile(input: {
    projectId: string
    path: string
    maxChars?: number
    fromLine?: number
    lineCount?: number
    pageRange?: string
    sheetNames?: string[]
    maxRowsPerSheet?: number
    maxColsPerSheet?: number
    includeFormulas?: boolean
    mode?: 'auto' | 'local' | 'cloud'
    signal?: AbortSignal
  }): Promise<ProjectFileReadResult> {
    throwIfAborted(input.signal)
    const resolved = await resolveProjectFile(input.projectId, input.path)
    const entry = fileEntryFromStat(resolved.root.rootRealPath!, resolved.absolutePath, resolved.stat)
    const maxChars = Math.max(1_000, Math.min(input.maxChars ?? DEFAULT_MAX_CHARS, 120_000))

    if (!entry.supported) {
      return {
        projectId: resolved.root.projectId,
        rootPath: resolved.root.rootPath,
        ...entry,
        content: '',
        truncated: false,
        warning: `暂不支持读取 ${entry.extension || '该'} 格式文件。`,
      }
    }

    if (isDrawingKind(entry.kind)) {
      return {
        projectId: resolved.root.projectId,
        rootPath: resolved.root.rootPath,
        ...entry,
        content: '',
        truncated: false,
        warning: `${entry.extension} 图纸无法按文本读取，请改用 CAD 子代理的图纸工具。`,
      }
    }

    const mode = input.mode ?? 'auto'
    if (!['auto', 'local', 'cloud'].includes(mode)) {
      throw new Error(`不支持的项目文件读取模式：${mode}`)
    }
    const isExcel = entry.kind === 'xlsx' || entry.extension === '.xls'
    if (isExcel && mode === 'local' && resolved.stat.size > MAX_LOCAL_FILE_BYTES) {
      return {
        projectId: resolved.root.projectId,
        rootPath: resolved.root.rootPath,
        ...entry,
        content: '',
        truncated: false,
        warning: `Excel 超过 ${MAX_LOCAL_FILE_BYTES / 1024 / 1024}MB，无法仅在本机解析；可改用 mode=cloud。`,
      }
    }
    const canReadExcelLocally = isExcel
      && mode !== 'cloud'
      && resolved.stat.size <= MAX_LOCAL_FILE_BYTES
    const cloudDocument = isCloudDocumentKind(entry.kind) && !canReadExcelLocally
    const maxFileBytes = cloudDocument ? MAX_CLOUD_DOCUMENT_BYTES : MAX_LOCAL_FILE_BYTES
    if (resolved.stat.size > maxFileBytes) {
      return {
        projectId: resolved.root.projectId,
        rootPath: resolved.root.rootPath,
        ...entry,
        content: '',
        truncated: false,
        warning: `文件超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB，已拒绝读取。`,
      }
    }

    if (cloudDocument && !this.cloudDocumentReader) {
      return {
        projectId: resolved.root.projectId,
        rootPath: resolved.root.rootPath,
        ...entry,
        content: '',
        truncated: false,
        warning: '复杂文档必须通过后端云解析，但当前云解析服务未初始化。',
      }
    }

    const cloudInput = {
      projectId: resolved.root.projectId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      sizeBytes: resolved.stat.size,
      modifiedAt: resolved.stat.mtime.toISOString(),
      maxChars,
      pageRange: input.pageRange,
      sheetNames: input.sheetNames,
      maxRowsPerSheet: input.maxRowsPerSheet,
      maxColsPerSheet: input.maxColsPerSheet,
      includeFormulas: input.includeFormulas,
      signal: input.signal,
    }
    let extracted: ProjectCloudDocumentReadResult
    if (canReadExcelLocally) {
      try {
        extracted = await extractLocalExcel(resolved.absolutePath, cloudInput)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (mode === 'local' || !this.cloudDocumentReader) {
          extracted = {
            content: '',
            parser: 'node-xlsx',
            warning: mode === 'local'
              ? `本地 Excel 解析失败：${reason}。当前 mode=local，未上传云端。`
              : `本地 Excel 解析失败且云解析不可用：${reason}`,
            metadata: {},
            truncated: false,
          }
        } else {
          try {
            const fallback = await this.cloudDocumentReader(cloudInput)
            extracted = {
              ...fallback,
              warning: [`本地 Excel 解析失败，已切换云解析：${reason}`, fallback.warning]
                .filter(Boolean)
                .join('；'),
            }
          } catch (cloudError) {
            extracted = {
              content: '',
              parser: 'cloud-document',
              warning: `本地 Excel 解析失败（${reason}）；云解析也失败：${cloudError instanceof Error ? cloudError.message : String(cloudError)}`,
              metadata: {},
              truncated: false,
            }
          }
        }
      }
    } else if (cloudDocument) {
      try {
        extracted = await this.cloudDocumentReader!(cloudInput)
      } catch (error) {
        extracted = {
          content: '',
          parser: 'cloud-document',
          warning: `云文档解析失败：${error instanceof Error ? error.message : String(error)}`,
          metadata: {},
          truncated: false,
        }
      }
    } else {
      const selected = selectTextLines(
        await extractPlainText(resolved.absolutePath),
        input.fromLine,
        input.lineCount,
      )
      extracted = {
        content: selected.content,
        parser: 'node-text',
        warning: null,
        metadata: selected.metadata,
        truncated: selected.truncated,
      }
    }
    throwIfAborted(input.signal)
    const clipped = clipContent(extracted.content, maxChars)
    const warnings = [extracted.warning, clipped.truncated ? '内容过长，已截断。' : null]
      .filter(Boolean)
      .join('；')

    return {
      projectId: resolved.root.projectId,
      rootPath: resolved.root.rootPath,
      ...entry,
      content: clipped.content,
      truncated: extracted.truncated || clipped.truncated,
      sheets: Array.isArray(extracted.metadata.sheets)
        ? extracted.metadata.sheets.filter((value): value is string => typeof value === 'string')
        : undefined,
      parser: extracted.parser,
      metadata: extracted.metadata,
      warning: warnings || null,
    }
  }

  async searchFiles(input: {
    projectId: string
    query: string
    limit?: number
    path?: string
    source?: ProjectFileSourceFilter
    glob?: string
    signal?: AbortSignal
  }): Promise<ProjectFilesSearchResult> {
    const query = input.query.trim()
    if (query.length > 500) {
      throw new Error('项目资料搜索词不能超过 500 个字符。')
    }
    const limit = Math.max(1, Math.min(input.limit ?? 10, 20))
    const scopePath = normalizeScopePath(input.path)
    const source = input.source ?? 'all'
    const glob = input.glob?.trim() || null
    const globMatcher = glob ? globPatternToRegExp(glob) : null
    const listed = await this.listFiles(input.projectId, input.signal, {
      path: scopePath,
      depth: MAX_SCAN_DEPTH,
      source,
    })
    if (!listed.rootExists || !query) {
      return {
        projectId: listed.projectId,
        rootPath: listed.rootPath,
        rootExists: listed.rootExists,
        query,
        scopePath,
        source,
        glob,
        matches: [],
        matchCount: 0,
        searchedFileCount: 0,
        truncated: listed.truncated,
        warning: query ? listed.warning : '搜索关键词不能为空。',
      }
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const phrase = query.toLowerCase()
    const searchRoot = await getProjectRoot(input.projectId)
    const matches: ProjectFileSearchMatch[] = []
    let searchedFileCount = 0
    const searchableFiles = listed.files.filter((file) =>
      (!globMatcher || globMatcher.test(file.path) || globMatcher.test(file.name))
      && file.supported
      && !isCloudDocumentKind(file.kind)
      && !isDrawingKind(file.kind)
      && file.sizeBytes <= MAX_LOCAL_FILE_BYTES,
    )
    const searchByteBudgets = allocateSearchByteBudgets(searchableFiles)
    let contentSearchTruncated = searchableFiles.some(
      (file) => (searchByteBudgets.get(file.path) ?? 0) < file.sizeBytes,
    )

    for (const file of listed.files) {
      throwIfAborted(input.signal)
      if (globMatcher && !globMatcher.test(file.path) && !globMatcher.test(file.name)) continue

      const metadataText = [
        file.path,
        file.name,
        file.title,
        file.tags?.join(' '),
        file.description,
        file.source,
      ].filter(Boolean).join('\n')
      const metadataHaystack = metadataText.toLowerCase()
      const pathHaystack = `${file.path}\n${file.name}`.toLowerCase()
      const metadataTermHits = terms.filter((term) => metadataHaystack.includes(term))
      const filenameHit = terms.some((term) => pathHaystack.includes(term))
      const snippets: string[] = []
      let score = metadataTermHits.length * 3
      if (filenameHit) score += 4
      if (phrase && pathHaystack.includes(phrase)) score += 8
      let warning: string | null = null

      if (metadataTermHits.length > 0) {
        snippets.push(file.title
          ? `索引命中：${file.path}（${file.title}）`
          : `文件名命中：${file.path}`)
        if (file.description) {
          snippets.push(file.description)
        }
      }

      if (
        file.supported
        && !isCloudDocumentKind(file.kind)
        && !isDrawingKind(file.kind)
        && file.sizeBytes <= MAX_LOCAL_FILE_BYTES
      ) {
        const maxBytes = searchByteBudgets.get(file.path) ?? 0
        if (maxBytes <= 0 && file.sizeBytes > 0) {
          contentSearchTruncated = true
        } else {
          searchedFileCount += 1
          try {
            const resolved = await resolveProjectFileFromRoot(searchRoot, file.path)
            const searched = await searchPlainTextFile({
              file: {
                absolutePath: resolved.absolutePath,
                sizeBytes: resolved.stat.size,
              },
              terms,
              phrase,
              maxBytes,
              signal: input.signal,
            })
            score += searched.termHits.size * 5
            if (searched.phraseHit) score += 8
            snippets.push(...searched.snippets)
            if (searched.truncated) {
              contentSearchTruncated = true
              warning = `文本较大，仅搜索前 ${Math.round(searched.bytesRead / 1024)}KB。`
            }
          } catch (error) {
            warning = error instanceof Error ? error.message : String(error)
          }
        }
      }

      if (score > 0) {
        matches.push({
          path: file.path,
          name: file.name,
          kind: file.kind,
          supported: file.supported,
          score,
          snippets: snippets.slice(0, 3),
          title: file.title,
          tags: file.tags,
          description: file.description,
          source: file.source,
          warning,
        })
      }
    }

    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'zh-CN'))
    const matchCount = matches.length
    const returnedMatches = matches.slice(0, limit)
    const warnings = [
      listed.warning,
      contentSearchTruncated
        ? `纯文本内容搜索为每个候选文件至少公平保留前 ${SEARCH_MIN_BYTES_PER_FILE / 1024}KB，再共享合计 ${SEARCH_MAX_TOTAL_BYTES / 1024 / 1024}MB 预算；单个文件最多 ${SEARCH_MAX_BYTES_PER_FILE / 1024 / 1024}MB。`
        : null,
      matchCount > returnedMatches.length
        ? `共找到 ${matchCount} 个匹配文件，仅返回相关度最高的 ${returnedMatches.length} 个。`
        : null,
    ].filter(Boolean)

    return {
      projectId: listed.projectId,
      rootPath: listed.rootPath,
      rootExists: true,
      query,
      scopePath,
      source,
      glob,
      matches: returnedMatches,
      matchCount,
      searchedFileCount,
      truncated: listed.truncated || contentSearchTruncated || matchCount > returnedMatches.length,
      warning: warnings.join('；') || null,
    }
  }
}
