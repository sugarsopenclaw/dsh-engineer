import { contextBridge, ipcRenderer } from 'electron'

import {
  MLIGHT_CAD_RUNTIME_CHANNELS,
  type MLightCadRuntimeBridge,
  type MLightCadRuntimeRequest,
  type MLightCadRuntimeResponse,
  type MLightCadRuntimeResult,
} from '../../../../src/shared/mlight-cad-runtime'

let registered = false

const bridge: MLightCadRuntimeBridge = Object.freeze({
  register(handler: (request: MLightCadRuntimeRequest) => Promise<MLightCadRuntimeResult>): () => void {
    if (registered) throw new Error('MLightCAD runtime handler is already registered.')
    registered = true
    const listener = (_event: Electron.IpcRendererEvent, request: MLightCadRuntimeRequest): void => {
      void handler(request).then(
        (result) => {
          const response: MLightCadRuntimeResponse = { id: request.id, ok: true, result }
          ipcRenderer.send(MLIGHT_CAD_RUNTIME_CHANNELS.response, response)
        },
        (error: unknown) => {
          const response: MLightCadRuntimeResponse = {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 2_048) : 'MLightCAD extraction failed.',
          }
          ipcRenderer.send(MLIGHT_CAD_RUNTIME_CHANNELS.response, response)
        },
      )
    }
    ipcRenderer.on(MLIGHT_CAD_RUNTIME_CHANNELS.request, listener)
    ipcRenderer.send(MLIGHT_CAD_RUNTIME_CHANNELS.ready)
    return () => {
      ipcRenderer.removeListener(MLIGHT_CAD_RUNTIME_CHANNELS.request, listener)
      registered = false
    }
  },
})

if (process.isMainFrame) contextBridge.exposeInMainWorld('mlightCadRuntime', bridge)
