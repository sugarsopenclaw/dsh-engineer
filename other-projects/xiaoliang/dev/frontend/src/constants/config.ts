const fallbackBackendBaseUrl = import.meta.env.DEV
  ? 'http://127.0.0.1:8000'
  : 'https://xl.x3yun.com/api'

export const BACKEND_BASE_URL = (
  import.meta.env.VITE_BACKEND_BASE_URL?.trim() || fallbackBackendBaseUrl
).replace(/\/+$/, '')
