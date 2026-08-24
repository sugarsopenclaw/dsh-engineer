import { BrowserWindow, screen, type Rectangle } from 'electron'
import { IPC_ON } from '../../src/shared/ipc-contract'
import {
  DEFAULT_WINDOW_STATE,
  WINDOW_MODE_LAYOUT_TRANSITION_MS,
  WINDOW_MODE_SETTLE_GRACE_MS,
  type WindowMode,
  type WindowState,
} from '../../src/shared/window-state'
import { appConfig } from './app-config'
import { getAppIcon } from './app-icon'

const MAIN_WINDOW_RIGHT_MARGIN = 20
const INITIAL_SHOW_FALLBACK_DELAY_MS = 1_200

type WideWindowSnapshot = {
  bounds: Rectangle
  maximized: boolean
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private currentWindowMode: WindowMode = appConfig.window.defaultMode
  private wideWindowSnapshot: WideWindowSnapshot | null = null
  private compactBoundsTimer: NodeJS.Timeout | null = null
  private wideMinimumTimer: NodeJS.Timeout | null = null
  private wideMinimumListener: (() => void) | null = null

  private resolveInitialBounds(): Rectangle {
    return this.resolveBoundsInWorkArea(
      this.currentWindowMode,
      screen.getPrimaryDisplay().workArea,
    )
  }

  /** 最小尺寸不能超出工作区，否则 Electron 会把窗口撑到屏幕外。 */
  private resolveMinimumSize(mode: WindowMode, workArea: Rectangle) {
    const configured = appConfig.window.minimumSizes[mode]
    return {
      width: Math.min(configured.width, workArea.width),
      height: Math.min(configured.height, workArea.height),
    }
  }

  private resolveWideMinimumSize(win: BrowserWindow) {
    return this.resolveMinimumSize('wide', screen.getDisplayMatching(win.getBounds()).workArea)
  }

  private resolveBoundsInWorkArea(mode: WindowMode, workArea: Rectangle): Rectangle {
    const configured = appConfig.window.sizes[mode]
    const width = Math.min(configured.width, workArea.width)
    const height = Math.min(configured.height, workArea.height)
    const x = mode === 'compact'
      ? Math.max(workArea.x, workArea.x + workArea.width - width - MAIN_WINDOW_RIGHT_MARGIN)
      : workArea.x + Math.round((workArea.width - width) / 2)
    const y = workArea.y + Math.round((workArea.height - height) / 2)
    return { x, y, width, height }
  }

  createMainWindow() {
    const bounds = this.resolveInitialBounds()
    const appIcon = getAppIcon()
    const minimumSize = this.resolveMinimumSize(
      this.currentWindowMode,
      screen.getPrimaryDisplay().workArea,
    )

    this.mainWindow = new BrowserWindow({
      show: false,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: minimumSize.width,
      minHeight: minimumSize.height,
      resizable: this.currentWindowMode === 'wide',
      maximizable: this.currentWindowMode === 'wide',
      frame: appConfig.window.frame,
      autoHideMenuBar: true,
      backgroundColor: appConfig.window.backgroundColor,
      icon: appIcon,
      title: appConfig.productTitle,
      alwaysOnTop: DEFAULT_WINDOW_STATE.alwaysOnTop,
      webPreferences: appConfig.window.webPreferences,
    })

    if (process.platform === 'win32') {
      this.mainWindow.setIcon(appIcon)
      this.mainWindow.setAppDetails({
        appId: appConfig.appUserModelId,
        appIconPath: appConfig.icons.windowsPath,
        appIconIndex: 0,
      })
    }

    this.mainWindow.setPosition(bounds.x, bounds.y)
    this.setupWindowStateEvents(this.mainWindow)
    this.setupGracefulStart()

    if (appConfig.isDev) {
      void this.mainWindow.loadURL(appConfig.devServerUrl)
    } else {
      void this.mainWindow.loadFile(appConfig.prodPath)
      this.disableRefreshShortcuts()
    }
    return this.mainWindow
  }

  private setupWindowStateEvents(win: BrowserWindow) {
    win.on('maximize', () => this.emitWindowState())
    win.on('unmaximize', () => this.emitWindowState())
    win.on('closed', () => {
      if (this.mainWindow === win) {
        this.clearCompactBoundsTimer()
        this.clearWideMinimumWatch()
        this.mainWindow = null
      }
    })
  }

  private disableRefreshShortcuts() {
    this.mainWindow?.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5') {
        event.preventDefault()
        return
      }
      if (input.control && input.key === 'r') {
        event.preventDefault()
        return
      }
      if (input.control && input.shift && input.key === 'R') {
        event.preventDefault()
      }
    })
  }

  private setupGracefulStart() {
    if (!this.mainWindow) return

    const win = this.mainWindow
    let shown = false
    let fallbackTimer: NodeJS.Timeout | null = null
    const clearFallbackTimer = () => {
      if (!fallbackTimer) return
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    const showInitialWindow = () => {
      if (shown || win.isDestroyed()) return
      shown = true
      clearFallbackTimer()
      win.show()
      this.preventDefaultFileDrag()
      this.emitWindowState()
    }

    win.setBackgroundColor(appConfig.window.backgroundColor)
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[WindowManager] 页面加载失败:', errorCode, errorDescription)
    })

    win.once('ready-to-show', showInitialWindow)
    win.webContents.once('did-finish-load', () => {
      fallbackTimer = setTimeout(showInitialWindow, INITIAL_SHOW_FALLBACK_DELAY_MS)
    })
    win.once('closed', clearFallbackTimer)
  }

  private preventDefaultFileDrag() {
    if (!this.mainWindow?.webContents) return

    this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      const currentUrl = this.mainWindow?.webContents.getURL()
      if (navigationUrl !== currentUrl) {
        event.preventDefault()
      }
    })

    this.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  showWindow() {
    if (this.mainWindow?.isMinimized()) {
      this.mainWindow.restore()
    }
    this.mainWindow?.show()
    this.mainWindow?.focus()
    this.emitWindowState()
  }

  hideWindow() {
    this.mainWindow?.hide()
    this.emitWindowState()
  }

  minimizeWindow() {
    this.mainWindow?.minimize()
  }

  setWindowPin(shouldPin: boolean) {
    if (!this.mainWindow) return
    if (shouldPin) {
      this.mainWindow.setAlwaysOnTop(true, 'screen-saver')
    } else {
      this.mainWindow.setAlwaysOnTop(false)
    }
    this.emitWindowState()
  }

  isWindowAlwaysOnTop() {
    return this.mainWindow?.isAlwaysOnTop() ?? false
  }

  isWindowVisible() {
    return this.mainWindow?.isVisible() ?? false
  }

  getMainWindow() {
    return this.mainWindow
  }

  getWindowState(): WindowState {
    return {
      mode: this.currentWindowMode,
      maximized: this.mainWindow?.isMaximized() ?? false,
      alwaysOnTop: this.mainWindow?.isAlwaysOnTop() ?? DEFAULT_WINDOW_STATE.alwaysOnTop,
    }
  }

  setWindowMode(mode: WindowMode): WindowState {
    const win = this.mainWindow
    if (!win || win.isDestroyed()) {
      this.currentWindowMode = mode
      return this.getWindowState()
    }
    if (mode === this.currentWindowMode) {
      return this.getWindowState()
    }

    if (mode === 'compact') {
      this.enterCompactMode(win)
    } else {
      this.enterWideMode(win)
    }
    this.emitWindowState()
    return this.getWindowState()
  }

  toggleWindowSize(): WindowState {
    return this.setWindowMode(this.currentWindowMode === 'compact' ? 'wide' : 'compact')
  }

  toggleMaximize(): WindowState {
    const win = this.mainWindow
    if (!win || win.isDestroyed() || this.currentWindowMode === 'compact') {
      return this.getWindowState()
    }

    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    this.emitWindowState()
    return this.getWindowState()
  }

  private clearCompactBoundsTimer() {
    if (!this.compactBoundsTimer) return
    clearTimeout(this.compactBoundsTimer)
    this.compactBoundsTimer = null
  }

  private clearWideMinimumWatch() {
    if (this.wideMinimumTimer) {
      clearTimeout(this.wideMinimumTimer)
      this.wideMinimumTimer = null
    }
    if (this.wideMinimumListener && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.removeListener('resized', this.wideMinimumListener)
    }
    this.wideMinimumListener = null
  }

  /**
   * 只在窗口正在长大的动画期间容许「先别设 min」；
   * force 表示宽限期已过，必须把宽窗下限抬起来，否则窗口会一直停在小窗下限。
   */
  private applyWideMinimumSize(win: BrowserWindow, options: { force?: boolean } = {}) {
    if (this.currentWindowMode !== 'wide' || win.isDestroyed()) return false
    const minimumSize = this.resolveWideMinimumSize(win)
    const bounds = win.getBounds()
    const alreadyGrown = bounds.width >= minimumSize.width && bounds.height >= minimumSize.height
    if (!options.force && !alreadyGrown) return false
    win.setMinimumSize(minimumSize.width, minimumSize.height)
    this.clearWideMinimumWatch()
    return true
  }

  private watchWideMinimumSize(win: BrowserWindow) {
    this.clearWideMinimumWatch()
    if (this.applyWideMinimumSize(win)) return
    const onResized = () => {
      this.applyWideMinimumSize(win)
    }
    this.wideMinimumListener = onResized
    win.on('resized', onResized)
    this.wideMinimumTimer = setTimeout(() => {
      this.wideMinimumTimer = null
      this.applyWideMinimumSize(win, { force: true })
    }, WINDOW_MODE_LAYOUT_TRANSITION_MS + WINDOW_MODE_SETTLE_GRACE_MS)
  }

  private enterCompactMode(win: BrowserWindow) {
    this.clearCompactBoundsTimer()
    this.clearWideMinimumWatch()
    const maximized = win.isMaximized()
    const previousBounds = maximized ? win.getNormalBounds() : win.getBounds()
    const wideMinimum = this.resolveWideMinimumSize(win)
    const settledWideBounds = previousBounds.width >= wideMinimum.width
      && previousBounds.height >= wideMinimum.height
    // 动画中或仍是小窗尺寸的测量不可信，宁可沿用上一次合格的宽窗快照。
    if (maximized || settledWideBounds || !this.wideWindowSnapshot) {
      this.wideWindowSnapshot = { bounds: previousBounds, maximized }
    }

    this.currentWindowMode = 'compact'
    const display = screen.getDisplayMatching(previousBounds)
    const workArea = display.workArea
    const minimumSize = this.resolveMinimumSize('compact', workArea)
    win.setMinimumSize(minimumSize.width, minimumSize.height)
    win.setMaximizable(false)
    win.setResizable(true)

    const compactBounds = this.resolveBoundsInWorkArea('compact', workArea)
    const rightEdge = previousBounds.x + previousBounds.width
    compactBounds.x = clamp(
      rightEdge - compactBounds.width,
      workArea.x,
      workArea.x + workArea.width - compactBounds.width,
    )
    compactBounds.y = clamp(
      previousBounds.y,
      workArea.y,
      workArea.y + workArea.height - compactBounds.height,
    )

    this.compactBoundsTimer = setTimeout(() => {
      this.compactBoundsTimer = null
      if (!this.mainWindow || this.mainWindow.isDestroyed() || this.currentWindowMode !== 'compact') {
        return
      }
      if (win.isMaximized()) {
        win.unmaximize()
      }
      win.setBounds(compactBounds, true)
      win.setResizable(false)
    }, WINDOW_MODE_LAYOUT_TRANSITION_MS)
  }

  private enterWideMode(win: BrowserWindow) {
    this.clearCompactBoundsTimer()
    this.clearWideMinimumWatch()
    this.currentWindowMode = 'wide'
    win.setResizable(true)
    win.setMaximizable(true)

    const snapshot = this.wideWindowSnapshot
    const targetBounds = snapshot?.bounds ?? this.resolveBoundsInWorkArea(
      'wide',
      screen.getDisplayMatching(win.getBounds()).workArea,
    )
    win.setBounds(targetBounds, true)
    if (snapshot?.maximized) {
      win.maximize()
      const minimumSize = this.resolveWideMinimumSize(win)
      win.setMinimumSize(minimumSize.width, minimumSize.height)
    } else {
      this.watchWideMinimumSize(win)
    }
  }

  private emitWindowState() {
    const win = this.mainWindow
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(IPC_ON.WINDOW_STATE_CHANGED, this.getWindowState())
  }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
