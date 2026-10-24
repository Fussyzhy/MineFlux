import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  InstallRequest,
  LoaderId,
  MinefluxApi,
  Settings,
  SourceMode,
  TaskEvent,
  WindowAction,
  WindowStateEvent,
} from '../src/shared/types'

const api: MinefluxApi = {
  getVersions: (mode: SourceMode) => ipcRenderer.invoke('mineflux:getVersions', mode),
  startInstall: (request: InstallRequest) => ipcRenderer.invoke('mineflux:startInstall', request),
  pause: (taskId: string) => ipcRenderer.invoke('mineflux:pause', taskId),
  resume: (taskId: string) => ipcRenderer.invoke('mineflux:resume', taskId),
  cancel: (taskId: string) => ipcRenderer.invoke('mineflux:cancel', taskId),
  retryFailed: (taskId: string) => ipcRenderer.invoke('mineflux:retryFailed', taskId),
  chooseFolder: () => ipcRenderer.invoke('mineflux:chooseFolder'),
  chooseModpackFile: () => ipcRenderer.invoke('mineflux:chooseModpackFile'),
  inspectModpack: (file: string) => ipcRenderer.invoke('mineflux:inspectModpack', file),
  revealPath: (target: string) => ipcRenderer.invoke('mineflux:revealPath', target),
  openExternal: (url: string) => ipcRenderer.invoke('mineflux:openExternal', url),
  getSettings: () => ipcRenderer.invoke('mineflux:getSettings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('mineflux:saveSettings', settings),
  suggestRoot: () => ipcRenderer.invoke('mineflux:suggestRoot'),
  getLoaderVersions: (id: LoaderId, mcVersion: string, mode: SourceMode) =>
    ipcRenderer.invoke('mineflux:getLoaderVersions', id, mcVersion, mode),
  getModVersions: (
    slug: 'fabric-api' | 'optifabric',
    mcVersion: string,
    loaders: string[],
    mode: SourceMode,
  ) => ipcRenderer.invoke('mineflux:getModVersions', slug, mcVersion, loaders, mode),
  detectJava: () => ipcRenderer.invoke('mineflux:detectJava'),
  chooseJavaFile: () => ipcRenderer.invoke('mineflux:chooseJavaFile'),
  probeJavaPath: (target: string) => ipcRenderer.invoke('mineflux:probeJavaPath', target),
  openJavaDownload: () => ipcRenderer.invoke('mineflux:openJavaDownload'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getInstalledVersions: (root: string) => ipcRenderer.invoke('mineflux:getInstalledVersions', root),
  removeInstance: (root: string, name: string) =>
    ipcRenderer.invoke('mineflux:removeInstance', root, name),
  windowControl: (action: WindowAction) => ipcRenderer.invoke('mineflux:windowControl', action),
  onWindowState: (callback: (state: WindowStateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WindowStateEvent): void =>
      callback(payload)
    ipcRenderer.on('mineflux:windowState', listener)
    return () => ipcRenderer.removeListener('mineflux:windowState', listener)
  },
  onEvent: (callback: (event: TaskEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TaskEvent): void => callback(payload)
    ipcRenderer.on('mineflux:event', listener)
    return () => ipcRenderer.removeListener('mineflux:event', listener)
  },
  appVersion: () => ipcRenderer.invoke('mineflux:appVersion'),
}

contextBridge.exposeInMainWorld('mineflux', api)

