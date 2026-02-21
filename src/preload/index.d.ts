import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppConfig,
  SelectLibraryFolderResult,
  IndexProgress,
  IndexResult
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
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    keepic: KeePickAPI
  }
}
