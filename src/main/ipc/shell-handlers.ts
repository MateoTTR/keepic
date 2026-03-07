import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Injectable function type for showing an item in the OS file explorer. */
export type ShowItemInFolderFn = (fullPath: string) => void

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Opens the OS file explorer and selects the file at `absolutePath`.
 */
export function handleRevealInFolder(
  absolutePath: string,
  showItemInFolder: ShowItemInFolderFn
): void {
  showItemInFolder(absolutePath)
}

/**
 * Resolves a library-relative path to an absolute path, then reveals it
 * in the OS file explorer.
 *
 * @throws If libraryPath is null or empty.
 */
export function handleRevealLibraryFile(
  relativePath: string,
  libraryPath: string | null,
  showItemInFolder: ShowItemInFolderFn
): void {
  if (!libraryPath) {
    throw new Error('Library path not configured')
  }
  const absolutePath = join(libraryPath, relativePath)
  showItemInFolder(absolutePath)
}
