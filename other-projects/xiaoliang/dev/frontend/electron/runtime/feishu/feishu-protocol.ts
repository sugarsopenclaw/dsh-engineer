import type { FeishuSettingsView, SubagentRunUpdate } from '../../../src/shared/local-agent'

export const FEISHU_REPLY_CHUNK_SIZE = 3200
const FEISHU_PROGRESS_MAX_TOOLS = 4

/**
 * Routing, wire-format and progress rendering for the Feishu channel. Kept free
 * of the Lark SDK and the database so it stays directly testable.
 */

export function buildFeishuRouteKey(input: {
  isGroup: boolean
  chatId: string
  senderId: string
  rootId: string
  groupSessionScope: FeishuSettingsView['groupSessionScope']
}) {
  const senderSuffix = `sender:${input.senderId || 'unknown'}`
  if (!input.isGroup) {
    return `dm:${input.senderId || input.chatId}`
  }

  const groupBase = `group:${input.chatId}`
  if (input.groupSessionScope === 'group') return groupBase
  if (input.groupSessionScope === 'group_sender') return `${groupBase}:${senderSuffix}`

  // Plain group messages carry no thread ids at all. Without a topic the scope
  // degrades to its thread-less equivalent instead of inventing one, otherwise
  // every message would open a brand new session.
  const topicSuffix = input.rootId ? `topic:${input.rootId}` : ''
  if (input.groupSessionScope === 'group_topic_sender') {
    return [groupBase, topicSuffix, senderSuffix].filter(Boolean).join(':')
  }
  return [groupBase, topicSuffix].filter(Boolean).join(':')
}

/**
 * Reads the documented `GET /open-apis/bot/v3/info` payload, which puts `bot`
 * at the top level rather than under `data`.
 */
export function extractFeishuBotInfo(response: unknown) {
  const record = response && typeof response === 'object'
    ? response as Record<string, unknown>
    : {}
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : {}
  const rawBot = record.bot ?? data.bot
  const bot = rawBot && typeof rawBot === 'object'
    ? rawBot as Record<string, unknown>
    : {}
  return {
    code: typeof record.code === 'number' ? record.code : undefined,
    msg: typeof record.msg === 'string' ? record.msg : '',
    openId: typeof bot.open_id === 'string' ? bot.open_id.trim() : '',
    appName: typeof bot.app_name === 'string' ? bot.app_name.trim() : '',
  }
}

export function buildTextContent(text: string) {
  return JSON.stringify({ text })
}

export function buildPostContent(text: string) {
  return JSON.stringify({
    zh_cn: {
      content: [
        [
          {
            tag: 'md',
            text,
          },
        ],
      ],
    },
  })
}

export function buildCardContent(
  text: string,
  options: { title?: string; template?: string } = {},
) {
  return JSON.stringify({
    schema: '2.0',
    config: {
      width_mode: 'fill',
    },
    header: {
      title: {
        tag: 'plain_text',
        content: options.title ?? '晓量',
      },
      template: options.template ?? 'blue',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: text,
        },
      ],
    },
  })
}

export function buildMarkdownCardContent(text: string) {
  return buildCardContent(text)
}

export function buildProgressCardContent(text: string) {
  return buildCardContent(text, { title: '晓量 · 处理中', template: 'grey' })
}

export function shouldUseMarkdownCard(text: string) {
  return /```[\s\S]*?```/.test(text) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)
}

export function chunkText(text: string, size = FEISHU_REPLY_CHUNK_SIZE) {
  const normalized = text.trim()
  if (normalized.length <= size) return normalized ? [normalized] : []
  const chunks: string[] = []
  let rest = normalized
  while (rest.length > size) {
    const hardLimit = rest.slice(0, size)
    const splitAt = Math.max(
      hardLimit.lastIndexOf('\n\n'),
      hardLimit.lastIndexOf('\n'),
      hardLimit.lastIndexOf('。'),
      hardLimit.lastIndexOf('；'),
      hardLimit.lastIndexOf('; '),
    )
    const cut = splitAt > size * 0.5 ? splitAt + 1 : size
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) {
    chunks.push(rest)
  }
  return chunks
}

