import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import {
  SessionManager,
  sessionEntryToContextMessages,
  type SessionEntry,
  type SessionTreeNode,
} from '@earendil-works/pi-coding-agent'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildStableMessageRecordIds,
  getConversationSnapshot,
  persistPiConversationProjection,
  type PiSessionMessageProjection,
} from '../../conversations/conversation-repository'
import { getDB } from '../../db'
import { resetPiSessionArchiveState } from '../../project-sync/pi-session-archive-state'
import type {
  ConversationTreeEntryType,
  ConversationTreeMessageRole,
  ConversationTreeNode,
  ConversationTreeSnapshot,
} from '../../../../src/shared/local-agent'
import { SUBAGENT_COMPLETION_CUSTOM_TYPE } from '../../../../src/shared/subagent-completion'

export const XIAOLIANG_PI_RUNTIME_VERSION = 2
export const LEGACY_CHECKPOINT_CUSTOM_TYPE = 'xiaoliang.legacy_checkpoint'
export const ACTIVE_PATH_CUSTOM_TYPE = 'xiaoliang.active_path'

export type PiSessionMigrationStatus = 'migrating' | 'ready' | 'failed'

export interface ConversationPiSessionBinding {
  conversationId: string
  piSessionId: string
  piSessionFile: string
  parentConversationId: string | null
  forkedFromEntryId: string | null
  runtimeVersion: number
  migrationStatus: PiSessionMigrationStatus
  migrationError: string
  createdAt: string
  updatedAt: string
}

interface ConversationPiSessionBindingRow {
  conversation_id: string
  pi_session_id: string
  pi_session_file: string
  parent_conversation_id: string | null
  forked_from_entry_id: string | null
  runtime_version: number
  migration_status: PiSessionMigrationStatus
  migration_error: string
  created_at: string
  updated_at: string
}

export interface PreparedConversationPiSession {
  binding: ConversationPiSessionBinding
  sessionManager: SessionManager
  migratedLegacyMessages: boolean
}

