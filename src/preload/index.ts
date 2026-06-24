import { contextBridge, ipcRenderer } from 'electron'

const electronHandler = {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_: any, ...args: any[]) => {
      // 对于 glue-layer:log 事件，解析 JSON 字符串
      if (channel === 'glue-layer:log' && typeof args[0] === 'string') {
        try {
          callback(JSON.parse(args[0]))
        } catch {
          callback(args[0])
        }
      } else {
        callback(...args)
      }
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  // 微信 Agent IPC 桥接
  wechatAgent: {
    getGlueLayerStatus: () => ipcRenderer.invoke('wechat-agent:getGlueLayerStatus'),
    restartGlueLayer: () => ipcRenderer.invoke('wechat-agent:restartGlueLayer'),
    checkWeChat: () => ipcRenderer.invoke('wechat-agent:checkWeChat'),
    installWeChat: () => ipcRenderer.invoke('wechat-agent:installWeChat'),
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronHandler)
    contextBridge.exposeInMainWorld('osInfo', { platform: process.platform })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronHandler
  // @ts-ignore
  window.osInfo = { platform: process.platform }
}

export type ElectronHandler = typeof electronHandler
