import type {
  PromptTemplateView,
  PromptTemplateWriteInput,
} from '../../../src/shared/backend-api'
import { backendRequest } from './http'

export class PromptTemplateApiClient {
  list(accessToken: string) {
    return backendRequest<PromptTemplateView[]>('/users/me/prompt-templates', {
      accessToken,
    })
  }

  create(accessToken: string, payload: PromptTemplateWriteInput) {
    return backendRequest<PromptTemplateView>('/users/me/prompt-templates', {
      method: 'POST',
      accessToken,
      body: payload,
    })
  }

  update(accessToken: string, templateId: string, payload: PromptTemplateWriteInput) {
    return backendRequest<PromptTemplateView>(
      `/users/me/prompt-templates/${encodeURIComponent(templateId)}`,
      {
        method: 'PUT',
        accessToken,
        body: payload,
      },
    )
  }

  delete(accessToken: string, templateId: string) {
    return backendRequest<{ ok: boolean }>(
      `/users/me/prompt-templates/${encodeURIComponent(templateId)}`,
      {
        method: 'DELETE',
        accessToken,
      },
    )
  }
}

export const promptTemplateApiClient = new PromptTemplateApiClient()
