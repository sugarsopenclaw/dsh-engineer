import { useEffect } from 'react'
import { useThemeStore } from '@/stores/theme-store'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'

export function useThemeSync() {
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const syncFromElectron = useThemeStore((s) => s.syncFromElectron)

  useEffect(() => {
    void syncFromElectron()
  }, [syncFromElectron])

  useEffect(() => {
    if (!isElectronApp()) return
    const unsub = electronBridge.onThemeChanged((theme) => {
      setSystemTheme(theme)
    })
    return () => {
      unsub?.()
    }
  }, [setSystemTheme])
}
