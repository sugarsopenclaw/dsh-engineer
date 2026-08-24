import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getDB } from '../db'
import { resetPiSessionArchiveState } from '../project-sync/pi-session-archive-state'
import type {
  AgentMessageHostNotice,
  AgentMessageRecord,
  AgentMessagePart,
  AgentMessageRole,
  ConversationCreationSource,
  ConversationSummary,
  ContextUsageInfo,
  DrawingSummary,
  ImageAttachment,
  ProjectSummary,
  WorkspaceSearchMatchType,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '../../../src/shared/local-agent'
import {
  mergeImageAttachments,
  normalizeImageAttachmentPayload,
} from '../../../src/shared/local-agent'
import {
  DEFAULT_THINKING_MODE,
  normalizeThinkingMode,
  type ThinkingMode,
} from '../../../src/shared/billing-domain'
import {
  describeSubagentCompletionNotice,
  parseSubagentCompletionDeliveryDetails,
  parseSubagentCompletionPrompt,
  SUBAGENT_COMPLETION_CUSTOM_TYPE,
} from '../../../src/shared/subagent-completion'
import { stableImageAttachmentId } from '../agent/image-attachment-id'
import {
  normalizeConversationAgentMode,
  normalizePlanPhase,
} from '../agent/modes/plan-mode'

const DEFAULT_DRAWING_NAME = '通用图纸'

function normalizeProjectName(name: string) {
  return name.trim().toLowerCase()
}

function normalizeProjectRootPath(rootPath: string) {
  return rootPath.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

function inferProjectNameFromRootPath(rootPath: string) {
  const normalizedRoot = rootPath.trim().replace(/[\\/]+$/, '')
  const baseName = path.basename(normalizedRoot).trim()
  if (baseName) {
    return baseName
  }

  return normalizedRoot || '未命名项目'
}

function normalizeDrawingName(name: string) {
  return name.trim().toLowerCase()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function clipText(value: string, maxLength: number) {
  const normalized = compactWhitespace(value)
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}…`
}

function workspaceSearchSnippet(value: string, query: string, maxLength = 140) {
  const normalizedText = compactWhitespace(String(value ?? ''))
  const normalizedQuery = compactWhitespace(query)
  if (!normalizedText || !normalizedQuery) {
    return clipText(normalizedText, maxLength)
  }

  const matchIndex = normalizedText.toLocaleLowerCase('zh-CN')
    .indexOf(normalizedQuery.toLocaleLowerCase('zh-CN'))
  if (matchIndex < 0) {
    return clipText(normalizedText, maxLength)
  }

  const radius = Math.max(24, Math.floor((maxLength - normalizedQuery.length) / 2))
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + radius)
  return `${start > 0 ? '…' : ''}${normalizedText.slice(start, end)}${end < normalizedText.length ? '…' : ''}`
}

interface ProjectRow {
  id: string
  name: string
}

interface DrawingRow {
  id: string
  project_id: string
  name: string
  normalized_name: string
}

interface ProjectSummaryRow {
  id: string
  name: string
  description: string
  root_path: string
  root_path_updated_at: string | null
  created_at: string
  updated_at: string
}

interface DrawingSummaryRow {
  id: string
  project_id: string
  name: string
  created_at: string
  updated_at: string
}

interface ConversationRow {
  id: string
  title: string
  agent_state: string
  is_pinned: number
  preferred_model_id: string | null
  preferred_thinking_mode: string | null
  project_id: string | null
  drawing_id: string | null
}

interface ConversationSummaryRow {
  id: string
  title: string
  creation_source: string
  updated_at: string
  is_pinned: number
  preferred_model_id: string | null
  preferred_thinking_mode: string | null
  project_id: string | null
  project_name: string | null
  drawing_id: string | null
  drawing_name: string | null
  context_input_tokens: number
  context_output_tokens: number
  context_used_tokens: number
  context_total_tokens: number
  context_percent: number
  context_model_id: string
  context_cache_tokens: number
  context_trailing_tokens: number
  context_compact_at_tokens: number
  parent_conversation_id: string | null
  forked_from_entry_id: string | null
  child_conversation_count: number
  session_sync_scope: 'active_path' | null
  preferred_agent_mode?: string | null
  plan_phase?: string | null
  has_pending_interaction?: number | null
}

interface ConversationContextUsageRow {
  context_input_tokens: number
  context_output_tokens: number
  context_used_tokens: number
  context_total_tokens: number
  context_percent: number
  context_model_id: string
  context_cache_tokens: number
  context_trailing_tokens: number
  context_compact_at_tokens: number
}

interface MessageRow {
  id: string
  conversation_id: string
  client_run_id: string | null
  pi_session_id: string | null
  pi_entry_id: string | null
  path_index: number
  is_visible: number
  role: AgentMessageRole
  host_notice: string
  content: string
  tool_name: string
  tool_args: string
  tool_result: string
  thinking: string
  parts_json: string
  attachments_json: string
  created_at: string
}

interface WorkspaceSearchRow {
  result_kind: 'project' | 'conversation'
  project_id: string
  project_name: string
  conversation_id: string | null
  conversation_title: string | null
  matched_message_id: string | null
  matched_role: AgentMessageRole | null
  matched_text: string
  match_type: WorkspaceSearchMatchType
  updated_at: string
  matched_at: string | null
}

interface DrawingQuantityReferenceRow {
  drawing_id: string
  construction_attachments_json: string
  source_message: string
  updated_at: string
}

interface CadDrawingArtifactDeleteRow {
  drawing_id: string
  project_id: string
  drawing_name: string
  doc_name: string | null
  doc_key: string | null
  artifact_id: string | null
  knowledge_file_id: string | null
}

export interface ConversationSnapshot {
  messages: AgentMessage[]
  compactions?: ConversationCompactionRecord[]
}

interface ConversationSnapshotRow {
  id: string
  agent_state: string
}

interface DrawingDeletionContext {
  drawingId: string
  drawingName: string
  docName?: string | null
  docKey?: string | null
  artifactId?: string | null
  knowledgeFileId?: string | null
}

interface DrawingDeleteResult {
  deletedConversationIds: string[]
  deletedDrawingIds: string[]
}

export interface ConversationCompactionRecord {
  version: number
  reason: string
  createdAt: string
  beforeMessages: number
  afterMessages: number
  beforeTokens: number
  afterTokens: number
  projectedTokens: number
  summaryChars: number
  retainedTailTurns: number
  retainedUserAnchors: number
  warning?: string
}

interface ProjectMemorySearchRow {
  message_id: string
  conversation_id: string
  role: AgentMessageRole
  content: string
  tool_result: string
  thinking: string
  created_at: string
  conversation_title: string
  conversation_updated_at: string
  drawing_id: string | null
  drawing_name: string | null
}

export interface ProjectMemoryMatch {
  messageId: string
  conversationId: string
  conversationTitle: string
  drawingId: string | null
  drawingName: string | null
  role: AgentMessageRole
  excerpt: string
  createdAt: string
  updatedAt: string
}

interface ConversationScope {
  projectId: string
  drawingId: string | null
}

export interface DrawingQuantityReference {
  drawingId: string
  constructionAttachments: ImageAttachment[]
  sourceMessage: string
  updatedAt: string
}

function findProjectByName(db: ReturnType<typeof getDB>, projectName: string) {
  const normalizedName = normalizeProjectName(projectName)
  if (!normalizedName) {
    return undefined
  }

  return db
    .prepare(
      `SELECT id, name
       FROM projects
       WHERE lower(trim(name)) = ?
       LIMIT 1`,
    )
    .get(normalizedName) as ProjectRow | undefined
}

function findProjectByRootDirectory(
  db: ReturnType<typeof getDB>,
  rootPath: string,
): ProjectSummary | null {
  const normalizedRootPath = normalizeProjectRootPath(rootPath)
  if (!normalizedRootPath) {
    return null
  }

  const rows = db
    .prepare(
      `SELECT id, name, description, root_path, root_path_updated_at, created_at, updated_at
       FROM projects
       WHERE trim(root_path) != ''`,
    )
    .all() as ProjectSummaryRow[]

  const row = rows.find((candidate) =>
    normalizeProjectRootPath(candidate.root_path) === normalizedRootPath)
  return row ? mapProjectSummary(row) : null
}

function getAvailableProjectName(db: ReturnType<typeof getDB>, preferredName: string) {
  const baseName = preferredName.trim() || '未命名项目'
  if (!findProjectByName(db, baseName)) {
    return baseName
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseName} (${index})`
    if (!findProjectByName(db, candidate)) {
      return candidate
    }
  }

  throw new Error('项目名称冲突过多，请换一个项目名称。')
}

function findDrawingInProject(db: ReturnType<typeof getDB>, projectId: string, drawingName: string) {
  const normalizedName = normalizeDrawingName(drawingName)
  if (!normalizedName) {
    return undefined
  }

  return db
    .prepare(
      `SELECT id, project_id, name, normalized_name
       FROM drawings
       WHERE project_id = ? AND normalized_name = ?
       LIMIT 1`,
    )
    .get(projectId, normalizedName) as DrawingRow | undefined
}

function ensureDrawingInProject(db: ReturnType<typeof getDB>, projectId: string, drawingName: string) {
  const fallbackName = drawingName.trim() || DEFAULT_DRAWING_NAME
  const normalizedFallback = normalizeDrawingName(fallbackName)

  const existing = findDrawingInProject(db, projectId, fallbackName)

  if (existing) {
    return existing
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO drawings (id, project_id, name, normalized_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
  ).run(id, projectId, fallbackName, normalizedFallback)

  return {
    id,
    project_id: projectId,
    name: fallbackName,
    normalized_name: normalizedFallback,
  }
}

export function ensureProjectDrawing(projectId: string, drawingName: string): DrawingSummary {
  const db = getDB()
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    throw new Error('projectId 不能为空。')
  }
  const projectExists = db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(normalizedProjectId) as { id: string } | undefined
  if (!projectExists) {
    throw new Error(`未找到项目: ${normalizedProjectId}`)
  }

  const drawing = ensureDrawingInProject(db, normalizedProjectId, drawingName)
  db.prepare(
    `UPDATE drawings
     SET updated_at = datetime('now','localtime')
     WHERE id = ?`,
  ).run(drawing.id)

  const row = db
    .prepare(
      `SELECT id, project_id, name, created_at, updated_at
       FROM drawings
       WHERE id = ?`,
    )
    .get(drawing.id) as DrawingSummaryRow | undefined

  if (!row) {
    throw new Error('读取图纸记录失败。')
  }

  return mapDrawingSummary(row)
}

function ensureConversationScope(conversationId: string): ConversationScope | null {
  const db = getDB()
  const row = db
    .prepare('SELECT project_id, drawing_id FROM conversations WHERE id = ?')
    .get(conversationId) as Pick<ConversationRow, 'project_id' | 'drawing_id'> | undefined

  if (!row) {
    return null
  }

  const drawingId = row.drawing_id
  let projectId = row.project_id

  if (!projectId && drawingId) {
    const drawing = db
      .prepare('SELECT project_id FROM drawings WHERE id = ?')
      .get(drawingId) as Pick<DrawingRow, 'project_id'> | undefined
    projectId = drawing?.project_id ?? null

    if (projectId) {
      db.prepare(
        `UPDATE conversations
         SET project_id = ?
         WHERE id = ?`,
      ).run(projectId, conversationId)
    }
  }

  // Ownership belongs to the user. A read path must never mint a project just to
  // give an unscoped conversation somewhere to live.
  if (!projectId) {
    return null
  }

  return { projectId, drawingId: drawingId || null }
}

function imageAttachmentFromContentBlock(block: any): ImageAttachment | null {
  if (
    block?.type !== 'image'
    || typeof block.data !== 'string'
    || typeof block.mimeType !== 'string'
  ) {
    return null
  }

  const payload = normalizeImageAttachmentPayload(block.data, block.mimeType)
  if (!payload) return null

  return {
    id: stableImageAttachmentId({
      id: block.id,
      data: payload.data,
      mimeType: payload.mimeType,
    }),
    ...payload,
    ...(typeof block.name === 'string' && block.name.trim()
      ? { name: block.name.trim() }
      : {}),
  }
}

function extractTextAndAttachments(content: unknown): { text: string; attachments: ImageAttachment[] } {
  if (typeof content === 'string') {
    return { text: content, attachments: [] }
  }

  if (!Array.isArray(content)) {
    return { text: '', attachments: [] }
  }

  const text: string[] = []
  const attachments: ImageAttachment[] = []

  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      text.push(block.text)
      continue
    }

    const attachment = imageAttachmentFromContentBlock(block)
    if (attachment) attachments.push(attachment)
  }

  return {
    text: text.join('\n'),
    attachments,
  }
}

