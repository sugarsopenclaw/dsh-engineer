type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiEnvelope<T> = {
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
    readonly code?: string | null,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

export type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  accessToken?: string | null
  signal?: AbortSignal
}

export function getBackendBaseUrl() {
  return (
    process.env.XIAOLIANG_BACKEND_BASE_URL?.trim()
    || process.env.VITE_BACKEND_BASE_URL?.trim()
    || FALLBACK_BACKEND_BASE_URL
  ).replace(/\/+$/, '')
}

type TokenRefresher = () => Promise<string | null>

let tokenRefresher: TokenRefresher | null = null

/** Wire once from main-process auth so billing/agent-usage can recover from 401. */
export function setBackendTokenRefresher(refresher: TokenRefresher | null) {
  tokenRefresher = refresher
}

async function executeBackendRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const headers = new Headers()

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`)
  }

  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    method: options.method || (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  const payload = await parsePayload(response)

  if (!response.ok) {
    const envelope = (payload && typeof payload === 'object' ? payload : {}) as ApiEnvelope<T>
    throw new BackendApiError(
      extractApiError(payload) || `请求失败 (${response.status})`,
      response.status,
      typeof envelope.code === 'string'
        ? envelope.code
        : typeof envelope.message === 'string'
          ? envelope.message
          : null,
      envelope.details,
    )
  }

  const envelope = payload as ApiEnvelope<T>

  if (!envelope.success || envelope.data === undefined) {
    throw new BackendApiError(
      envelope.error || envelope.message || '接口返回失败。',
      response.status,
      typeof envelope.code === 'string' ? envelope.code : null,
      envelope.details,
    )
  }

  return envelope.data
}

export async function backendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await executeBackendRequest<T>(path, options)
  } catch (error) {
    if (
      error instanceof BackendApiError
      && error.status === 401
      && options.accessToken
      && tokenRefresher
    ) {
      const nextToken = await tokenRefresher()
      if (nextToken && nextToken !== options.accessToken) {
        return executeBackendRequest<T>(path, { ...options, accessToken: nextToken })
      }
    }
    throw error
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
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  if (typeof record.error === 'string' && record.error.length > 0) return record.error
  if (typeof record.message === 'string' && record.message.length > 0) return record.message
  if (typeof record.detail === 'string' && record.detail.length > 0) return record.detail
  if (Array.isArray(record.detail)) {
    const messages = record.detail
      .map((item) => {
        if (typeof item === 'string') return item.trim() || null
        if (!item || typeof item !== 'object') return null

        const detail = item as Record<string, unknown>
        const message = typeof detail.msg === 'string' ? detail.msg.trim() : ''
        if (!message) return null
        const location = Array.isArray(detail.loc)
          ? detail.loc
            .filter((part): part is string | number => (
              typeof part === 'string' || typeof part === 'number'
            ))
            .map(String)
            .filter((part) => part !== 'body')
            .join('.')
          : ''
        return location ? `${location}: ${message}` : message
      })
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) return messages.slice(0, 3).join('；')
  }
  return null
}
