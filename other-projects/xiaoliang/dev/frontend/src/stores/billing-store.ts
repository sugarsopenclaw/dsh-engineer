import { create } from 'zustand'
import type { QuotaSummaryData } from '@/shared/backend-api'

type BillingState = {
  quota: QuotaSummaryData | null
  subscriptionOpen: boolean
  quotaExceededMessage: string | null
  setQuota: (quota: QuotaSummaryData | null) => void
  openSubscription: (message?: string | null) => void
  closeSubscription: () => void
}

export const useBillingStore = create<BillingState>((set) => ({
  quota: null,
  subscriptionOpen: false,
  quotaExceededMessage: null,
  setQuota: (quota) => set({ quota }),
  openSubscription: (message = null) =>
    set({
      subscriptionOpen: true,
      quotaExceededMessage: message,
    }),
  closeSubscription: () =>
    set({
      subscriptionOpen: false,
      quotaExceededMessage: null,
    }),
}))