interface MessageSerializationContext {
  toolResultsByCallId: ReadonlyMap<string, any>
  assistantAttachmentsByMessage: ReadonlyMap<AgentMessage, ImageAttachment[]>
  assistantToolCallIds: ReadonlySet<string>
}

const EMPTY_MESSAGE_SERIALIZATION_CONTEXT: MessageSerializationContext = {
  toolResultsByCallId: new Map<string, any>(),
  assistantAttachmentsByMessage: new Map<AgentMessage, ImageAttachment[]>(),
  assistantToolCallIds: new Set<string>(),
}

function assistantParts(
  message: any,
  toolResultsByCallId: ReadonlyMap<string, any> = EMPTY_MESSAGE_SERIALIZATION_CONTEXT.toolResultsByCallId,
) {
  if (!Array.isArray(message?.content)) {
    return {
      content: '',
      thinking: '',
      toolName: '',
      toolArgs: '',
      toolResult: '',
      parts: [] as AgentMessagePart[],
    }
  }

  const text = message.content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')

  const thinking = message.content
    .filter((item: any) => item?.type === 'thinking' && typeof item.thinking === 'string')
    .map((item: any) => item.thinking)
    .join('\n')

  const toolCalls = message.content.filter((item: any) => item?.type === 'toolCall')
  const parts: AgentMessagePart[] = message.content.flatMap((item: any): AgentMessagePart[] => {
    if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
      return [{ type: 'text', content: item.text }]
    }
    if (item?.type === 'thinking' && typeof item.thinking === 'string' && item.thinking) {
      return [{ type: 'thinking', content: item.thinking }]
    }
    if (item?.type === 'toolCall') {
      const toolCallId = typeof item.id === 'string' ? item.id : ''
      const toolResult = toolCallId ? toolResultsByCallId.get(toolCallId) : undefined
      return [{
        type: 'tool',
        toolCallId,
        name: typeof item.name === 'string' ? item.name : '',
        args: JSON.stringify(item.arguments ?? {}),
        result: toolResult ? messageContentToText(toolResult.content) : '',
      }]
    }
    return []
  })
  const toolResults = parts
    .filter((part): part is Extract<AgentMessagePart, { type: 'tool' }> => part.type === 'tool')
    .map((part) => part.result)
    .filter(Boolean)

  return {
    content: text,
    thinking,
    toolName: toolCalls[0]?.name ?? '',
    toolArgs: toolCalls.length > 0 ? JSON.stringify(toolCalls.map((item: any) => item.arguments)) : '',
    toolResult: toolResults.join('\n'),
    parts,
  }
}

function messageContentToText(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function parseStoredAttachments(raw: string): ImageAttachment[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item) => {
      if (
        typeof item?.id === 'string' &&
        typeof item?.data === 'string' &&
        typeof item?.mimeType === 'string'
      ) {
        const payload = normalizeImageAttachmentPayload(item.data, item.mimeType)
        if (!payload) return []
        return [
          {
            id: item.id,
            ...payload,
            name: typeof item.name === 'string' ? item.name : undefined,
          } satisfies ImageAttachment,
        ]
      }
      return []
    })
  } catch {
    return []
  }
}

function parseStoredParts(raw: string): AgentMessagePart[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): AgentMessagePart[] => {
      if (
        (item?.type === 'text' || item?.type === 'thinking')
        && typeof item.content === 'string'
      ) {
        return [{ type: item.type, content: item.content }]
      }
      if (
        item?.type === 'tool'
        && typeof item.toolCallId === 'string'
        && typeof item.name === 'string'
        && typeof item.args === 'string'
        && typeof item.result === 'string'
      ) {
        return [{
          type: 'tool',
          toolCallId: item.toolCallId,
          name: item.name,
          args: item.args,
          result: item.result,
        }]
      }
      return []
    })
  } catch {
    return []
  }
}

const COMPACTION_SUMMARY_PREFIXES = ['[上下文摘要', '[上下文检查点摘要]']

function textFromAgentContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .flatMap((item) => {
      if (typeof item === 'string') {
        return item
      }
      if (item?.type === 'text' && typeof item.text === 'string') {
        return item.text
      }
      return []
    })
    .join('\n')
}

function isCompactionSummaryAgentMessage(message: AgentMessage) {
  if ((message as { role?: unknown }).role !== 'user') {
    return false
  }
  const text = textFromAgentContent((message as { content?: unknown }).content).trimStart()
  return COMPACTION_SUMMARY_PREFIXES.some((prefix) => text.startsWith(prefix))
}

function normalizeDeletionToken(value: string | null | undefined) {
  const trimmed = value?.trim() || ''
  if (trimmed.length < 4) {
    return ''
  }
  return trimmed.toLowerCase()
}

function basenameToken(value: string | null | undefined) {
  const trimmed = value?.trim() || ''
  if (!trimmed) {
    return ''
  }
  const parts = trimmed.split(/[\\/]/)
  return normalizeDeletionToken(parts[parts.length - 1])
}

function buildDrawingDeletionTokens(context: DrawingDeletionContext) {
  return Array.from(new Set([
    normalizeDeletionToken(context.drawingId),
    normalizeDeletionToken(context.drawingName),
    basenameToken(context.drawingName),
    normalizeDeletionToken(context.docName),
    basenameToken(context.docName),
    normalizeDeletionToken(context.docKey),
    normalizeDeletionToken(context.artifactId),
    normalizeDeletionToken(context.knowledgeFileId),
  ].filter(Boolean)))
}

function stringifyForDeletionMatch(value: unknown) {
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return String(value ?? '').toLowerCase()
  }
}

function sanitizeDeletedDrawingSnapshot(
  rawSnapshot: string,
  context: DrawingDeletionContext,
): string | null {
  if (!rawSnapshot.trim()) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawSnapshot)
  } catch {
    return ''
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const record = parsed as Record<string, unknown>
  const messages = Array.isArray(record.messages)
    ? (record.messages as AgentMessage[])
    : []
  const compactions = Array.isArray(record.compactions)
    ? record.compactions
    : []
  const deletionTokens = buildDrawingDeletionTokens(context)
  const nextMessages = messages.filter((message) => {
    if (isCompactionSummaryAgentMessage(message)) {
      return false
    }
    if (deletionTokens.length === 0) {
      return true
    }
    const haystack = stringifyForDeletionMatch(message)
    return !deletionTokens.some((token) => haystack.includes(token))
  })

  if (nextMessages.length === messages.length && compactions.length === 0) {
    return null
  }

  return JSON.stringify({
    ...record,
    messages: nextMessages,
    compactions: [],
  })
}

