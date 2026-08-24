export type WindowMode = 'compact' | 'wide'

export const WINDOW_MODE_LAYOUT_TRANSITION_MS = 180
/** 动画结束后留给窗口尺寸稳定的宽限时间，超时即按实际尺寸兜底。 */
export const WINDOW_MODE_SETTLE_GRACE_MS = 200
export const WIDE_LAYOUT_MIN_WIDTH = 1040
/** 小窗口内容区宽度。宽屏中间栏可以缩到这个宽度。 */
export const COMPACT_WINDOW_WIDTH = 420

export interface WindowState {
  mode: WindowMode
  maximized: boolean
  alwaysOnTop: boolean
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  mode: 'wide',
  maximized: false,
  alwaysOnTop: false,
}

export function isWindowMode(value: unknown): value is WindowMode {
  return value === 'compact' || value === 'wide'
}
