import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  libraryPath: null,
  heic: {
    mode: 'keep',
    jpegQuality: 90
  },
  dedupThreshold: 2
}

/**
 * Manages the KeePic application configuration stored in config.json inside
 * the OS application data directory (app.getPath('userData')).
 *
 * Usage:
 *   const cfg = new ConfigManager(app.getPath('userData'))
 *   cfg.load()
 *   cfg.setLibraryPath('/Volumes/NAS/Photos')
 */
export class ConfigManager {
  private readonly configPath: string
  private config: AppConfig

  constructor(userDataPath: string) {
    this.configPath = join(userDataPath, 'config.json')
    this.config = structuredClone(DEFAULT_CONFIG)
  }

  /**
   * Loads the config file from disk. If the file is missing or invalid, the
   * in-memory config is reset to defaults without throwing.
   */
  load(): void {
    if (!existsSync(this.configPath)) {
      this.config = structuredClone(DEFAULT_CONFIG)
      return
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      this.config = mergeWithDefaults(parsed)
    } catch {
      this.config = structuredClone(DEFAULT_CONFIG)
    }
  }

  /** Persists the current in-memory config to disk. */
  save(): void {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
  }

  /** Returns a deep copy of the current config. */
  get(): AppConfig {
    return structuredClone(this.config)
  }

  /** Sets the library folder path and persists immediately. Pass null to clear. */
  setLibraryPath(path: string | null): void {
    this.config = { ...this.config, libraryPath: path }
    this.save()
  }

  /** Sets the HEIC configuration and persists immediately. */
  setHeicConfig(heic: AppConfig['heic']): void {
    this.config = { ...this.config, heic }
    this.save()
  }

  /** Sets the dedup Hamming distance threshold and persists immediately. */
  setDedupThreshold(threshold: number): void {
    this.config = { ...this.config, dedupThreshold: Math.max(0, Math.min(4, Math.round(threshold))) }
    this.save()
  }
}

/**
 * Merges a parsed (but unvalidated) JSON value with the default config.
 * Unknown or wrongly-typed fields fall back to their default values.
 *
 * Handles backward compatibility: if the old `heicConversion` key is present
 * (from v0.2.x config files), it is migrated to the new `heic` shape.
 */
export function mergeWithDefaults(parsed: unknown): AppConfig {
  const result = structuredClone(DEFAULT_CONFIG)

  if (typeof parsed !== 'object' || parsed === null) {
    return result
  }

  const obj = parsed as Record<string, unknown>

  if (obj['libraryPath'] === null || typeof obj['libraryPath'] === 'string') {
    result.libraryPath = obj['libraryPath'] as string | null
  }

  // New heic config shape
  if (typeof obj['heic'] === 'object' && obj['heic'] !== null) {
    const heic = obj['heic'] as Record<string, unknown>
    if (heic['mode'] === 'keep' || heic['mode'] === 'convert') {
      result.heic.mode = heic['mode']
    }
    if (typeof heic['jpegQuality'] === 'number') {
      result.heic.jpegQuality = heic['jpegQuality']
    }
  }
  // Backward compat: migrate old heicConversion to new heic shape
  else if (typeof obj['heicConversion'] === 'object' && obj['heicConversion'] !== null) {
    const old = obj['heicConversion'] as Record<string, unknown>
    if (typeof old['enabled'] === 'boolean') {
      result.heic.mode = old['enabled'] ? 'convert' : 'keep'
    }
    if (typeof old['jpegQuality'] === 'number') {
      result.heic.jpegQuality = old['jpegQuality']
    }
  }

  if (typeof obj['dedupThreshold'] === 'number') {
    result.dedupThreshold = Math.max(0, Math.min(4, Math.round(obj['dedupThreshold'])))
  }

  return result
}
