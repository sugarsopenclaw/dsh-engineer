import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ProjectAgentsStatus,
  ProjectArtifactEntry,
  ProjectContextIndexEntry,
  ProjectContextStatus,
  ProjectFileEntry,
} from '../../../src/shared/local-agent'
import { getProjectSummary } from '../conversations/conversation-repository'
import { ProjectArtifactService } from './project-artifact-service'
import { ProjectFileService } from './project-file-service'

const XIAOLIANG_DIR_NAME = '.xiaoliang'
const INDEX_JSON_NAME = 'project-index.json'
const INDEX_MARKDOWN_NAME = 'PROJECT_INDEX.md'
const AGENTS_FILE_NAME = 'AGENTS.md'
const OUTPUT_ROOT_NAME = 'xiaoliang-outputs'
const AGENTS_CONTEXT_MAX_CHARS = 12_000
const MARKDOWN_TITLE_READ_BYTES = 64 * 1024
const PROJECT_INDEX_DEFAULT_MAX_AGE_MS = 5 * 60 * 1_000

interface ProjectRootInfo {
  projectId: string
  projectName: string
  rootPath: string | null
  rootExists: boolean
  rootRealPath: string | null
  warning?: string | null
}

interface ProjectIndexFile {
  schemaVersion: 1
  projectId: string
  generatedAt: string
  entries: ProjectContextIndexEntry[]
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, '/')
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function escapeMarkdownTable(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function clipText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return { content: value, truncated: false }
  }
  return {
    content: `${value.slice(0, Math.max(0, maxChars - 80))}\n\n[AGENTS.md 内容过长，已截断。]`,
    truncated: true,
  }
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

function compactLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function kindLabel(kind: string) {
  const normalized = kind.toLowerCase()
  if (normalized === 'markdown') return 'Markdown'
  if (normalized === 'document') return '办公文档'
  if (normalized === 'image') return '图片/扫描件'
  if (normalized === 'docx') return 'Word 文档'
  if (normalized === 'pdf') return 'PDF'
  if (normalized === 'xlsx' || normalized === 'excel') return 'Excel 表格'
  if (normalized === 'csv') return 'CSV 表格'
  if (normalized === 'json') return 'JSON'
  if (normalized === 'algorithm') return '算法文件'
  if (normalized === 'text') return '文本'
  return kind || '文件'
}

