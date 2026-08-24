/**
 * A background subagent reports back through a host-authored custom session message.
 * The payload is model context, not user speech: the transcript shows a compact notice
 * instead so a child's report never renders as a user message.
 */

export const SUBAGENT_COMPLETION_MARKER = '[subagent_completion]'
export const SUBAGENT_COMPLETION_CUSTOM_TYPE = 'xiaoliang.subagent_completion'

export type SubagentCompletionAgentType =
  | 'cad-analyst'
  | 'cad-drafter'
  | 'blender-modeler'
  | 'research-analyst'
export type SubagentCompletionStatus = 'completed' | 'failed' | 'cancelled'

export interface SubagentCompletionNotice {
  taskId: string
  /** Absent for payloads written before the header carried the child's identity. */
  agentType?: SubagentCompletionAgentType
  status?: SubagentCompletionStatus
  /** Children reported by this one injection; absent or 1 for a single child. */
  count?: number
}

export type SubagentCompletionDeliveryDetails = SubagentCompletionNotice

const HEADER_SCAN_LINES = 8
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const AGENT_TYPES: readonly SubagentCompletionAgentType[] = [
  'cad-analyst',
  'cad-drafter',
  'blender-modeler',
  'research-analyst',
]
const STATUSES: readonly SubagentCompletionStatus[] = ['completed', 'failed', 'cancelled']

function normalizeAgentType(value: unknown): SubagentCompletionAgentType | undefined {
  return typeof value === 'string' && AGENT_TYPES.includes(value as SubagentCompletionAgentType)
    ? value as SubagentCompletionAgentType
    : undefined
}

function normalizeStatus(value: unknown): SubagentCompletionStatus | undefined {
  return typeof value === 'string' && STATUSES.includes(value as SubagentCompletionStatus)
    ? value as SubagentCompletionStatus
    : undefined
}

/** Only a plural count is carried; 1 and anything malformed read as "a single child". */
function normalizeCount(value: unknown): number | undefined {
  const count = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(count) && count > 1 ? Math.min(count, 999) : undefined
}

export interface SubagentCompletionEntry {
  taskId: string
  agentType: SubagentCompletionAgentType
  status: SubagentCompletionStatus
  payload: string
}

/**
 * Frames one or more finished children as a host notice rather than user speech.
 *
 * The runtime has no user turn to put this in, so it arrives shaped like one. Models read
 * that as the user speaking and answer it — acknowledging the notice, thanking the user,
 * asking what to do next — instead of continuing the work the child unblocked. Wrapping it
 * in system-reminder framing says plainly who wrote it and what to do with it.
 *
 * Several children finishing at once are one notice, not one each: each injection costs a
 * full turn, so a burst of four used to spend four turns before any of the evidence was
 * read.
 */
export function buildSubagentCompletionPrompt(input: {
  parentPromptId: string
  completions: readonly SubagentCompletionEntry[]
}): string {
  const [primary, ...rest] = input.completions
  if (!primary) throw new Error('A subagent completion notice needs at least one child.')
  const count = input.completions.length
  return [
    SUBAGENT_COMPLETION_MARKER,
    `task_id: ${primary.taskId}`,
    `parent_prompt_id: ${input.parentPromptId}`,
    `agent_type: ${primary.agentType}`,
    `status: ${primary.status}`,
    `task_count: ${count}`,
    '<system-reminder>',
    count === 1
      ? 'A delegated task you started has finished. The host produced and validated the report below; the user did not write it and is not waiting on a reply to it. Use it to continue the work, and do not acknowledge or thank anyone for it.'
      : `${count} delegated tasks you started have finished. The host produced and validated the reports below; the user did not write them and is not waiting on a reply to them. Work through them together, and do not acknowledge or thank anyone for them.`,
    '',
    ...(rest.length === 0
      ? [primary.payload]
      : input.completions.flatMap((completion) => [
          `--- task_id: ${completion.taskId} (${completion.agentType}, ${completion.status}) ---`,
          completion.payload,
          '',
        ])),
    '</system-reminder>',
  ].join('\n')
}

/** Returns the notice descriptor when `content` is a host-authored completion prompt. */
export function parseSubagentCompletionPrompt(content: string): SubagentCompletionNotice | null {
  const lines = content.split('\n', HEADER_SCAN_LINES)
  if (lines[0]?.trim() !== SUBAGENT_COMPLETION_MARKER) return null
  const header = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(': ')
    if (separator <= 0) continue
    header.set(line.slice(0, separator).trim(), line.slice(separator + 2).trim())
  }
  const taskId = header.get('task_id') || ''
  if (!TASK_ID_PATTERN.test(taskId)) return null
  const agentType = normalizeAgentType(header.get('agent_type'))
  const status = normalizeStatus(header.get('status'))
  const count = normalizeCount(header.get('task_count'))
  return {
    taskId,
    ...(agentType ? { agentType } : {}),
    ...(status ? { status } : {}),
    ...(count ? { count } : {}),
  }
}

/** Reads the typed metadata carried outside model-visible custom-message content. */
export function parseSubagentCompletionDeliveryDetails(
  value: unknown,
): SubagentCompletionDeliveryDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const taskId = typeof record.taskId === 'string' ? record.taskId : ''
  if (!TASK_ID_PATTERN.test(taskId)) return null
  const agentType = normalizeAgentType(record.agentType)
  const status = normalizeStatus(record.status)
  const count = normalizeCount(record.count)
  return {
    taskId,
    ...(agentType ? { agentType } : {}),
    ...(status ? { status } : {}),
    ...(count ? { count } : {}),
  }
}

const AGENT_LABELS: Readonly<Record<SubagentCompletionAgentType, string>> = {
  'cad-analyst': 'CAD 取证',
  'cad-drafter': 'CAD 取证',
  'blender-modeler': 'Blender 子代理',
  'research-analyst': '调研取证',
}

export function subagentCompletionAgentLabel(
  agentType: SubagentCompletionAgentType | undefined,
): string {
  return agentType ? AGENT_LABELS[agentType] : '子代理'
}

/** CAD children and historical research runs expose an evidence pack; Blender exposes a report. */
function producesEvidencePack(agentType: SubagentCompletionAgentType | undefined): boolean {
  return agentType === 'cad-analyst'
    || agentType === 'cad-drafter'
    || agentType === 'research-analyst'
}

/** Single wording for the streaming notice and the persisted transcript row. */
export function describeSubagentCompletionNotice(notice: SubagentCompletionNotice): string {
  const label = subagentCompletionAgentLabel(notice.agentType)
  if (notice.count && notice.count > 1) {
    return `${notice.count} 个子代理已结束，回报已合并注入上下文`
  }
  if (notice.status === 'cancelled') return `${label}已取消，取消回报已注入上下文`
  if (notice.status === 'failed') return `${label}执行失败，失败回报已注入上下文`
  if (notice.status === 'completed') {
    return producesEvidencePack(notice.agentType)
      ? `${label}已完成，证据包回报已注入上下文`
      : `${label}已完成，执行报告已注入上下文`
  }
  return `${label}回报已注入上下文`
}
