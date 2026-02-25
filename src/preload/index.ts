import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppConfig,
  DuplicateGroup,
  GoogleAuthStatus,
  GoogleDownloadProgress,
  GoogleDownloadResult,
  ImportPlan,
  ImportProgress,
  ImportResult,
  LibraryStats,
  PlanProgress,
  SelectLibraryFolderResult
} from '../shared/types'

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
    },
    getStats: (): Promise<LibraryStats | null> =>
      ipcRenderer.invoke('library:get-stats') as Promise<LibraryStats | null>,
    scanDuplicates: (): Promise<DuplicateGroup[]> =>
      ipcRenderer.invoke('library:scan-duplicates') as Promise<DuplicateGroup[]>
  },
  import: {
    selectSourceFolder: (): Promise<{ cancelled: boolean; path?: string }> =>
      ipcRenderer.invoke('import:select-source-folder'),

    plan: (
      sourceFolder: string,
      onProgress: (p: PlanProgress) => void
    ): Promise<ImportPlan | { error: string }> => {
      const progressHandler = (_event: unknown, data: PlanProgress) => onProgress(data)
      ipcRenderer.on('import:plan-progress', progressHandler)
      return ipcRenderer
        .invoke('import:plan', { sourcePath: sourceFolder })
        .finally(() => ipcRenderer.removeListener('import:plan-progress', progressHandler))
    },

    execute: (
      plan: ImportPlan
    ): Promise<{ started: boolean } | { alreadyRunning: boolean } | { error: string }> =>
      ipcRenderer.invoke('import:execute', { plan }),

    onProgress: (callback: (p: ImportProgress) => void): void => {
      ipcRenderer.on('import:progress', (_event, data) => callback(data))
    },

    removeProgressListeners: (): void => {
      ipcRenderer.removeAllListeners('import:progress')
    },

    onComplete: (callback: (r: ImportResult) => void): void => {
      ipcRenderer.on('import:complete', (_event, data) => callback(data))
    },

    removeCompleteListeners: (): void => {
      ipcRenderer.removeAllListeners('import:complete')
    },

    cancel: (): Promise<{ cancelled: true } | { noWorker: true }> =>
      ipcRenderer.invoke('import:cancel')
  },
  google: {
    getAuthStatus: (): Promise<GoogleAuthStatus> => ipcRenderer.invoke('google:get-auth-status'),

    connect: (): Promise<{ success: true; email: string } | { error: string }> =>
      ipcRenderer.invoke('google:connect'),

    disconnect: (): Promise<{ success: true } | { error: string }> =>
      ipcRenderer.invoke('google:disconnect'),

    getLastDownloadDate: (): Promise<{ date: string | null }> =>
      ipcRenderer.invoke('google:get-last-download-date'),

    cleanupDownloadDir: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke('google:cleanup-download-dir', { dirPath }),

    createPickerSession: (): Promise<
      { sessionId: string; pickerUri: string } | { error: string }
    > => ipcRenderer.invoke('google:create-picker-session'),

    pollPickerSession: (sessionId: string): Promise<{ ready: boolean } | { error: string }> =>
      ipcRenderer.invoke('google:poll-picker-session', { sessionId }),

    startPickerDownload: (
      sessionId: string
    ): Promise<{ started: true } | { alreadyRunning: true } | { error: string }> =>
      ipcRenderer.invoke('google:start-picker-download', { sessionId }),

    cancelPickerDownload: (): Promise<{ cancelled: true } | { noWorker: true }> =>
      ipcRenderer.invoke('google:cancel-picker-download'),

    onPickerDownloadProgress: (callback: (p: GoogleDownloadProgress) => void): void => {
      ipcRenderer.on('google:picker-download-progress', (_event, data) => callback(data))
    },

    onPickerDownloadComplete: (callback: (r: GoogleDownloadResult) => void): void => {
      ipcRenderer.on('google:picker-download-complete', (_event, data) => callback(data))
    },

    removePickerDownloadListeners: (): void => {
      ipcRenderer.removeAllListeners('google:picker-download-progress')
      ipcRenderer.removeAllListeners('google:picker-download-complete')
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('keepic', keepicAPI)
