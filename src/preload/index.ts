import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppConfig, SelectLibraryFolderResult } from '../shared/types'

const keepicAPI = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    selectLibraryFolder: (): Promise<SelectLibraryFolderResult> =>
      ipcRenderer.invoke('config:select-library-folder')
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('keepic', keepicAPI)
