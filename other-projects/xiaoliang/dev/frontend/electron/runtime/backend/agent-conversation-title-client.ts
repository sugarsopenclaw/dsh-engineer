import { backendRequest } from './http'

export interface AgentConversationTitleResult {
  title: string
}

class AgentConversationTitleApiClient {
  generate(
    accessToken: string,
    firstUserMessage: string,
    signal?: AbortSignal,
  ): Promise<AgentConversationTitleResult> {
    return backendRequest<AgentConversationTitleResult>('/agent/v1/conversation-title', {
      method: 'POST',
      accessToken,
      body: { first_user_message: firstUserMessage },
      signal,
    })
  }
}

export const agentConversationTitleApiClient = new AgentConversationTitleApiClient()
