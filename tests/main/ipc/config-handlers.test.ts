import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ConfigManager } from '../../../src/main/config'
import {
  handleGetConfig,
  validateLibraryPath,
  handleSelectLibraryFolder,
  type ShowOpenDialogFn,
  type ShowOpenDialogResult
} from '../../../src/main/ipc/config-handlers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'keepic-handlers-test-'))
}

function makeDialog(result: ShowOpenDialogResult): ShowOpenDialogFn {
  return () => Promise.resolve(result)
}

// ---------------------------------------------------------------------------
// handleGetConfig
// ---------------------------------------------------------------------------

describe('handleGetConfig', () => {
  let tmpDir: string
  let cfg: ConfigManager

  beforeEach(() => {
    tmpDir = makeTempDir()
    cfg = new ConfigManager(tmpDir)
    cfg.load()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the current config', () => {
    const result = handleGetConfig(cfg)
    expect(result.libraryPath).toBeNull()
    expect(result.heic.mode).toBe('keep')
  })

  it('reflects an updated library path', () => {
    cfg.setLibraryPath('/some/path')
    const result = handleGetConfig(cfg)
    expect(result.libraryPath).toBe('/some/path')
  })
})

// ---------------------------------------------------------------------------
// validateLibraryPath
// ---------------------------------------------------------------------------

describe('validateLibraryPath', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns valid for an existing directory', () => {
    const result = validateLibraryPath(tmpDir)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns invalid with error for a non-existent path', () => {
    const result = validateLibraryPath(join(tmpDir, 'does-not-exist'))
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Folder does not exist')
  })

  it('returns invalid with error when path is a file (not a directory)', () => {
    const filePath = join(tmpDir, 'somefile.txt')
    writeFileSync(filePath, 'hello', 'utf-8')
    const result = validateLibraryPath(filePath)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path is not a directory')
  })

  it('returns valid for a nested directory', () => {
    const nested = join(tmpDir, 'sub', 'folder')
    mkdirSync(nested, { recursive: true })
    expect(validateLibraryPath(nested).valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleSelectLibraryFolder
// ---------------------------------------------------------------------------

describe('handleSelectLibraryFolder', () => {
  let tmpDir: string
  let cfgDir: string
  let cfg: ConfigManager

  beforeEach(() => {
    tmpDir = makeTempDir()
    cfgDir = makeTempDir()
    cfg = new ConfigManager(cfgDir)
    cfg.load()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(cfgDir, { recursive: true, force: true })
  })

  it('returns cancelled: true when dialog is cancelled', async () => {
    const dialog = makeDialog({ canceled: true, filePaths: [] })
    const result = await handleSelectLibraryFolder(dialog, cfg)
    expect(result.cancelled).toBe(true)
  })

  it('returns cancelled: true when filePaths is empty', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: [] })
    const result = await handleSelectLibraryFolder(dialog, cfg)
    expect(result.cancelled).toBe(true)
  })

  it('returns error when selected path does not exist', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: [join(tmpDir, 'ghost')] })
    const result = await handleSelectLibraryFolder(dialog, cfg)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBe('Folder does not exist')
    expect(result.path).toBeUndefined()
  })

  it('returns error when selected path is a file', async () => {
    const filePath = join(tmpDir, 'notafolder.txt')
    writeFileSync(filePath, 'data', 'utf-8')
    const dialog = makeDialog({ canceled: false, filePaths: [filePath] })
    const result = await handleSelectLibraryFolder(dialog, cfg)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBe('Path is not a directory')
    expect(result.path).toBeUndefined()
  })

  it('saves the path to config and returns it on success', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: [tmpDir] })
    const result = await handleSelectLibraryFolder(dialog, cfg)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.path).toBe(tmpDir)
    expect(cfg.get().libraryPath).toBe(tmpDir)
  })

  it('does not modify config when cancelled', async () => {
    const dialog = makeDialog({ canceled: true, filePaths: [] })
    await handleSelectLibraryFolder(dialog, cfg)
    expect(cfg.get().libraryPath).toBeNull()
  })

  it('does not modify config when path is invalid', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: [join(tmpDir, 'missing')] })
    await handleSelectLibraryFolder(dialog, cfg)
    expect(cfg.get().libraryPath).toBeNull()
  })
})
