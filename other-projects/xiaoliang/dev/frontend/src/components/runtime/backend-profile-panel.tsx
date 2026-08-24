import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { logoutFromBackend } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import { useAuthStore } from '@/stores/auth-store'
import type { AuthSessionData } from '@/shared/backend-api'

function userInitials(session: AuthSessionData): string {
  const name = session.user.display_name?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase().slice(0, 2)
    }
    return name.slice(0, 2).toUpperCase()
  }
  const local = session.user.email.split('@')[0] || '?'
  return local.slice(0, 2).toUpperCase()
}

export function BackendProfilePanel() {
  const session = useAuthStore((state) => state.session)
  const clearSession = useAuthStore((state) => state.clearSession)

  const [loggingOut, setLoggingOut] = useState(false)

  if (!session) {
    return null
  }

  const activeSession = session
  const initials = userInitials(activeSession)

  async function handleLogout() {
    const refreshToken = activeSession.refresh_token
    setLoggingOut(true)
    try {
      if (isElectronApp()) {
        await electronBridge.logoutBackend()
      } else if (refreshToken) {
        await logoutFromBackend(refreshToken)
      }
    } catch {
      // 即便远端注销失败，也要清空本地会话。
    } finally {
      clearSession()
      setLoggingOut(false)
    }
  }

  return (
    <section className="min-w-0 overflow-x-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px] font-semibold text-white"
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-500">欢迎</p>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{activeSession.user.email}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 text-slate-500"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          <LogOut className="mr-1 h-3.5 w-3.5" />
          {loggingOut ? '退出…' : '退出'}
        </Button>
      </div>
    </section>
  )
}
