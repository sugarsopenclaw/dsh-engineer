import { contextBridge, ipcRenderer } from 'electron'
import { IPC_INVOKE, IPC_ON, IPC_SEND } from '../src/shared/ipc-contract'

const validChannels = {
  invoke: Object.values(IPC_INVOKE),
  send: Object.values(IPC_SEND),
  on: Object.values(IPC_ON),
} as const

function isValidChannel(
  type: keyof typeof validChannels,
  channel: string,
): channel is (typeof validChannels)[typeof type][number] {
  return validChannels[type].includes(channel as never)
}

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: async (channel: string, ...args: unknown[]) => {
    if (!isValidChannel('invoke', channel)) {
      throw new Error(`[preload] 无效或未授权的 invoke 通道: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  send: (channel: string, ...args: unknown[]) => {
    if (!isValidChannel('send', channel)) {
      console.warn(`[preload] 无效或未授权的 send 通道: ${channel}`)
      return
    }
    ipcRenderer.send(channel, ...args)
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!isValidChannel('on', channel)) return null
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },

  environment: {
    versions: {
      chrome: process.versions.chrome,
      node: process.versions.node,
      electron: process.versions.electron,
    },
    platform: process.platform,
  },
})
