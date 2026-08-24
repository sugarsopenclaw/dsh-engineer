import { QUOTA_EXCEEDED_CODE } from '../../../src/shared/billing-domain'
import { BackendApiError } from '../backend/http'

export class QuotaExceededError extends Error {
  readonly code = QUOTA_EXCEEDED_CODE
  readonly status = 402

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

export function toQuotaExceededError(error: unknown): QuotaExceededError | null {
  if (error instanceof QuotaExceededError) return error
  if (error instanceof BackendApiError) {
    if (error.status === 402 || error.code === QUOTA_EXCEEDED_CODE) {
      return new QuotaExceededError(
        error.message || '算力额度不足，请购买算力包后继续使用。',
        error.details,
      )
    }
  }
  return null
}

export function serializeAgentError(error: unknown): {
  message: string
  code?: string
  status?: number
  details?: unknown
} {
  const quota = toQuotaExceededError(error)
  if (quota) {
    return {
      message: quota.message,
      code: quota.code,
      status: quota.status,
      details: quota.details,
    }
  }
  if (error instanceof BackendApiError) {
    return {
      message: error.message,
      code: error.code || undefined,
      status: error.status,
      details: error.details,
    }
  }
  return {
    message: error instanceof Error ? error.message : String(error),
  }
}
