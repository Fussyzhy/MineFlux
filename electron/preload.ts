import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  InstallRequest,
  LoaderId,
  McdlApi,
  Settings,
  SourceMode,
  TaskEvent,
  WindowAction,
  WindowStateEvent,
} from '../src/shared/types'

const api: McdlApi = {
  getVersions: (mode: SourceMode) => ipcRenderer.invoke('mcdl:getVersions', mode),
  startInstall: (request: InstallRequest) => ipcRenderer.invoke('mcdl:startInstall', request),
  pause: (taskId: string) => ipcRenderer.invoke('mcdl:pause', taskId),
  resume: (taskId: string) => ipcRenderer.invoke('mcdl:resume', taskId),
  cancel: (taskId: string) => ipcRenderer.invoke('mcdl:cancel', taskId),
  retryFailed: (taskId: string) => ipcRenderer.invoke('mcdl:retryFailed', taskId),
  chooseFolder: () => ipcRenderer.invoke('mcdl:chooseFolder'),
  chooseModpackFile: () => ipcRenderer.invoke('mcdl:chooseModpackFile'),
  inspectModpack: (file: string) => ipcRenderer.invoke('mcdl:inspectModpack', file),
  revealPath: (target: string) => ipcRenderer.invoke('mcdl:revealPath', target),
  openExternal: (url: string) => ipcRenderer.invoke('mcdl:openExternal', url),
  getSettings: () => ipcRenderer.invoke('mcdl:getSettings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('mcdl:saveSettings', settings),
  suggestRoot: () => ipcRenderer.invoke('mcdl:suggestRoot'),
  getLoaderVersions: (id: LoaderId, mcVersion: string, mode: SourceMode) =>
    ipcRenderer.invoke('mcdl:getLoaderVersions', id, mcVersion, mode),
  getModVersions: (
    slug: 'fabric-api' | 'optifabric',
    mcVersion: string,
    loaders: string[],
    mode: SourceMode,
  ) => ipcRenderer.invoke('mcdl:getModVersions', slug, mcVersion, loaders, mode),
  detectJava: () => ipcRenderer.invoke('mcdl:detectJava'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getInstalledVersions: (root: string) => ipcRenderer.invoke('mcdl:getInstalledVersions', root),
  removeInstance: (root: string, name: string) =>
    ipcRenderer.invoke('mcdl:removeInstance', root, name),
  windowControl: (action: WindowAction) => ipcRenderer.invoke('mcdl:windowControl', action),
  onWindowState: (callback: (state: WindowStateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WindowStateEvent): void =>
      callback(payload)
    ipcRenderer.on('mcdl:windowState', listener)
    return () => ipcRenderer.removeListener('mcdl:windowState', listener)
  },
  onEvent: (callback: (event: TaskEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TaskEvent): void => callback(payload)
    ipcRenderer.on('mcdl:event', listener)
    return () => ipcRenderer.removeListener('mcdl:event', listener)
  },
  appVersion: () => ipcRenderer.invoke('mcdl:appVersion'),
}

contextBridge.exposeInMainWorld('mcdl', api)