export interface FeishuRunProgress {
  startedAt: number
  thinking: boolean
  answering: boolean
  /** Keyed by toolCallId so parallel calls collapse into one line. */
  activeTools: Map<string, string>
  finishedTools: number
  lastFinishedTool: string
  subagents: Map<string, { label: string; status: string }>
  compaction: string
  retry: string
}

export const FEISHU_SUBAGENT_TYPE_LABELS: Record<SubagentRunUpdate['type'], string> = {
  'cad-analyst': '图纸分析',
  'cad-drafter': '图纸绘制',
  'blender-modeler': '三维建模',
  'research-analyst': '资料调研',
}

const FEISHU_SUBAGENT_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function createRunProgress(startedAt = Date.now()): FeishuRunProgress {
  return {
    startedAt,
    thinking: false,
    answering: false,
    activeTools: new Map(),
    finishedTools: 0,
    lastFinishedTool: '',
    subagents: new Map(),
    compaction: '',
    retry: '',
  }
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/**
 * Feishu has no token-level streaming, so the agent loop is surfaced as a
 * status digest patched into one card instead of a message per step.
 */
export function renderRunProgress(progress: FeishuRunProgress, now = Date.now()) {
  const activeTools = Array.from(new Set(progress.activeTools.values()))
  const headline = activeTools.length > 0
    ? `正在调用工具：${activeTools.slice(0, FEISHU_PROGRESS_MAX_TOOLS).join('、')}${
      activeTools.length > FEISHU_PROGRESS_MAX_TOOLS ? ' 等' : ''
    }`
    : progress.answering
      ? '正在编写回答'
      : progress.thinking
        ? '正在思考'
        : '正在处理'

  const details: string[] = []
  if (progress.finishedTools > 0) {
    details.push(
      progress.lastFinishedTool
        ? `已完成 ${progress.finishedTools} 次工具调用，最近：${progress.lastFinishedTool}`
        : `已完成 ${progress.finishedTools} 次工具调用`,
    )
  }
  for (const subagent of progress.subagents.values()) {
    const status = FEISHU_SUBAGENT_STATUS_LABELS[subagent.status] ?? subagent.status
    details.push(`子代理 ${subagent.label}：${status}`)
  }
  if (progress.compaction) details.push(progress.compaction)
  if (progress.retry) details.push(progress.retry)

  return [
    `**${headline}** · 已用 ${formatElapsed(now - progress.startedAt)}`,
    ...details.map((detail) => `- ${detail}`),
  ].join('\n')
}

/**
 * Only text the finished run authored may be published. Falling back to the
 * transcript's last assistant message would replay the previous answer whenever
 * a turn ended without producing one (soft error, blocked tool, user abort).
 */
export function pickRunReplyText(input: {
  finalAnswer: string | null
  runAssistantText: string
  textBuffer: string
  errorText: string | null
  status: 'completed' | 'stopped' | 'failed'
}) {
  const answer =
    input.finalAnswer?.trim()
    || input.runAssistantText.trim()
    || input.textBuffer.trim()

  if (answer) {
    return input.errorText ? `${answer}\n\n处理中出现错误：${input.errorText}` : answer
  }
  if (input.errorText) return `处理失败：${input.errorText}`
  if (input.status === 'stopped') return '本次请求已被停止。'
  if (input.status === 'failed') return '处理失败，请稍后重试。'
  return '已完成。'
}

export function buildInterruptedNotice(partialText: string, reason: string) {
  const partial = partialText.trim()
  return partial
    ? `${partial}\n\n（本次回答被中断：${reason}。请重新发送消息继续。）`
    : `本次请求未完成就被中断：${reason}。请重新发送消息重试。`
}
