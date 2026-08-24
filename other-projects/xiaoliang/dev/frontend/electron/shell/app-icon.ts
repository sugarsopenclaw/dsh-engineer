import { nativeImage, type NativeImage } from 'electron'
import { appConfig } from './app-config'

let cachedIcon: NativeImage | null = null

/** 所有 Electron 原生入口共用同一枚晓量图标，避免窗口、任务栏和托盘各自回退。 */
export function getAppIcon(): NativeImage {
  if (cachedIcon && !cachedIcon.isEmpty()) {
    return cachedIcon
  }

  for (const iconPath of appConfig.icons.paths) {
    try {
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        cachedIcon = icon
        return icon
      }
    } catch (error) {
      console.warn('[AppIcon] 加载图标失败:', iconPath, error)
    }
  }

  const fallbackIcon = nativeImage.createFromDataURL(appConfig.icons.fallbackDataUrl)
  if (fallbackIcon.isEmpty()) {
    throw new Error(`晓量图标不可用: ${appConfig.icons.paths.join(', ')}`)
  }

  console.warn('[AppIcon] 图标文件不可用，使用内置晓量图标')
  cachedIcon = fallbackIcon
  return fallbackIcon
}