function mapBinding(row: ConversationPiSessionBindingRow): ConversationPiSessionBinding {
  return {
    conversationId: row.conversation_id,
    piSessionId: row.pi_session_id,
    piSessionFile: row.pi_session_file,
    parentConversationId: row.parent_conversation_id,
    forkedFromEntryId: row.forked_from_entry_id,
    runtimeVersion: row.runtime_version,
    migrationStatus: row.migration_status,
    migrationError: row.migration_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getConversationPiSessionBinding(
  conversationId: string,
): ConversationPiSessionBinding | null {
  const row = getDB()
    .prepare(
      `SELECT conversation_id, pi_session_id, pi_session_file,
              parent_conversation_id, forked_from_entry_id, runtime_version,
              migration_status, migration_error, created_at, updated_at
         FROM conversation_session_bindings
        WHERE conversation_id = ?`,
    )
    .get(conversationId) as ConversationPiSessionBindingRow | undefined
  return row ? mapBinding(row) : null
}

export function listConversationPiSessionBindings(): ConversationPiSessionBinding[] {
  return (getDB()
    .prepare(
      `SELECT conversation_id, pi_session_id, pi_session_file,
              parent_conversation_id, forked_from_entry_id, runtime_version,
              migration_status, migration_error, created_at, updated_at
         FROM conversation_session_bindings
        ORDER BY datetime(updated_at) DESC, rowid DESC`,
    )
    .all() as ConversationPiSessionBindingRow[]).map(mapBinding)
}

export function upsertConversationPiSessionBinding(input: {
  conversationId: string
  piSessionId: string
  piSessionFile: string
  parentConversationId?: string | null
  forkedFromEntryId?: string | null
  runtimeVersion?: number
  migrationStatus: PiSessionMigrationStatus
  migrationError?: string
  clearMessageMappings?: boolean
}): ConversationPiSessionBinding {
  const db = getDB()
  const existingArchiveIdentity = db.prepare(
    `SELECT pi_session_id, pi_session_file
       FROM conversation_session_bindings
      WHERE conversation_id = ?`,
  ).get(input.conversationId) as {
    pi_session_id: string
    pi_session_file: string
  } | undefined
  const archiveIdentityChanged = Boolean(
    existingArchiveIdentity
    && (
      existingArchiveIdentity.pi_session_id !== input.piSessionId
      || existingArchiveIdentity.pi_session_file !== input.piSessionFile
    ),
  )
  db.transaction(() => {
    db.prepare(
      `INSERT INTO conversation_session_bindings (
        conversation_id, pi_session_id, pi_session_file,
        parent_conversation_id, forked_from_entry_id, runtime_version,
        migration_status, migration_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
      ON CONFLICT(conversation_id) DO UPDATE SET
        pi_session_id = excluded.pi_session_id,
        pi_session_file = excluded.pi_session_file,
        parent_conversation_id = excluded.parent_conversation_id,
        forked_from_entry_id = excluded.forked_from_entry_id,
        runtime_version = excluded.runtime_version,
        migration_status = excluded.migration_status,
        migration_error = excluded.migration_error,
        updated_at = datetime('now','localtime')`,
    ).run(
      input.conversationId,
      input.piSessionId,
      input.piSessionFile,
      input.parentConversationId ?? null,
      input.forkedFromEntryId ?? null,
      input.runtimeVersion ?? XIAOLIANG_PI_RUNTIME_VERSION,
      input.migrationStatus,
      input.migrationError ?? '',
    )
    if (archiveIdentityChanged) {
      resetPiSessionArchiveState(input.conversationId)
    }
    if (input.clearMessageMappings) {
      db.prepare(
        'DELETE FROM conversation_message_id_mappings WHERE conversation_id = ?',
      ).run(input.conversationId)
    }
  })()

  const binding = getConversationPiSessionBinding(input.conversationId)
  if (!binding) {
    throw new Error(`Failed to bind Pi session for conversation ${input.conversationId}.`)
  }
  return binding
}

function isPersistableMessage(message: AgentMessage): boolean {
  const role = (message as { role?: unknown }).role
  return role === 'user' || role === 'assistant' || role === 'toolResult'
}

function projectableSessionMessage(entry: SessionEntry): AgentMessage | null {
  if (entry.type === 'message') {
    return isPersistableMessage(entry.message) ? entry.message : null
  }
  if (
    entry.type === 'custom_message'
    && entry.customType === SUBAGENT_COMPLETION_CUSTOM_TYPE
  ) {
    return sessionEntryToContextMessages(entry)[0] ?? null
  }
  return null
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = path.resolve(parentPath)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function getManagedPiSessionDirectory(agentDir: string): string {
  return path.join(path.resolve(agentDir), 'sessions')
}

function assertManagedSessionFile(sessionDir: string, sessionFile: string) {
  if (!isPathInside(sessionDir, sessionFile)) {
    throw new Error(`Pi session file escaped the managed session directory: ${sessionFile}`)
  }
  if (path.extname(sessionFile).toLowerCase() !== '.jsonl') {
    throw new Error(`Pi session file must use the .jsonl extension: ${sessionFile}`)
  }
}

/**
 * Pi normally delays creating a JSONL file until the first assistant message.
 * Xiaoliang materializes the generated header immediately so a newly bound
 * conversation survives an abnormal exit before its first completed turn.
 */
export function createMaterializedPiSession(input: {
  cwd: string
  sessionDir: string
  name?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  parentSession?: string
}): SessionManager {
  fs.mkdirSync(input.sessionDir, { recursive: true })
  const created = SessionManager.create(input.cwd, input.sessionDir, {
    parentSession: input.parentSession,
  })
  const sessionFile = created.getSessionFile()
  const header = created.getHeader()
  if (!sessionFile || !header) {
    throw new Error('Pi failed to allocate a persistent session file.')
  }
  assertManagedSessionFile(input.sessionDir, sessionFile)
  fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })

  const sessionManager = SessionManager.open(sessionFile, input.sessionDir, input.cwd)
  if (input.name?.trim()) {
    sessionManager.appendSessionInfo(input.name.trim())
  }
  if (input.modelProvider?.trim() && input.modelId?.trim()) {
    sessionManager.appendModelChange(input.modelProvider.trim(), input.modelId.trim())
  }
  if (input.thinkingLevel) {
    sessionManager.appendThinkingLevelChange(input.thinkingLevel)
  }
  return sessionManager
}

function projectSession(input: {
  conversationId: string
  title: string
  sessionManager: SessionManager
  legacyMessageIdsByEntryId?: ReadonlyMap<string, string>
  touchUpdatedAt?: boolean
}) {
  const entries: PiSessionMessageProjection[] = input.sessionManager
    .getBranch()
    .flatMap((entry) => {
      const message = projectableSessionMessage(entry)
      if (!message) return []
      return [{
        piEntryId: entry.id,
        message,
        legacyMessageId: input.legacyMessageIdsByEntryId?.get(entry.id),
      }]
    })
  persistPiConversationProjection({
    conversationId: input.conversationId,
    title: input.title,
    piSessionId: input.sessionManager.getSessionId(),
    entries,
    touchUpdatedAt: input.touchUpdatedAt,
  })
}

export function rebuildConversationPiProjection(input: {
  conversationId: string
  title: string
  sessionManager: SessionManager
}) {
  projectSession({ ...input, touchUpdatedAt: true })
}

export function summarizePiSession(sessionManager: SessionManager) {
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let toolResults = 0
  let totalMessages = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let cost = 0

  const addUsage = (usage: any) => {
    if (!usage || typeof usage !== 'object') return
    inputTokens += Number(usage.input) || 0
    outputTokens += Number(usage.output) || 0
    cacheReadTokens += Number(usage.cacheRead) || 0
    cacheWriteTokens += Number(usage.cacheWrite) || 0
    cost += Number(usage.cost?.total) || 0
  }

  for (const entry of sessionManager.getEntries()) {
    if ((entry.type === 'branch_summary' || entry.type === 'compaction') && entry.usage) {
      addUsage(entry.usage)
    }
    if (entry.type !== 'message') continue
    totalMessages += 1
    const message = entry.message as any
    if (message.role === 'user') {
      userMessages += 1
    } else if (message.role === 'assistant') {
      assistantMessages += 1
      if (Array.isArray(message.content)) {
        toolCalls += message.content.filter((part: any) => part?.type === 'toolCall').length
      }
      addUsage(message.usage)
    } else if (message.role === 'toolResult') {
      toolResults += 1
      addUsage(message.usage)
    }
  }

  return {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      total: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    },
    cost,
  }
}

