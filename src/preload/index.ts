import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppConfig, SelectLibraryFolderResult } from '../shared/types'

const keepicAPI = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    selectLibraryFolder: (): Promise<SelectLibraryFolderResult> =>
      ipcRenderer.invoke('config:select-library-folder')
  },
  library: {
    startIndex: (): Promise<{ started?: boolean; alreadyRunning?: boolean; error?: string }> =>
      ipcRenderer.invoke('library:start-index'),
    onIndexProgress: (
      callback: (progress: {
        total: number
        processed: number
        indexed: number
        skipped: number
      }) => void
    ) => {
      ipcRenderer.on('library:index-progress', (_event, data) => callback(data))
    },
    onIndexComplete: (
      callback: (result: {
        type: 'complete' | 'error'
        indexed?: number
        skipped?: number
        deleted?: number
        message?: string
      }) => void
    ) => {
      ipcRenderer.on('library:index-complete', (_event, data) => callback(data))
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('keepic', keepicAPI)
