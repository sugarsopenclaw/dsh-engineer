import type {
  AuthSessionData,
  CurrentUserData,
  LoginRequest,
  LoginWithEmailCodeRequest,
  RegisterRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
} from '../../../src/shared/backend-api'

type HttpMethod = 'GET' | 'POST'

type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  accessToken?: string | null
}

type ApiEnvelope<T> = {
  success: boolean
  data?: T
  message?: string | null
  error?: string | null
  code?: string | null
  details?: unknown
}

const FALLBACK_BACKEND_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://127.0.0.1:8000'
  : 'https://xl.x3yun.com/api'

export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

export function isInvalidRefreshTokenError(error: unknown): error is BackendApiError {
  return (
    error instanceof BackendApiError
    && error.status === 401
    && error.code === 'invalid_refresh_token'
  )
}

export class BackendAuthApiClient {
  private readonly baseUrl = getBackendBaseUrl()

  register(payload: RegisterRequest) {
    return this.request<AuthSessionData>('/auth/register', {
      method: 'POST',
      body: payload,
    })
  }

  login(payload: LoginRequest) {
    return this.request<AuthSessionData>('/auth/login', {
      method: 'POST',
      body: payload,
    })
  }

  sendEmailLoginCode(payload: SendEmailCodeRequest) {
    return this.requestOptionalData<SendEmailCodeResponse>('/auth/email-otp/send', {
      method: 'POST',
      body: payload,
    })
  }

  loginWithEmailCode(payload: LoginWithEmailCodeRequest) {
    return this.request<AuthSessionData>('/auth/email-otp/login', {
      method: 'POST',
      body: payload,
    })
  }

  refresh(refreshToken: string) {
    return this.request<AuthSessionData>('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
  }

  async logout(refreshToken: string) {
    await this.request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
  }

  getCurrentUser(accessToken: string) {
    return this.request<CurrentUserData>('/users/me', {
      accessToken,
    })
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const headers = new Headers()

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    if (options.accessToken) {
      headers.set('Authorization', `Bearer ${options.accessToken}`)
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const payload = await parsePayload(response)

    if (!response.ok) {
      throw createBackendApiError(payload, response.status, `请求失败 (${response.status})`)
    }

    const envelope = payload as ApiEnvelope<T>

    if (!envelope.success || envelope.data === undefined) {
      throw createBackendApiError(payload, response.status, '接口返回失败。')
    }

    return envelope.data
  }

  /** 发码等接口可能只返回 success、无 data 字段 */
  private async requestOptionalData<T>(path: string, options: RequestOptions): Promise<T | undefined> {
    const headers = new Headers()

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    if (options.accessToken) {
      headers.set('Authorization', `Bearer ${options.accessToken}`)
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const payload = await parsePayload(response)

    if (!response.ok) {
      throw createBackendApiError(payload, response.status, `请求失败 (${response.status})`)
    }

    const envelope = payload as ApiEnvelope<T>

    if (!envelope.success) {
      throw createBackendApiError(payload, response.status, '接口返回失败。')
    }

    return envelope.data
  }
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text.length > 0 ? text : null
}

function extractApiError(payload: unknown): string | null {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    return payload
  }

  if (typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>

  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error
  }

  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message
  }

  if (typeof record.detail === 'string' && record.detail.length > 0) {
    return record.detail
  }

  if (Array.isArray(record.detail)) {
    const parts = record.detail
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') {
          return item.msg
        }

        return null
      })
      .filter((item): item is string => Boolean(item))

    if (parts.length > 0) {
      return parts.join('；')
    }
  }

  return null
}

function getBackendBaseUrl() {
  return (
    process.env.XIAOLIANG_BACKEND_BASE_URL?.trim()
    || process.env.VITE_BACKEND_BASE_URL?.trim()
    || FALLBACK_BACKEND_BASE_URL
  ).replace(/\/+$/, '')
}

function createBackendApiError(payload: unknown, status: number, fallbackMessage: string) {
  const envelope = payload && typeof payload === 'object'
    ? payload as ApiEnvelope<unknown>
    : null
  return new BackendApiError(
    extractApiError(payload) || fallbackMessage,
    status,
    typeof envelope?.code === 'string' ? envelope.code : null,
    envelope?.details,
  )
}
