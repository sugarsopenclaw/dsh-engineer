import { parseSubagentCompletionPrompt } from '../../../../src/shared/subagent-completion'
import { CANONICAL_EVIDENCE_PACK_REF_PATTERN } from '../subagents/security'

interface TurnMessage {
  role?: unknown
  content?: unknown
}

export function extractTurnMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ''
  }

  const chunks = content.flatMap((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      return trimmed ? [trimmed] : []
    }
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') {
      const trimmed = record.text.trim()
      return trimmed ? [trimmed] : []
    }
    return []
  })
  return chunks.join('\n').trim()
}

export function isHostAuthoredUserMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return false
  }
  const candidate = message as TurnMessage
  if (candidate.role !== 'user') {
    return false
  }
  return parseSubagentCompletionPrompt(extractTurnMessageText(candidate.content)) !== null
}

export function findGenuineTurnStartIndex(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 0
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as TurnMessage
    if (message?.role !== 'user') {
      continue
    }
    if (isHostAuthoredUserMessage(message)) {
      continue
    }
    return index + 1
  }
  return 0
}

export function getGenuineUserText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return ''
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as TurnMessage
    if (message?.role !== 'user' || isHostAuthoredUserMessage(message)) {
      continue
    }
    const text = extractTurnMessageText(message.content)
    if (text) {
      return text
    }
  }
  return ''
}

export function getGenuineUserTextWindow(messages: unknown, maxUserTurns = 3): string {
  if (!Array.isArray(messages)) {
    return ''
  }
  const parts: string[] = []
  let remainingTurns = maxUserTurns
  for (let index = messages.length - 1; index >= 0 && remainingTurns > 0; index -= 1) {
    const message = messages[index] as TurnMessage
    if (message?.role !== 'user' || isHostAuthoredUserMessage(message)) {
      continue
    }
    remainingTurns -= 1
    const text = extractTurnMessageText(message.content)
    if (text) {
      parts.unshift(text)
    }
  }
  return parts.join('\n').trim()
}

/** How far back a completion notice looks for the parent having read the evidence. */
const EVIDENCE_SCAN_MESSAGE_LIMIT = 80

/**
 * Whether the parent already read one of these artifacts with its own `read` tool.
 *
 * A parent that went and read the evidence pack does not need to be told the child
 * finished: the notice would cost a turn and invite it to read the same file again.
 * Only a successful read of a canonical per-run evidence pack counts — shared pages
 * are not run-specific, and a path that merely contains one as a substring is not it.
 */
export function hasReadArtifact(messages: unknown, artifactRefs: readonly string[]): boolean {
  if (!Array.isArray(messages)) return false
  const needles = new Set(
    artifactRefs
      .map((ref) => (typeof ref === 'string' ? ref.trim().replace(/\\/gu, '/') : ''))
      .filter((ref) => CANONICAL_EVIDENCE_PACK_REF_PATTERN.test(ref)),
  )
  if (needles.size === 0) return false

  const start = Math.max(0, messages.length - EVIDENCE_SCAN_MESSAGE_LIMIT)
  const failedCallIds = new Set<string>()
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index] as { role?: unknown; toolCallId?: unknown; isError?: unknown }
    if (message?.role === 'toolResult' && message.isError === true && typeof message.toolCallId === 'string') {
      failedCallIds.add(message.toolCallId)
    }
  }
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index] as TurnMessage
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue
      const call = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
      if (call.type !== 'toolCall' || call.name !== 'read') continue
      if (typeof call.id === 'string' && failedCallIds.has(call.id)) continue
      if (needles.has(readToolCallPath(call.arguments))) return true
    }
  }
  return false
}

/** The `path` argument of a read call, separator-normalized; anything else cannot match. */
function readToolCallPath(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const value = (args as { path?: unknown }).path
  return typeof value === 'string' ? value.trim().replace(/\\/gu, '/') : ''
}

export function collectTurnAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return ''
  }
  const start = findGenuineTurnStartIndex(messages)
  const parts: string[] = []
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index] as TurnMessage & { stopReason?: unknown }
    if (message?.role !== 'assistant') {
      continue
    }
    if (
      message.stopReason === 'error'
      || message.stopReason === 'aborted'
      || message.stopReason === 'toolUse'
    ) {
      continue
    }
    const text = extractTurnMessageText(message.content)
    if (text) {
      parts.push(text)
    }
  }
  return parts.join('\n\n').trim()
}
