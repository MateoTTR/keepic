import { existsSync, unlinkSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import type { EventEmitter } from 'events'
import { defaultPhashComputer, type PhashComputer, type PhashResult } from './phash'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns the candidate HEIC/HEIF companion paths for a given .MOV file.
 * Replaces the .MOV extension with .heic and .heif (lowercase).
 * On case-insensitive filesystems (Windows/macOS), lowercase lookups are
 * sufficient to match uppercase extensions such as .HEIC or .HEIF.
 *
 * Example: '/photos/IMG_1234.MOV' → ['/photos/IMG_1234.heic', '/photos/IMG_1234.heif']
 */
export function getHeicCandidatePaths(movPath: string): string[] {
  const stem = movPath.slice(0, -extname(movPath).length)
  return [stem + '.heic', stem + '.heif']
}

// ---------------------------------------------------------------------------
// Live Photo detection
// ---------------------------------------------------------------------------

/** Injectable function type for checking file existence. */
export type ExistsChecker = (path: string) => boolean

/**
 * Returns true if `movPath` is the video component of an iPhone Live Photo.
 *
 * A .MOV file is a Live Photo companion when a HEIC or HEIF still image with
 * the same stem exists in the same directory.
 *
 * @param movPath    - Absolute path to the .MOV file to check.
 * @param checkExists - Injectable existence checker (defaults to existsSync).
 */
export function isLivePhotoMov(movPath: string, checkExists: ExistsChecker = existsSync): boolean {
  if (extname(movPath).toLowerCase() !== '.mov') return false
  return getHeicCandidatePaths(movPath).some(checkExists)
}

// ---------------------------------------------------------------------------
// ffmpeg path resolution
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the ffmpeg binary from `ffmpeg-static`.
 *
 * In production (Electron packaged app), the binary lives in
 * `resources/app.asar.unpacked/...` rather than inside the asar archive.
 * This function rewrites the path accordingly.
 */
export function getFfmpegPath(
  loadPath: () => string | null = (): string | null =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('ffmpeg-static') as string | null
): string {
  const path = loadPath()
  if (!path) throw new Error('ffmpeg-static: no binary found for the current platform')
  return path.replace('app.asar', 'app.asar.unpacked')
}

// ---------------------------------------------------------------------------
// HEIC → JPEG conversion
// ---------------------------------------------------------------------------

/** Injectable HEIC converter: reads `src`, writes a JPEG to `dest`. */
export type HeicConverter = (src: string, dest: string, quality: number) => Promise<void>

/**
 * Injectable spawn function — used for testing without calling the real ffmpeg binary.
 * Must return an object that emits 'close' (exit code) and 'error' events.
 */
export type SpawnFn = (command: string, args: string[]) => EventEmitter

/**
 * Creates a HeicConverter backed by ffmpeg (pre-built static binary).
 *
 * Uses `-q:v` to pass JPEG quality. ffmpeg exits non-zero on decode failure,
 * which causes the returned Promise to reject.
 *
 * Note: EXIF metadata from the original HEIC is not embedded in the output JPEG.
 * The import pipeline stores metadata (date, GPS, dimensions) in the SQLite
 * database separately via exifreader, so no information is lost.
 *
 * @param ffmpegPath - Absolute path to the ffmpeg binary (from getFfmpegPath()).
 * @param spawnFn    - Injectable spawn function (defaults to child_process.spawn).
 */
export function createHeicConverter(ffmpegPath: string, spawnFn: SpawnFn = spawn): HeicConverter {
  return (src: string, dest: string, quality: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      const child = spawnFn(ffmpegPath, ['-i', src, '-q:v', String(quality), dest, '-y'])
      child.on('close', (code: number | null) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exited with code ${code ?? 'null'}`))
      })
      child.on('error', (err: Error) => reject(err))
    })
  }
}

/** Default converter using ffmpeg-static. */
export const defaultHeicConverter: HeicConverter = createHeicConverter(getFfmpegPath())

/**
 * Converts a HEIC/HEIF image to JPEG via ffmpeg.
 *
 * @param src       - Absolute path to the source HEIC/HEIF file.
 * @param dest      - Absolute path for the output JPEG file.
 * @param quality   - JPEG quality passed to ffmpeg `-q:v`.
 * @param converter - Injectable converter (defaults to defaultHeicConverter).
 */
export async function convertHeicToJpeg(
  src: string,
  dest: string,
  quality: number,
  converter: HeicConverter = defaultHeicConverter
): Promise<void> {
  await converter(src, dest, quality)
}

// ---------------------------------------------------------------------------
// Universal pHash computer (HEIC-aware)
// ---------------------------------------------------------------------------

export interface UniversalPhashComputerOptions {
  /** Injectable spawn function (for testing without real ffmpeg). */
  spawnFn?: SpawnFn
  /** Injectable pHash computer for the intermediate JPEG (defaults to defaultPhashComputer). */
  computeSharpPhash?: PhashComputer
  /** Injectable temp path generator (defaults to os.tmpdir() + uuid). */
  generateTempPath?: () => string
  /** Injectable file deletion (defaults to unlinkSync, errors ignored). */
  deleteFile?: (path: string) => void
}

/**
 * Creates a PhashComputer that handles both HEIC/HEIF and regular image files.
 *
 * - HEIC/HEIF: converts to a temporary JPEG via ffmpeg, computes pHash with
 *   native sharp, then deletes the temp file.
 * - All other formats: delegates directly to native sharp (no ffmpeg involved).
 *
 * This replaces the old `createHeicPhashComputer` (WASM-based) and makes the
 * library indexer HEIC-aware: HEIC files now receive a real pHash in the DB.
 *
 * @param ffmpegPath - Absolute path to the ffmpeg binary (from getFfmpegPath()).
 * @param options    - Injectable dependencies (for testing).
 */
export function createUniversalPhashComputer(
  ffmpegPath: string,
  options: UniversalPhashComputerOptions = {}
): PhashComputer {
  const spawnFn = options.spawnFn ?? (spawn as SpawnFn)
  const computeSharpPhash = options.computeSharpPhash ?? defaultPhashComputer
  const generateTempPath =
    options.generateTempPath ?? ((): string => join(tmpdir(), `keepic-phash-${randomUUID()}.jpg`))
  const deleteFile = options.deleteFile ?? ((p: string): void => unlinkSync(p))

  return async (filePath: string): Promise<PhashResult | null> => {
    const ext = extname(filePath).toLowerCase()

    if (ext !== '.heic' && ext !== '.heif') {
      // Non-HEIC: native sharp path (fast)
      return computeSharpPhash(filePath)
    }

    // HEIC path: ffmpeg → temp JPEG → sharp pHash → delete temp
    const tempPath = generateTempPath()
    let result: PhashResult | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawnFn(ffmpegPath, ['-i', filePath, '-frames:v', '1', tempPath, '-y'])
        child.on('close', (code: number | null) => {
          if (code === 0) resolve()
          else reject(new Error(`ffmpeg exited with code ${code ?? 'null'}`))
        })
        child.on('error', (err: Error) => reject(err))
      })
      result = await computeSharpPhash(tempPath)
    } catch {
      // result stays null
    }
    try {
      deleteFile(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    return result
  }
}
