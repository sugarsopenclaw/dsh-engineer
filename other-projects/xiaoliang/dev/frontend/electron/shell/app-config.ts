import fs from 'node:fs'
import path from 'node:path'
import { COMPACT_WINDOW_WIDTH } from '../../src/shared/window-state'

const APP_ROOT = path.resolve(__dirname, '..')

let appVersion = '0.0.0'
try {
  appVersion = JSON.parse(
    fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf-8'),
  ).version as string
} catch {
  /* keep default */
}

function getResourcePath(relativePath: string) {
  if (process.resourcesPath) {
    const externalResourcePath = path.join(process.resourcesPath, relativePath)
    if (fs.existsSync(externalResourcePath)) {
      return externalResourcePath
    }
  }

  return path.join(APP_ROOT, relativePath)
}

const COMPACT_WIDTH = COMPACT_WINDOW_WIDTH
const COMPACT_HEIGHT = 860
const WINDOWS_ICON_PATH = getResourcePath('public/xiaoliang.ico')
const PNG_ICON_PATH = getResourcePath('public/xiaoliang.png')
const IS_DEV = process.env.NODE_ENV === 'development'

export const appConfig = {
  appId: 'com.xiaoliang.desktop',
  // Windows 任务栏按 AUMID 匹配开始菜单快捷方式取图标；开发态若与正式版共用
  // AUMID，指向 electron.exe 的旧快捷方式会让正式版显示 Electron 默认图标。
  appUserModelId: IS_DEV ? 'com.xiaoliang.desktop.dev' : 'com.xiaoliang.desktop',
  isDev: IS_DEV,
  appVersion,
  productTitle: `晓量 v${appVersion}`,
  icons: {
    windowsPath: WINDOWS_ICON_PATH,
    paths: [WINDOWS_ICON_PATH, PNG_ICON_PATH],
    fallbackDataUrl:
      'data:image/png;base64,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',
  },
  window: {
    sizes: {
      compact: { width: COMPACT_WIDTH, height: COMPACT_HEIGHT },
      wide: { width: 1440, height: 900 },
    },
    minimumSizes: {
      compact: { width: 380, height: 620 },
      wide: { width: 1040, height: 680 },
    },
    defaultMode: 'wide' as const,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      devTools: process.env.NODE_ENV === 'development',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  },
  tray: {
    tooltip: `晓量 v${appVersion}`,
  },
  devServerUrl: 'http://localhost:5173',
  prodPath: path.join(APP_ROOT, 'dist/index.html'),
}
