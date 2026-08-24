import type { AgentUsageRunDetailView } from '../../../src/shared/backend-api'
import type {
  ConversationRunUsageView,
  ConversationUsageChangedPayload,
  ConversationUsageTotalsView,
  RunUsagePurposeBreakdown,
} from '../../../src/shared/billing-domain'
import { getDB } from '../db'

interface UsageRunRow {
  client_run_id: string
  conversation_id: string
  status: string
  credits: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  call_count: number
  breakdown_json: string
  started_at: string
  updated_at: string
}

function nonNegativeInt(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.round(numeric)
}

function normalizeStartedAt(value: unknown): string {
  const timestamp = Date.parse(typeof value === 'string' ? value : '')
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString()
}

function parseBreakdown(json: string): RunUsagePurposeBreakdown[] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    const breakdown: RunUsagePurposeBreakdown[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (typeof record.callPurpose !== 'string') continue
      breakdown.push({
        callPurpose: record.callPurpose,
        childRunId: typeof record.childRunId === 'string' ? record.childRunId : null,
        callCount: nonNegativeInt(record.callCount),
        inputTokens: nonNegativeInt(record.inputTokens),
        outputTokens: nonNegativeInt(record.outputTokens),
        cacheReadTokens: nonNegativeInt(record.cacheReadTokens),
        cacheWriteTokens: nonNegativeInt(record.cacheWriteTokens),
        reasoningTokens: nonNegativeInt(record.reasoningTokens),
        totalTokens: nonNegativeInt(record.totalTokens),
      })
    }
    return breakdown
  } catch {
    return []
  }
}

function mapRow(row: UsageRunRow): ConversationRunUsageView {
  return {
    clientRunId: row.client_run_id,
    status: row.status,
    creditsCharged: nonNegativeInt(row.credits),
    callCount: nonNegativeInt(row.call_count),
    inputTokens: nonNegativeInt(row.input_tokens),
    outputTokens: nonNegativeInt(row.output_tokens),
    cacheReadTokens: nonNegativeInt(row.cache_read_tokens),
    cacheWriteTokens: nonNegativeInt(row.cache_write_tokens),
    reasoningTokens: nonNegativeInt(row.reasoning_tokens),
    totalTokens: nonNegativeInt(row.total_tokens),
    breakdown: parseBreakdown(row.breakdown_json),
    updatedAt: row.updated_at,
  }
}

function mergeBreakdown(
  target: Map<string, RunUsagePurposeBreakdown>,
  items: RunUsagePurposeBreakdown[],
): void {
  for (const item of items) {
    const key = `${item.callPurpose}:${item.childRunId ?? ''}`
    const current = target.get(key) ?? {
      callPurpose: item.callPurpose,
      childRunId: item.childRunId,
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    }
    current.callCount += item.callCount
    current.inputTokens += item.inputTokens
    current.outputTokens += item.outputTokens
    current.cacheReadTokens += item.cacheReadTokens
    current.cacheWriteTokens += item.cacheWriteTokens
    current.reasoningTokens += item.reasoningTokens
    current.totalTokens += item.totalTokens
    target.set(key, current)
  }
}

function sumRows(rows: UsageRunRow[]): ConversationUsageTotalsView {
  const breakdown = new Map<string, RunUsagePurposeBreakdown>()
  const totals: ConversationUsageTotalsView = {
    runCount: rows.length,
    creditsCharged: 0,
    callCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    breakdown: [],
  }
  for (const row of rows) {
    totals.creditsCharged += nonNegativeInt(row.credits)
    totals.callCount += nonNegativeInt(row.call_count)
    totals.inputTokens += nonNegativeInt(row.input_tokens)
    totals.outputTokens += nonNegativeInt(row.output_tokens)
    totals.cacheReadTokens += nonNegativeInt(row.cache_read_tokens)
    totals.cacheWriteTokens += nonNegativeInt(row.cache_write_tokens)
    totals.reasoningTokens += nonNegativeInt(row.reasoning_tokens)
    totals.totalTokens += nonNegativeInt(row.total_tokens)
    mergeBreakdown(breakdown, parseBreakdown(row.breakdown_json))
  }
  totals.breakdown = [...breakdown.values()].sort((left, right) => {
    const purposeOrder = left.callPurpose.localeCompare(right.callPurpose)
    return purposeOrder || (left.childRunId ?? '').localeCompare(right.childRunId ?? '')
  })
  return totals
}