function mergeQuantityReferenceAttachments(
  primary: ImageAttachment[],
  secondary: ImageAttachment[],
  limit = 3,
): ImageAttachment[] {
  const seen = new Set<string>()
  const merged: ImageAttachment[] = []

  for (const attachment of [...primary, ...secondary]) {
    if (
      !attachment
      || typeof attachment.id !== 'string'
      || typeof attachment.data !== 'string'
      || typeof attachment.mimeType !== 'string'
    ) {
      continue
    }
    const dedupeKey = `${attachment.mimeType}:${attachment.data}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    merged.push({
      id: attachment.id,
      data: attachment.data,
      mimeType: attachment.mimeType,
      name: attachment.name,
    })
    if (merged.length >= limit) {
      break
    }
  }

  return merged
}

function mapContextUsage(
  row: ConversationContextUsageRow,
): ContextUsageInfo | null {
  if (!row.context_model_id || row.context_total_tokens <= 0) {
    return null
  }

  // context_compact_at_tokens > 0 表示新格式行（cache/trailing 直接落库）；
  // 旧行的 used = input + cache，缓存量只能反推，且没有压缩阈值概念。
  const isPiAligned = row.context_compact_at_tokens > 0

  return {
    inputTokens: row.context_input_tokens,
    outputTokens: row.context_output_tokens,
    cacheTokens: isPiAligned
      ? row.context_cache_tokens
      : Math.max(0, row.context_used_tokens - row.context_input_tokens),
    usedTokens: row.context_used_tokens,
    totalTokens: row.context_total_tokens,
    ...(isPiAligned
      ? {
        compactAtTokens: row.context_compact_at_tokens,
        trailingTokens: row.context_trailing_tokens,
      }
      : {}),
    percent: row.context_percent,
    modelId: row.context_model_id,
  }
}

function mapConversationSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    creationSource: normalizeConversationCreationSource(row.creation_source),
    updatedAt: row.updated_at,
    isPinned: row.is_pinned === 1,
    preferredModelId: row.preferred_model_id ?? null,
    preferredThinkingMode: normalizeThinkingMode(row.preferred_thinking_mode),
    preferredAgentMode: normalizeConversationAgentMode(row.preferred_agent_mode),
    planPhase: normalizePlanPhase(row.plan_phase),
    hasPendingInteraction: Number(row.has_pending_interaction) === 1,
    projectId: row.project_id ?? null,
    projectName: row.project_name ?? null,
    drawingId: row.drawing_id ?? null,
    drawingName: row.drawing_name ?? null,
    contextUsage: mapContextUsage(row),
    parentConversationId: row.parent_conversation_id ?? null,
    forkedFromEntryId: row.forked_from_entry_id ?? null,
    childConversationCount: Number(row.child_conversation_count) || 0,
    sessionSyncScope: row.session_sync_scope === 'active_path' ? 'active_path' : null,
  }
}

const CONVERSATION_FAMILY_SELECT = `
  (SELECT binding.parent_conversation_id
     FROM conversation_session_bindings binding
    WHERE binding.conversation_id = c.id) AS parent_conversation_id,
  (SELECT binding.forked_from_entry_id
     FROM conversation_session_bindings binding
    WHERE binding.conversation_id = c.id) AS forked_from_entry_id,
  (SELECT COUNT(*)
     FROM conversation_session_bindings child_binding
    WHERE child_binding.parent_conversation_id = c.id) AS child_conversation_count,
  CASE WHEN EXISTS (
    SELECT 1
      FROM conversation_session_bindings binding
     WHERE binding.conversation_id = c.id
  ) THEN 'active_path' ELSE NULL END AS session_sync_scope,
  COALESCE((
    SELECT preferred_mode FROM conversation_plan_mode m WHERE m.conversation_id = c.id
  ), 'agent') AS preferred_agent_mode,
  COALESCE((
    SELECT phase FROM conversation_plan_mode m WHERE m.conversation_id = c.id
  ), 'inactive') AS plan_phase,
  CASE WHEN EXISTS (
    SELECT 1 FROM conversation_pending_interactions p WHERE p.conversation_id = c.id
  ) THEN 1 ELSE 0 END AS has_pending_interaction`

const CONVERSATION_CREATION_SOURCES = new Set<ConversationCreationSource>([
  'desktop_first_message',
  'desktop_new_button',
  'desktop_tree_branch',
  'feishu',
  'legacy_unknown',
])

function normalizeConversationCreationSource(
  value: unknown,
): ConversationCreationSource {
  const normalized = typeof value === 'string'
    ? value.trim() as ConversationCreationSource
    : undefined
  return normalized && CONVERSATION_CREATION_SOURCES.has(normalized)
    ? normalized
    : 'legacy_unknown'
}

function mapProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  const rootPath = row.root_path?.trim() || null
  const rootPathExists = (() => {
    if (!rootPath) return false
    try {
      return fs.statSync(rootPath).isDirectory()
    } catch {
      return false
    }
  })()
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rootPath,
    rootPathUpdatedAt: row.root_path_updated_at ?? null,
    rootPathExists,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDrawingSummary(row: DrawingSummaryRow): DrawingSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function buildStableMessageRecordIds(
  conversationId: string,
  messages: AgentMessage[],
): string[] {
  const identityOccurrences = new Map<string, number>()

  return messages.map((message) => {
    const record = message as any
    const role = typeof record.role === 'string' ? record.role : 'message'
    const timestamp = String(record.timestamp ?? 'untimed')
    const responseId = role === 'assistant' && typeof record.responseId === 'string'
      ? record.responseId.trim()
      : ''
    const toolCallId = role === 'toolResult' && typeof record.toolCallId === 'string'
      ? record.toolCallId.trim()
      : ''
    const intrinsicId = responseId || toolCallId || timestamp
    const identity = `${role}\0${intrinsicId}`
    const occurrence = identityOccurrences.get(identity) ?? 0
    identityOccurrences.set(identity, occurrence + 1)

    const digest = createHash('sha256')
      .update(conversationId)
      .update('\0')
      .update(identity)
      .update('\0')
      .update(String(occurrence))
      .digest('hex')
      .slice(0, 32)
    return `agent-message:${digest}`
  })
}

export function buildPiMessageRecordId(piSessionId: string, piEntryId: string): string {
  const sessionId = piSessionId.trim()
  const entryId = piEntryId.trim()
  if (!sessionId || !entryId) {
    throw new Error('Pi message identity requires both session and entry IDs.')
  }
  return `pi:${sessionId}:${entryId}`
}

function buildMessageSerializationContext(messages: AgentMessage[]): MessageSerializationContext {
  const toolResultsByCallId = new Map<string, any>()
  const assistantAttachmentsByMessage = new Map<AgentMessage, ImageAttachment[]>()
  const assistantToolCallIds = new Set<string>()
  let latestAssistant: AgentMessage | null = null
  let turnAttachments: ImageAttachment[] = []

  const commitTurnAttachments = () => {
    if (latestAssistant && turnAttachments.length > 0) {
      assistantAttachmentsByMessage.set(latestAssistant, turnAttachments)
    }
    latestAssistant = null
    turnAttachments = []
  }

  for (const message of messages) {
    const record = message as any
    if (record.role === 'user' || record.role === 'custom') {
      commitTurnAttachments()
      continue
    }

    if (record.role === 'assistant') {
      latestAssistant = message
      const attachments = extractTextAndAttachments(record.content).attachments
      turnAttachments = mergeImageAttachments(turnAttachments, attachments)

      if (Array.isArray(record.content)) {
        for (const item of record.content) {
          if (item?.type === 'toolCall' && typeof item.id === 'string' && item.id) {
            assistantToolCallIds.add(item.id)
          }
        }
      }
      continue
    }

    if (record.role === 'toolResult') {
      if (typeof record.toolCallId === 'string' && record.toolCallId) {
        toolResultsByCallId.set(record.toolCallId, record)
      }
      const attachments = extractTextAndAttachments(record.content).attachments
      turnAttachments = mergeImageAttachments(turnAttachments, attachments)
    }
  }

  commitTurnAttachments()
  return {
    toolResultsByCallId,
    assistantAttachmentsByMessage,
    assistantToolCallIds,
  }
}

function serializeMessageRecord(
  conversationId: string,
  message: AgentMessage,
  messageId: string,
  context: MessageSerializationContext = EMPTY_MESSAGE_SERIALIZATION_CONTEXT,
): AgentMessageRecord {
  const anyMessage = message as any
  const clientRunId = typeof anyMessage.clientRunId === 'string' && anyMessage.clientRunId.trim()
    ? anyMessage.clientRunId.trim()
    : null

  if (anyMessage.role === 'assistant') {
    const parts = assistantParts(anyMessage, context.toolResultsByCallId)
    return {
      id: messageId,
      conversationId,
      clientRunId,
      role: 'assistant',
      content: parts.content,
      toolName: parts.toolName,
      toolArgs: parts.toolArgs,
      toolResult: parts.toolResult,
      thinking: parts.thinking,
      parts: parts.parts,
      attachments: context.assistantAttachmentsByMessage.get(message) ?? [],
      createdAt: new Date(anyMessage.timestamp || Date.now()).toISOString(),
    }
  }

  if (anyMessage.role === 'toolResult') {
    const { text, attachments } = extractTextAndAttachments(anyMessage.content)
    const attachmentsPromotedToAssistant = (
      typeof anyMessage.toolCallId === 'string'
      && context.assistantToolCallIds.has(anyMessage.toolCallId)
    )
    return {
      id: messageId,
      conversationId,
      clientRunId,
      role: 'tool',
      content: text,
      toolName: anyMessage.toolName ?? '',
      toolArgs: '',
      toolResult: text,
      thinking: '',
      attachments: attachmentsPromotedToAssistant ? [] : attachments,
      createdAt: new Date(anyMessage.timestamp || Date.now()).toISOString(),
    }
  }

  const { text, attachments } = extractTextAndAttachments(anyMessage.content)
  // A background subagent's report only belongs in the Pi session that feeds the model.
  // The display projection keeps the notice, never the payload.
  const isTypedCompletion = anyMessage.role === 'custom'
    && anyMessage.customType === SUBAGENT_COMPLETION_CUSTOM_TYPE
  const customPayload = isTypedCompletion
    && anyMessage.details
    && typeof anyMessage.details === 'object'
    && !Array.isArray(anyMessage.details)
    ? (anyMessage.details as { payload?: unknown }).payload
    : undefined
  const completion = isTypedCompletion
    ? parseSubagentCompletionDeliveryDetails(customPayload)
      ?? parseSubagentCompletionPrompt(text)
    : parseSubagentCompletionPrompt(text)
  const hostNotice: AgentMessageHostNotice | null = completion
    ? { kind: 'subagent_completion', ...completion }
    : null

  return {
    id: messageId,
    conversationId,
    clientRunId,
    role: 'user',
    ...(hostNotice ? { hostNotice } : {}),
    content: completion ? describeSubagentCompletionNotice(completion) : text,
    toolName: '',
    toolArgs: '',
    toolResult: '',
    thinking: '',
    attachments,
    createdAt: new Date(anyMessage.timestamp || Date.now()).toISOString(),
  }
}

function serializeMessageRecordsForDisplay(
  conversationId: string,
  messages: AgentMessage[],
): AgentMessageRecord[] {
  const context = buildMessageSerializationContext(messages)
  const messageIds = buildStableMessageRecordIds(conversationId, messages)

  return messages.flatMap((message, index) => {
    const record = message as any
    if (
      record.role === 'toolResult'
      && typeof record.toolCallId === 'string'
      && context.assistantToolCallIds.has(record.toolCallId)
    ) {
      return []
    }
    return [serializeMessageRecord(conversationId, message, messageIds[index], context)]
  })
}

/** Legacy unscoped entry point. Always throws; use a project- or drawing-scoped creator. */
export function createConversation(
  _title = '新对话',
  _creationSource: ConversationCreationSource = 'legacy_unknown',
): ConversationSummary {
  throw new Error(
    '创建对话需要指定项目或图纸，请改用 createConversationInProject 或 createConversationInDrawing。',
  )
}

export function createConversationInProject(
  projectId: string,
  title = '新对话',
  creationSource: ConversationCreationSource = 'legacy_unknown',
  thinkingMode?: ThinkingMode,
): ConversationSummary {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    throw new Error('projectId 不能为空。')
  }

  const db = getDB()
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(normalizedProjectId) as { id: string } | undefined

  if (!project) {
    throw new Error(`未找到项目: ${normalizedProjectId}`)
  }

  const id = randomUUID()
  db
    .prepare(
      `INSERT INTO conversations (
        id, project_id, drawing_id, title, creation_source, agent_state,
        created_at, updated_at, is_pinned, preferred_thinking_mode
      ) VALUES (
        ?, ?, NULL, ?, ?, '', datetime('now','localtime'), datetime('now','localtime'), 0, ?
      )`,
    )
    .run(
      id,
      normalizedProjectId,
      title.trim() || '新对话',
      normalizeConversationCreationSource(creationSource),
      normalizeThinkingMode(thinkingMode ?? DEFAULT_THINKING_MODE),
    )

  return getConversationSummary(id) as ConversationSummary
}

/**
 * Create the SQLite business record for a Pi fork/clone while preserving the
 * source conversation's project, drawing references, and user preferences.
 * The Pi JSONL binding is committed separately after its branched file exists.
 */
export function createConversationBranch(
  parentConversationId: string,
  title: string,
): ConversationSummary {
  const normalizedParentId = parentConversationId.trim()
  if (!normalizedParentId) {
    throw new Error('parentConversationId 不能为空。')
  }

  const db = getDB()
  const parent = db.prepare(
    `SELECT project_id, drawing_id, preferred_model_id, preferred_thinking_mode
       FROM conversations
      WHERE id = ?`,
  ).get(normalizedParentId) as {
    project_id: string | null
    drawing_id: string | null
    preferred_model_id: string | null
    preferred_thinking_mode: string | null
  } | undefined
  if (!parent) {
    throw new Error(`未找到父会话: ${normalizedParentId}`)
  }

  const id = randomUUID()
  const normalizedTitle = title.trim().slice(0, 500) || '新对话'
  const references = db.prepare(
    `SELECT drawing_id, role, confidence, source
       FROM conversation_drawing_refs
      WHERE conversation_id = ?`,
  ).all(normalizedParentId) as Array<{
    drawing_id: string
    role: string
    confidence: number
    source: string
  }>

  db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (
        id, project_id, drawing_id, title, creation_source, agent_state,
        created_at, updated_at, is_pinned, preferred_model_id,
        preferred_thinking_mode
      ) VALUES (
        ?, ?, ?, ?, 'desktop_tree_branch', '',
        datetime('now','localtime'), datetime('now','localtime'), 0, ?, ?
      )`,
    ).run(
      id,
      parent.project_id,
      parent.drawing_id,
      normalizedTitle,
      parent.preferred_model_id,
      normalizeThinkingMode(parent.preferred_thinking_mode),
    )

    const insertReference = db.prepare(
      `INSERT INTO conversation_drawing_refs (
        id, conversation_id, drawing_id, role, confidence, source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
    )
    for (const reference of references) {
      insertReference.run(
        randomUUID(),
        id,
        reference.drawing_id,
        reference.role,
        reference.confidence,
        reference.source,
      )
    }
  })()

  return getConversationSummary(id) as ConversationSummary
}

export function listProjects(): ProjectSummary[] {
  return getDB()
    .prepare(
      `SELECT id, name, description, root_path, root_path_updated_at, created_at, updated_at
       FROM projects
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all()
    .map((row) => mapProjectSummary(row as ProjectSummaryRow))
}

export function createProject(name: string, description = ''): ProjectSummary {
  const normalizedName = name.trim()
  if (!normalizedName) {
    throw new Error('项目名称不能为空。')
  }

  const db = getDB()
  const existingProject = findProjectByName(db, normalizedName)
  if (existingProject) {
    throw new Error(`已存在同名项目：${existingProject.name}`)
  }

  const id = randomUUID()
  db
    .prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
    )
    .run(id, normalizedName, description.trim())

  const row = db
    .prepare(
      `SELECT id, name, description, root_path, root_path_updated_at, created_at, updated_at
       FROM projects
       WHERE id = ?`,
    )
    .get(id) as ProjectSummaryRow | undefined

  if (!row) {
    throw new Error('创建项目失败。')
  }

  return mapProjectSummary(row)
}

