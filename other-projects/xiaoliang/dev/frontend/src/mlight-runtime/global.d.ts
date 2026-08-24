import type { MLightCadRuntimeBridge } from '../shared/mlight-cad-runtime'

declare global {
  interface Window {
    readonly mlightCadRuntime?: MLightCadRuntimeBridge
  }
}

export {}
