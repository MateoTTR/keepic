import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  libraryPath: null,
  heicConversion: {
    enabled: true,
    jpegQuality: 90
  }
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
}

/**
 * Merges a parsed (but unvalidated) JSON value with the default config.
 * Unknown or wrongly-typed fields fall back to their default values.
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

  if (typeof obj['heicConversion'] === 'object' && obj['heicConversion'] !== null) {
    const heic = obj['heicConversion'] as Record<string, unknown>
    if (typeof heic['enabled'] === 'boolean') {
      result.heicConversion.enabled = heic['enabled']
    }
    if (typeof heic['jpegQuality'] === 'number') {
      result.heicConversion.jpegQuality = heic['jpegQuality']
    }
  }

  return result
}