export function createOrOpenProjectFromDirectory(input: {
  rootPath: string
  name?: string
  description?: string
}): ProjectSummary {
  const rootPath = input.rootPath.trim()
  if (!rootPath) {
    throw new Error('项目目录不能为空。')
  }

  const db = getDB()
  const existingProject = findProjectByRootDirectory(db, rootPath)
  if (existingProject) {
    return existingProject
  }

  const projectName = getAvailableProjectName(
    db,
    input.name?.trim() || inferProjectNameFromRootPath(rootPath),
  )
  const id = randomUUID()
  db
    .prepare(
      `INSERT INTO projects (
        id, name, description, root_path, root_path_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'), datetime('now','localtime'))`,
    )
    .run(id, projectName, input.description?.trim() || '', rootPath)

  const row = db
    .prepare(
      `SELECT id, name, description, root_path, root_path_updated_at, created_at, updated_at
       FROM projects
       WHERE id = ?`,
    )
    .get(id) as ProjectSummaryRow | undefined

  if (!row) {
    throw new Error('创建项目失败。')
  }

  return mapProjectSummary(row)
}

export function getProjectSummary(projectId: string): ProjectSummary | null {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return null
  }

  const row = getDB()
    .prepare(
      `SELECT id, name, description, root_path, root_path_updated_at, created_at, updated_at
       FROM projects
       WHERE id = ?`,
    )
    .get(normalizedProjectId) as ProjectSummaryRow | undefined

  return row ? mapProjectSummary(row) : null
}

export function updateProjectRootDirectory(
  projectId: string,
  rootPath: string | null,
): ProjectSummary {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    throw new Error('projectId 不能为空。')
  }

  const nextRootPath = rootPath?.trim() || ''
  const db = getDB()
  const result = db
    .prepare(
      `UPDATE projects
       SET root_path = ?,
           root_path_updated_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now','localtime') END,
           updated_at = datetime('now','localtime')
       WHERE id = ?`,
    )
    .run(nextRootPath, nextRootPath, normalizedProjectId)

  if (result.changes === 0) {
    throw new Error(`未找到项目: ${normalizedProjectId}`)
  }

  const project = getProjectSummary(normalizedProjectId)
  if (!project) {
    throw new Error('更新项目目录失败。')
  }
  return project
}

