import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  AgentWorkspaceCoreFileName,
  AgentWorkspaceFileStatus,
  AgentWorkspaceProjectIndexEntry,
  AgentWorkspaceStatus,
} from '../../../../src/shared/local-agent'
import { getDB } from '../../db'
import { listProjects } from '../../conversations/conversation-repository'
import { getAgentWorkspaceSettings, saveAgentWorkspaceRoot } from './agent-workspace-repository'

const XIAOLIANG_DIR_NAME = '.xiaoliang'
const INDEX_JSON_NAME = 'workspace-projects.json'
const INDEX_MARKDOWN_NAME = 'WORKSPACE_PROJECTS.md'
const AGENT_WORKSPACE_DEFAULT_MAX_AGE_MS = 5 * 60 * 1_000
const CORE_FILE_MAX_BYTES = 2 * 1024 * 1024
const CORE_FILE_TOTAL_CONTEXT_CHARS = 3_200
const ATOMIC_WRITE_RENAME_MAX_ATTEMPTS = 8
const ATOMIC_WRITE_RENAME_BASE_DELAY_MS = 80
const RETRIABLE_ATOMIC_WRITE_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT'])

export const AGENT_WORKSPACE_CONTEXT_FILE_NAMES = [
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
] as const satisfies readonly AgentWorkspaceCoreFileName[]

export const AGENT_WORKSPACE_MANAGED_FILE_NAMES = [
  ...AGENT_WORKSPACE_CONTEXT_FILE_NAMES,
] as const satisfies readonly AgentWorkspaceCoreFileName[]

export const AGENT_WORKSPACE_ALL_FILE_NAMES = [
  ...AGENT_WORKSPACE_MANAGED_FILE_NAMES,
  'BOOTSTRAP.md',
] as const satisfies readonly AgentWorkspaceCoreFileName[]

const CONTEXT_FILE_MAX_CHARS: Partial<Record<AgentWorkspaceCoreFileName, number>> = {
  'AGENTS.md': 1_100,
  'SOUL.md': 650,
  'IDENTITY.md': 450,
  'USER.md': 650,
  'TOOLS.md': 600,
}

const CORE_FILE_TEMPLATES: Record<(typeof AGENT_WORKSPACE_MANAGED_FILE_NAMES)[number], string> = {
  'AGENTS.md': [
    '# AGENTS.md - Agent Workspace',
    '',
    '这个文件夹是 agent 的全局工作手册和项目历史索引，不是某个工程项目目录。',
    '',
    '- 当前项目的资料、图纸、清单和项目 AGENTS.md 以项目上下文为准。冲突优先级：用户本轮明确要求 > 当前项目规则 > 本 workspace 约定。',
    '- 这里沉淀稳定的工作流程、长期偏好、环境约束和可复用经验；内容保持简洁、可验证、可回滚。',
    '- 日常记忆追加到 `memory/YYYY-MM-DD.md`，长期稳定结论再整理进 `MEMORY.md`。',
    '- 不要记录账号密钥、隐私凭证或无法安全共享的敏感内容。',
    '',
  ].join('\n'),
  'SOUL.md': [
    '# SOUL.md - Who You Are',
    '',
    '- 先自己查清楚：读上下文、用工具、看文件，卡住时再问用户。',
    '- 允许有判断：发现风险、耦合问题或证据不足时直接说清楚。',
    '- 信任来自克制：删除、覆盖、外发、公开发布和敏感信息处理保持边界，不可逆操作需要明确确认。',
    '- 不把临时测试结论写成长期规则；不记录密钥、token、账号或隐私凭证。',
    '',
  ].join('\n'),
  'IDENTITY.md': [
    '# IDENTITY.md - Agent Identity',
    '',
    '- 名称：晓量 Agent',
    '- 定位：工程资料、CAD 图纸、清单与算量辅助 agent',
    '- 工作场景：本机客户端、项目资料目录、CAD 取证子代理、agent workspace',
    '',
  ].join('\n'),
  'USER.md': [
    '# USER.md - User Profile',
    '',
    '- 语言：中文优先。',
    '- 回答：直接说明结论、影响范围和验证结果。',
    '- 实现：简洁、优雅、低耦合；避免引入不必要的全局副作用。',
    '- 工程协作：区分项目资料、CAD 证据和联网来源；WBS/清单/Excel 产物注重可读性与可复核性。',
    '',
  ].join('\n'),
  'TOOLS.md': [
    '# TOOLS.md - Local Notes',
    '',
    '记录这台机器和晓量客户端特有的注意事项。',
    '',
    '- CAD：图纸内容一律经 CAD 取证子代理读取；主 Agent 不直连本机 CAD，也不要求用户手动预处理。',
    '- 项目目录：当前项目资料目录由项目面板绑定；agent workspace 只记录全局背景和项目历史索引。',
    '- 表格：复杂 Excel 产物走项目产物写入能力，保持表头、列宽、筛选和冻结窗格易读。',
    '- 可补充：本机 CAD、Office 解析、打包依赖或 Electron 环境的稳定注意点；不要记录 API key 或敏感路径。',
    '',
  ].join('\n'),
}

