import { existsSync, statSync } from 'fs'
import type { ConfigManager } from '../config'
import type { AppConfig, SelectLibraryFolderResult } from '../../shared/types'

export interface ShowOpenDialogOptions {
  properties: Array<'openDirectory'>
  title: string
}

export interface ShowOpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

/** Signature of Electron's dialog.showOpenDialog (injectable for testing). */
export type ShowOpenDialogFn = (options: ShowOpenDialogOptions) => Promise<ShowOpenDialogResult>

/** Returns the current application config. */
export function handleGetConfig(configManager: ConfigManager): AppConfig {
  return configManager.get()
}

/** Updates the HEIC configuration and persists immediately. */
export function handleSetHeicConfig(
  configManager: ConfigManager,
  heic: AppConfig['heic']
): AppConfig {
  configManager.setHeicConfig(heic)
  return configManager.get()
}

/**
 * Validates that the given path exists and is a directory.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateLibraryPath(folderPath: string): { valid: boolean; error?: string } {
  if (!existsSync(folderPath)) {
    return { valid: false, error: 'Folder does not exist' }
  }
  if (!statSync(folderPath).isDirectory()) {
    return { valid: false, error: 'Path is not a directory' }
  }
  return { valid: true }
}

/**
 * Opens an OS folder picker dialog, validates the chosen path, and saves it
 * as the library folder in the config.
 *
 * @param showOpenDialog - Injectable dialog function (Electron boundary).
 * @param configManager  - ConfigManager instance.
 */
export async function handleSelectLibraryFolder(
  showOpenDialog: ShowOpenDialogFn,
  configManager: ConfigManager
): Promise<SelectLibraryFolderResult> {
  const result = await showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select KeePic library folder'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true }
  }

  const folderPath = result.filePaths[0]
  const validation = validateLibraryPath(folderPath)

  if (!validation.valid) {
    return { cancelled: false, error: validation.error }
  }

  configManager.setLibraryPath(folderPath)
  return { cancelled: false, path: folderPath }
}