export function deleteProject(projectId: string): DrawingDeleteResult {
  const db = getDB()
  const conversationIds = db
    .prepare('SELECT id FROM conversations WHERE project_id = ?')
    .all(projectId) as Array<{ id: string }>
  const drawingIds = db
    .prepare('SELECT id FROM drawings WHERE project_id = ?')
    .all(projectId) as Array<{ id: string }>

  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM conversation_usage_runs
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE project_id = ?
        )`,
    ).run(projectId)
    db.prepare('DELETE FROM conversations WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM drawings WHERE project_id = ?').run(projectId)
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    if (result.changes === 0) {
      throw new Error(`未找到项目: ${projectId}`)
    }
  })

  transaction()
  return {
    deletedConversationIds: conversationIds.map((item) => item.id),
    deletedDrawingIds: drawingIds.map((item) => item.id),
  }
}

export function listDrawings(projectId: string): DrawingSummary[] {
  return getDB()
    .prepare(
      `SELECT d.id, d.project_id, d.name, d.created_at, d.updated_at
       FROM drawings d
       LEFT JOIN cad_drawing_artifacts a ON a.drawing_id = d.id
       WHERE d.project_id = @projectId
         AND NOT (d.normalized_name = @defaultDrawingName AND a.drawing_id IS NULL)
       ORDER BY d.updated_at DESC, d.created_at DESC`,
    )
    .all({
      projectId,
      defaultDrawingName: normalizeDrawingName(DEFAULT_DRAWING_NAME),
    })
    .map((row) => mapDrawingSummary(row as DrawingSummaryRow))
}

export function createDrawing(projectId: string, drawingName: string): DrawingSummary {
  const normalizedName = drawingName.trim()
  if (!normalizedName) {
    throw new Error('图纸名称不能为空。')
  }

  const db = getDB()
  const projectExists = db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(projectId) as { id: string } | undefined

  if (!projectExists) {
    throw new Error(`未找到项目: ${projectId}`)
  }

  const existingDrawing = findDrawingInProject(db, projectId, normalizedName)
  if (existingDrawing) {
    throw new Error(`当前项目中已存在同名图纸：${existingDrawing.name}`)
  }

  const drawing = ensureDrawingInProject(db, projectId, normalizedName)
  db.prepare(
    `UPDATE drawings
     SET updated_at = datetime('now','localtime')
     WHERE id = ?`,
  ).run(drawing.id)

  const row = db
    .prepare(
      `SELECT id, project_id, name, created_at, updated_at
       FROM drawings
       WHERE id = ?`,
    )
    .get(drawing.id) as DrawingSummaryRow | undefined

  if (!row) {
    throw new Error('创建图纸失败。')
  }

  return mapDrawingSummary(row)
}

export function deleteDrawing(drawingId: string): DrawingDeleteResult {
  const normalizedDrawingId = drawingId.trim()
  if (!normalizedDrawingId) {
    throw new Error('drawingId 不能为空。')
  }

  const db = getDB()
  const drawing = db
    .prepare(
      `SELECT d.id AS drawing_id,
              d.project_id,
              d.name AS drawing_name,
              a.doc_name,
              a.doc_key,
              a.artifact_id,
              a.knowledge_file_id
         FROM drawings d
         LEFT JOIN cad_drawing_artifacts a ON a.drawing_id = d.id
        WHERE d.id = ?
        LIMIT 1`,
    )
    .get(normalizedDrawingId) as CadDrawingArtifactDeleteRow | undefined

  if (!drawing) {
    throw new Error(`未找到图纸: ${normalizedDrawingId}`)
  }

  const affectedConversations = db
    .prepare(
      `SELECT id, agent_state
         FROM conversations
        WHERE drawing_id = @drawingId
       UNION
       SELECT c.id, c.agent_state
         FROM conversations c
         INNER JOIN conversation_drawing_refs r ON r.conversation_id = c.id
        WHERE r.drawing_id = @drawingId
       UNION
       SELECT id, agent_state
         FROM conversations
        WHERE project_id = @projectId
          AND agent_state <> ''
          AND (
            instr(agent_state, @drawingId) > 0
            OR (@drawingName <> '' AND instr(lower(agent_state), @drawingName) > 0)
            OR (@docName <> '' AND instr(lower(agent_state), @docName) > 0)
            OR (@docKey <> '' AND instr(lower(agent_state), @docKey) > 0)
            OR (@artifactId <> '' AND instr(lower(agent_state), @artifactId) > 0)
            OR (@knowledgeFileId <> '' AND instr(lower(agent_state), @knowledgeFileId) > 0)
          )`,
    )
    .all({
      drawingId: normalizedDrawingId,
      projectId: drawing.project_id,
      drawingName: normalizeDeletionToken(drawing.drawing_name),
      docName: normalizeDeletionToken(drawing.doc_name),
      docKey: normalizeDeletionToken(drawing.doc_key),
      artifactId: normalizeDeletionToken(drawing.artifact_id),
      knowledgeFileId: normalizeDeletionToken(drawing.knowledge_file_id),
    }) as ConversationSnapshotRow[]

  const deletionContext: DrawingDeletionContext = {
    drawingId: drawing.drawing_id,
    drawingName: drawing.drawing_name,
    docName: drawing.doc_name,
    docKey: drawing.doc_key,
    artifactId: drawing.artifact_id,
    knowledgeFileId: drawing.knowledge_file_id,
  }

  const transaction = db.transaction(() => {
    const clearConversationRuntime = db.prepare(
      `UPDATE conversations
          SET agent_state = ?,
              context_input_tokens = 0,
              context_output_tokens = 0,
              context_used_tokens = 0,
              context_total_tokens = 0,
              context_percent = 0,
              context_model_id = '',
              context_cache_tokens = 0,
              context_trailing_tokens = 0,
              context_compact_at_tokens = 0
        WHERE id = ?`,
    )
    const clearConversationUsage = db.prepare(
      `UPDATE conversations
          SET context_input_tokens = 0,
              context_output_tokens = 0,
              context_used_tokens = 0,
              context_total_tokens = 0,
              context_percent = 0,
              context_model_id = '',
              context_cache_tokens = 0,
              context_trailing_tokens = 0,
              context_compact_at_tokens = 0
        WHERE id = ?`,
    )
    const hasPiSessionBinding = db.prepare(
      `SELECT 1
         FROM conversation_session_bindings
        WHERE conversation_id = ?`,
    )

    for (const conversation of affectedConversations) {
      if (hasPiSessionBinding.get(conversation.id)) {
        // Once migrated, agent_state is an immutable backup. Drawing deletion
        // only invalidates live context; immutable history remains in Pi JSONL.
        clearConversationUsage.run(conversation.id)
        continue
      }
      const sanitizedSnapshot = sanitizeDeletedDrawingSnapshot(
        conversation.agent_state,
        deletionContext,
      )
      if (sanitizedSnapshot !== null) {
        clearConversationRuntime.run(sanitizedSnapshot, conversation.id)
      } else {
        clearConversationUsage.run(conversation.id)
      }
    }

    db.prepare('UPDATE conversations SET drawing_id = NULL WHERE drawing_id = ?').run(normalizedDrawingId)
    db.prepare('DELETE FROM conversation_drawing_refs WHERE drawing_id = ?').run(normalizedDrawingId)
    db.prepare('DELETE FROM drawing_quantity_references WHERE drawing_id = ?').run(normalizedDrawingId)
    db.prepare('DELETE FROM cad_drawing_artifacts WHERE drawing_id = ?').run(normalizedDrawingId)
    const result = db.prepare('DELETE FROM drawings WHERE id = ?').run(normalizedDrawingId)
    if (result.changes === 0) {
      throw new Error(`未找到图纸: ${normalizedDrawingId}`)
    }
  })

  transaction()
  return {
    deletedConversationIds: affectedConversations.map((item) => item.id),
    deletedDrawingIds: [normalizedDrawingId],
  }
}

export function recordConversationDrawingUsage(input: {
  conversationId: string
  drawingId: string
  role?: string
  confidence?: number
  source?: string
}) {
  const conversationId = input.conversationId.trim()
  const drawingId = input.drawingId.trim()
  if (!conversationId || !drawingId) {
    return null
  }
  const role = input.role?.trim() || 'reference'
  const source = input.source?.trim() || ''
  const confidence = Number.isFinite(input.confidence)
    ? clamp(Number(input.confidence), 0, 1)
    : 1
  const now = new Date().toISOString()

  getDB()
    .prepare(
      `INSERT INTO conversation_drawing_refs (
         id, conversation_id, drawing_id, role, confidence, source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, drawing_id, role) DO UPDATE SET
         confidence = excluded.confidence,
         source = excluded.source,
         updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), conversationId, drawingId, role, confidence, source, now, now)

  return { conversationId, drawingId, role, confidence, source, updatedAt: now }
}

export function listDrawingConversations(drawingId: string): ConversationSummary[] {
  return getDB()
    .prepare(
      `SELECT
         c.id,
         c.title,
         c.creation_source,
         c.updated_at,
         c.is_pinned,
         c.preferred_model_id,
         c.preferred_thinking_mode,
         c.project_id,
         c.drawing_id,
         p.name AS project_name,
         d.name AS drawing_name,
         c.context_input_tokens,
         c.context_output_tokens,
         c.context_used_tokens,
         c.context_total_tokens,
         c.context_percent,
         c.context_model_id,
         c.context_cache_tokens,
         c.context_trailing_tokens,
         c.context_compact_at_tokens,
         ${CONVERSATION_FAMILY_SELECT}
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN drawings d ON d.id = c.drawing_id
       WHERE c.drawing_id = ?
          OR EXISTS (
            SELECT 1
              FROM conversation_drawing_refs r
             WHERE r.conversation_id = c.id
               AND r.drawing_id = ?
          )
       ORDER BY c.is_pinned DESC, c.updated_at DESC, c.created_at DESC`,
    )
    .all(drawingId, drawingId)
    .map((row) => mapConversationSummary(row as ConversationSummaryRow))
}

export function createConversationInDrawing(
  drawingId: string,
  title = '新对话',
  creationSource: ConversationCreationSource = 'legacy_unknown',
  thinkingMode?: ThinkingMode,
): ConversationSummary {
  const db = getDB()
  const drawing = db
    .prepare('SELECT id, project_id FROM drawings WHERE id = ?')
    .get(drawingId) as Pick<DrawingRow, 'id' | 'project_id'> | undefined

  if (!drawing) {
    throw new Error(`未找到图纸: ${drawingId}`)
  }

  const normalizedTitle = title.trim() || '新对话'
  const conversationId = randomUUID()

  db.prepare(
    `INSERT INTO conversations (
      id,
      project_id,
      drawing_id,
      title,
      creation_source,
      agent_state,
      created_at,
      updated_at,
      is_pinned,
      preferred_thinking_mode
    ) VALUES (
      ?, ?, NULL, ?, ?, '', datetime('now','localtime'), datetime('now','localtime'), 0, ?
    )`,
  ).run(
    conversationId,
    drawing.project_id,
    normalizedTitle,
    normalizeConversationCreationSource(creationSource),
    normalizeThinkingMode(thinkingMode ?? DEFAULT_THINKING_MODE),
  )

  recordConversationDrawingUsage({
    conversationId,
    drawingId: drawing.id,
    role: 'legacy_primary',
    confidence: 1,
    source: 'createConversationInDrawing',
  })

  return getConversationSummary(conversationId) as ConversationSummary
}