/**
 * 历史模板世代。文件内容与其中任一世代完全一致（仅空白差异）时，
 * 视为用户从未手动修改，允许一次性迁移到当前模板。
 */
const LEGACY_CORE_FILE_TEMPLATES: Record<(typeof AGENT_WORKSPACE_MANAGED_FILE_NAMES)[number], string[]> = {
  'AGENTS.md': [
    [
      '# AGENTS.md - Agent Workspace',
      '',
      '这个文件夹是 agent 的家，不是某个工程项目目录。把它当成本机工作手册和项目历史索引。',
      '',
      '## 启动原则',
      '',
      '- 优先使用运行时已经注入的 workspace 摘录，不要为了确认存在而重复读取核心文件。',
      '- 当前项目资料、CAD 图纸、清单和项目 AGENTS.md 仍以项目上下文为准。',
      '- 冲突优先级：用户本轮明确要求 > 当前项目规则 > agent workspace 工作约定。',
      '',
      '## 工作方式',
      '',
      '- 先取证，再结论。项目问题引用项目资料、CAD 证据或联网来源。',
      '- 简洁、优雅、低耦合是默认实现标准；能局部解决就不要引入全局副作用。',
      '- 工具失败时优先说明原因和可靠替代路径。',
    ].join('\n'),
    [
      '# AGENTS.md',
      '',
      '## 全局工作手册',
      '',
      '- 这是 agent 级 workspace，不是某个工程项目目录。',
      '- 项目级资料、图纸、清单和项目规则仍以当前项目目录及其 AGENTS.md 为准。',
      '- 稳定的工作流程、长期偏好、环境约束和可复用经验可以沉淀在这里。',
      '- 不要记录账号密钥、隐私凭证或无法安全共享的敏感内容。',
      '',
      '## 工作原则',
      '',
      '- 先使用本轮对话和当前项目上下文；需要持久记忆时再参考 workspace 记忆。',
      '- 修改长期记忆或工作手册时，应保持简洁、可验证、可回滚。',
      '- 项目证据引用项目相对路径；全局 workspace 内容只作为偏好和工作背景。',
      '- 日常记忆追加到 `memory/YYYY-MM-DD.md`；长期稳定结论再整理到 `MEMORY.md`。',
    ].join('\n'),
  ],
  'SOUL.md': [
    [
      '# SOUL.md - Who You Are',
      '',
      '你不是一个只会答复的聊天窗口。你是晓量客户端里的工程 agent：在用户的本机环境里读资料、看图纸、生成产物。',
      '',
      '## Core Truths',
      '',
      '- 真正有用，而不是看起来热情。少寒暄，多给结论、证据和下一步。',
      '- 先自己查清楚。读上下文、用工具、看文件；卡住时再问用户。',
      '- 允许有判断。发现风险、低耦合问题或证据不足时，直接说清楚。',
      '- 工程场景重可复核。路径、图纸名、handle、坐标、数量、版本和来源要保留。',
      '- 信任来自克制。对删除、覆盖、外发、公开发布和敏感信息处理保持边界。',
      '',
      '## Boundaries',
      '',
      '- 私有资料留在本地语境中；不要主动泄露项目资料、用户偏好或本机环境。',
      '- 不记录密钥、token、账号、密码或隐私凭证。',
      '',
      '## Vibe',
      '',
      '直接、冷静、可靠。该短就短，该细就细。不要表演式自信，不要把不确定说成确定。',
    ].join('\n'),
    [
      '# SOUL.md',
      '',
      '## Persona',
      '',
      '- 面向工程与造价场景，保持直接、严谨、可执行。',
      '- 少寒暄，多给结论、依据和下一步。',
      '- 对不确定的信息标注来源与置信度，不把猜测包装成事实。',
      '',
      '## Boundaries',
      '',
      '- 不主动泄露本地资料、用户偏好或项目隐私。',
      '- 对外发送、删除、覆盖和不可逆操作需要明确确认。',
      '- 不把临时测试结论写成长期规则。',
    ].join('\n'),
  ],
  'IDENTITY.md': [
    [
      '# IDENTITY.md - Agent Identity',
      '',
      '- 名称：晓量 Agent',
      '- 定位：工程资料、CAD 图纸、清单与算量辅助 agent',
      '- 工作场景：本机客户端、项目资料目录、已连接 CAD、agent workspace',
      '- 风格：简洁、务实、重证据',
      '- 主要能力：项目资料检索、DWG/CAD 读取、视觉识图、工程量与 Excel 产物生成',
      '',
      '## Role',
      '',
      '帮助用户把工程资料、图纸证据和算量产物串起来。先做可靠取证，再输出可复核结论。',
    ].join('\n'),
    [
      '# IDENTITY.md',
      '',
      '- 名称：晓量 Agent',
      '- 定位：工程资料、CAD 图纸、清单与算量辅助 agent',
      '- 风格：简洁、务实、重证据',
      '- 主要能力：项目资料检索、图纸读取、视觉识图、工程量表格产物生成',
    ].join('\n'),
  ],
  'USER.md': [
    [
      '# USER.md - User Profile',
      '',
      '## 用户偏好',
      '',
      '- 语言：中文优先。',
      '- 回答：直接说明结论、影响范围和验证结果。',
      '- 实现：简洁、优雅、低耦合；避免引入不必要的全局副作用。',
      '- 需要排查时，先读代码和本地上下文，再给判断。',
      '',
      '## 项目协作',
      '',
      '- 涉及工程资料时区分项目资料、CAD 证据和联网来源。',
      '- 生成 WBS、工程量清单或 Excel 产物时注重可读性和可复核性。',
      '- UI 里不要暴露 agent harness 自己维护的内部文件，除非用户明确要管理它。',
    ].join('\n'),
    [
      '# USER.md',
      '',
      '## 用户偏好',
      '',
      '- 语言：中文优先。',
      '- 回答：直接说明结论、影响范围和验证结果。',
      '- 实现：简洁、优雅、低耦合；避免引入不必要的全局副作用。',
      '',
      '## 项目协作',
      '',
      '- 涉及工程资料时区分项目资料、CAD 证据、知识库和联网来源。',
      '- 生成 WBS、工程量清单或 Excel 产物时注重可读性和可复核性。',
    ].join('\n'),
  ],
  'TOOLS.md': [
    [
      '# TOOLS.md - Local Notes',
      '',
      'Skills 定义工具怎么用；这里记录这台机器和晓量客户端特有的注意事项。',
      '',
      '## 当前约定',
      '',
      '- CAD：通过本机已连接 CAD 读取当前图纸，DWG 项目文件可先打开到 CAD 再读取。',
      '- 项目目录：当前项目资料目录由项目面板绑定；agent workspace 提供工作约定和项目历史索引。',
      '- 表格：复杂 Excel 产物优先使用项目产物写入能力，保持表头、列宽、筛选和冻结窗格易读。',
      '',
      '## 可记录内容',
      '',
      '- 本机 CAD、项目资料、PDF/Word/Excel、打包依赖或 Electron 环境的稳定注意点。',
      '- 不要记录 API key、账号、私有凭证或完整敏感路径。',
    ].join('\n'),
    [
      '# TOOLS.md',
      '',
      '## 本机环境笔记',
      '',
      '- CAD：通过本机已连接 CAD 读取当前图纸，DWG 项目文件可先打开到 CAD 再读取。',
      '- 项目目录：当前项目资料目录由项目面板绑定；agent workspace 只记录全局背景和项目历史索引。',
      '- 表格：复杂 Excel 产物优先使用项目产物写入能力，保持表头、列宽、筛选和冻结窗格易读。',
    ].join('\n'),
  ],
}

