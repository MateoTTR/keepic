import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ConfigManager, mergeWithDefaults } from '../../src/main/config'
import type { AppConfig } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'keepic-config-test-'))
}

const DEFAULT: AppConfig = {
  libraryPath: null,
  heicConversion: { enabled: true, jpegQuality: 90 }
}

// ---------------------------------------------------------------------------
// mergeWithDefaults (pure function)
// ---------------------------------------------------------------------------

describe('mergeWithDefaults', () => {
  it('returns defaults when passed null', () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT)
  })

  it('returns defaults when passed a non-object primitive', () => {
    expect(mergeWithDefaults(42)).toEqual(DEFAULT)
    expect(mergeWithDefaults('bad')).toEqual(DEFAULT)
  })

  it('returns defaults when passed an array', () => {
    expect(mergeWithDefaults([])).toEqual(DEFAULT)
  })

  it('applies a valid libraryPath string', () => {
    const result = mergeWithDefaults({ libraryPath: '/mnt/nas/photos' })
    expect(result.libraryPath).toBe('/mnt/nas/photos')
  })

  it('accepts libraryPath: null explicitly', () => {
    const result = mergeWithDefaults({ libraryPath: null })
    expect(result.libraryPath).toBeNull()
  })

  it('ignores libraryPath with wrong type', () => {
    const result = mergeWithDefaults({ libraryPath: 123 })
    expect(result.libraryPath).toBeNull()
  })

  it('applies heicConversion.enabled when boolean', () => {
    const result = mergeWithDefaults({ heicConversion: { enabled: false } })
    expect(result.heicConversion.enabled).toBe(false)
  })

  it('ignores heicConversion.enabled when wrong type', () => {
    const result = mergeWithDefaults({ heicConversion: { enabled: 'yes' } })
    expect(result.heicConversion.enabled).toBe(true) // default
  })

  it('applies heicConversion.jpegQuality when number', () => {
    const result = mergeWithDefaults({ heicConversion: { jpegQuality: 75 } })
    expect(result.heicConversion.jpegQuality).toBe(75)
  })

  it('ignores heicConversion.jpegQuality when wrong type', () => {
    const result = mergeWithDefaults({ heicConversion: { jpegQuality: '80' } })
    expect(result.heicConversion.jpegQuality).toBe(90) // default
  })

  it('ignores heicConversion when not an object', () => {
    const result = mergeWithDefaults({ heicConversion: 'bad' })
    expect(result.heicConversion).toEqual(DEFAULT.heicConversion)
  })

  it('returns a deep copy (mutating result does not affect a second call)', () => {
    const a = mergeWithDefaults({})
    a.heicConversion.jpegQuality = 1
    const b = mergeWithDefaults({})
    expect(b.heicConversion.jpegQuality).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// ConfigManager
// ---------------------------------------------------------------------------

describe('ConfigManager', () => {
  let tmpDir: string
  let cfg: ConfigManager

  beforeEach(() => {
    tmpDir = makeTempDir()
    cfg = new ConfigManager(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // --- get() ---

  it('get() returns default config before load()', () => {
    expect(cfg.get()).toEqual(DEFAULT)
  })

  it('get() returns a deep copy (mutation does not affect internal state)', () => {
    const a = cfg.get()
    a.heicConversion.jpegQuality = 1
    expect(cfg.get().heicConversion.jpegQuality).toBe(90)
  })

  // --- load() — no file ---

  it('load() keeps defaults when config.json does not exist', () => {
    cfg.load()
    expect(cfg.get()).toEqual(DEFAULT)
  })

  // --- load() — valid file ---

  it('load() reads a valid config.json', () => {
    const stored: AppConfig = {
      libraryPath: '/mnt/nas/photos',
      heicConversion: { enabled: false, jpegQuality: 75 }
    }
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(stored), 'utf-8')
    cfg.load()
    expect(cfg.get()).toEqual(stored)
  })

  it('load() merges partial config with defaults', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({ libraryPath: '/foo' }), 'utf-8')
    cfg.load()
    const result = cfg.get()
    expect(result.libraryPath).toBe('/foo')
    expect(result.heicConversion).toEqual(DEFAULT.heicConversion)
  })

  // --- load() — corrupt file ---

  it('load() falls back to defaults on invalid JSON', () => {
    writeFileSync(join(tmpDir, 'config.json'), '{ broken json', 'utf-8')
    cfg.load()
    expect(cfg.get()).toEqual(DEFAULT)
  })

  it('load() falls back to defaults when JSON is not an object', () => {
    writeFileSync(join(tmpDir, 'config.json'), '"just a string"', 'utf-8')
    cfg.load()
    expect(cfg.get()).toEqual(DEFAULT)
  })

  // --- save() ---

  it('save() writes valid JSON that can be read back', () => {
    cfg.load()
    cfg.save()
    const raw = readFileSync(join(tmpDir, 'config.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual(DEFAULT)
  })

  // --- setLibraryPath() ---

  it('setLibraryPath() updates the path in memory', () => {
    cfg.setLibraryPath('/mnt/nas/photos')
    expect(cfg.get().libraryPath).toBe('/mnt/nas/photos')
  })

  it('setLibraryPath() persists to disk immediately', () => {
    cfg.setLibraryPath('/mnt/nas/photos')
    const raw = readFileSync(join(tmpDir, 'config.json'), 'utf-8')
    expect(JSON.parse(raw).libraryPath).toBe('/mnt/nas/photos')
  })

  it('setLibraryPath(null) clears the path', () => {
    cfg.setLibraryPath('/mnt/nas/photos')
    cfg.setLibraryPath(null)
    expect(cfg.get().libraryPath).toBeNull()
  })

  it('setLibraryPath(null) persists null to disk', () => {
    cfg.setLibraryPath(null)
    const raw = readFileSync(join(tmpDir, 'config.json'), 'utf-8')
    expect(JSON.parse(raw).libraryPath).toBeNull()
  })

  // --- round-trip ---

  it('load() after setLibraryPath() round-trips correctly', () => {
    cfg.setLibraryPath('/mnt/nas/photos')

    const cfg2 = new ConfigManager(tmpDir)
    cfg2.load()
    expect(cfg2.get().libraryPath).toBe('/mnt/nas/photos')
  })

  it('load() after save() with full config round-trips correctly', () => {
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        libraryPath: '/backup',
        heicConversion: { enabled: false, jpegQuality: 60 }
      }),
      'utf-8'
    )
    cfg.load()
    cfg.save()

    const cfg2 = new ConfigManager(tmpDir)
    cfg2.load()
    expect(cfg2.get()).toEqual({
      libraryPath: '/backup',
      heicConversion: { enabled: false, jpegQuality: 60 }
    })
  })
})
