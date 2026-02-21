import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, SelectLibraryFolderResult } from '../shared/types'

export interface KeePickAPI {
  config: {
    get: () => Promise<AppConfig>
    selectLibraryFolder: () => Promise<SelectLibraryFolderResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    keepic: KeePickAPI
  }
}