export function listConversations(searchQuery?: string): ConversationSummary[] {
  const keyword = searchQuery?.trim().toLowerCase()

  if (!keyword) {
    return getDB()
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.creation_source,
           c.updated_at,
           c.is_pinned,
           c.preferred_model_id,
           c.preferred_thinking_mode,
           c.project_id,
           c.drawing_id,
           p.name AS project_name,
            d.name AS drawing_name,
            c.context_input_tokens,
            c.context_output_tokens,
            c.context_used_tokens,
            c.context_total_tokens,
            c.context_percent,
            c.context_model_id,
            c.context_cache_tokens,
            c.context_trailing_tokens,
            c.context_compact_at_tokens,
            ${CONVERSATION_FAMILY_SELECT}
         FROM conversations c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN drawings d ON d.id = c.drawing_id
        ORDER BY c.is_pinned DESC, c.updated_at DESC, c.created_at DESC`,
      )
      .all()
      .map((row) => mapConversationSummary(row as ConversationSummaryRow))
  }

  return getDB()
    .prepare(
      `SELECT
         c.id,
         c.title,
         c.creation_source,
         c.updated_at,
         c.is_pinned,
         c.preferred_model_id,
         c.preferred_thinking_mode,
         c.project_id,
         c.drawing_id,
         p.name AS project_name,
        d.name AS drawing_name,
        c.context_input_tokens,
        c.context_output_tokens,
        c.context_used_tokens,
        c.context_total_tokens,
        c.context_percent,
        c.context_model_id,
        c.context_cache_tokens,
        c.context_trailing_tokens,
        c.context_compact_at_tokens,
        ${CONVERSATION_FAMILY_SELECT}
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN drawings d ON d.id = c.drawing_id
       WHERE instr(lower(c.title), ?) > 0
          OR EXISTS (
            SELECT 1
            FROM messages m
            WHERE m.conversation_id = c.id
              AND (
                instr(lower(m.content), ?) > 0
                OR instr(lower(m.thinking), ?) > 0
                OR instr(lower(m.tool_result), ?) > 0
                OR instr(lower(m.tool_name), ?) > 0
                OR instr(lower(m.tool_args), ?) > 0
              )
          )
      ORDER BY c.is_pinned DESC,
                CASE WHEN instr(lower(c.title), ?) > 0 THEN 0 ELSE 1 END,
                c.updated_at DESC,
                c.created_at DESC`,
    )
    .all(keyword, keyword, keyword, keyword, keyword, keyword, keyword)
    .map((row) => mapConversationSummary(row as ConversationSummaryRow))
}

export function searchWorkspace(input: WorkspaceSearchRequest): WorkspaceSearchResult[] {
  const query = String(input?.query ?? '').trim()
  if (!query) {
    return []
  }

  const keyword = query.toLocaleLowerCase('zh-CN')
  const requestedLimit = Number(input.limit)
  const limit = clamp(
    Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50,
    1,
    100,
  )

  const rows = getDB()
    .prepare(
      `WITH search(keyword) AS (VALUES (?))
       SELECT
         'project' AS result_kind,
         p.id AS project_id,
         p.name AS project_name,
         NULL AS conversation_id,
         NULL AS conversation_title,
         NULL AS matched_message_id,
         NULL AS matched_role,
         CASE
           WHEN instr(lower(p.name), search.keyword) > 0 THEN p.name
           ELSE p.description
         END AS matched_text,
         'project' AS match_type,
         p.updated_at AS updated_at,
         NULL AS matched_at,
         0 AS match_rank,
         0 AS is_pinned,
         p.updated_at AS sort_at
       FROM projects p
       CROSS JOIN search
       WHERE instr(lower(p.name), search.keyword) > 0
          OR instr(lower(p.description), search.keyword) > 0

       UNION ALL

       SELECT
         'conversation' AS result_kind,
         p.id AS project_id,
         p.name AS project_name,
         c.id AS conversation_id,
         c.title AS conversation_title,
         NULL AS matched_message_id,
         NULL AS matched_role,
         c.title AS matched_text,
         'title' AS match_type,
         c.updated_at AS updated_at,
         NULL AS matched_at,
         1 AS match_rank,
         c.is_pinned AS is_pinned,
         c.updated_at AS sort_at
       FROM conversations c
       INNER JOIN projects p ON p.id = c.project_id
       CROSS JOIN search
       WHERE instr(lower(c.title), search.keyword) > 0

       UNION ALL

       SELECT
         'conversation' AS result_kind,
         p.id AS project_id,
         p.name AS project_name,
         c.id AS conversation_id,
         c.title AS conversation_title,
         CASE
           WHEN m.role = 'tool' THEN COALESCE(
             (
               SELECT previous.id
               FROM messages previous
               WHERE previous.conversation_id = m.conversation_id
                 AND previous.role = 'assistant'
                 AND previous.rowid < m.rowid
               ORDER BY previous.rowid DESC
               LIMIT 1
             ),
             m.id
           )
           ELSE m.id
         END AS matched_message_id,
         m.role AS matched_role,
         CASE
           WHEN instr(lower(m.content), search.keyword) > 0 THEN m.content
           WHEN instr(lower(m.thinking), search.keyword) > 0 THEN m.thinking
           WHEN instr(lower(m.tool_result), search.keyword) > 0 THEN m.tool_result
           WHEN instr(lower(m.tool_args), search.keyword) > 0 THEN m.tool_args
           ELSE m.tool_name
         END AS matched_text,
         CASE
           WHEN instr(lower(m.content), search.keyword) > 0 THEN 'message'
           WHEN instr(lower(m.thinking), search.keyword) > 0 THEN 'thinking'
           ELSE 'tool'
         END AS match_type,
         c.updated_at AS updated_at,
         m.created_at AS matched_at,
         2 AS match_rank,
         c.is_pinned AS is_pinned,
         m.created_at AS sort_at
       FROM messages m
       INNER JOIN conversations c ON c.id = m.conversation_id
       INNER JOIN projects p ON p.id = c.project_id
       CROSS JOIN search
       WHERE instr(lower(m.content), search.keyword) > 0
          OR instr(lower(m.thinking), search.keyword) > 0
          OR instr(lower(m.tool_result), search.keyword) > 0
          OR instr(lower(m.tool_args), search.keyword) > 0
          OR instr(lower(m.tool_name), search.keyword) > 0

       ORDER BY match_rank ASC,
                is_pinned DESC,
                updated_at DESC,
                sort_at DESC
       LIMIT ?`,
    )
    .all(keyword, limit) as WorkspaceSearchRow[]

  return rows.map((row) => ({
    kind: row.result_kind,
    projectId: row.project_id,
    projectName: row.project_name,
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title,
    matchedMessageId: row.matched_message_id,
    matchedRole: row.matched_role,
    matchType: row.match_type,
    snippet: workspaceSearchSnippet(row.matched_text, query),
    updatedAt: row.updated_at,
    matchedAt: row.matched_at,
  }))
}

export function listProjectConversations(
  projectId: string,
  searchQuery?: string,
): ConversationSummary[] {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  const keyword = searchQuery?.trim().toLowerCase()
  const db = getDB()

  if (!keyword) {
    return db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.creation_source,
           c.updated_at,
           c.is_pinned,
           c.preferred_model_id,
           c.preferred_thinking_mode,
           c.project_id,
           c.drawing_id,
           p.name AS project_name,
           d.name AS drawing_name,
           c.context_input_tokens,
           c.context_output_tokens,
           c.context_used_tokens,
           c.context_total_tokens,
           c.context_percent,
           c.context_model_id,
           ${CONVERSATION_FAMILY_SELECT}
         FROM conversations c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN drawings d ON d.id = c.drawing_id
        WHERE c.project_id = ?
        ORDER BY c.is_pinned DESC, c.updated_at DESC, c.created_at DESC`,
      )
      .all(normalizedProjectId)
      .map((row) => mapConversationSummary(row as ConversationSummaryRow))
  }

  return db
    .prepare(
      `SELECT
         c.id,
         c.title,
         c.creation_source,
         c.updated_at,
         c.is_pinned,
         c.preferred_model_id,
         c.preferred_thinking_mode,
         c.project_id,
         c.drawing_id,
         p.name AS project_name,
         d.name AS drawing_name,
         c.context_input_tokens,
         c.context_output_tokens,
         c.context_used_tokens,
         c.context_total_tokens,
         c.context_percent,
         c.context_model_id,
         c.context_cache_tokens,
         c.context_trailing_tokens,
         c.context_compact_at_tokens,
         ${CONVERSATION_FAMILY_SELECT}
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN drawings d ON d.id = c.drawing_id
       WHERE c.project_id = ?
         AND (
           instr(lower(c.title), ?) > 0
           OR EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.conversation_id = c.id
               AND (
                 instr(lower(m.content), ?) > 0
                 OR instr(lower(m.thinking), ?) > 0
                 OR instr(lower(m.tool_result), ?) > 0
                 OR instr(lower(m.tool_name), ?) > 0
                 OR instr(lower(m.tool_args), ?) > 0
               )
           )
         )
      ORDER BY c.is_pinned DESC,
                CASE WHEN instr(lower(c.title), ?) > 0 THEN 0 ELSE 1 END,
                c.updated_at DESC,
                c.created_at DESC`,
    )
    .all(
      normalizedProjectId,
      keyword,
      keyword,
      keyword,
      keyword,
      keyword,
      keyword,
      keyword,
    )
    .map((row) => mapConversationSummary(row as ConversationSummaryRow))
}

export function getConversationSummary(id: string): ConversationSummary | null {
  const row = getDB()
    .prepare(
      `SELECT
         c.id,
         c.title,
         c.creation_source,
         c.updated_at,
         c.is_pinned,
         c.preferred_model_id,
         c.preferred_thinking_mode,
         c.project_id,
         c.drawing_id,
         p.name AS project_name,
        d.name AS drawing_name,
        c.context_input_tokens,
        c.context_output_tokens,
        c.context_used_tokens,
        c.context_total_tokens,
        c.context_percent,
        c.context_model_id,
        c.context_cache_tokens,
        c.context_trailing_tokens,
        c.context_compact_at_tokens,
        ${CONVERSATION_FAMILY_SELECT}
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN drawings d ON d.id = c.drawing_id
       WHERE c.id = ?`,
    )
    .get(id) as ConversationSummaryRow | undefined

  if (!row) return null
  return mapConversationSummary(row)
}

export function getDrawingQuantityReference(drawingId: string): DrawingQuantityReference | null {
  const normalizedId = drawingId.trim()
  if (!normalizedId) {
    return null
  }

  const row = getDB()
    .prepare(
      `SELECT drawing_id, construction_attachments_json, source_message, updated_at
       FROM drawing_quantity_references
       WHERE drawing_id = ?`,
    )
    .get(normalizedId) as DrawingQuantityReferenceRow | undefined

  if (!row) {
    return null
  }

  return {
    drawingId: row.drawing_id,
    constructionAttachments: parseStoredAttachments(row.construction_attachments_json),
    sourceMessage: row.source_message || '',
    updatedAt: row.updated_at,
  }
}

export function upsertDrawingQuantityReference(input: {
  drawingId: string
  constructionAttachments: ImageAttachment[]
  sourceMessage?: string | null
}): DrawingQuantityReference | null {
  const drawingId = input.drawingId.trim()
  if (!drawingId) {
    return null
  }

  const existing = getDrawingQuantityReference(drawingId)
  const mergedAttachments = mergeQuantityReferenceAttachments(
    input.constructionAttachments,
    existing?.constructionAttachments ?? [],
  )

  if (mergedAttachments.length === 0) {
    return existing
  }

  const now = new Date().toISOString()
  const sourceMessage = clipText(
    compactWhitespace(input.sourceMessage || '') || existing?.sourceMessage || '',
    240,
  )

  getDB()
    .prepare(
      `INSERT INTO drawing_quantity_references (
        drawing_id, construction_attachments_json, source_message, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(drawing_id) DO UPDATE SET
        construction_attachments_json = excluded.construction_attachments_json,
        source_message = excluded.source_message,
        updated_at = excluded.updated_at`,
    )
    .run(drawingId, JSON.stringify(mergedAttachments), sourceMessage, now)

  return {
    drawingId,
    constructionAttachments: mergedAttachments,
    sourceMessage,
    updatedAt: now,
  }
}

