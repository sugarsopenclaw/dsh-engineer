import { app, dialog, net } from 'electron'
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  autoUpdater,
  type NsisUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater'
import { IPC_ON } from '../../src/shared/ipc-contract'
import { getBackendBaseUrl } from '../runtime/backend/http'

export type AppUpdateChannel = 'stable' | 'beta'
export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  channel: AppUpdateChannel
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  downloaded: boolean
  forceUpdate: boolean
  forceUpdateMessage: string | null
  progress: AppUpdateProgress | null
  error: string | null
  feedUrl: string
  isPackaged: boolean
  checkedAt: string | null
}

interface StoredUpdatePreferences {
  channel?: AppUpdateChannel
  clientId?: string
}

interface DesktopUpdatePolicyResponse {
  latest_version: string | null
  update_available: boolean
  force_update: boolean
  force_update_message: string | null
  feed_url: string | null
}

interface AppUpdateManagerOptions {
  getMainWindow: () => BrowserWindow | null
  backendBaseUrl?: string
  userDataPath?: string
  enabled?: boolean
  platform?: NodeJS.Platform
  startupDelayMs?: number
  checkIntervalMs?: number
}

const DEFAULT_STARTUP_DELAY_MS = 10_000
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const STABLE_CHANNEL: AppUpdateChannel = 'stable'
const ENV_UPDATE_DEBUG = 'XIAOLIANG_UPDATE_DEBUG'

