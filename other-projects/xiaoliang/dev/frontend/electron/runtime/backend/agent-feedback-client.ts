import type {
  AgentMessageFeedbackDeleteInput,
  AgentMessageFeedbackUpsertInput,
  AgentMessageFeedbackView,
} from '../../../src/shared/backend-api'
import { backendRequest } from './http'

export class AgentFeedbackApiClient {
  listForConversation(accessToken: string, localConversationId: string) {
    const query = new URLSearchParams({
      local_conversation_id: localConversationId,
    })
    return backendRequest<AgentMessageFeedbackView[]>(
      `/users/me/agent-feedback?${query.toString()}`,
      { accessToken },
    )
  }

  upsert(accessToken: string, payload: AgentMessageFeedbackUpsertInput) {
    return backendRequest<AgentMessageFeedbackView>('/users/me/agent-feedback', {
      method: 'PUT',
      accessToken,
      body: payload,
    })
  }

  delete(accessToken: string, payload: AgentMessageFeedbackDeleteInput) {
    const query = new URLSearchParams({
      local_conversation_id: payload.local_conversation_id,
      local_message_id: payload.local_message_id,
    })
    return backendRequest<{ ok: boolean }>(
      `/users/me/agent-feedback?${query.toString()}`,
      {
        method: 'DELETE',
        accessToken,
      },
    )
  }
}

export const agentFeedbackApiClient = new AgentFeedbackApiClient()
