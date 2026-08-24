import { useCallback, useEffect, useRef } from 'react'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import { useAuthStore } from '@/stores/auth-store'
import { useBillingStore } from '@/stores/billing-store'

/**
 * Keeps the credit balance current.
 *
 * Credits are charged per model call from real token usage, so the balance
 * moves during a run rather than at a fixed cost per run. The main process
 * pushes an authoritative quota after each settled call (billing:quotaChanged);
 * the mount and run-end refreshes below stay as reconciliation backstops.
 */
export function useCreditBalanceSync(isAgentRunning: boolean, enabled = true) {
  const setQuota = useBillingStore((state) => state.setQuota)
  const wasRunning = useRef(isAgentRunning)

  const refresh = useCallback(async () => {
    if (!isElectronApp()) return
    try {
      const next = await electronBridge.getBillingQuota()
      if (next) setQuota(next)
    } catch {
      // A stale badge is better than surfacing a balance-refresh failure.
    }
  }, [setQuota])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const unsubscribe = electronBridge.onBillingQuotaChanged((quota) => {
      if (quota) setQuota(quota)
    })
    return () => {
      unsubscribe?.()
    }
  }, [enabled, setQuota])

  useEffect(() => {
    if (!enabled) return
    if (wasRunning.current && !isAgentRunning) {
      void refresh()
    }
    wasRunning.current = isAgentRunning
  }, [enabled, isAgentRunning, refresh])

  return refresh
}

/** The freshest quota: live billing store first, login-time session snapshot as fallback. */
export function useCreditBalance() {
  const storedQuota = useBillingStore((state) => state.quota)
  const sessionQuota = useAuthStore((state) => state.session?.quota ?? null)
  return storedQuota ?? sessionQuota
}
