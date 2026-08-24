import { useEffect } from 'react'
import { useBillingStore } from '@/stores/billing-store'

/** Listen for quota-exceeded events from agent chat and open subscription UI. */
export function useQuotaExceededListener(onOpenSettings?: () => void) {
  const openSubscription = useBillingStore((s) => s.openSubscription)

  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      openSubscription(detail?.message || '算力额度不足，请购买算力包后继续使用。')
      onOpenSettings?.()
    }
    window.addEventListener('xiaoliang:quota-exceeded', handle)
    return () => window.removeEventListener('xiaoliang:quota-exceeded', handle)
  }, [onOpenSettings, openSubscription])
}
