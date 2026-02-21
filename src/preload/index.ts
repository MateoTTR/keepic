import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose a safe API to the renderer via contextBridge.
// IPC handlers will be added here as features are implemented.
contextBridge.exposeInMainWorld('electron', electronAPI)
