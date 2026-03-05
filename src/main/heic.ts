import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import sharp from 'sharp'
import { dctHash, defaultPhashComputer, type PhashComputer, type PhashResult } from './phash'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 32

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

export function isHeicFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.heic' || ext === '.heif'
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
// HEIC full-image decode via heic-decode (WASM libheif)
// ---------------------------------------------------------------------------

/** Result of decoding a HEIC file to raw RGBA pixels. */
export interface HeicDecodeResult {
  data: Uint8Array
  width: number
  height: number
}

/** Injectable HEIC decoder function type. */
export type HeicDecodeFn = (buffer: Buffer) => Promise<HeicDecodeResult>

/**
 * Default HEIC decoder using the heic-decode package (WASM libheif).
 * Decodes the full tile-grid-assembled image at native resolution.
 */
export async function defaultHeicDecode(buffer: Buffer): Promise<HeicDecodeResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const decode = require('heic-decode') as (opts: { buffer: Buffer }) => Promise<HeicDecodeResult>
  return decode({ buffer })
}

// ---------------------------------------------------------------------------
// HEIC → JPEG conversion
// ---------------------------------------------------------------------------

/** Injectable HEIC converter: reads `src`, writes a JPEG to `dest`. */
export type HeicConverter = (src: string, dest: string, quality: number) => Promise<void>

/**
 * Creates a HeicConverter backed by heic-decode (WASM) + sharp.
 *
 * Decodes the full-resolution HEIC image via libheif, then encodes to JPEG
 * via sharp at the specified quality level.
 *
 * @param decodeFn - Injectable HEIC decoder (defaults to defaultHeicDecode).
 * @param readFile - Injectable file reader (defaults to readFileSync).
 */
export function createHeicConverter(
  decodeFn: HeicDecodeFn = defaultHeicDecode,
  readFile: (path: string) => Buffer = readFileSync
): HeicConverter {
  return async (src: string, dest: string, quality: number): Promise<void> => {
    const buffer = readFile(src)
    const { data, width, height } = await decodeFn(buffer)
    await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
      .jpeg({ quality })
      .toFile(dest)
  }
}

// ---------------------------------------------------------------------------
// Universal pHash computer (HEIC-aware)
// ---------------------------------------------------------------------------

export interface UniversalPhashComputerOptions {
  /** Injectable HEIC decoder (for testing without real WASM). */
  decodeFn?: HeicDecodeFn
  /** Injectable file reader (defaults to readFileSync). */
  readFile?: (path: string) => Buffer
  /** Injectable pHash computer for non-HEIC files (defaults to defaultPhashComputer). */
  computeSharpPhash?: PhashComputer
}

/**
 * Creates a PhashComputer that handles both HEIC/HEIF and regular image files.
 *
 * - HEIC/HEIF: decodes full image via heic-decode (WASM libheif), pipes RGBA
 *   pixels through sharp for resize + greyscale, then computes DCT hash.
 *   This produces a correct full-image pHash (not just tile 0).
 * - All other formats: delegates directly to native sharp.
 *
 * @param options - Injectable dependencies (for testing).
 */
export function createUniversalPhashComputer(
  options: UniversalPhashComputerOptions = {}
): PhashComputer {
  const decodeFn = options.decodeFn ?? defaultHeicDecode
  const readFile = options.readFile ?? readFileSync
  const computeSharpPhash = options.computeSharpPhash ?? defaultPhashComputer

  return async (filePath: string): Promise<PhashResult | null> => {
    if (!isHeicFile(filePath)) {
      return computeSharpPhash(filePath)
    }

    // HEIC path: heic-decode (full image) → sharp raw → greyscale → dctHash
    const buffer = readFile(filePath)
    const { data: rgba, width, height } = await decodeFn(buffer)
    const { data } = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      phash: dctHash(new Uint8Array(data), SAMPLE_SIZE),
      width,
      height
    }
  }
}