function listConversationRunRows(conversationId: string): UsageRunRow[] {
  return getDB()
    .prepare(
      `SELECT client_run_id, conversation_id, status, credits,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              reasoning_tokens, total_tokens, call_count, breakdown_json, started_at, updated_at
         FROM conversation_usage_runs
        WHERE conversation_id = ?
        ORDER BY julianday(started_at) ASC, rowid ASC`,
    )
    .all(conversationId) as UsageRunRow[]
}

/**
 * 把后端权威 run 快照按 client_run_id upsert 落库（幂等），
 * 返回「该 run 最新行 + 会话累计」的完整载荷；会话不存在任何行时返回 null。
 */
export function upsertConversationUsageRun(
  conversationId: string,
  detail: AgentUsageRunDetailView,
): ConversationUsageChangedPayload | null {
  const normalizedConversationId = conversationId.trim()
  const clientRunId = detail.run?.client_run_id?.trim()
  if (!normalizedConversationId || !clientRunId) return null
  const startedAt = normalizeStartedAt(detail.run?.started_at)
  const db = getDB()
  const conversationExists = db
    .prepare('SELECT 1 FROM conversations WHERE id = ?')
    .get(normalizedConversationId)
  if (!conversationExists) return null

  const breakdown: RunUsagePurposeBreakdown[] = (detail.breakdown ?? []).map((item) => ({
    callPurpose: item.call_purpose,
    childRunId: item.child_run_id ?? null,
    callCount: nonNegativeInt(item.call_count),
    inputTokens: nonNegativeInt(item.input_tokens),
    outputTokens: nonNegativeInt(item.output_tokens),
    cacheReadTokens: nonNegativeInt(item.cache_read_tokens),
    cacheWriteTokens: nonNegativeInt(item.cache_write_tokens),
    reasoningTokens: nonNegativeInt(item.reasoning_tokens),
    totalTokens: nonNegativeInt(item.total_tokens),
  }))

  db
    .prepare(
      `INSERT INTO conversation_usage_runs (
         client_run_id, conversation_id, status, credits,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         reasoning_tokens, total_tokens, call_count, breakdown_json, started_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(client_run_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         status = excluded.status,
         credits = excluded.credits,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         cache_write_tokens = excluded.cache_write_tokens,
         reasoning_tokens = excluded.reasoning_tokens,
         total_tokens = excluded.total_tokens,
         call_count = excluded.call_count,
         breakdown_json = excluded.breakdown_json,
         started_at = excluded.started_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      clientRunId,
      normalizedConversationId,
      detail.run?.status ?? 'completed',
      nonNegativeInt(detail.credits_charged),
      nonNegativeInt(detail.totals?.input_tokens),
      nonNegativeInt(detail.totals?.output_tokens),
      nonNegativeInt(detail.totals?.cache_read_tokens),
      nonNegativeInt(detail.totals?.cache_write_tokens),
      nonNegativeInt(detail.totals?.reasoning_tokens),
      nonNegativeInt(detail.totals?.total_tokens),
      nonNegativeInt(detail.call_count),
      JSON.stringify(breakdown),
      startedAt,
    )

  return readConversationUsage(normalizedConversationId)
}

/**
 * 读取会话的用量视图：最近启动的 run + 全部 run 的累计。
 * 累计是本机观测到的后端权威数字之和，主键去重保证重启/重试幂等。
 */
export function readConversationUsage(
  conversationId: string,
): ConversationUsageChangedPayload | null {
  const normalizedConversationId = conversationId.trim()
  if (!normalizedConversationId) return null
  const rows = listConversationRunRows(normalizedConversationId)
  if (rows.length === 0) return null
  return {
    conversationId: normalizedConversationId,
    run: mapRow(rows[rows.length - 1]),
    session: sumRows(rows),
  }
}
