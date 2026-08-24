import { create } from 'zustand'
import {
  normalizeUpdateStatus,
  type UpdateStatus,
} from '@/components/update/update-state.mts'

type UiState = {
  sidebarOpen: boolean
  updateStatus: UpdateStatus
  setSidebarOpen: (v: boolean) => void
  setUpdateStatus: (status: UpdateStatus) => void
  resetUpdateStatus: () => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  updateStatus: normalizeUpdateStatus({ phase: 'idle' }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setUpdateStatus: (status) => set({ updateStatus: status }),
  resetUpdateStatus: () => set({ updateStatus: normalizeUpdateStatus({ phase: 'idle' }) }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
}))
