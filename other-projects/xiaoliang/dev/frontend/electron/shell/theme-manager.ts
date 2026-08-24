import { nativeTheme } from 'electron'
import type { ThemeMode } from '../../src/types/render'
import { IPC_ON } from '../../src/shared/ipc-contract'
import type { WindowManager } from './window-manager'

export class ThemeManager {
  constructor(private readonly windowManager: WindowManager) {
    this.setupThemeListeners()
  }

  getSystemTheme(): Exclude<ThemeMode, 'system'> {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  setTheme(theme: ThemeMode): Exclude<ThemeMode, 'system'> {
    nativeTheme.themeSource = theme
    return this.getSystemTheme()
  }

  private setupThemeListeners() {
    nativeTheme.on('updated', () => {
      const mainWindow = this.windowManager.getMainWindow()
      if (!mainWindow) return
      mainWindow.webContents.send(IPC_ON.THEME_CHANGED, this.getSystemTheme())
    })
  }
}
