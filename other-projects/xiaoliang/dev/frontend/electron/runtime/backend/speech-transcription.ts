import type { AuthSessionData, SpeechTranscriptionData } from '../../../src/shared/backend-api'

const FALLBACK_BACKEND_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://127.0.0.1:8000'
  : 'https://xl.x3yun.com/api'

const BACKEND_BASE_URL = (
  process.env.XIAOLIANG_BACKEND_BASE_URL?.trim()
  || process.env.VITE_BACKEND_BASE_URL?.trim()
  || FALLBACK_BACKEND_BASE_URL
).replace(/\/+$/, '')

export interface SpeechBufferTranscriptionInput {
  buffer: Buffer
  mimeType: string
  fileName: string
  getBackendSession: () => Promise<AuthSessionData | null>
}

export async function transcribeSpeechBuffer(
  input: SpeechBufferTranscriptionInput,
): Promise<SpeechTranscriptionData> {
  const firstSession = await input.getBackendSession()
  if (!firstSession?.access_token) {
    throw new Error('当前未登录后端，无法转写语音。')
  }

  let response = await requestTranscription(input, firstSession.access_token)
  if (response.status === 401) {
    const refreshedSession = await input.getBackendSession()
    if (refreshedSession?.access_token && refreshedSession.access_token !== firstSession.access_token) {
      response = await requestTranscription(input, refreshedSession.access_token)
    }
  }

  const payload = await parseBackendPayload(response)
  if (!response.ok) {
    throw new Error(`语音转写失败 (${response.status})：${extractBackendError(payload)}`)
  }

  const envelope = payload as {
    success?: boolean
    data?: Partial<SpeechTranscriptionData>
    error?: string
    message?: string
  }
  if (envelope.success === false) {
    throw new Error(envelope.error || envelope.message || '语音转写接口返回失败。')
  }

  const data = (envelope.data ?? payload) as Partial<SpeechTranscriptionData>
  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text) {
    throw new Error('未识别到有效语音内容。')
  }

  return {
    text,
    model: typeof data.model === 'string' ? data.model : '',
    content_type: typeof data.content_type === 'string' ? data.content_type : null,
    size_bytes: typeof data.size_bytes === 'number' ? data.size_bytes : input.buffer.byteLength,
  }
}

async function requestTranscription(
  input: SpeechBufferTranscriptionInput,
  accessToken: string,
) {
  const formData = new FormData()
  formData.append(
    'audio',
    new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
    input.fileName,
  )

  return fetch(`${BACKEND_BASE_URL}/speech/transcribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  })
}

async function parseBackendPayload(response: Response) {
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<unknown>
  }
  const text = await response.text()
  return text || null
}

function extractBackendError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '请求失败'
  const record = payload as Record<string, unknown>
  return firstNonEmpty(
    typeof record.error === 'string' ? record.error : undefined,
    typeof record.message === 'string' ? record.message : undefined,
    typeof record.detail === 'string' ? record.detail : undefined,
  ) || '请求失败'
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim() ?? '').find(Boolean) ?? ''
}
