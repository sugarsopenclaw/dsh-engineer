import { createHash } from 'node:crypto'
import type { AgentMessageRecord } from '../../../src/shared/local-agent'

export function stableMessageKey(message: AgentMessageRecord): string {
  const hash = createHash('sha256')
  const localMessageId = message.id.trim()
  const values = localMessageId
    ? ['local-message-id-v1', message.conversationId, localMessageId]
    : [
        'message-content-v1',
        message.conversationId,
        message.role,
        message.createdAt,
        message.content,
        message.toolName,
        message.toolArgs,
        message.toolResult,
        message.thinking,
      ]
  for (const value of values) {
    hash.update(String(value || ''))
    hash.update('\0')
  }
  return hash.digest('hex')
}
