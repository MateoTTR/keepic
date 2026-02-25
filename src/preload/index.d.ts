import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppConfig,
  DuplicateGroup,
  GoogleAuthStatus,
  ImportPlan,
  ImportProgress,
  ImportResult,
  IndexProgress,
  IndexResult,
  LibraryStats,
  PlanProgress,
  SelectLibraryFolderResult
} from '../shared/types'

export interface StartIndexResult {
  started?: boolean
  alreadyRunning?: boolean
  error?: string
}

export interface IndexCompleteEvent extends Partial<IndexResult> {
  type: 'complete' | 'error'
  message?: string
}

export interface KeePickAPI {
  config: {
    get: () => Promise<AppConfig>
    selectLibraryFolder: () => Promise<SelectLibraryFolderResult>
  }
  library: {
    startIndex: () => Promise<StartIndexResult>
    onIndexProgress: (callback: (progress: IndexProgress) => void) => void
    onIndexComplete: (callback: (result: IndexCompleteEvent) => void) => void
    getStats: () => Promise<LibraryStats | null>
    scanDuplicates: () => Promise<DuplicateGroup[]>
  }
  import: {
    selectSourceFolder: () => Promise<{ cancelled: boolean; path?: string }>
    plan: (
      sourceFolder: string,
      onProgress: (p: PlanProgress) => void
    ) => Promise<ImportPlan | { error: string }>
    execute: (
      plan: ImportPlan
    ) => Promise<{ started: boolean } | { alreadyRunning: boolean } | { error: string }>
    onProgress: (callback: (p: ImportProgress) => void) => void
    onComplete: (callback: (r: ImportResult) => void) => void
    cancel: () => Promise<void>
  }
  google: {
    getAuthStatus: () => Promise<GoogleAuthStatus>
    connect: () => Promise<{ success: true; email: string } | { error: string }>
    disconnect: () => Promise<{ success: true } | { error: string }>
    getLastDownloadDate: () => Promise<{ date: string | null }>
    cleanupDownloadDir: (dirPath: string) => Promise<void>
    createPickerSession: () => Promise<{ sessionId: string; pickerUri: string } | { error: string }>
    pollPickerSession: (sessionId: string) => Promise<{ ready: boolean } | { error: string }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    keepic: KeePickAPI
  }
}
