import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'

import {
  MLIGHT_CAD_RUNTIME_CHANNELS,
  type MLightCadRuntimeRequest,
  type MLightCadRuntimeResult,
} from '../../../../src/shared/mlight-cad-runtime'

export const DEFAULT_RUNTIME_TIMEOUT_MS = 10 * 60 * 1_000
const READY_TIMEOUT_MS = 30_000
const MAX_RAW_JSONL_BYTES = 512 * 1024 * 1024
const MAX_READABLE_BYTES = 128 * 1024 * 1024
const MAX_BASE64_BYTES = 96 * 1024 * 1024
export const MAX_DRAFT_ENTITIES = 5_000
export const MAX_DRAFT_LAYERS = 64

export interface MLightCadRuntimeWindowOptions {
  devServerUrl?: string
  preloadPath: string
  rendererHtmlPath: string
  cadDataBaseUrl: string
  timeoutMs?: number
}

interface PendingRequest {
  resolve: (result: MLightCadRuntimeResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  abortListener?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('MLightCAD operation was cancelled.')
}

function isBoundedWarnings(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= 500
    && value.every((warning) => typeof warning === 'string' && warning.length <= 2_000)
}

function isBoundedBase64(value: unknown, limit = MAX_BASE64_BYTES): value is string {
  return typeof value === 'string' && value.length <= limit
}

function isBoundedHandles(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= MAX_DRAFT_ENTITIES
    && value.every((handle) => typeof handle === 'string' && handle.length <= 128)
}

function isBoundedLayerNames(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= MAX_DRAFT_LAYERS
    && value.every((name) => typeof name === 'string' && name.length <= 255)
}

function isWindow(value: unknown): boolean {
  if (!isRecord(value)) return false
  const pair = (candidate: unknown): boolean => Array.isArray(candidate)
    && candidate.length === 2
    && candidate.every((component) => typeof component === 'number' && Number.isFinite(component))
  return pair(value.min) && pair(value.max)
}

function isRuntimeResult(value: unknown): value is MLightCadRuntimeResult {
  if (!isRecord(value) || !isBoundedWarnings(value.warnings)) return false
  switch (value.kind) {
    case 'extract':
      return typeof value.rawJsonl === 'string'
        && typeof value.readableMarkdown === 'string'
        && isRecord(value.summary)
        && Buffer.byteLength(value.rawJsonl, 'utf8') <= MAX_RAW_JSONL_BYTES
        && Buffer.byteLength(value.readableMarkdown, 'utf8') <= MAX_READABLE_BYTES
    case 'render':
      return isBoundedBase64(value.pngBase64)
        && Number.isFinite(value.width)
        && Number.isFinite(value.height)
    case 'entity_preview':
      return Array.isArray(value.images)
        && value.images.length <= 200
        && value.images.every((image) => isRecord(image)
          && typeof image.id === 'string'
          && isBoundedBase64(image.pngBase64))
        && Array.isArray(value.missingGroupIds)
    case 'layers':
      return Array.isArray(value.layers)
        && value.layers.length <= 20_000
        && value.layers.every((layer) => isRecord(layer) && typeof layer.name === 'string')
    case 'document_info':
      return typeof value.fileName === 'string'
        && Number.isFinite(value.entityCount)
        && Number.isFinite(value.layerCount)
        && Array.isArray(value.fontsNotFound)
        && (value.contentExtents === null || isWindow(value.contentExtents))
    case 'export_dxf':
      return isBoundedBase64(value.dxfBase64) && Number.isFinite(value.byteLength)
    case 'mutate':
      return isBoundedHandles(value.createdHandles)
        && isBoundedLayerNames(value.createdLayers)
        && isBoundedLayerNames(value.reusedLayers)
    default:
      return false
  }
}

/**
 * A single hidden renderer that owns one parsed drawing. The window outlives an
 * individual request so a caller can open once and then extract, render and export
 * against the same database; requests inside one window still run serially because
 * they share its JavaScript thread.
 */
export class MLightCadRuntimeWindow {
  private readonly pending = new Map<string, PendingRequest>()
  private queue: Promise<void> = Promise.resolve()
  private runtimeWindow: BrowserWindow | undefined
  private readyPromise: Promise<void> | undefined
  private resolveReady: (() => void) | undefined
  private rejectReady: ((error: Error) => void) | undefined
  private closed = false

