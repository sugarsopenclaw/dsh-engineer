const DEFAULT_RELEASE_SITE_URL = 'https://xl.x3yun.com'

type ReleaseImportMeta = ImportMeta & {
  readonly env?: {
    readonly VITE_RELEASE_SITE_URL?: string
  }
}

function normalizeUrl(value: string | undefined): string {
  const candidate = value?.trim()
  if (!candidate) return DEFAULT_RELEASE_SITE_URL
  return candidate.replace(/\/+$/, '')
}

export const RELEASE_SITE_URL = normalizeUrl(
  (import.meta as ReleaseImportMeta).env?.VITE_RELEASE_SITE_URL,
)