function compactPreview(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const value = part as Record<string, unknown>
    if (value.type === 'text' || value.type === 'thinking') {
      return typeof value.text === 'string' ? [value.text] : []
    }
    if (value.type === 'toolCall') {
      return typeof value.name === 'string' ? [`调用 ${value.name}`] : ['工具调用']
    }
    return []
  }).join(' ')
}

function messageRole(entry: SessionEntry): ConversationTreeMessageRole | null {
  if (entry.type !== 'message') return null
  const role = (entry.message as { role?: unknown }).role
  if (role === 'user' || role === 'assistant') return role
  return role === 'toolResult' ? 'tool' : null
}

function entryPreview(entry: SessionEntry): string {
  if (entry.type === 'message') {
    const message = entry.message as {
      role?: unknown
      content?: unknown
      toolName?: unknown
      errorMessage?: unknown
    }
    const text = compactPreview(contentText(message.content))
    if (message.role === 'user') return text || '用户消息'
    if (message.role === 'assistant') {
      if (text) return text
      return typeof message.errorMessage === 'string' && message.errorMessage.trim()
        ? compactPreview(message.errorMessage)
        : '助手消息'
    }
    if (message.role === 'toolResult') {
      const toolName = typeof message.toolName === 'string' ? message.toolName.trim() : ''
      return compactPreview(`${toolName ? `${toolName} · ` : ''}${text || '工具结果'}`)
    }
    return '消息'
  }
  if (entry.type === 'compaction') return compactPreview(`上下文压缩 · ${entry.summary}`)
  if (entry.type === 'branch_summary') return compactPreview(`分支摘要 · ${entry.summary}`)
  if (entry.type === 'thinking_level_change') return `思考级别 · ${entry.thinkingLevel}`
  if (entry.type === 'model_change') return `模型 · ${entry.provider}/${entry.modelId}`
  if (entry.type === 'session_info') return `会话名称 · ${entry.name || '未命名'}`
  if (entry.type === 'label') return `书签更新 · ${entry.label || '已清除'}`
  if (entry.type === 'custom_message') return compactPreview(contentText(entry.content)) || '自定义消息'
  if (entry.type === 'custom') {
    return entry.customType === ACTIVE_PATH_CUSTOM_TYPE
      ? '当前路径锚点'
      : `运行时记录 · ${entry.customType}`
  }
  return '未知运行时记录'
}