export function deleteConversation(id: string) {
  const db = getDB()
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM conversation_usage_runs WHERE conversation_id = ?').run(id)
    return db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  })
  const result = transaction()
  if (result.changes === 0) {
    throw new Error(`未找到会话: ${id}`)
  }
}

export function renameConversation(id: string, title: string) {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) {
    throw new Error('会话标题不能为空。')
  }

  const result = getDB()
    .prepare(
      `UPDATE conversations
       SET title = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
    )
    .run(normalizedTitle, id)

  if (result.changes === 0) {
    throw new Error(`未找到会话: ${id}`)
  }
}

export function renameConversationIfFirstMessageMatches(
  id: string,
  expectedFirstUserMessageId: string,
  title: string,
): boolean {
  const normalizedTitle = title.trim()
  if (!normalizedTitle || !expectedFirstUserMessageId.trim()) {
    return false
  }

  const db = getDB()
  return db.transaction(() => {
    const conversation = db
      .prepare('SELECT title FROM conversations WHERE id = ?')
      .get(id) as { title: string } | undefined
    if (conversation?.title !== '新对话') {
      return false
    }

    const firstUserMessage = db
      .prepare(
        `SELECT id
           FROM messages
          WHERE conversation_id = ? AND role = 'user'
          ORDER BY datetime(created_at) ASC, rowid ASC
          LIMIT 1`,
      )
      .get(id) as { id: string } | undefined
    if (firstUserMessage?.id !== expectedFirstUserMessageId) {
      return false
    }

    const result = db
      .prepare(
        `UPDATE conversations
            SET title = ?, updated_at = datetime('now','localtime')
          WHERE id = ? AND title = '新对话'`,
      )
      .run(normalizedTitle, id)
    return result.changes === 1
  })()
}

export function getConversationPreferredModelId(conversationId: string): string | null {
  const row = getDB()
    .prepare('SELECT preferred_model_id FROM conversations WHERE id = ?')
    .get(conversationId) as { preferred_model_id: string | null } | undefined

  return row?.preferred_model_id ?? null
}

export function getConversationThinkingMode(conversationId: string): ThinkingMode {
  const row = getDB()
    .prepare('SELECT preferred_thinking_mode FROM conversations WHERE id = ?')
    .get(conversationId) as { preferred_thinking_mode: string | null } | undefined

  return normalizeThinkingMode(row?.preferred_thinking_mode)
}

export function setConversationPreferredModel(conversationId: string, modelId: string | null) {
  getDB()
    .prepare(
      `UPDATE conversations
       SET preferred_model_id = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
    )
    .run(modelId, conversationId)
}

export function setConversationThinkingMode(conversationId: string, mode: ThinkingMode) {
  getDB()
    .prepare(
      `UPDATE conversations
       SET preferred_thinking_mode = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
    )
    .run(normalizeThinkingMode(mode), conversationId)
}

export function setConversationPinned(conversationId: string, pinned: boolean) {
  const result = getDB()
    .prepare(
      `UPDATE conversations
       SET is_pinned = ?
       WHERE id = ?`,
    )
    .run(pinned ? 1 : 0, conversationId)

  if (result.changes === 0) {
    throw new Error(`未找到会话: ${conversationId}`)
  }
}

export function updateConversationContextUsage(
  conversationId: string,
  usage: ContextUsageInfo | null,
) {
  if (!usage) {
    getDB()
      .prepare(
        `UPDATE conversations
         SET context_input_tokens = 0,
             context_output_tokens = 0,
             context_used_tokens = 0,
             context_total_tokens = 0,
             context_percent = 0,
             context_model_id = '',
             context_cache_tokens = 0,
             context_trailing_tokens = 0,
             context_compact_at_tokens = 0,
             updated_at = datetime('now','localtime')
         WHERE id = ?`,
      )
      .run(conversationId)
    return
  }

  const percent = Number.isFinite(usage.percent) ? clamp(usage.percent, 0, 100) : 0

  getDB()
    .prepare(
      `UPDATE conversations
       SET context_input_tokens = ?,
           context_output_tokens = ?,
           context_used_tokens = ?,
           context_total_tokens = ?,
           context_percent = ?,
           context_model_id = ?,
           context_cache_tokens = ?,
           context_trailing_tokens = ?,
           context_compact_at_tokens = ?,
           updated_at = datetime('now','localtime')
       WHERE id = ?`,
    )
    .run(
      usage.inputTokens,
      usage.outputTokens,
      usage.usedTokens,
      usage.totalTokens,
      percent,
      usage.modelId,
      Math.max(0, Math.round(usage.cacheTokens ?? 0)),
      Math.max(0, Math.round(usage.trailingTokens ?? 0)),
      Math.max(0, Math.round(usage.compactAtTokens ?? 0)),
      conversationId,
    )
}

export function bindConversationToDrawingByName(conversationId: string, drawingName: string) {
  const normalizedDrawingName = drawingName.trim()
  if (!normalizedDrawingName) {
    return null
  }

  const scope = ensureConversationScope(conversationId)
  if (!scope) {
    return null
  }

  const db = getDB()
  const drawing = ensureDrawingInProject(db, scope.projectId, normalizedDrawingName)

  recordConversationDrawingUsage({
    conversationId,
    drawingId: drawing.id,
    role: 'auto_detected',
    confidence: 0.7,
    source: 'active_cad_document',
  })

  return {
    projectId: scope.projectId,
    drawingId: drawing.id,
    drawingName: drawing.name,
  }
}

export function searchProjectMemory(input: {
  conversationId: string
  query: string
  limit?: number
  includeCurrentDrawing?: boolean
}): ProjectMemoryMatch[] {
  const keyword = input.query.trim().toLowerCase()
  if (!keyword) {
    return []
  }

  const scope = ensureConversationScope(input.conversationId)
  if (!scope) {
    return []
  }

  const limit = clamp(input.limit ?? 6, 1, 20)
  const includeCurrentDrawing = input.includeCurrentDrawing ?? false
  const shouldFilterSameDrawing = !includeCurrentDrawing && !!scope.drawingId

  const sameDrawingFilter = shouldFilterSameDrawing
    ? 'AND (c.drawing_id IS NULL OR c.drawing_id <> @currentDrawingId)'
    : ''

  const preferOtherDrawingSort = scope.drawingId
    ? `CASE
         WHEN c.drawing_id IS NOT NULL AND c.drawing_id <> @currentDrawingId THEN 0
         ELSE 1
       END,`
    : ''

  const rows = getDB()
    .prepare(
      `SELECT
         m.id AS message_id,
         m.conversation_id,
         m.role,
         m.content,
         m.tool_result,
         m.thinking,
         m.created_at,
         c.title AS conversation_title,
         c.updated_at AS conversation_updated_at,
         c.drawing_id,
         d.name AS drawing_name
       FROM messages m
       INNER JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN drawings d ON d.id = c.drawing_id
       WHERE c.project_id = @projectId
         AND c.id <> @conversationId
         ${sameDrawingFilter}
         AND (
           instr(lower(c.title), @keyword) > 0
           OR instr(lower(m.content), @keyword) > 0
           OR instr(lower(m.thinking), @keyword) > 0
           OR instr(lower(m.tool_result), @keyword) > 0
         )
       ORDER BY
         ${preferOtherDrawingSort}
         c.updated_at DESC,
         datetime(m.created_at) DESC
       LIMIT @limit`,
    )
    .all({
      projectId: scope.projectId,
      conversationId: input.conversationId,
      keyword,
      currentDrawingId: scope.drawingId,
      limit,
    }) as ProjectMemorySearchRow[]

  return rows.map((row) => {
    const excerpt = clipText(row.content || row.tool_result || row.thinking || '', 240)
    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      drawingId: row.drawing_id,
      drawingName: row.drawing_name,
      role: row.role,
      excerpt,
      createdAt: row.created_at,
      updatedAt: row.conversation_updated_at,
    }
  })
}

export function getConversationSnapshot(id: string): ConversationSnapshot {
  const row = getDB()
    .prepare('SELECT agent_state FROM conversations WHERE id = ?')
    .get(id) as Pick<ConversationRow, 'agent_state'> | undefined

  if (!row?.agent_state) {
    return { messages: [] }
  }

  try {
    const parsed = JSON.parse(row.agent_state) as ConversationSnapshot
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      compactions: Array.isArray(parsed.compactions) ? parsed.compactions : [],
    }
  } catch {
    return { messages: [] }
  }
}

export function getMessageRecords(conversationId: string): AgentMessageRecord[] {
  return getDB()
    .prepare(
      `SELECT id, conversation_id, client_run_id, pi_session_id, pi_entry_id,
              path_index, is_visible, role, host_notice, content, tool_name, tool_args,
              tool_result, thinking, parts_json, attachments_json, created_at
       FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, rowid ASC`,
    )
    .all(conversationId)
    .map((row) => mapMessageRow(row as MessageRow))
}

function parseStoredHostNotice(raw: string): AgentMessageHostNotice | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AgentMessageHostNotice>
    return parsed?.kind === 'subagent_completion' && typeof parsed.taskId === 'string'
      ? parsed as AgentMessageHostNotice
      : null
  } catch {
    return null
  }
}

function mapMessageRow(record: MessageRow): AgentMessageRecord {
  // Rows projected before host_notice existed still hold the raw payload; recover the
  // notice from it so old transcripts stop showing a child's report as a user message.
  const legacyCompletion = record.host_notice
    ? null
    : parseSubagentCompletionPrompt(record.content)
  const hostNotice = legacyCompletion
    ? { kind: 'subagent_completion' as const, ...legacyCompletion }
    : parseStoredHostNotice(record.host_notice)
  return {
    id: record.id,
    conversationId: record.conversation_id,
    clientRunId: record.client_run_id,
    piSessionId: record.pi_session_id,
    piEntryId: record.pi_entry_id,
    role: record.role,
    ...(hostNotice ? { hostNotice } : {}),
    content: legacyCompletion
      ? describeSubagentCompletionNotice(legacyCompletion)
      : record.content,
    toolName: record.tool_name,
    toolArgs: record.tool_args,
    toolResult: record.tool_result,
    thinking: record.thinking,
    parts: parseStoredParts(record.parts_json),
    attachments: parseStoredAttachments(record.attachments_json),
    createdAt: record.created_at,
  }
}

function getPiDisplayMessageRecords(conversationId: string): AgentMessageRecord[] {
  return getDB()
    .prepare(
      `SELECT id, conversation_id, client_run_id, pi_session_id, pi_entry_id,
              path_index, is_visible, role, host_notice, content, tool_name, tool_args,
              tool_result, thinking, parts_json, attachments_json, created_at
         FROM messages
        WHERE conversation_id = ? AND is_visible = 1
        ORDER BY path_index ASC, rowid ASC`,
    )
    .all(conversationId)
    .map((row) => mapMessageRow(row as MessageRow))
}

export function getDisplayMessageRecords(conversationId: string): AgentMessageRecord[] {
  const piBinding = getDB()
    .prepare(
      `SELECT 1
         FROM conversation_session_bindings
        WHERE conversation_id = ?`,
    )
    .get(conversationId)
  if (piBinding) {
    return getPiDisplayMessageRecords(conversationId)
  }

  const snapshot = getConversationSnapshot(conversationId)
  if (snapshot.messages.length === 0) {
    return getMessageRecords(conversationId)
  }
  return serializeMessageRecordsForDisplay(conversationId, snapshot.messages)
}

export function getPiPromptLinkForRun(
  conversationId: string,
  clientRunId: string,
): { piSessionId: string; piEntryId: string } | null {
  const row = getDB()
    .prepare(
      `SELECT pi_session_id, pi_entry_id
         FROM messages
        WHERE conversation_id = ?
          AND client_run_id = ?
          AND role = 'user'
          AND pi_session_id IS NOT NULL
          AND pi_entry_id IS NOT NULL
        ORDER BY path_index DESC, rowid DESC
        LIMIT 1`,
    )
    .get(conversationId, clientRunId) as {
      pi_session_id: string
      pi_entry_id: string
    } | undefined
  return row
    ? { piSessionId: row.pi_session_id, piEntryId: row.pi_entry_id }
    : null
}

export function persistConversationState(
  conversationId: string,
  title: string,
  messages: AgentMessage[],
  options: { compaction?: ConversationCompactionRecord } = {},
) {
  const db = getDB()
  const attachmentContext = buildMessageSerializationContext(messages)
  const persistenceContext: MessageSerializationContext = {
    ...attachmentContext,
    // Keep the existing normalized message-table layout; tool text remains on tool rows.
    toolResultsByCallId: EMPTY_MESSAGE_SERIALIZATION_CONTEXT.toolResultsByCallId,
  }
  const messageIds = buildStableMessageRecordIds(conversationId, messages)
  const records = messages.map((message, index) => {
    const record = serializeMessageRecord(
      conversationId,
      message,
      messageIds[index],
      persistenceContext,
    )
    if ((message as any).role === 'assistant') {
      record.parts = assistantParts(message, attachmentContext.toolResultsByCallId).parts
    }
    return record
  })
  const existing = getConversationSnapshot(conversationId)
  const compactions = [
    ...(existing.compactions ?? []),
    ...(options.compaction ? [options.compaction] : []),
  ].slice(-20)
  const snapshot = JSON.stringify({ messages, compactions })

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE conversations
       SET title = ?, agent_state = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
    ).run(title, snapshot, conversationId)

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)

    const insert = db.prepare(
      `INSERT INTO messages (
        id, conversation_id, client_run_id, role, host_notice, content, tool_name, tool_args, tool_result, thinking, parts_json, attachments_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (const record of records) {
      insert.run(
        record.id,
        record.conversationId,
        record.clientRunId ?? null,
        record.role,
        record.hostNotice ? JSON.stringify(record.hostNotice) : '',
        record.content,
        record.toolName,
        record.toolArgs,
        record.toolResult,
        record.thinking,
        JSON.stringify(record.parts ?? []),
        JSON.stringify(record.attachments ?? []),
        record.createdAt,
      )
    }
  })

  transaction()
}

