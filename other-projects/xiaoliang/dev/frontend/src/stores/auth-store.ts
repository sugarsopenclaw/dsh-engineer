import { create } from 'zustand'
import type { AuthSessionData, CurrentUserData } from '@/shared/backend-api'

type AuthState = {
  session: AuthSessionData | null
  hydrated: boolean
  setSession: (session: AuthSessionData) => void
  setHydrated: (value: boolean) => void
  updateCurrentUser: (payload: CurrentUserData) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  session: null,
  hydrated: false,
  setSession: (session) => set({ session, hydrated: true }),
  setHydrated: (value) => set({ hydrated: value }),
  updateCurrentUser: (payload) =>
    set((state) => {
      if (!state.session) {
        return state
      }

      return {
        session: {
          ...state.session,
          user: payload.user,
          organization: payload.organization,
          role: payload.role,
        },
      }
    }),
  clearSession: () => set({ session: null, hydrated: true }),
}))