function assistantToolCallIds(entry: SessionEntry): Set<string> {
  if (entry.type !== 'message') return new Set()
  const message = entry.message as { role?: unknown; content?: unknown }
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return new Set()
  return new Set(message.content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const candidate = part as { type?: unknown; id?: unknown }
    return candidate.type === 'toolCall' && typeof candidate.id === 'string' && candidate.id
      ? [candidate.id]
      : []
  }))
}

interface ToolResultContinuation {
  leafId: string
  count: number
  activeCount: number
}

function resolveToolResultContinuation(
  sessionManager: SessionManager,
  assistantEntry: SessionEntry,
  activePathIds: ReadonlySet<string>,
): ToolResultContinuation {
  const expectedToolCallIds = assistantToolCallIds(assistantEntry)
  let best: ToolResultContinuation = {
    leafId: assistantEntry.id,
    count: 0,
    activeCount: activePathIds.has(assistantEntry.id) ? 1 : 0,
  }
  if (expectedToolCallIds.size === 0) return best

  const stack: Array<{
    entryId: string
    remaining: Set<string>
    count: number
    activeCount: number
  }> = [{
    entryId: assistantEntry.id,
    remaining: expectedToolCallIds,
    count: 0,
    activeCount: best.activeCount,
  }]

  while (stack.length > 0) {
    const current = stack.pop() as (typeof stack)[number]
    const candidates = sessionManager.getChildren(current.entryId).filter((child) => {
      if (child.type !== 'message') return false
      const message = child.message as { role?: unknown; toolCallId?: unknown }
      return message.role === 'toolResult'
        && typeof message.toolCallId === 'string'
        && current.remaining.has(message.toolCallId)
    })
    if (candidates.length === 0) {
      if (
        current.count > best.count
        || (current.count === best.count && current.activeCount > best.activeCount)
      ) {
        best = {
          leafId: current.entryId,
          count: current.count,
          activeCount: current.activeCount,
        }
      }
      continue
    }

    for (const child of candidates) {
      const message = child.type === 'message'
        ? child.message as { toolCallId?: unknown }
        : {}
      const remaining = new Set(current.remaining)
      remaining.delete(String(message.toolCallId))
      stack.push({
        entryId: child.id,
        remaining,
        count: current.count + 1,
        activeCount: current.activeCount + (activePathIds.has(child.id) ? 1 : 0),
      })
    }
  }

  return best
}

export function resolvePiCloneTarget(
  sessionManager: SessionManager,
  targetEntryId: string,
): { leafId: string; toolResultCount: number } {
  const target = sessionManager.getEntry(targetEntryId)
  if (!target) throw new Error(`Pi Tree entry 不存在: ${targetEntryId}`)
  const activePathIds = new Set(sessionManager.getBranch().map((entry) => entry.id))
  const continuation = resolveToolResultContinuation(
    sessionManager,
    target,
    activePathIds,
  )
  return {
    leafId: continuation.leafId,
    toolResultCount: continuation.count,
  }
}

export function buildConversationPiTreeSnapshot(input: {
  conversationId: string
  sessionManager: SessionManager
  forkedChildCounts?: ReadonlyMap<string, number>
}): ConversationTreeSnapshot {
  const { sessionManager } = input
  const activePathIds = new Set(sessionManager.getBranch().map((entry) => entry.id))
  const leafId = sessionManager.getLeafId()
  const nodes: ConversationTreeNode[] = []
  const stack: Array<{ node: SessionTreeNode; depth: number }> = sessionManager
    .getTree()
    .toReversed()
    .map((node) => ({ node, depth: 0 }))

  while (stack.length > 0) {
    const { node, depth } = stack.pop() as (typeof stack)[number]
    const entry = node.entry
    const cloneTarget = resolveToolResultContinuation(
      sessionManager,
      entry,
      activePathIds,
    )
    const role = messageRole(entry)
    nodes.push({
      id: entry.id,
      parentId: entry.parentId,
      type: entry.type as ConversationTreeEntryType,
      role,
      timestamp: entry.timestamp,
      preview: entryPreview(entry),
      label: node.label ?? null,
      depth,
      childCount: node.children.length,
      isActivePath: activePathIds.has(entry.id),
      isLeaf: entry.id === leafId,
      canForkBefore: role === 'user',
      canCloneAt: entry.type !== 'label' && entry.type !== 'session_info',
      cloneToolResultCount: cloneTarget.count,
      forkedChildCount: input.forkedChildCounts?.get(entry.id) ?? 0,
    })
    for (const child of node.children.toReversed()) {
      stack.push({ node: child, depth: depth + 1 })
    }
  }

  return {
    conversationId: input.conversationId,
    sessionId: sessionManager.getSessionId(),
    parentSessionFile: sessionManager.getHeader()?.parentSession ?? null,
    leafId,
    nodes,
    cloudSyncScope: 'active_path',
  }
}

