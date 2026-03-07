import { describe, it, expect } from 'vitest'
import {
  handleRevealInFolder,
  handleRevealLibraryFile,
  type ShowItemInFolderFn
} from '../../../src/main/ipc/shell-handlers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpy(): { fn: ShowItemInFolderFn; calls: string[] } {
  const calls: string[] = []
  const fn: ShowItemInFolderFn = (fullPath: string) => {
    calls.push(fullPath)
  }
  return { fn, calls }
}

// ---------------------------------------------------------------------------
// handleRevealInFolder
// ---------------------------------------------------------------------------

describe('handleRevealInFolder', () => {
  it('calls showItemInFolder with the absolute path', () => {
    const { fn, calls } = makeSpy()
    handleRevealInFolder('/photos/2024/2024.06/IMG_1234.jpg', fn)

    expect(calls).toEqual(['/photos/2024/2024.06/IMG_1234.jpg'])
  })

  it('handles paths with spaces', () => {
    const { fn, calls } = makeSpy()
    handleRevealInFolder('/my photos/holiday pic.jpg', fn)

    expect(calls).toEqual(['/my photos/holiday pic.jpg'])
  })
})

// ---------------------------------------------------------------------------
// handleRevealLibraryFile
// ---------------------------------------------------------------------------

describe('handleRevealLibraryFile', () => {
  it('joins relative path with library path and reveals', () => {
    const { fn, calls } = makeSpy()
    handleRevealLibraryFile('2024/2024.06/IMG_1234.jpg', '/shared/photos', fn)

    expect(calls).toEqual(['/shared/photos/2024/2024.06/IMG_1234.jpg'])
  })

  it('handles relative paths with event folder names', () => {
    const { fn, calls } = makeSpy()
    handleRevealLibraryFile('2024/2024.04.15-19.Londres/IMG.jpg', '/lib', fn)

    expect(calls).toEqual(['/lib/2024/2024.04.15-19.Londres/IMG.jpg'])
  })

  it('throws when library path is null', () => {
    const { fn } = makeSpy()
    expect(() => handleRevealLibraryFile('2024/IMG.jpg', null, fn)).toThrow(
      'Library path not configured'
    )
  })

  it('throws when library path is empty string', () => {
    const { fn } = makeSpy()
    expect(() => handleRevealLibraryFile('2024/IMG.jpg', '', fn)).toThrow(
      'Library path not configured'
    )
  })
})
