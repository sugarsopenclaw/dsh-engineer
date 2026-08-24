import type { ManagedAgentModelCatalogView } from '../../../src/shared/backend-api'
import { backendRequest } from './http'

export class AgentModelCatalogApiClient {
  getCatalog(accessToken: string) {
    return backendRequest<ManagedAgentModelCatalogView>('/agent/v1/models', {
      accessToken,
    })
  }
}

export const agentModelCatalogApiClient = new AgentModelCatalogApiClient()
