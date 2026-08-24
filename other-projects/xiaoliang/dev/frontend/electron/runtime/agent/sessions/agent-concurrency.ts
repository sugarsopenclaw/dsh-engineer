import { BackendApiError } from '../../backend/http'

export const MAX_ACTIVE_AGENT_CONVERSATIONS = 3
export const AGENT_CONVERSATION_LIMIT_CODE = 'agent_conversation_limit'
export const AGENT_CONVERSATION_LIMIT_MESSAGE = `已有 ${MAX_ACTIVE_AGENT_CONVERSATIONS} 个会话在运行，请等待其中一个完成后再试。`

export function assertAgentConversationCapacity(activeConversationCount: number): void {
  if (activeConversationCount < MAX_ACTIVE_AGENT_CONVERSATIONS) return
  throw new BackendApiError(
    AGENT_CONVERSATION_LIMIT_MESSAGE,
    409,
    AGENT_CONVERSATION_LIMIT_CODE,
    { limit: MAX_ACTIVE_AGENT_CONVERSATIONS },
  )
}