  constructor(private readonly options: MLightCadRuntimeWindowOptions) {
    ipcMain.on(MLIGHT_CAD_RUNTIME_CHANNELS.ready, this.onReady)
    ipcMain.on(MLIGHT_CAD_RUNTIME_CHANNELS.response, this.onResponse)
  }

  get isAlive(): boolean {
    return !this.closed && Boolean(this.runtimeWindow) && !this.runtimeWindow?.isDestroyed()
  }

  send(
    request: Omit<MLightCadRuntimeRequest, 'id'>,
    signal?: AbortSignal,
  ): Promise<MLightCadRuntimeResult> {
    if (this.closed) return Promise.reject(new Error('MLightCAD runtime window is closed.'))
    const operation = this.queue.then(async () => {
      if (this.closed) throw new Error('MLightCAD runtime window is closed.')
      if (signal?.aborted) throw abortError(signal)
      return this.run(request, signal)
    })
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  /**
   * Working-set size of the renderer holding the parsed drawing, in kilobytes.
   *
   * The window budget is a memory budget: how many parsed drawings fit on the machine is
   * the only thing that decides how many CAD children can run at once. Reporting the real
   * figure per drawing is what makes raising that budget a measurement rather than a
   * guess. Null when the process has gone or the platform declines to answer.
   */
  async sampleMemoryKb(): Promise<number | null> {
    const runtimeWindow = this.runtimeWindow
    if (this.closed || !runtimeWindow || runtimeWindow.isDestroyed()) return null
    try {
      const pid = runtimeWindow.webContents.getOSProcessId()
      const metric = app.getAppMetrics().find((candidate) => candidate.pid === pid)
      const kb = metric?.memory.workingSetSize
      return typeof kb === 'number' && Number.isFinite(kb) && kb > 0 ? Math.round(kb) : null
    } catch {
      return null
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    ipcMain.removeListener(MLIGHT_CAD_RUNTIME_CHANNELS.ready, this.onReady)
    ipcMain.removeListener(MLIGHT_CAD_RUNTIME_CHANNELS.response, this.onResponse)
    const error = new Error('MLightCAD runtime window is closed.')
    this.rejectReady?.(error)
    this.resolveReady = undefined
    this.rejectReady = undefined
    this.readyPromise = undefined
    this.rejectAll(error)
    if (this.runtimeWindow && !this.runtimeWindow.isDestroyed()) this.runtimeWindow.destroy()
    this.runtimeWindow = undefined
  }

  private readonly onReady = (event: IpcMainEvent): void => {
    if (!this.runtimeWindow || event.sender !== this.runtimeWindow.webContents) return
    this.resolveReady?.()
    this.resolveReady = undefined
    this.rejectReady = undefined
  }

  private readonly onResponse = (event: IpcMainEvent, rawResponse: unknown): void => {
    if (!this.runtimeWindow || event.sender !== this.runtimeWindow.webContents || !isRecord(rawResponse)) return
    const id = rawResponse.id
    if (typeof id !== 'string') return
    const pending = this.takePending(id)
    if (!pending) return
    if (rawResponse.ok === true && isRuntimeResult(rawResponse.result)) {
      pending.resolve(rawResponse.result)
      return
    }
    pending.reject(new Error(
      typeof rawResponse.error === 'string' && rawResponse.error
        ? rawResponse.error.slice(0, 2_048)
        : 'MLightCAD runtime returned a malformed response.',
    ))
  }

  private async run(
    request: Omit<MLightCadRuntimeRequest, 'id'>,
    signal?: AbortSignal,
  ): Promise<MLightCadRuntimeResult> {
    await this.ensureWindow()
    if (signal?.aborted) throw abortError(signal)
    const runtimeWindow = this.runtimeWindow
    if (!runtimeWindow || runtimeWindow.isDestroyed()) throw new Error('MLightCAD runtime is unavailable.')
    const id = randomUUID()
    const payload: MLightCadRuntimeRequest = { id, ...request }
    return new Promise<MLightCadRuntimeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timedOut = this.takePending(id)
        if (!timedOut) return
        timedOut.reject(new Error('MLightCAD operation timed out.'))
        // The renderer is wedged inside the operation, so the parsed document is lost with it.
        if (!runtimeWindow.isDestroyed()) runtimeWindow.destroy()
      }, this.options.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS)
      const abortListener = signal
        ? () => {
            const aborted = this.takePending(id)
            if (!aborted) return
            aborted.reject(abortError(signal))
            if (!runtimeWindow.isDestroyed()) runtimeWindow.destroy()
          }
        : undefined
      this.pending.set(id, { resolve, reject, timer, signal, abortListener })
      if (signal && abortListener) {
        signal.addEventListener('abort', abortListener, { once: true })
        if (signal.aborted) {
          abortListener()
          return
        }
      }
      try {
        runtimeWindow.webContents.send(MLIGHT_CAD_RUNTIME_CHANNELS.request, payload)
      } catch (error) {
        const failed = this.takePending(id)
        failed?.reject(error instanceof Error ? error : new Error('MLightCAD request could not be sent.'))
      }
    })
  }

  private async ensureWindow(): Promise<void> {
    if (this.runtimeWindow && !this.runtimeWindow.isDestroyed() && this.readyPromise) {
      await this.readyPromise
      return
    }
    const runtimeWindow = new BrowserWindow({
      width: 16,
      height: 16,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        offscreen: false,
        partition: `mlight-cad-runtime-${randomUUID()}`,
        devTools: Boolean(this.options.devServerUrl),
      },
    })
    this.runtimeWindow = runtimeWindow
    runtimeWindow.webContents.session.setPermissionCheckHandler(() => false)
    runtimeWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    const readyPromise = this.readyPromise
    const readyTimer = setTimeout(() => {
      this.rejectReady?.(new Error('MLightCAD runtime did not become ready.'))
    }, READY_TIMEOUT_MS)
    runtimeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    runtimeWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
    runtimeWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    runtimeWindow.webContents.once('did-fail-load', () => {
      this.rejectReady?.(new Error('MLightCAD runtime failed to load.'))
    })
    runtimeWindow.once('closed', () => {
      const error = new Error('MLightCAD runtime window closed.')
      if (this.runtimeWindow === runtimeWindow) {
        this.rejectReady?.(error)
        this.resolveReady = undefined
        this.rejectReady = undefined
        this.runtimeWindow = undefined
        this.readyPromise = undefined
        this.rejectAll(error)
      }
    })
    const query = { cadDataBaseUrl: this.options.cadDataBaseUrl }
    try {
      const loadPromise = this.options.devServerUrl
        ? runtimeWindow.loadURL(this.devServerRuntimeUrl(query))
        : runtimeWindow.loadFile(this.options.rendererHtmlPath, { query })
      await Promise.all([loadPromise, readyPromise])
    } catch (error) {
      if (this.runtimeWindow === runtimeWindow) {
        this.runtimeWindow = undefined
        this.readyPromise = undefined
        this.resolveReady = undefined
        this.rejectReady = undefined
      }
      if (!runtimeWindow.isDestroyed()) runtimeWindow.destroy()
      throw error
    } finally {
      clearTimeout(readyTimer)
    }
  }

  private devServerRuntimeUrl(query: Record<string, string>): string {
    const devServerUrl = this.options.devServerUrl ?? ''
    const base = devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`
    const url = new URL(path.posix.basename(this.options.rendererHtmlPath), base)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return url.href
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      const pending = this.takePending(id)
      pending?.reject(error)
    }
  }

  private takePending(id: string): PendingRequest | undefined {
    const pending = this.pending.get(id)
    if (!pending) return undefined
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener)
    }
    return pending
  }
}
