/**
 * Message protocol between the React preview panel and the sandboxed CAD preview
 * runtime document. The panel never ships drawing bytes across `postMessage`; it
 * hands over a single-use loopback URL that the runtime streams directly.
 */
export const CAD_PREVIEW_RUNTIME_CHANNEL = 'xiaoliang:cad-preview-runtime'

export type CadPreviewLocale = 'zh' | 'en'
export type CadPreviewTheme = 'light' | 'dark'

export interface CadPreviewOpenRequest {
  channel: typeof CAD_PREVIEW_RUNTIME_CHANNEL
  type: 'open'
  requestId: number
  fileName: string
  /** Single-use loopback capability URL for the drawing bytes. */
  sourceUrl: string
  /** Loopback base URL that serves the self-hosted font and template corpus. */
  cadDataBaseUrl: string
  locale: CadPreviewLocale
  theme: CadPreviewTheme
}

export interface CadPreviewReadyMessage {
  channel: typeof CAD_PREVIEW_RUNTIME_CHANNEL
  type: 'ready'
}

export interface CadPreviewProgressMessage {
  channel: typeof CAD_PREVIEW_RUNTIME_CHANNEL
  type: 'progress'
  requestId: number
  /** 0-100, or `null` while the stage is running without a determinate share. */
  percentage: number | null
  stage: string
}

export interface CadPreviewDocumentSummary {
  fileName: string
  entityCount: number
  layerCount: number
  parseDurationMs: number
  /** Fonts the drawing asked for that the self-hosted corpus could not supply. */
  fontsNotFound: string[]
}

export type CadPreviewResultMessage = {
  channel: typeof CAD_PREVIEW_RUNTIME_CHANNEL
  type: 'result'
  requestId: number
} & (
  | { ok: true; document: CadPreviewDocumentSummary }
  | { ok: false; error: string }
)

export type CadPreviewRuntimeMessage =
  | CadPreviewReadyMessage
  | CadPreviewProgressMessage
  | CadPreviewResultMessage

export function isCadPreviewOpenRequest(value: unknown): value is CadPreviewOpenRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CadPreviewOpenRequest>
  return candidate.channel === CAD_PREVIEW_RUNTIME_CHANNEL
    && candidate.type === 'open'
    && Number.isSafeInteger(candidate.requestId)
    && typeof candidate.fileName === 'string'
    && candidate.fileName.length > 0
    && candidate.fileName.length <= 512
    && isLoopbackUrl(candidate.sourceUrl)
    && isLoopbackUrl(candidate.cadDataBaseUrl)
    && (candidate.locale === 'zh' || candidate.locale === 'en')
    && (candidate.theme === 'light' || candidate.theme === 'dark')
}

export function isCadPreviewRuntimeMessage(value: unknown): value is CadPreviewRuntimeMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { channel?: unknown; type?: unknown }
  if (candidate.channel !== CAD_PREVIEW_RUNTIME_CHANNEL) return false
  return candidate.type === 'ready' || candidate.type === 'progress' || candidate.type === 'result'
}

/**
 * The runtime only ever talks to the capability server on loopback. Rejecting
 * anything else keeps a spoofed `postMessage` from steering it at a remote host.
 */
function isLoopbackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' && url.hostname === '127.0.0.1'
}
