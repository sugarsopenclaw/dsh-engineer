import { Menu, Notification, Tray, app } from 'electron'
import { appConfig } from './app-config'
import { getAppIcon } from './app-icon'
import type { WindowManager } from './window-manager'

export class TrayManager {
  private tray: Tray | null = null

  constructor(private readonly windowManager: WindowManager) {}

  createTray() {
    this.tray = new Tray(getAppIcon())
    this.tray.setToolTip(appConfig.tray.tooltip)
    this.createTrayMenu()
    this.setupTrayEvents()
    return this.tray
  }

  private createTrayMenu() {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => this.windowManager.showWindow(),
      },
      {
        label: '关闭窗口',
        click: () => this.windowManager.hideWindow(),
      },
      { type: 'separator' },
      {
        label: '退出应用',
        click: () => {
          ;(app as typeof app & { isQuiting?: boolean }).isQuiting = true
          app.quit()
        },
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  private setupTrayEvents() {
    this.tray?.on('click', () => {
      if (this.windowManager.isWindowVisible()) {
        this.windowManager.hideWindow()
        return
      }
      this.windowManager.showWindow()
    })
  }

  showTrayNotification(title: string, body: string): boolean {
    if (process.platform !== 'win32' || !this.tray || !Notification.isSupported()) {
      return false
    }

    const notification = new Notification({
      title: title || app.getName(),
      body,
      icon: getAppIcon(),
      silent: false,
    })

    notification.show()
    notification.on('click', () => {
      this.windowManager.showWindow()
    })
    return true
  }

  destroyTray() {
    this.tray?.destroy()
    this.tray = null
  }
}
