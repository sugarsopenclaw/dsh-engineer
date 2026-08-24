import { useCallback, useEffect, useState } from 'react'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import {
  DEFAULT_WINDOW_STATE,
  WIDE_LAYOUT_MIN_WIDTH,
  type WindowMode,
  type WindowState,
} from '@/shared/window-state'

type WindowControlState = {
  isElectron: boolean
  isAlwaysOnTop: boolean
  windowState: WindowState
  refreshWindowState: () => Promise<void>
  refreshAlwaysOnTop: () => Promise<void>
  toggleAlwaysOnTop: () => Promise<void>
  setWindowMode: (mode: WindowMode) => Promise<void>
  toggleWindowSize: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  minimizeWindow: () => void
  closeWindow: () => void
  quitApp: () => void
}

function getInitialWindowState(): WindowState {
  if (typeof window !== 'undefined' && !isElectronApp()) {
    return {
      ...DEFAULT_WINDOW_STATE,
      mode: window.innerWidth >= WIDE_LAYOUT_MIN_WIDTH ? 'wide' : 'compact',
      alwaysOnTop: false,
    }
  }
  return { ...DEFAULT_WINDOW_STATE }
}

export function useWindowControl(): WindowControlState {
  const [isElectron] = useState(() => isElectronApp())
  const [windowState, setWindowState] = useState<WindowState>(getInitialWindowState)

  const refreshWindowState = useCallback(async () => {
    if (!isElectronApp()) return
    try {
      setWindowState(await electronBridge.getWindowState())
    } catch {
      /* keep the last known state */
    }
  }, [])

  useEffect(() => {
    if (isElectron) {
      const unsubscribe = electronBridge.onWindowStateChanged(setWindowState)
      void refreshWindowState()
      return () => unsubscribe?.()
    }

    const handleResize = () => {
      setWindowState((current) => ({
        ...current,
        mode: window.innerWidth >= WIDE_LAYOUT_MIN_WIDTH ? 'wide' : 'compact',
        maximized: false,
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isElectron, refreshWindowState])

  const toggleAlwaysOnTop = useCallback(async () => {
    const next = !windowState.alwaysOnTop
    if (isElectronApp()) {
      electronBridge.setWindowPinned(next)
    }
    setWindowState((current) => ({ ...current, alwaysOnTop: next }))
  }, [windowState.alwaysOnTop])

  const setWindowMode = useCallback(async (mode: WindowMode) => {
    if (isElectronApp()) {
      setWindowState(await electronBridge.setWindowMode(mode))
      return
    }
    setWindowState((current) => ({ ...current, mode, maximized: false }))
  }, [])

  const toggleWindowSize = useCallback(async () => {
    await setWindowMode(windowState.mode === 'compact' ? 'wide' : 'compact')
  }, [setWindowMode, windowState.mode])

  const toggleMaximizeWindow = useCallback(async () => {
    if (windowState.mode === 'compact') return
    if (isElectronApp()) {
      setWindowState(await electronBridge.toggleMaximizeWindow())
      return
    }
    setWindowState((current) => ({ ...current, maximized: !current.maximized }))
  }, [windowState.mode])

  const minimizeWindow = useCallback(() => {
    electronBridge.minimizeWindow()
  }, [])

  const closeWindow = useCallback(() => {
    electronBridge.closeWindow()
  }, [])

  const quitApp = useCallback(() => {
    electronBridge.quitApp()
  }, [])

  return {
    isElectron,
    isAlwaysOnTop: windowState.alwaysOnTop,
    windowState,
    refreshWindowState,
    refreshAlwaysOnTop: refreshWindowState,
    toggleAlwaysOnTop,
    setWindowMode,
    toggleWindowSize,
    toggleMaximizeWindow,
    minimizeWindow,
    closeWindow,
    quitApp,
  }
}
