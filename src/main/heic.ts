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
 * Returns the candidate photo companion paths for a given video file.
 * Replaces the video extension with .heic, .heif, .jpg, .jpeg (lowercase).
 * On case-insensitive filesystems (Windows/macOS), lowercase lookups are
 * sufficient to match uppercase extensions such as .HEIC or .JPG.
 *
 * Example: '/photos/IMG_1234.MOV' → ['/photos/IMG_1234.heic', '/photos/IMG_1234.heif', '/photos/IMG_1234.jpg', '/photos/IMG_1234.jpeg']
 */
export function getPhotoCandidatePaths(videoPath: string): string[] {
  const stem = videoPath.slice(0, -extname(videoPath).length)
  return [stem + '.heic', stem + '.heif', stem + '.jpg', stem + '.jpeg']
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

const LIVE_PHOTO_VIDEO_EXTENSIONS = new Set(['.mp4'])

/**
 * Returns true if the file extension is a potential Live Photo video companion.
 */
export function isLivePhotoVideoExtension(name: string): boolean {
  return LIVE_PHOTO_VIDEO_EXTENSIONS.has(extname(name).toLowerCase())
}

/**
 * Returns true if `videoPath` is the video component of an iPhone Live Photo.
 *
 * A .MP4 file is a Live Photo companion when a photo still image
 * (.heic, .heif, .jpg, .jpeg) with the same stem exists in the same directory.
 *
 * @param videoPath   - Absolute path to the video file to check.
 * @param checkExists - Injectable existence checker (defaults to existsSync).
 */
export function isLivePhotoVideo(
  videoPath: string,
  checkExists: ExistsChecker = existsSync
): boolean {
  if (!isLivePhotoVideoExtension(videoPath)) return false
  return getPhotoCandidatePaths(videoPath).some(checkExists)
}

// ---------------------------------------------------------------------------
// HEIC full-image decode via @keepic/heif-decode (native N-API, static libheif)
// ---------------------------------------------------------------------------

/** Result of decoding a HEIC file to raw RGBA pixels. */
export interface HeicDecodeResult {
  data: Uint8Array
  width: number
  height: number
}

/** Injectable HEIC decoder function type. */
export type HeicDecodeFn = (buffer: Buffer) => Promise<HeicDecodeResult>

interface LibheifModule {
  decode(buffer: Buffer): Buffer
  getInfo(buffer: Buffer): { width: number; height: number }
}

let _libheif: LibheifModule | undefined

function getLibheif(): LibheifModule {
  if (!_libheif) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _libheif = require('@keepic/heif-decode') as LibheifModule
  }
  return _libheif
}

/**
 * Default HEIC decoder using the @keepic/heif-decode native N-API addon.
 * Decodes the full tile-grid-assembled image at native resolution.
 *
 * This is synchronous under the hood (blocks the calling thread).
 * For parallel decoding, use a HeicDecodePool instead.
 */
export async function defaultHeicDecode(buffer: Buffer): Promise<HeicDecodeResult> {
  const libheif = getLibheif()
  const info = libheif.getInfo(buffer)
  const data = libheif.decode(buffer)
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
}

// ---------------------------------------------------------------------------
// HEIC → JPEG conversion
// ---------------------------------------------------------------------------

/** Injectable HEIC converter: reads `src`, writes a JPEG to `dest`. */
export type HeicConverter = (src: string, dest: string, quality: number) => Promise<void>

/**
 * Creates a HeicConverter backed by @keepic/heif-decode (native N-API) + sharp.
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
 * - HEIC/HEIF: decodes full image via @keepic/heif-decode (native N-API), pipes RGBA
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