function normalizeTemplateForComparison(content: string) {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function isContextFileName(name: AgentWorkspaceCoreFileName) {
  return AGENT_WORKSPACE_CONTEXT_FILE_NAMES.some((candidate) => candidate === name)
}

interface AgentWorkspaceRootInfo {
  rootPath: string | null
  rootExists: boolean
  rootRealPath: string | null
  warning?: string | null
}

interface AgentWorkspaceIndexFile {
  schemaVersion: 1
  generatedAt: string
  entries: AgentWorkspaceProjectIndexEntry[]
}

export function resolveDefaultAgentWorkspaceRoot() {
  const homePath = app.getPath('home')?.trim()
  const basePath = homePath || app.getPath('userData')
  return path.join(basePath, '.xiaoliang', 'agent-workspace')
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function escapeMarkdownTable(value: string | null | undefined) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function clipText(value: string, maxChars: number, suffix: string) {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) {
    return { content: trimmed, truncated: false }
  }
  return {
    content: `${trimmed.slice(0, Math.max(0, maxChars - suffix.length - 2))}\n\n${suffix}`,
    truncated: true,
  }
}

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
      console.warn('[agent-workspace] failed to remove temp file', tempPath, error)
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

async function writeFileIfMissing(filePath: string, content: string) {
  try {
    await fs.promises.writeFile(filePath, content, {
      encoding: 'utf-8',
      flag: 'wx',
    })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
}

/**
 * 缺失时写入当前模板；已存在且内容仍等于任一历史模板世代（用户未改过）时，
 * 一次性迁移到当前模板。用户改过的文件永不覆盖。
 */
async function ensureCoreFileCurrent(
  filePath: string,
  name: (typeof AGENT_WORKSPACE_MANAGED_FILE_NAMES)[number],
) {
  const created = await writeFileIfMissing(filePath, CORE_FILE_TEMPLATES[name])
  if (created) return

  let existing: string
  try {
    existing = await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return
  }

  const normalized = normalizeTemplateForComparison(existing)
  if (normalized === normalizeTemplateForComparison(CORE_FILE_TEMPLATES[name])) {
    return
  }
  const isUntouchedLegacy = LEGACY_CORE_FILE_TEMPLATES[name].some(
    (legacy) => normalizeTemplateForComparison(legacy) === normalized,
  )
  if (!isUntouchedLegacy) return

  try {
    await atomicWriteText(filePath, CORE_FILE_TEMPLATES[name])
  } catch (error) {
    console.warn('[agent-workspace] failed to migrate legacy template', filePath, error)
  }
}

async function getRootInfo(): Promise<AgentWorkspaceRootInfo> {
  const settings = getAgentWorkspaceSettings()
  const rootPath = settings.rootPath?.trim() || null
  if (!rootPath) {
    return {
      rootPath: null,
      rootExists: false,
      rootRealPath: null,
      warning: '尚未指定 agent workspace 文件夹。',
    }
  }

  try {
    const stat = await fs.promises.stat(rootPath)
    if (!stat.isDirectory()) {
      return {
        rootPath,
        rootExists: false,
        rootRealPath: null,
        warning: 'agent workspace 路径存在，但不是文件夹。',
      }
    }
    return {
      rootPath,
      rootExists: true,
      rootRealPath: await fs.promises.realpath(rootPath),
      warning: null,
    }
  } catch (error) {
    return {
      rootPath,
      rootExists: false,
      rootRealPath: null,
      warning: `agent workspace 不可访问：${error instanceof Error ? error.message : String(error)}`,
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
    throw new Error(`${XIAOLIANG_DIR_NAME} 指向 agent workspace 之外，已拒绝。`)
  }
  return realPath
}

function createMissingFileStatus(
  root: AgentWorkspaceRootInfo,
  name: AgentWorkspaceCoreFileName,
): AgentWorkspaceFileStatus {
  return {
    name,
    path: root.rootRealPath ? path.join(root.rootRealPath, name) : null,
    exists: false,
    loadedInContext: isContextFileName(name),
    sizeBytes: null,
    modifiedAt: null,
    truncated: false,
    content: null,
    warning: root.rootExists ? null : root.warning,
  }
}

async function readCoreFileStatus(
  root: AgentWorkspaceRootInfo,
  name: AgentWorkspaceCoreFileName,
  options: { includeContent: boolean; remainingContextChars: number },
): Promise<AgentWorkspaceFileStatus> {
  const loadedInContext = isContextFileName(name)
  if (!root.rootExists || !root.rootRealPath) {
    return createMissingFileStatus(root, name)
  }

  const filePath = path.join(root.rootRealPath, name)
  try {
    const realPath = await fs.promises.realpath(filePath)
    if (!isPathInsideRoot(root.rootRealPath, realPath)) {
      return {
        ...createMissingFileStatus(root, name),
        exists: true,
        warning: `${name} 指向 agent workspace 之外，已拒绝读取。`,
      }
    }

    const stat = await fs.promises.stat(realPath)
    if (!stat.isFile()) {
      return {
        ...createMissingFileStatus(root, name),
        exists: true,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        warning: `${name} 存在但不是文件。`,
      }
    }

    const base: AgentWorkspaceFileStatus = {
      name,
      path: realPath,
      exists: true,
      loadedInContext,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      truncated: false,
      content: null,
      warning: null,
    }

    if (!options.includeContent || !loadedInContext) {
      return base
    }
    if (stat.size > CORE_FILE_MAX_BYTES) {
      return {
        ...base,
        warning: `${name} 超过 ${Math.round(CORE_FILE_MAX_BYTES / 1024 / 1024)}MB，未进入上下文。`,
      }
    }
    if (options.remainingContextChars <= 0) {
      return {
        ...base,
        truncated: true,
        warning: `${name} 因 agent workspace 上下文预算不足，未加载内容。`,
      }
    }

    const raw = await fs.promises.readFile(realPath, 'utf-8')
    const perFileMax = Math.min(
      CONTEXT_FILE_MAX_CHARS[name] ?? 1_000,
      options.remainingContextChars,
    )
    const clipped = clipText(raw, perFileMax, `[${name} 内容过长，已截断。]`)
    return {
      ...base,
      content: clipped.content,
      truncated: clipped.truncated,
      warning: clipped.truncated ? `${name} 内容较长，已按上下文预算截断。` : null,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createMissingFileStatus(root, name)
    }
    return {
      ...createMissingFileStatus(root, name),
      warning: `${name} 读取失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function readCoreFileStatuses(
  root: AgentWorkspaceRootInfo,
  includeContent: boolean,
): Promise<AgentWorkspaceFileStatus[]> {
  const statuses: AgentWorkspaceFileStatus[] = []
  let remainingContextChars = CORE_FILE_TOTAL_CONTEXT_CHARS
  for (const name of AGENT_WORKSPACE_ALL_FILE_NAMES) {
    const status = await readCoreFileStatus(root, name, {
      includeContent,
      remainingContextChars,
    })
    if (includeContent && status.loadedInContext && status.content) {
      remainingContextChars = Math.max(0, remainingContextChars - status.content.length)
    }
    statuses.push(status)
  }
  return statuses
}

async function readIndexFile(root: AgentWorkspaceRootInfo): Promise<AgentWorkspaceIndexFile | null> {
  if (!root.rootExists || !root.rootRealPath) return null
  const indexPath = path.join(root.rootRealPath, XIAOLIANG_DIR_NAME, INDEX_JSON_NAME)
  try {
    const realPath = await fs.promises.realpath(indexPath)
    if (!isPathInsideRoot(root.rootRealPath, realPath)) return null
    const raw = await fs.promises.readFile(realPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AgentWorkspaceIndexFile>
    if (!Array.isArray(parsed.entries)) return null
    return {
      schemaVersion: 1,
      generatedAt: String(parsed.generatedAt || ''),
      entries: parsed.entries.filter((entry): entry is AgentWorkspaceProjectIndexEntry =>
        Boolean(entry && typeof entry.projectId === 'string' && typeof entry.name === 'string'),
      ),
    }
  } catch {
    return null
  }
}

function countByProjectId(sql: string) {
  return new Map(
    (getDB().prepare(sql).all() as Array<{ project_id: string; count: number }>).map((row) => [
      row.project_id,
      row.count,
    ]),
  )
}

function buildProjectEntries(): AgentWorkspaceProjectIndexEntry[] {
  const conversationCounts = countByProjectId(
    `SELECT project_id, count(*) AS count
       FROM conversations
      WHERE project_id IS NOT NULL AND project_id <> ''
      GROUP BY project_id`,
  )
  const drawingCounts = countByProjectId(
    `SELECT project_id, count(*) AS count
       FROM drawings
      GROUP BY project_id`,
  )

  return listProjects()
    .map((project) => ({
      projectId: project.id,
      name: project.name,
      description: project.description,
      rootPath: project.rootPath,
      rootPathExists: project.rootPathExists,
      rootPathUpdatedAt: project.rootPathUpdatedAt,
      conversationCount: conversationCounts.get(project.id) ?? 0,
      drawingCount: drawingCounts.get(project.id) ?? 0,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh-CN'))
}

function renderIndexMarkdown(input: {
  generatedAt: string
  entries: AgentWorkspaceProjectIndexEntry[]
}) {
  const lines = [
    '# 晓量 Agent Workspace 项目历史索引',
    '',
    '> 本文件由晓量自动生成，请不要手动编辑。全局规则请维护 agent workspace 根目录中的 `AGENTS.md`，项目规则请维护对应项目根目录中的 `AGENTS.md`。',
    '',
    `更新时间：${input.generatedAt}`,
    `项目数：${input.entries.length}`,
    '',
    '## 使用方式',
    '',
    '- 本索引用于让 agent 了解做过哪些项目，以及项目资料目录的位置和可访问状态。',
    '- 项目资料的详细文件索引仍在各项目目录的 `.xiaoliang/PROJECT_INDEX.md`。',
    '- 回答具体项目问题时，以当前会话绑定项目和项目资料证据为准。',
    '',
  ]

  if (input.entries.length === 0) {
    lines.push('暂无项目。', '')
    return lines.join('\n')
  }

  lines.push('| 项目 | 项目目录 | 目录状态 | 对话 | 图纸 | 更新时间 | 说明 |')
  lines.push('| --- | --- | --- | ---: | ---: | --- | --- |')
  for (const entry of input.entries) {
    lines.push(
      `| ${escapeMarkdownTable(entry.name)} | ${escapeMarkdownTable(entry.rootPath)} | ${entry.rootPathExists ? '可访问' : '未绑定/不可访问'} | ${entry.conversationCount} | ${entry.drawingCount} | ${escapeMarkdownTable(entry.updatedAt)} | ${escapeMarkdownTable(entry.description)} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

export class AgentWorkspaceService {
  private refreshInFlight: Promise<AgentWorkspaceStatus> | null = null
  private ensureReadyInFlight: Promise<AgentWorkspaceStatus> | null = null

  async ensureWorkspaceReady(): Promise<AgentWorkspaceStatus> {
    if (this.ensureReadyInFlight) {
      return this.ensureReadyInFlight
    }

    this.ensureReadyInFlight = this.ensureWorkspaceReadyNow()
      .finally(() => {
        this.ensureReadyInFlight = null
      })
    return this.ensureReadyInFlight
  }

  private async ensureWorkspaceReadyNow(): Promise<AgentWorkspaceStatus> {
    const settings = getAgentWorkspaceSettings()
    if (!settings.rootPath) {
      saveAgentWorkspaceRoot(resolveDefaultAgentWorkspaceRoot())
    }

    const root = await getRootInfo()
    if (!root.rootExists && root.rootPath) {
      await fs.promises.mkdir(root.rootPath, { recursive: true })
    }

    const refreshedRoot = await getRootInfo()
    if (!refreshedRoot.rootExists || !refreshedRoot.rootRealPath) {
      return this.getStatus()
    }

    for (const name of AGENT_WORKSPACE_MANAGED_FILE_NAMES) {
      await ensureCoreFileCurrent(path.join(refreshedRoot.rootRealPath, name), name)
    }
    return this.refreshIndex()
  }

  async getStatus(options: { includeContextContent?: boolean } = {}): Promise<AgentWorkspaceStatus> {
    const root = await getRootInfo()
    const coreFiles = await readCoreFileStatuses(root, Boolean(options.includeContextContent))
    const index = await readIndexFile(root)
    const indexRoot = root.rootRealPath ? path.join(root.rootRealPath, XIAOLIANG_DIR_NAME) : null
    const initialized = AGENT_WORKSPACE_MANAGED_FILE_NAMES.every((name) =>
      coreFiles.some((file) => file.name === name && file.exists),
    )

    return {
      rootPath: root.rootPath,
      rootExists: root.rootExists,
      initialized,
      coreFiles,
      indexJsonPath: indexRoot ? path.join(indexRoot, INDEX_JSON_NAME) : null,
      indexMarkdownPath: indexRoot ? path.join(indexRoot, INDEX_MARKDOWN_NAME) : null,
      projectEntries: index?.entries ?? [],
      indexedProjectCount: index?.entries.length ?? 0,
      lastIndexedAt: index?.generatedAt || null,
      warning: root.warning ?? null,
    }
  }

  async setRootDirectory(rootPath: string | null): Promise<AgentWorkspaceStatus> {
    const normalizedRoot = rootPath?.trim() || null
    if (!normalizedRoot) {
      saveAgentWorkspaceRoot(null)
      return this.getStatus()
    }

    const stat = await fs.promises.stat(normalizedRoot)
    if (!stat.isDirectory()) {
      throw new Error('agent workspace 路径存在，但不是文件夹。')
    }
    const realPath = await fs.promises.realpath(normalizedRoot)
    saveAgentWorkspaceRoot(realPath)
    return this.ensureWorkspaceReady()
  }

  clearRootDirectory(): Promise<AgentWorkspaceStatus> {
    saveAgentWorkspaceRoot(null)
    return this.ensureWorkspaceReady()
  }

  async initializeWorkspace(): Promise<AgentWorkspaceStatus> {
    const root = await getRootInfo()
    if (!root.rootExists || !root.rootRealPath) {
      throw new Error(root.warning || 'agent workspace 不可访问。')
    }

    for (const name of AGENT_WORKSPACE_MANAGED_FILE_NAMES) {
      await ensureCoreFileCurrent(path.join(root.rootRealPath, name), name)
    }
    await this.refreshIndex()
    return this.getStatus()
  }

  async refreshIndex(): Promise<AgentWorkspaceStatus> {
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    this.refreshInFlight = this.refreshIndexNow()
      .finally(() => {
        this.refreshInFlight = null
      })
    return this.refreshInFlight
  }

  async ensureFreshIndex(options: { maxAgeMs?: number } = {}): Promise<AgentWorkspaceStatus> {
    await this.ensureWorkspaceReady()
    const status = await this.getStatus({ includeContextContent: true })
    if (!status.rootExists) {
      return status
    }

    const maxAgeMs = options.maxAgeMs ?? AGENT_WORKSPACE_DEFAULT_MAX_AGE_MS
    const indexedAt = status.lastIndexedAt ? Date.parse(status.lastIndexedAt) : 0
    if (indexedAt > 0 && Date.now() - indexedAt <= maxAgeMs) {
      return status
    }

    return this.refreshIndex()
      .then(() => this.getStatus({ includeContextContent: true }))
  }

  async getDirectoryPath(): Promise<string> {
    await this.ensureWorkspaceReady()
    const root = await getRootInfo()
    if (!root.rootExists || !root.rootRealPath) {
      throw new Error(root.warning || 'agent workspace 不可访问。')
    }
    return root.rootRealPath
  }

  async getIndexMarkdownPath(): Promise<string> {
    await this.ensureWorkspaceReady()
    const status = await this.refreshIndex()
    if (!status.indexMarkdownPath) {
      throw new Error(status.warning || 'agent workspace 项目历史索引不可访问。')
    }
    return status.indexMarkdownPath
  }

  async getCoreFilePath(fileName: AgentWorkspaceCoreFileName): Promise<string> {
    await this.ensureWorkspaceReady()
    if (!AGENT_WORKSPACE_ALL_FILE_NAMES.includes(fileName)) {
      throw new Error(`不支持的 agent workspace 文件：${fileName}`)
    }
    const root = await getRootInfo()
    if (!root.rootExists || !root.rootRealPath) {
      throw new Error(root.warning || 'agent workspace 不可访问。')
    }
    const filePath = path.join(root.rootRealPath, fileName)
    try {
      const realPath = await fs.promises.realpath(filePath)
      if (!isPathInsideRoot(root.rootRealPath, realPath)) {
        throw new Error(`${fileName} 指向 agent workspace 之外，已拒绝打开。`)
      }
      return realPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return filePath
      }
      throw error
    }
  }

  private async refreshIndexNow(): Promise<AgentWorkspaceStatus> {
    const root = await getRootInfo()
    if (!root.rootExists || !root.rootRealPath) {
      return this.getStatus()
    }

    const entries = buildProjectEntries()
    const generatedAt = new Date().toISOString()
    const index: AgentWorkspaceIndexFile = {
      schemaVersion: 1,
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
      renderIndexMarkdown({ generatedAt, entries }),
    )

    return this.getStatus()
  }
}
