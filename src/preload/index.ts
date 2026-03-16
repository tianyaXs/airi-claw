import { contextBridge, ipcRenderer } from 'electron'

const validChannels = [
  'window:minimize',
  'window:close',
  'window:get-position',
  'window:set-position',
  'app:get-asset-path',
  'screen:get-cursor-point',
  'tts:synthesize',
  'openclaw:send',
  'openclaw:is-connected',
  'openclaw:connect',
  'openclaw:disconnect',
  'openclaw:reset-device-keys'
]

const validReceiveChannels = [
  'openclaw:connected',
  'openclaw:disconnected',
  'openclaw:message',
  'openclaw:chunk',
  'openclaw:complete',
  'openclaw:typing',
  'openclaw:error',
  'openclaw:pairing-required',
  'openclaw:device-mismatch',
  'openclaw:response'
]

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args)
      }
      throw new Error(`Invalid channel: ${channel}`)
    },
    on: (channel: string, callback: (...args: any[]) => void) => {
      if (validReceiveChannels.includes(channel)) {
        const wrappedCallback = (_event: any, ...args: any[]) => callback(...args)
        ipcRenderer.on(channel, wrappedCallback)
        // Return cleanup function
        return () => ipcRenderer.removeListener(channel, wrappedCallback)
      }
      throw new Error(`Invalid channel: ${channel}`)
    }
  }
})

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
        on: (channel: string, callback: (...args: any[]) => void) => () => void
      }
    }
  }
}