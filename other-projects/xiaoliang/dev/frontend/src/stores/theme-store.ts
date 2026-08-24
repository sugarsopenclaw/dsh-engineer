import { create } from 'zustand'
import type { ThemeMode } from '@/types/render'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'

type ThemeState = {
  systemTheme: ThemeMode | null
  setSystemTheme: (t: ThemeMode) => void
  syncFromElectron: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set) => ({
  systemTheme: null,

  setSystemTheme: (t) => set({ systemTheme: t }),

  syncFromElectron: async () => {
    if (!isElectronApp()) return
    try {
      const t = await electronBridge.getSystemTheme()
      set({ systemTheme: t })
    } catch {
      // 浏览器预览无 electron
    }
  },
}))