export interface PiSessionMessageProjection {
  piEntryId: string
  message: AgentMessage
  legacyMessageId?: string
}

/**
 * Rebuild the SQLite active-path projection from the authoritative Pi session.
 * This intentionally leaves conversations.agent_state untouched as a read-only
 * migration backup.
 */
export function persistPiConversationProjection(input: {
  conversationId: string
  title: string
  piSessionId: string
  entries: PiSessionMessageProjection[]
  touchUpdatedAt?: boolean
}) {
  const db = getDB()
  const messages = input.entries.map(({ message }) => message)
  const attachmentContext = buildMessageSerializationContext(messages)
  const persistenceContext: MessageSerializationContext = {
    ...attachmentContext,
    toolResultsByCallId: EMPTY_MESSAGE_SERIALIZATION_CONTEXT.toolResultsByCallId,
  }
  const records = input.entries.map((entry, pathIndex) => {
    const canonicalId = buildPiMessageRecordId(input.piSessionId, entry.piEntryId)
    const record = serializeMessageRecord(
      input.conversationId,
      entry.message,
      canonicalId,
      persistenceContext,
    )
    if ((entry.message as any).role === 'assistant') {
      record.parts = assistantParts(entry.message, attachmentContext.toolResultsByCallId).parts
    }
    const candidate = entry.message as { role?: unknown; toolCallId?: unknown }
    const isVisible = !(
      candidate.role === 'toolResult'
      && typeof candidate.toolCallId === 'string'
      && attachmentContext.assistantToolCallIds.has(candidate.toolCallId)
    )
    return {
      entry,
      record,
      canonicalId,
      pathIndex,
      isVisible,
    }
  })

  const transaction = db.transaction(() => {
    const updated = db.prepare(
      `UPDATE conversations
          SET title = ?,
              updated_at = CASE
                WHEN ? = 1 THEN datetime('now','localtime')
                ELSE updated_at
              END
        WHERE id = ?`,
    ).run(input.title, input.touchUpdatedAt ? 1 : 0, input.conversationId)
    if (updated.changes === 0) {
      throw new Error(`未找到会话: ${input.conversationId}`)
    }

    if (input.touchUpdatedAt) {
      resetPiSessionArchiveState(input.conversationId)
    }

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(input.conversationId)
    const insertMessage = db.prepare(
      `INSERT INTO messages (
        id, conversation_id, client_run_id, pi_session_id, pi_entry_id,
        path_index, is_visible, role, host_notice, content, tool_name, tool_args,
        tool_result, thinking, parts_json, attachments_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const upsertMapping = db.prepare(
      `INSERT INTO conversation_message_id_mappings (
        conversation_id, legacy_message_id, canonical_message_id,
        pi_session_id, pi_entry_id, created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(conversation_id, legacy_message_id) DO UPDATE SET
        canonical_message_id = excluded.canonical_message_id,
        pi_session_id = excluded.pi_session_id,
        pi_entry_id = excluded.pi_entry_id`,
    )

    for (const projected of records) {
      const { entry, record } = projected
      insertMessage.run(
        projected.canonicalId,
        record.conversationId,
        record.clientRunId ?? null,
        input.piSessionId,
        entry.piEntryId,
        projected.pathIndex,
        projected.isVisible ? 1 : 0,
        record.role,
        record.hostNotice ? JSON.stringify(record.hostNotice) : '',
        record.content,
        record.toolName,
        record.toolArgs,
        record.toolResult,
        record.thinking,
        JSON.stringify(record.parts ?? []),
        JSON.stringify(record.attachments ?? []),
        record.createdAt,
      )
      if (entry.legacyMessageId?.trim()) {
        upsertMapping.run(
          input.conversationId,
          entry.legacyMessageId.trim(),
          projected.canonicalId,
          input.piSessionId,
          entry.piEntryId,
        )
      }
    }
  })

  transaction()
}

export function clearPiConversationProjection(conversationId: string) {
  const db = getDB()
  db.transaction(() => {
    const updated = db.prepare(
      `UPDATE conversations
          SET title = '新对话',
              context_input_tokens = 0,
              context_output_tokens = 0,
              context_used_tokens = 0,
              context_total_tokens = 0,
              context_percent = 0,
              context_model_id = '',
              context_cache_tokens = 0,
              context_trailing_tokens = 0,
              context_compact_at_tokens = 0,
              updated_at = datetime('now','localtime')
        WHERE id = ?`,
    ).run(conversationId)
    if (updated.changes === 0) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
    db.prepare(
      'DELETE FROM conversation_message_id_mappings WHERE conversation_id = ?',
    ).run(conversationId)
  })()
}

/** Use the legacy ID for existing cloud archive/feedback rows after migration. */
export function resolveExternalMessageId(
  conversationId: string,
  canonicalMessageId: string,
): string {
  const row = getDB()
    .prepare(
      `SELECT legacy_message_id
         FROM conversation_message_id_mappings
        WHERE conversation_id = ? AND canonical_message_id = ?`,
    )
    .get(conversationId, canonicalMessageId) as { legacy_message_id: string } | undefined
  return row?.legacy_message_id || canonicalMessageId
}

/** Map feedback/archive IDs created before migration onto the canonical Pi ID. */
export function resolveCanonicalMessageId(
  conversationId: string,
  externalMessageId: string,
): string {
  const row = getDB()
    .prepare(
      `SELECT canonical_message_id
         FROM conversation_message_id_mappings
        WHERE conversation_id = ? AND legacy_message_id = ?`,
    )
    .get(conversationId, externalMessageId) as { canonical_message_id: string } | undefined
  return row?.canonical_message_id || externalMessageId
}

export function resetConversation(conversationId: string) {
  const db = getDB()
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE conversations
       SET title = '新对话',
           agent_state = '',
           context_input_tokens = 0,
           context_output_tokens = 0,
           context_used_tokens = 0,
           context_total_tokens = 0,
           context_percent = 0,
           context_model_id = '',
           context_cache_tokens = 0,
           context_trailing_tokens = 0,
           context_compact_at_tokens = 0,
           updated_at = datetime('now','localtime')
       WHERE id = ?`,
    ).run(conversationId)
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
  })

  transaction()
}
