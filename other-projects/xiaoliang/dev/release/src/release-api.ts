export interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string | null
}

export interface ClientReleaseArtifact {
  platform: string
  label: string
  file_name: string
  download_url: string
  backup_url: string | null
  file_size: string | null
  checksum_sha512: string | null
  notes: string[]
}

export interface ClientReleaseData {
  product_name: string
  tagline: string
  summary: string
  release_channel: string
  version: string
  published_at: string
  release_notes_title: string | null
  release_notes: string[]
  highlights: string[]
  installation_steps: string[]
  support_text: string | null
  github_release_url: string | null
  artifacts: ClientReleaseArtifact[]
}

export const RELEASE_API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_RELEASE_API_BASE_URL,
  import.meta.env.DEV ? 'http://127.0.0.1:8000' : 'https://xl.x3yun.com/api',
)

export async function fetchLatestRelease(): Promise<ClientReleaseData> {
  const response = await fetch(joinApiUrl('/client-releases/latest'), {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  })

  let payload: ApiResponse<ClientReleaseData> | null = null
  try {
    payload = (await response.json()) as ApiResponse<ClientReleaseData>
  } catch {
    /* keep payload null when the body is not JSON */
  }

  if (!response.ok || !payload?.success || !payload.data) {
    const message = payload?.message || `请求失败 (${response.status})`
    throw new Error(message)
  }

  return payload.data
}

/**
 * Turn a rejection into something worth showing a visitor. A transport failure
 * surfaces as `TypeError: Failed to fetch`, which says nothing useful on a page
 * whose download button still works.
 */
export function describeLoadError(reason: unknown): string {
  if (reason instanceof DOMException && reason.name === 'TimeoutError') {
    return '连接超时'
  }
  if (reason instanceof TypeError) {
    return '网络暂时不可达'
  }
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message
  }
  return '接口无响应'
}

export function buildTrackedDownloadUrl(downloadPath: string, source: string): string {
  const url = new URL(joinApiUrl(downloadPath))
  const normalizedSource = source.trim()
  if (normalizedSource) {
    url.searchParams.set('source', normalizedSource)
  }
  return url.toString()
}

function joinApiUrl(pathName: string): string {
  const normalizedPath = pathName.startsWith('/') ? pathName : `/${pathName}`
  return `${RELEASE_API_BASE_URL}${normalizedPath}`
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback
  return candidate.replace(/\/+$/, '')
}
