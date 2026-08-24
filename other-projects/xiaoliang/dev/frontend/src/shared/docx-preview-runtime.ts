export const DOCX_PREVIEW_RUNTIME_CHANNEL = 'xiaoliang:docx-preview-runtime'
export const MAX_DOCX_PREVIEW_BYTES = 15 * 1024 * 1024
export const MAX_DOCX_PREVIEW_BASE64_CHARACTERS = Math.ceil(MAX_DOCX_PREVIEW_BYTES / 3) * 4 + 16
export const MAX_DOCX_PREVIEW_ERROR_CHARACTERS = 500

export function toDocxPreviewErrorText(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : 'Word 文档渲染失败。'
  return message.slice(0, MAX_DOCX_PREVIEW_ERROR_CHARACTERS)
}

export interface DocxPreviewRenderRequest {
  channel: typeof DOCX_PREVIEW_RUNTIME_CHANNEL
  type: 'render'
  requestId: number
  dataBase64: string
}

export interface DocxPreviewReadyMessage {
  channel: typeof DOCX_PREVIEW_RUNTIME_CHANNEL
  type: 'ready'
}

export interface DocxPreviewResultMessage {
  channel: typeof DOCX_PREVIEW_RUNTIME_CHANNEL
  type: 'result'
  requestId: number
  success: boolean
  error?: string
}

export type DocxPreviewRuntimeMessage = DocxPreviewReadyMessage | DocxPreviewResultMessage

export function isDocxPreviewRenderRequest(value: unknown): value is DocxPreviewRenderRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DocxPreviewRenderRequest>
  return candidate.channel === DOCX_PREVIEW_RUNTIME_CHANNEL
    && candidate.type === 'render'
    && Number.isSafeInteger(candidate.requestId)
    && typeof candidate.dataBase64 === 'string'
    && candidate.dataBase64.length <= MAX_DOCX_PREVIEW_BASE64_CHARACTERS
}

export function isDocxPreviewRuntimeMessage(value: unknown): value is DocxPreviewRuntimeMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    channel?: unknown
    type?: unknown
    requestId?: unknown
    success?: unknown
    error?: unknown
  }
  if (candidate.channel !== DOCX_PREVIEW_RUNTIME_CHANNEL) return false
  if (candidate.type === 'ready') return true
  return candidate.type === 'result'
    && Number.isSafeInteger(candidate.requestId)
    && typeof candidate.success === 'boolean'
    && (
      candidate.error === undefined
      || (
        typeof candidate.error === 'string'
        && candidate.error.length <= MAX_DOCX_PREVIEW_ERROR_CHARACTERS
      )
    )
}
