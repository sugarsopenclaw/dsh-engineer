import { app, BrowserWindow } from 'electron'
import { WindowManager } from './shell/window-manager'
import { TrayManager } from './shell/tray-manager'
import { ThemeManager } from './shell/theme-manager'
import { ScreenshotManager } from './shell/screenshot-manager'
import { initAutoUpdater, type AppUpdateManager } from './shell/auto-update-manager'
import { appConfig } from './shell/app-config'
import { IPCHandlers } from './runtime/ipc/ipc-handlers'
import { syncPowerSaveBlocker } from './runtime/power/power-save-manager'
import { getPowerSettings } from './runtime/settings/power-settings-repository'

app.setName('晓量')

if (process.platform === 'win32') {
  app.setAppUserModelId(appConfig.appUserModelId)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

let windowManager: WindowManager | null = null
let trayManager: TrayManager | null = null
let themeManager: ThemeManager | null = null
let screenshotManager: ScreenshotManager | null = null
let ipcHandlers: IPCHandlers | null = null
let appUpdateManager: AppUpdateManager | null = null
let quitPreparationPromise: Promise<void> | null = null
let quitPreparationComplete = false

function createApp() {
  windowManager = new WindowManager()
  trayManager = new TrayManager(windowManager)
  themeManager = new ThemeManager(windowManager)
  screenshotManager = new ScreenshotManager()
  appUpdateManager = initAutoUpdater(() => windowManager?.getMainWindow() ?? null)
  ipcHandlers = new IPCHandlers(
    windowManager,
    trayManager,
    themeManager,
    screenshotManager,
    appUpdateManager,
  )

  windowManager.createMainWindow()
  trayManager.createTray()
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      windowManager?.showWindow()
      return
    }

    void app.whenReady().then(() => {
      windowManager?.showWindow()
    })
  })

  app.whenReady().then(() => {
    createApp()
    try {
      syncPowerSaveBlocker(getPowerSettings().preventSleep)
    } catch (error) {
      console.warn(
        '[app] failed to restore the prevent-sleep setting',
        error instanceof Error ? error.message : String(error),
      )
    }
  })

  if (process.platform === 'darwin') {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createApp()
        return
      }
      windowManager?.showWindow()
    })
  }

  app.on('window-all-closed', () => {
    console.log('所有窗口已关闭，应用保持在托盘运行')
  })

  app.on('before-quit', (event) => {
    ;(app as typeof app & { isQuiting?: boolean }).isQuiting = true
    appUpdateManager?.dispose()
    if (quitPreparationComplete) return

    event.preventDefault()
    if (quitPreparationPromise) return
    quitPreparationPromise = (async () => {
      try {
        await ipcHandlers?.prepareToQuit()
      } catch (error) {
        console.warn(
          '[app] graceful agent shutdown failed',
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        quitPreparationComplete = true
        app.quit()
      }
    })()
  })

  app.on('will-quit', () => {
    ipcHandlers?.dispose()
    trayManager?.destroyTray()
  })
}