async function readFileHead(filePath: string, maxBytes: number) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.toString('utf-8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function inferTitleFromFile(rootRealPath: string, entry: ProjectFileEntry) {
  const fallback = compactLabel(stripExtension(entry.name)) || entry.name
  const extension = entry.extension.toLowerCase()
  if (extension !== '.md' && extension !== '.markdown' && extension !== '.txt') {
    return fallback
  }

  try {
    const absolutePath = path.join(rootRealPath, entry.path)
    const text = await readFileHead(absolutePath, MARKDOWN_TITLE_READ_BYTES)
    const heading = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('#') && line.replace(/^#+\s*/, '').trim())
    if (heading) {
      return heading.replace(/^#+\s*/, '').trim().slice(0, 120)
    }
  } catch {
    // Keep filename fallback.
  }
  return fallback
}

function inferTags(entry: Pick<ProjectContextIndexEntry, 'path' | 'kind' | 'source'>) {
  const tags = new Set<string>()
  tags.add(entry.source === 'artifact' ? '晓量产物' : '用户资料')
  tags.add(kindLabel(entry.kind))
  for (const segment of entry.path.split('/').slice(0, -1)) {
    const clean = segment.trim()
    if (clean && clean !== OUTPUT_ROOT_NAME && clean !== XIAOLIANG_DIR_NAME) {
      tags.add(clean.slice(0, 24))
    }
    if (tags.size >= 6) break
  }
  return [...tags]
}

function buildDescription(entry: Pick<ProjectContextIndexEntry, 'path' | 'kind' | 'source'>) {
  const source = entry.source === 'artifact' ? '晓量产物' : '用户放入的项目资料'
  return `${source}，类型为 ${kindLabel(entry.kind)}，相对路径 ${entry.path}。`
}

function previousEntryReusable(
  previous: ProjectContextIndexEntry | undefined,
  next: Pick<ProjectContextIndexEntry, 'path' | 'source' | 'sizeBytes' | 'modifiedAt'>,
) {
  return Boolean(
    previous &&
      previous.path === next.path &&
      previous.source === next.source &&
      previous.sizeBytes === next.sizeBytes &&
      previous.modifiedAt === next.modifiedAt,
  )
}

function isInternalProjectFile(relativePath: string) {
  const normalized = normalizeSlash(relativePath).toLowerCase()
  return (
    normalized === AGENTS_FILE_NAME.toLowerCase() ||
    normalized.startsWith(`${XIAOLIANG_DIR_NAME.toLowerCase()}/`) ||
    normalized === OUTPUT_ROOT_NAME.toLowerCase() ||
    normalized.startsWith(`${OUTPUT_ROOT_NAME.toLowerCase()}/`)
  )
}

const ATOMIC_WRITE_RENAME_MAX_ATTEMPTS = 8
const ATOMIC_WRITE_RENAME_BASE_DELAY_MS = 80
const RETRIABLE_ATOMIC_WRITE_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT'])

function isRetriableAtomicWriteError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && RETRIABLE_ATOMIC_WRITE_ERROR_CODES.has(code)
}

function getAtomicWriteRetryDelay(attempt: number) {
  return Math.min(1_000, ATOMIC_WRITE_RENAME_BASE_DELAY_MS * 2 ** attempt)
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function removeTempFileQuietly(tempPath: string) {
  try {
    await fs.promises.unlink(tempPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[project-context] failed to remove temp index file', tempPath, error)
    }
  }
}

function createAtomicTempPath(filePath: string) {
  const parsed = path.parse(filePath)
  return path.join(
    parsed.dir,
    `.${parsed.base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  )
}

async function atomicWriteText(filePath: string, content: string) {
  let lastError: unknown
  for (let attempt = 0; attempt <= ATOMIC_WRITE_RENAME_MAX_ATTEMPTS; attempt += 1) {
    const tempPath = createAtomicTempPath(filePath)
    try {
      await fs.promises.writeFile(tempPath, content, 'utf-8')
      await fs.promises.rename(tempPath, filePath)
      return
    } catch (error) {
      lastError = error
      await removeTempFileQuietly(tempPath)
      if (attempt < ATOMIC_WRITE_RENAME_MAX_ATTEMPTS && isRetriableAtomicWriteError(error)) {
        await delay(getAtomicWriteRetryDelay(attempt))
        continue
      }
      throw error
    }
  }
  throw lastError
}

async function getProjectRoot(projectId: string): Promise<ProjectRootInfo> {
  const project = getProjectSummary(projectId)
  if (!project) {
    return {
      projectId,
      projectName: '',
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
      projectName: project.name,
      rootPath: null,
      rootExists: false,
      rootRealPath: null,
      warning: '当前项目尚未绑定本地资料与产物目录。',
    }
  }

  try {
    const stat = await fs.promises.stat(rootPath)
    if (!stat.isDirectory()) {
      return {
        projectId: project.id,
        projectName: project.name,
        rootPath,
        rootExists: false,
        rootRealPath: null,
        warning: '项目目录路径存在，但不是文件夹。',
      }
    }
    return {
      projectId: project.id,
      projectName: project.name,
      rootPath,
      rootExists: true,
      rootRealPath: await fs.promises.realpath(rootPath),
      warning: null,
    }
  } catch (error) {
    return {
      projectId: project.id,
      projectName: project.name,
      rootPath,
      rootExists: false,
      rootRealPath: null,
      warning: `项目目录不可访问：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function ensureXiaoliangDir(rootRealPath: string) {
  const dirPath = path.join(rootRealPath, XIAOLIANG_DIR_NAME)
  await fs.promises.mkdir(dirPath, { recursive: true })
  const stat = await fs.promises.stat(dirPath)
  if (!stat.isDirectory()) {
    throw new Error(`${XIAOLIANG_DIR_NAME} 已存在但不是文件夹。`)
  }
  const realPath = await fs.promises.realpath(dirPath)
  if (!isPathInsideRoot(rootRealPath, realPath)) {
    throw new Error(`${XIAOLIANG_DIR_NAME} 指向项目目录之外，已拒绝。`)
  }
  return realPath
}

function createEmptyAgentsStatus(root: ProjectRootInfo): ProjectAgentsStatus {
  return {
    exists: false,
    path: root.rootRealPath ? path.join(root.rootRealPath, AGENTS_FILE_NAME) : null,
    relativePath: AGENTS_FILE_NAME,
    sizeBytes: null,
    modifiedAt: null,
    truncated: false,
    content: null,
    warning: root.rootExists ? null : root.warning,
  }
}

async function readAgentsStatus(root: ProjectRootInfo): Promise<ProjectAgentsStatus> {
  if (!root.rootExists || !root.rootRealPath) {
    return createEmptyAgentsStatus(root)
  }

  const agentsPath = path.join(root.rootRealPath, AGENTS_FILE_NAME)
  try {
    const realPath = await fs.promises.realpath(agentsPath)
    if (!isPathInsideRoot(root.rootRealPath, realPath)) {
      return {
        ...createEmptyAgentsStatus(root),
        exists: true,
        warning: 'AGENTS.md 指向项目目录之外，已拒绝读取。',
      }
    }
    const stat = await fs.promises.stat(agentsPath)
    if (!stat.isFile()) {
      return {
        ...createEmptyAgentsStatus(root),
        exists: true,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        warning: 'AGENTS.md 存在但不是文件。',
      }
    }
    const raw = await fs.promises.readFile(agentsPath, 'utf-8')
    const clipped = clipText(raw.trim(), AGENTS_CONTEXT_MAX_CHARS)
    return {
      exists: true,
      path: agentsPath,
      relativePath: AGENTS_FILE_NAME,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      truncated: clipped.truncated,
      content: clipped.content,
      warning: clipped.truncated ? 'AGENTS.md 内容较长，已按上下文预算截断。' : null,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyAgentsStatus(root)
    }
    return {
      ...createEmptyAgentsStatus(root),
      warning: `AGENTS.md 读取失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function readIndexFile(root: ProjectRootInfo): Promise<ProjectIndexFile | null> {
  if (!root.rootExists || !root.rootRealPath) return null
  const indexPath = path.join(root.rootRealPath, XIAOLIANG_DIR_NAME, INDEX_JSON_NAME)
  try {
    const realPath = await fs.promises.realpath(indexPath)
    if (!isPathInsideRoot(root.rootRealPath, realPath)) return null
    const raw = await fs.promises.readFile(realPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProjectIndexFile>
    if (!Array.isArray(parsed.entries)) return null
    return {
      schemaVersion: 1,
      projectId: String(parsed.projectId || root.projectId),
      generatedAt: String(parsed.generatedAt || ''),
      entries: parsed.entries.filter((entry): entry is ProjectContextIndexEntry =>
        Boolean(entry && typeof entry.path === 'string' && typeof entry.name === 'string'),
      ),
    }
  } catch {
    return null
  }
}

function renderIndexMarkdown(input: {
  projectName: string
  generatedAt: string
  entries: ProjectContextIndexEntry[]
}) {
  const userEntries = input.entries.filter((entry) => entry.source === 'user')
  const artifactEntries = input.entries.filter((entry) => entry.source === 'artifact')
  const lines = [
    '# 晓量项目资料索引',
    '',
    '> 本文件由晓量自动生成，请不要手动编辑。项目总纲请维护根目录 `AGENTS.md`。',
    '',
    `更新时间：${input.generatedAt}`,
    `项目名称：${input.projectName || '未命名项目'}`,
    `文件总数：${input.entries.length}（用户资料 ${userEntries.length}，晓量产物 ${artifactEntries.length}）`,
    '',
    '## 使用方式',
    '',
    '- `AGENTS.md` 用于记录项目背景、工程口径、回答偏好和关键约束。',
    '- 用户放入的资料、晓量导出的清单/算法/报告会进入本索引。',
    '- Agent 回答引用资料时应使用下表的相对路径。',
    '',
  ]

  const appendTable = (title: string, entries: ProjectContextIndexEntry[]) => {
    lines.push(`## ${title}`, '')
    if (entries.length === 0) {
      lines.push('暂无。', '')
      return
    }
    lines.push('| 路径 | 标题 | 类型 | 标签 | 更新时间 | 描述 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const entry of entries) {
      lines.push(
        `| ${escapeMarkdownTable(entry.path)} | ${escapeMarkdownTable(entry.title)} | ${escapeMarkdownTable(kindLabel(entry.kind))} | ${escapeMarkdownTable(entry.tags.join(', '))} | ${escapeMarkdownTable(entry.modifiedAt)} | ${escapeMarkdownTable(entry.description)} |`,
      )
    }
    lines.push('')
  }

  appendTable('用户资料', userEntries)
  appendTable('晓量产物', artifactEntries)
  return lines.join('\n')
}

export class ProjectContextService {
  private readonly refreshInFlight = new Map<string, Promise<ProjectContextStatus>>()

  constructor(
    private readonly projectFileService = new ProjectFileService(),
    private readonly projectArtifactService = new ProjectArtifactService(),
  ) {}

  async getStatus(projectId: string): Promise<ProjectContextStatus> {
    const root = await getProjectRoot(projectId)
    const agents = await readAgentsStatus(root)
    const index = await readIndexFile(root)
    const entries = index?.entries ?? []
    const userFileCount = entries.filter((entry) => entry.source === 'user').length
    const artifactFileCount = entries.filter((entry) => entry.source === 'artifact').length
    const indexRoot = root.rootRealPath ? path.join(root.rootRealPath, XIAOLIANG_DIR_NAME) : null
    return {
      projectId: root.projectId,
      rootPath: root.rootPath,
      rootExists: root.rootExists,
      agents,
      indexJsonPath: indexRoot ? path.join(indexRoot, INDEX_JSON_NAME) : null,
      indexMarkdownPath: indexRoot ? path.join(indexRoot, INDEX_MARKDOWN_NAME) : null,
      indexedFileCount: entries.length,
      userFileCount,
      artifactFileCount,
      lastIndexedAt: index?.generatedAt || null,
      warning: root.warning ?? null,
    }
  }

  async refreshIndex(projectId: string, signal?: AbortSignal): Promise<ProjectContextStatus> {
    const existing = this.refreshInFlight.get(projectId)
    if (existing) {
      return existing
    }

    const refresh = this.refreshIndexNow(projectId, signal)
      .finally(() => {
        if (this.refreshInFlight.get(projectId) === refresh) {
          this.refreshInFlight.delete(projectId)
        }
      })
    this.refreshInFlight.set(projectId, refresh)
    return refresh
  }

  async ensureFreshIndex(
    projectId: string,
    options?: { maxAgeMs?: number; signal?: AbortSignal },
  ): Promise<ProjectContextStatus> {
    const status = await this.getStatus(projectId)
    if (!status.rootExists) {
      return status
    }

    const maxAgeMs = options?.maxAgeMs ?? PROJECT_INDEX_DEFAULT_MAX_AGE_MS
    const indexedAt = status.lastIndexedAt ? Date.parse(status.lastIndexedAt) : 0
    if (indexedAt > 0 && Date.now() - indexedAt <= maxAgeMs) {
      return status
    }

    return this.refreshIndex(projectId, options?.signal)
  }

  private async refreshIndexNow(projectId: string, signal?: AbortSignal): Promise<ProjectContextStatus> {
    const root = await getProjectRoot(projectId)
    if (!root.rootExists || !root.rootRealPath) {
      return this.getStatus(projectId)
    }

    const previous = await readIndexFile(root)
    const previousByPath = new Map((previous?.entries ?? []).map((entry) => [entry.path, entry]))
    const listedFiles = await this.projectFileService.listFiles(projectId, signal)
    const listedArtifacts = await this.projectArtifactService.listArtifacts(projectId, signal)
    const entries: ProjectContextIndexEntry[] = []

    for (const file of listedFiles.files) {
      const normalizedPath = normalizeSlash(file.path)
      if (isInternalProjectFile(normalizedPath)) continue
      entries.push(await this.buildEntry(root.rootRealPath, file, 'user', previousByPath))
    }

    for (const artifact of listedArtifacts.artifacts) {
      const entry = this.artifactToFileEntry(artifact)
      entries.push(await this.buildEntry(root.rootRealPath, entry, 'artifact', previousByPath))
    }

    entries.sort((a, b) =>
      a.source.localeCompare(b.source) ||
      a.path.localeCompare(b.path, 'zh-CN'),
    )

    const generatedAt = new Date().toISOString()
    const index: ProjectIndexFile = {
      schemaVersion: 1,
      projectId: root.projectId,
      generatedAt,
      entries,
    }
    const indexDir = await ensureXiaoliangDir(root.rootRealPath)
    await atomicWriteText(
      path.join(indexDir, INDEX_JSON_NAME),
      `${JSON.stringify(index, null, 2)}\n`,
    )
    await atomicWriteText(
      path.join(indexDir, INDEX_MARKDOWN_NAME),
      renderIndexMarkdown({
        projectName: root.projectName,
        generatedAt,
        entries,
      }),
    )

    return this.getStatus(projectId)
  }

  async createAgentsFile(projectId: string): Promise<ProjectContextStatus> {
    const root = await getProjectRoot(projectId)
    if (!root.rootExists || !root.rootRealPath) {
      throw new Error(root.warning || '项目目录不可访问。')
    }

    const agentsPath = path.join(root.rootRealPath, AGENTS_FILE_NAME)
    try {
      const existing = await fs.promises.readFile(agentsPath, 'utf-8')
      if (existing.trim()) {
        return this.getStatus(projectId)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    const template = [
      '# AGENTS.md',
      '',
      '## 项目背景',
      '',
      `- 项目名称：${root.projectName || '请填写项目名称'}`,
      '- 项目类型：',
      '- 地区/计价口径：',
      '',
      '## 工程口径',
      '',
      '- 规范、定额、清单口径：',
      '- CAD 图纸读取与算量偏好：',
      '',
      '## 常用资料',
      '',
      '- 完整资料索引见 `.xiaoliang/PROJECT_INDEX.md`。',
      '- 重要说明、清单、合同、图纸导出文件可在这里补充说明。',
      '',
      '## 回答偏好',
      '',
      '- 回答时区分图纸证据、项目资料和联网来源。',
      '- 涉及算量或工程量时，先说明依据和未可靠确认的信息。',
      '',
    ].join('\n')
    await atomicWriteText(agentsPath, template)
    await this.refreshIndex(projectId)
    return this.getStatus(projectId)
  }

  async getAgentsPath(projectId: string): Promise<string> {
    const root = await getProjectRoot(projectId)
    if (!root.rootExists || !root.rootRealPath) {
      throw new Error(root.warning || '项目目录不可访问。')
    }
    return path.join(root.rootRealPath, AGENTS_FILE_NAME)
  }

  async getIndexMarkdownPath(projectId: string): Promise<string> {
    const status = await this.refreshIndex(projectId)
    if (!status.indexMarkdownPath) {
      throw new Error(status.warning || '项目索引不可访问。')
    }
    return status.indexMarkdownPath
  }

  private artifactToFileEntry(artifact: ProjectArtifactEntry): ProjectFileEntry {
    const artifactPath = normalizeSlash(artifact.path)
    const prefixedPath = artifactPath === OUTPUT_ROOT_NAME || artifactPath.startsWith(`${OUTPUT_ROOT_NAME}/`)
      ? artifactPath
      : `${OUTPUT_ROOT_NAME}/${artifactPath}`
    return {
      path: prefixedPath,
      name: artifact.name,
      extension: artifact.extension,
      kind: artifact.kind === 'excel' ? 'xlsx' : artifact.kind === 'markdown' ? 'markdown' : artifact.kind === 'json' ? 'json' : artifact.kind === 'csv' ? 'csv' : artifact.kind === 'text' ? 'text' : 'unsupported',
      supported: true,
      sizeBytes: artifact.sizeBytes,
      modifiedAt: artifact.modifiedAt,
    }
  }

  private async buildEntry(
    rootRealPath: string,
    file: ProjectFileEntry,
    source: ProjectContextIndexEntry['source'],
    previousByPath: Map<string, ProjectContextIndexEntry>,
  ): Promise<ProjectContextIndexEntry> {
    const normalizedPath = normalizeSlash(file.path)
    const previous = previousByPath.get(normalizedPath)
    const stable = {
      path: normalizedPath,
      name: file.name,
      extension: file.extension,
      kind: file.kind,
      supported: file.supported,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
      source,
    }
    if (previousEntryReusable(previous, stable)) {
      return {
        ...stable,
        title: previous!.title,
        tags: previous!.tags,
        description: previous!.description,
      }
    }

    const title = source === 'user'
      ? await inferTitleFromFile(rootRealPath, file)
      : compactLabel(stripExtension(file.name)) || file.name
    const entryBase = {
      ...stable,
      title,
      tags: [] as string[],
      description: '',
    }
    return {
      ...entryBase,
      tags: inferTags(entryBase),
      description: buildDescription(entryBase),
    }
  }
}
