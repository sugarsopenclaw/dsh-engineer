// 渲染进程业务类型

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
}
