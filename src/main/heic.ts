import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import sharp from 'sharp'
import decode from 'heic-decode'

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
// HEIC → JPEG conversion
// ---------------------------------------------------------------------------

/** Injectable HEIC converter: reads `src`, writes a JPEG to `dest`. */
export type HeicConverter = (src: string, dest: string, quality: number) => Promise<void>

/** Injectable HEIC pixel decoder (defaults to heic-decode). */
export type HeicPixelDecoder = (options: {
  buffer: Buffer | ArrayBuffer | Uint8Array
}) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>

/**
 * Creates a HeicConverter that decodes HEIC via a pixel decoder, then encodes
 * to JPEG via sharp (mozjpeg).
 *
 * sharp's prebuilt binaries do not include the HEVC decoder (patent licensing),
 * so we rely on heic-decode (WebAssembly libde265) for the pixel decoding step.
 *
 * Note: EXIF metadata from the original HEIC is not embedded in the output JPEG.
 * The import pipeline stores metadata (date, GPS, dimensions) in the SQLite
 * database separately via exifreader, so no information is lost.
 *
 * @param decodeHeic - Injectable pixel decoder (defaults to heic-decode).
 * @param readFile   - Injectable file reader (defaults to readFileSync).
 */
export function createHeicConverter(
  decodeHeic: HeicPixelDecoder = decode,
  readFile: (path: string) => Buffer = readFileSync
): HeicConverter {
  return async (src: string, dest: string, quality: number): Promise<void> => {
    const inputBuffer = readFile(src)
    const { data, width, height } = await decodeHeic({ buffer: inputBuffer })
    await sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } })
      .jpeg({ quality })
      .toFile(dest)
  }
}

/** Default converter using heic-decode + sharp. */
export const defaultHeicConverter: HeicConverter = createHeicConverter()

/**
 * Converts a HEIC/HEIF image to JPEG.
 *
 * The conversion runs in a temp directory; moving the result to the library
 * folder is the responsibility of the import pipeline (TASK-010).
 *
 * @param src       - Absolute path to the source HEIC/HEIF file.
 * @param dest      - Absolute path for the output JPEG file.
 * @param quality   - JPEG quality (1–100). Typically from AppConfig.heicConversion.jpegQuality.
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