function appendAutoUpdateLog(line: string) {
  try {
    const file = path.join(app.getPath('userData'), 'xiaoliang-auto-update.log')
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

function maybeShowUpdateDebugError(title: string, message: string) {
  if (process.env[ENV_UPDATE_DEBUG] !== '1') return
  const logFile = path.join(app.getPath('userData'), 'xiaoliang-auto-update.log')
  dialog.showErrorBox(title, `${message}\n\n日志文件：\n${logFile}`)
}

export class AppUpdateManager extends EventEmitter {
  private readonly preferencesPath: string
  private readonly enabled: boolean
  private readonly backendBaseUrl: string
  private readonly startupDelayMs: number
  private readonly checkIntervalMs: number
  private readonly getMainWindow: () => BrowserWindow | null
  private startupTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private isChecking = false
  private preferences: Required<StoredUpdatePreferences>
  private status: AppUpdateStatus

  constructor(options: AppUpdateManagerOptions) {
    super()
    this.getMainWindow = options.getMainWindow
    this.backendBaseUrl = (options.backendBaseUrl ?? getBackendBaseUrl()).replace(/\/+$/, '')
    this.enabled =
      (options.enabled ?? app.isPackaged) && (options.platform ?? process.platform) === 'win32'
    this.preferencesPath = path.join(
      options.userDataPath ?? app.getPath('userData'),
      'desktop-update.json',
    )
    this.startupDelayMs = options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.preferences = this.readPreferences()
    this.writePreferences(this.preferences)
    this.status = {
      phase: this.enabled ? 'idle' : 'disabled',
      channel: STABLE_CHANNEL,
      currentVersion: app.getVersion(),
      latestVersion: null,
      updateAvailable: false,
      downloaded: false,
      forceUpdate: false,
      forceUpdateMessage: null,
      progress: null,
      error: null,
      feedUrl: this.feedBaseUrl(),
      isPackaged: app.isPackaged,
      checkedAt: null,
    }
    this.configureUpdater()
    this.bindUpdaterEvents()
  }

  start(): void {
    if (!this.enabled || this.startupTimer || this.intervalTimer) return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.checkForUpdates()
    }, this.startupDelayMs)
    this.intervalTimer = setInterval(() => {
      void this.checkForUpdates()
    }, this.checkIntervalMs)
  }

  dispose(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
    autoUpdater.removeAllListeners()
    this.removeAllListeners()
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status, progress: this.status.progress ? { ...this.status.progress } : null }
  }

  async checkForUpdates(): Promise<AppUpdateStatus> {
    if (this.isChecking || this.status.phase === 'downloading') {
      return this.getStatus()
    }
    if (!this.enabled) {
      this.setStatus({ phase: 'disabled', checkedAt: new Date().toISOString() })
      return this.getStatus()
    }

    this.isChecking = true
    this.setStatus({
      phase: 'checking',
      error: null,
      progress: null,
      checkedAt: new Date().toISOString(),
    })
    try {
      const policy = await this.fetchPolicy()
      this.setStatus({
        latestVersion: policy.latest_version,
        updateAvailable: policy.update_available,
        forceUpdate: policy.force_update,
        forceUpdateMessage: policy.force_update_message,
        feedUrl: policy.feed_url || this.feedBaseUrl(),
      })
      if (!policy.update_available) {
        this.setStatus({ phase: 'idle', downloaded: false })
        return this.getStatus()
      }
      await autoUpdater.checkForUpdates()
      return this.getStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendAutoUpdateLog(`checkForUpdates: ${message}`)
      this.setStatus({ phase: 'error', error: message })
      maybeShowUpdateDebugError('晓量 — 检查更新失败', message)
      return this.getStatus()
    } finally {
      this.isChecking = false
    }
  }

  installUpdate(): AppUpdateStatus {
    if (this.status.phase !== 'downloaded') {
      return this.getStatus()
    }
    autoUpdater.quitAndInstall(false, true)
    return this.getStatus()
  }

  private configureUpdater(): void {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true
    const legacyUnsignedRelease = process.env.XIAOLIANG_LEGACY_UNSIGNED_RELEASE === '1'
    if (process.platform === 'win32' && !legacyUnsignedRelease) {
      const windowsUpdater = autoUpdater as NsisUpdater
      const verifyUpdateCodeSignature = windowsUpdater.verifyUpdateCodeSignature
      windowsUpdater.verifyUpdateCodeSignature = async (publisherNames, file) => {
        const trustedPublishers = publisherNames.map((name) => name.trim()).filter(Boolean)
        if (trustedPublishers.length === 0) {
          return '更新配置缺少受信任的 publisherName。'
        }
        return verifyUpdateCodeSignature(trustedPublishers, file)
      }
    }
  }

  private bindUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.setStatus({ phase: 'checking', error: null })
    })
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'available',
        latestVersion: info.version || this.status.latestVersion,
        updateAvailable: true,
        downloaded: false,
        error: null,
      })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'idle',
        latestVersion: info.version || this.status.latestVersion,
        updateAvailable: false,
        downloaded: false,
        progress: null,
        error: null,
      })
    })
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setStatus({
        phase: 'downloading',
        progress: {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setStatus({
        phase: 'downloaded',
        latestVersion: info.version || this.status.latestVersion,
        updateAvailable: true,
        downloaded: true,
        progress: null,
        error: null,
      })
      void this.promptInstall(info.version || this.status.latestVersion)
    })
    autoUpdater.on('error', (error: Error) => {
      appendAutoUpdateLog(`error: ${error.message}`)
      this.setStatus({ phase: 'error', error: error.message })
      maybeShowUpdateDebugError('晓量 — 自动更新出错', error.message)
    })
  }

  private async promptInstall(version: string | null): Promise<void> {
    const dialogOptions = {
      type: 'info' as const,
      title: '晓量 — 更新已就绪',
      message: `新版本 ${version ?? '未知'} 已下载完成。`,
      detail:
        '需要重启应用以完成安装。是否立即重启？\n（选择「稍后」可继续使用；退出应用时也会自动安装）',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const parent = this.getMainWindow()
    const { response } = parent
      ? await dialog.showMessageBox(parent, dialogOptions)
      : await dialog.showMessageBox(dialogOptions)
    if (response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  }

  private async fetchPolicy(): Promise<DesktopUpdatePolicyResponse> {
    const response = await net.fetch(`${this.backendBaseUrl}/desktop-updates/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        channel: STABLE_CHANNEL,
        current_version: app.getVersion(),
        client_id: this.preferences.clientId,
      }),
    })
    if (!response.ok) {
      throw new Error(`Update policy request failed: ${response.status}`)
    }
    return (await response.json()) as DesktopUpdatePolicyResponse
  }

  private feedBaseUrl(): string {
    return `${this.backendBaseUrl}/desktop-updates/windows/x64`
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    const status = this.getStatus()
    this.emit('status-changed', status)
    this.broadcastStatus(status)
  }

  private broadcastStatus(status: AppUpdateStatus): void {
    const payload = {
      phase: status.phase === 'disabled' ? 'idle' : status.phase,
      version: status.latestVersion,
      percent: status.progress?.percent ?? null,
      message: status.error,
      forceUpdate: status.forceUpdate,
      forceUpdateMessage: status.forceUpdateMessage,
    }
    appendAutoUpdateLog(`status: ${JSON.stringify(payload)}`)
    try {
      const win = this.getMainWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC_ON.UPDATE_STATUS, payload)
    } catch {
      /* ignore */
    }
  }

  private readPreferences(): Required<StoredUpdatePreferences> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.preferencesPath, 'utf8')) as StoredUpdatePreferences
      return {
        channel: STABLE_CHANNEL,
        clientId: typeof parsed.clientId === 'string' && parsed.clientId ? parsed.clientId : randomUUID(),
      }
    } catch {
      return { channel: STABLE_CHANNEL, clientId: randomUUID() }
    }
  }

  private writePreferences(preferences: Required<StoredUpdatePreferences>): void {
    fs.mkdirSync(path.dirname(this.preferencesPath), { recursive: true })
    fs.writeFileSync(this.preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
  }
}

export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): AppUpdateManager {
  const manager = new AppUpdateManager({ getMainWindow })
  if (!app.isPackaged) {
    console.log('[AutoUpdate] 开发模式跳过自动更新')
    return manager
  }
  manager.start()
  return manager
}
