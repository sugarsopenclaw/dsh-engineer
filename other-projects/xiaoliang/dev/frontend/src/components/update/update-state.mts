export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateStatusInput = {
  phase: UpdatePhase | 'disabled'
  version?: string | null
  percent?: number | null
  message?: string | null
  forceUpdate?: boolean | null
  forceUpdateMessage?: string | null
}

export type UpdateStatus = {
  phase: UpdatePhase
  version: string | null
  percent: number | null
  message: string
  forceUpdate: boolean
  forceUpdateMessage: string | null
}

function normalizePercent(percent?: number | null): number | null {
  if (typeof percent !== 'number' || Number.isNaN(percent)) return null
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function buildMessage(input: UpdateStatusInput, percent: number | null): string {
  if (input.message?.trim()) return input.message.trim()
  if (input.forceUpdate && input.forceUpdateMessage?.trim()) {
    return input.forceUpdateMessage.trim()
  }

  switch (input.phase) {
    case 'idle':
    case 'disabled':
      return ''
    case 'checking':
      return '正在检查更新...'
    case 'available':
      return input.version ? `发现新版本 ${input.version}，正在准备下载。` : '发现新版本，正在准备下载。'
    case 'downloading':
      return percent === null ? '正在后台下载更新...' : `正在后台下载更新... ${percent}%`
    case 'downloaded':
      return input.version ? `新版本 ${input.version} 已下载完成。` : '新版本已下载完成。'
    case 'error':
      return '更新失败，请稍后重试或前往官网手动下载。'
  }
}

export function normalizeUpdateStatus(input: UpdateStatusInput): UpdateStatus {
  const phase: UpdatePhase = input.phase === 'disabled' ? 'idle' : input.phase
  const percent = phase === 'downloading' ? normalizePercent(input.percent) : null

  return {
    phase,
    version: input.version ?? null,
    percent,
    message: buildMessage({ ...input, phase }, percent),
    forceUpdate: Boolean(input.forceUpdate),
    forceUpdateMessage: input.forceUpdateMessage?.trim() || null,
  }
}

export function shouldShowUpdateBanner(status: UpdateStatus): boolean {
  return status.phase !== 'idle'
}
