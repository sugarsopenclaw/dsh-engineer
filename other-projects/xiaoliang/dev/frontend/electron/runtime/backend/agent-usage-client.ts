import type {
  AgentUsageRunFinishRequest,
  AgentUsageRunDetailView,
  AgentUsageRunStartRequest,
  AgentUsageRunView,
} from '../../../src/shared/backend-api'
import { backendRequest } from './http'

export class AgentUsageApiClient {
  startRun(accessToken: string, payload: AgentUsageRunStartRequest) {
    return backendRequest<AgentUsageRunView>('/users/me/agent-runs', {
      method: 'POST',
      accessToken,
      body: payload,
    })
  }

  finishRun(accessToken: string, clientRunId: string, payload: AgentUsageRunFinishRequest) {
    return backendRequest<AgentUsageRunView>(
      `/users/me/agent-runs/${encodeURIComponent(clientRunId)}`,
      {
        method: 'PATCH',
        accessToken,
        body: payload,
      },
    )
  }

  getRunUsage(accessToken: string, clientRunId: string, limit = 200) {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    return backendRequest<AgentUsageRunDetailView>(
      `/users/me/agent-runs/${encodeURIComponent(clientRunId)}/usage?limit=${boundedLimit}`,
      { accessToken },
    )
  }
}

export const agentUsageApiClient = new AgentUsageApiClient()