export function appendPiActivePathMarker(
  sessionManager: SessionManager,
  targetEntryId: string,
): string {
  return sessionManager.appendCustomEntry(ACTIVE_PATH_CUSTOM_TYPE, {
    targetEntryId,
    navigatedAt: new Date().toISOString(),
  })
}

function materializeCurrentSessionFile(sessionManager: SessionManager): string {
  const sessionFile = sessionManager.getSessionFile()
  const header = sessionManager.getHeader()
  if (!sessionFile || !header) {
    throw new Error('Pi 分支没有可持久化的 session 文件。')
  }
  if (!fs.existsSync(sessionFile)) {
    const lines = [header, ...sessionManager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join('\n')
    fs.writeFileSync(sessionFile, `${lines}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  return sessionFile
}

export function createConversationPiBranch(input: {
  sourceSessionFile: string
  targetEntryId: string
  mode: 'fork_before' | 'clone_at'
  cwd: string
  agentDir: string
  title: string
  modelProvider: string
  modelId: string
  thinkingLevel: ThinkingLevel
}): {
  sessionManager: SessionManager
  selectedText: string
  clonedThroughEntryId: string | null
  clonedToolResultCount: number
} {
  const sessionDir = getManagedPiSessionDirectory(input.agentDir)
  assertManagedSessionFile(sessionDir, input.sourceSessionFile)
  if (!fs.existsSync(input.sourceSessionFile)) {
    throw new Error('源 Pi session 文件不存在，无法创建分支。')
  }

  const source = SessionManager.open(input.sourceSessionFile, sessionDir, input.cwd)
  const target = source.getEntry(input.targetEntryId)
  if (!target) throw new Error(`Pi Tree entry 不存在: ${input.targetEntryId}`)

  let targetLeafId: string | null
  let selectedText = ''
  let clonedThroughEntryId: string | null = null
  let clonedToolResultCount = 0
  if (input.mode === 'fork_before') {
    if (target.type !== 'message' || (target.message as { role?: unknown }).role !== 'user') {
      throw new Error('fork-before 只能从用户消息之前创建。')
    }
    targetLeafId = target.parentId
    selectedText = contentText((target.message as { content?: unknown }).content)
  } else {
    const cloneTarget = resolvePiCloneTarget(source, target.id)
    targetLeafId = cloneTarget.leafId
    clonedThroughEntryId = cloneTarget.leafId
    clonedToolResultCount = cloneTarget.toolResultCount
  }

  if (targetLeafId === null) {
    return {
      sessionManager: createMaterializedPiSession({
        cwd: input.cwd,
        sessionDir,
        name: input.title,
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
        parentSession: input.sourceSessionFile,
      }),
      selectedText,
      clonedThroughEntryId,
      clonedToolResultCount,
    }
  }

  const newSessionFile = source.createBranchedSession(targetLeafId)
  if (!newSessionFile) throw new Error('Pi 未能创建分支 session 文件。')
  assertManagedSessionFile(sessionDir, newSessionFile)
  materializeCurrentSessionFile(source)
  const sessionManager = SessionManager.open(newSessionFile, sessionDir, input.cwd)
  if (input.title.trim() && sessionManager.getSessionName() !== input.title.trim()) {
    sessionManager.appendSessionInfo(input.title.trim())
  }
  return {
    sessionManager,
    selectedText,
    clonedThroughEntryId,
    clonedToolResultCount,
  }
}

export function exportPiSessionToJsonl(
  sessionManager: SessionManager,
  outputPath: string,
): string {
  const resolvedOutputPath = path.resolve(outputPath)
  const header = sessionManager.getHeader()
  if (!header) {
    throw new Error('Pi session has no header and cannot be exported.')
  }
  const sourceFile = sessionManager.getSessionFile()
  if (sourceFile && path.resolve(sourceFile) === resolvedOutputPath) {
    throw new Error('导出路径不能覆盖当前 Pi session 的事实源文件。')
  }
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true })
  const lines = [header, ...sessionManager.getBranch()]
    .map((entry) => JSON.stringify(entry))
    .join('\n')
  fs.writeFileSync(resolvedOutputPath, `${lines}\n`, 'utf8')
  return resolvedOutputPath
}

function openBoundSession(input: {
  binding: ConversationPiSessionBinding
  cwd: string
  sessionDir: string
}): SessionManager {
  assertManagedSessionFile(input.sessionDir, input.binding.piSessionFile)
  if (!fs.existsSync(input.binding.piSessionFile)) {
    throw new Error(`Bound Pi session file is missing: ${input.binding.piSessionFile}`)
  }
  const sessionManager = SessionManager.open(
    input.binding.piSessionFile,
    input.sessionDir,
    input.cwd,
  )
  if (sessionManager.getSessionId() !== input.binding.piSessionId) {
    throw new Error(
      `Pi session binding mismatch: expected ${input.binding.piSessionId}, received ${sessionManager.getSessionId()}`,
    )
  }
  return sessionManager
}

export function prepareConversationPiSession(input: {
  conversationId: string
  title: string
  cwd: string
  agentDir: string
  modelProvider: string
  modelId: string
  thinkingLevel: ThinkingLevel
}): PreparedConversationPiSession {
  const sessionDir = getManagedPiSessionDirectory(input.agentDir)
  const currentBinding = getConversationPiSessionBinding(input.conversationId)
  if (currentBinding?.migrationStatus === 'ready') {
    let sessionManager: SessionManager
    try {
      sessionManager = openBoundSession({
        binding: currentBinding,
        cwd: input.cwd,
        sessionDir,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      upsertConversationPiSessionBinding({
        ...currentBinding,
        migrationStatus: 'failed',
        migrationError: `session_open_failed: ${message}`,
      })
      throw new Error(
        `Pi session 无法打开；为避免回退到过期备份并丢失新消息，已停止恢复: ${message}`,
      )
    }
    if (
      input.title.trim()
      && sessionManager.getSessionName() !== input.title.trim()
    ) {
      sessionManager.appendSessionInfo(input.title.trim())
    }
    projectSession({
      conversationId: input.conversationId,
      title: input.title,
      sessionManager,
    })
    return {
      binding: currentBinding,
      sessionManager,
      migratedLegacyMessages: false,
    }
  }

  if (
    currentBinding?.migrationStatus === 'failed'
    && currentBinding.migrationError.startsWith('session_open_failed:')
  ) {
    throw new Error(
      `Pi session 绑定处于失败状态；为避免回退到过期备份并丢失新消息，未自动重建: ${currentBinding.migrationError}`,
    )
  }

  const snapshot = getConversationSnapshot(input.conversationId)
  const sessionManager = createMaterializedPiSession({
    cwd: input.cwd,
    sessionDir,
    name: input.title,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
  })
  const sessionFile = sessionManager.getSessionFile()
  if (!sessionFile) {
    throw new Error('Materialized Pi session does not have a file path.')
  }

  upsertConversationPiSessionBinding({
    conversationId: input.conversationId,
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: sessionFile,
    runtimeVersion: XIAOLIANG_PI_RUNTIME_VERSION,
    migrationStatus: 'migrating',
    migrationError: '',
    clearMessageMappings: true,
  })

  const legacyMessageIds = buildStableMessageRecordIds(
    input.conversationId,
    snapshot.messages,
  )
  const legacyMessageIdsByEntryId = new Map<string, string>()
  try {
    if (snapshot.messages.length > 0 || (snapshot.compactions?.length ?? 0) > 0) {
      sessionManager.appendCustomEntry(LEGACY_CHECKPOINT_CUSTOM_TYPE, {
        version: 1,
        migratedAt: new Date().toISOString(),
        originalMessageCount: snapshot.messages.length,
        compactions: snapshot.compactions ?? [],
        historyBeforeLegacyCompactionRecoverable: false,
      })
    }
    snapshot.messages.forEach((message, index) => {
      if (!isPersistableMessage(message)) return
      const entryId = sessionManager.appendMessage(message as any)
      legacyMessageIdsByEntryId.set(entryId, legacyMessageIds[index])
    })

    const binding = upsertConversationPiSessionBinding({
      conversationId: input.conversationId,
      piSessionId: sessionManager.getSessionId(),
      piSessionFile: sessionFile,
      runtimeVersion: XIAOLIANG_PI_RUNTIME_VERSION,
      migrationStatus: 'ready',
      migrationError: '',
    })
    projectSession({
      conversationId: input.conversationId,
      title: input.title,
      sessionManager,
      legacyMessageIdsByEntryId,
    })
    return {
      binding,
      sessionManager,
      migratedLegacyMessages: snapshot.messages.length > 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    upsertConversationPiSessionBinding({
      conversationId: input.conversationId,
      piSessionId: sessionManager.getSessionId(),
      piSessionFile: sessionFile,
      runtimeVersion: XIAOLIANG_PI_RUNTIME_VERSION,
      migrationStatus: 'failed',
      migrationError: `migration_failed: ${message}`,
    })
    throw error
  }
}

export function createReplacementConversationPiSession(input: {
  cwd: string
  agentDir: string
  title: string
  modelProvider: string
  modelId: string
  thinkingLevel: ThinkingLevel
  parentSession?: string
}): SessionManager {
  return createMaterializedPiSession({
    cwd: input.cwd,
    sessionDir: getManagedPiSessionDirectory(input.agentDir),
    name: input.title,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    parentSession: input.parentSession,
  })
}

export function appendConversationPiThinkingLevel(input: {
  conversationId: string
  cwd: string
  agentDir: string
  thinkingLevel: ThinkingLevel
}): boolean {
  const binding = getConversationPiSessionBinding(input.conversationId)
  if (!binding || binding.migrationStatus !== 'ready') return false
  const sessionManager = openBoundSession({
    binding,
    cwd: input.cwd,
    sessionDir: getManagedPiSessionDirectory(input.agentDir),
  })
  sessionManager.appendThinkingLevelChange(input.thinkingLevel)
  return true
}

export function importConversationPiSession(input: {
  sourceFile: string
  cwd: string
  agentDir: string
  title: string
}): SessionManager {
  const sourceFile = path.resolve(input.sourceFile)
  if (path.extname(sourceFile).toLowerCase() !== '.jsonl') {
    throw new Error('只能导入 .jsonl 格式的 Pi session。')
  }
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`导入的 Pi session 不存在: ${sourceFile}`)
  }
  const sessionDir = getManagedPiSessionDirectory(input.agentDir)
  const sessionManager = SessionManager.forkFrom(sourceFile, input.cwd, sessionDir)
  if (input.title.trim()) {
    sessionManager.appendSessionInfo(input.title.trim())
  }
  return sessionManager
}

export function commitConversationPiSession(input: {
  conversationId: string
  title: string
  sessionManager: SessionManager
  clearMessageMappings?: boolean
  parentConversationId?: string | null
  forkedFromEntryId?: string | null
}): ConversationPiSessionBinding {
  const sessionFile = input.sessionManager.getSessionFile()
  if (!sessionFile) {
    throw new Error('Cannot bind an in-memory Pi session to a conversation.')
  }
  const binding = upsertConversationPiSessionBinding({
    conversationId: input.conversationId,
    piSessionId: input.sessionManager.getSessionId(),
    piSessionFile: sessionFile,
    parentConversationId: input.parentConversationId,
    forkedFromEntryId: input.forkedFromEntryId,
    runtimeVersion: XIAOLIANG_PI_RUNTIME_VERSION,
    migrationStatus: 'ready',
    migrationError: '',
    clearMessageMappings: input.clearMessageMappings,
  })
  projectSession({
    conversationId: input.conversationId,
    title: input.title,
    sessionManager: input.sessionManager,
    touchUpdatedAt: true,
  })
  return binding
}

export function deleteManagedConversationPiSessionFile(input: {
  binding: ConversationPiSessionBinding
  agentDir: string
}): boolean {
  const sessionDir = getManagedPiSessionDirectory(input.agentDir)
  assertManagedSessionFile(sessionDir, input.binding.piSessionFile)
  if (!fs.existsSync(input.binding.piSessionFile)) return false
  fs.unlinkSync(input.binding.piSessionFile)
  return true
}
