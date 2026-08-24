import { BACKEND_BASE_URL } from '@/constants/config'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import { useAuthStore } from '@/stores/auth-store'
import type { AuthSessionData } from '@/shared/backend-api'
import type { ApiResponse } from '@/types/render'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  headers?: HeadersInit
  auth?: boolean
  wrapped?: boolean
  allowRefresh?: boolean
  signal?: AbortSignal
}

let refreshPromise: Promise<AuthSessionData | null> | null = null

export async function requestApi<T>(path: string, options: Omit<RequestOptions, 'wrapped'> = {}): Promise<T> {
  return requestJson<T>(path, { ...options, wrapped: true })
}

export async function requestRaw<T>(path: string, options: Omit<RequestOptions, 'wrapped'> = {}): Promise<T> {
  return requestJson<T>(path, { ...options, wrapped: false })
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return '请求失败，请稍后重试。'
}

async function requestJson<T>(path: string, options: RequestOptions): Promise<T> {
  const authState = useAuthStore.getState()
  const accessToken = options.auth === false ? null : authState.session?.access_token ?? null
  let preserveSessionAfterUnauthorized = false

  let response = await executeRequest(path, options, accessToken)

  if (
    response.status === 401
    && options.auth !== false
    && options.allowRefresh !== false
    && authState.session?.refresh_token
  ) {
    const refreshedSession = await refreshSession(authState.session.refresh_token)

    if (refreshedSession?.access_token && refreshedSession.access_token !== accessToken) {
      response = await executeRequest(path, options, refreshedSession.access_token)
    } else if (refreshedSession?.access_token === accessToken) {
      preserveSessionAfterUnauthorized = true
    }
  }

  const payload = await parsePayload(response)

  if (!response.ok) {
    if (
      response.status === 401
      && options.auth !== false
      && !preserveSessionAfterUnauthorized
    ) {
      useAuthStore.getState().clearSession()
    }

    throw new Error(extractApiError(payload) || `请求失败 (${response.status})`)
  }

  if (options.wrapped === false) {
    return payload as T
  }

  const envelope = payload as ApiResponse<T>

  if (!envelope.success) {
    throw new Error(envelope.error || envelope.message || '接口返回失败。')
  }

  return envelope.data as T
}

async function executeRequest(path: string, options: RequestOptions, accessToken: string | null): Promise<Response> {
  const headers = new Headers(options.headers)
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData

  if (options.body !== undefined && !isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.auth !== false && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  let requestBody: BodyInit | undefined
  if (options.body !== undefined) {
    requestBody = isFormDataBody
      ? (options.body as FormData)
      : JSON.stringify(options.body)
  }

  return fetch(`${BACKEND_BASE_URL}${path}`, {
    method: options.method || (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: requestBody,
    signal: options.signal,
  })
}

async function refreshSession(refreshToken: string): Promise<AuthSessionData | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        if (isElectronApp()) {
          const nextSession = await electronBridge.refreshBackendSession()
          if (nextSession) {
            useAuthStore.getState().setSession(nextSession)
            return nextSession
          }

          useAuthStore.getState().clearSession()
          return null
        }

        const response = await executeRequest(
          '/auth/refresh',
          {
            method: 'POST',
            body: { refresh_token: refreshToken },
            auth: false,
            wrapped: true,
            allowRefresh: false,
          },
          null,
        )

        const payload = await parsePayload(response)

        if (!response.ok) {
          throw new Error(extractApiError(payload) || '会话刷新失败。')
        }

        const envelope = payload as ApiResponse<AuthSessionData>

        if (!envelope.success || !envelope.data) {
          throw new Error(envelope.error || envelope.message || '会话刷新失败。')
        }

        useAuthStore.getState().setSession(envelope.data)
        return envelope.data
      } catch (error) {
        if (isElectronApp()) {
          console.warn('[auth] 会话刷新暂时失败，保留当前登录态。', error)
          return useAuthStore.getState().session
        }
        useAuthStore.getState().clearSession()
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }

  return refreshPromise
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
