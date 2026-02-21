import { existsSync } from 'fs'
import { extname } from 'path'
import sharp from 'sharp'

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

/**
 * Default converter using sharp.
 * EXIF metadata (date, GPS, orientation…) is preserved via `.withMetadata()`.
 * Throws on any sharp error; the caller is responsible for error handling.
 */
export const defaultHeicConverter: HeicConverter = async (
  src: string,
  dest: string,
  quality: number
): Promise<void> => {
  await sharp(src).jpeg({ quality }).withMetadata().toFile(dest)
}

/**
 * Converts a HEIC/HEIF image to JPEG, preserving EXIF metadata.
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
