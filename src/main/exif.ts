import ExifReader from 'exifreader'
import { basename } from 'path'
import type { DateSource } from '../shared/types'

export type ExifTags = Awaited<ReturnType<typeof ExifReader.load>>

/** Injectable function type for loading EXIF tags from a file path. */
export type ExifLoader = (filePath: string) => Promise<ExifTags | null>

// ---------------------------------------------------------------------------
// Pure functions (testable without file I/O)
// ---------------------------------------------------------------------------

/**
 * Parses an EXIF date string in the canonical format "YYYY:MM:DD HH:MM:SS".
 * Returns null if the string is missing, malformed, or represents an invalid date.
 */
export function parseExifDateString(str: string | undefined): Date | null {
  if (!str) return null
  // EXIF canonical format: "YYYY:MM:DD HH:MM:SS"
  const match = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, min, sec] = match.map(Number)
  // Month is 0-indexed in Date constructor
  const d = new Date(year, month - 1, day, hour, min, sec)
  // Guard against invalid dates and silent month overflow (e.g., month=13 → January next year)
  if (isNaN(d.getTime()) || d.getMonth() !== month - 1) return null
  return d
}

/**
 * Extracts a capture date from a filename using common camera/phone naming patterns.
 * Supports: YYYYMMDD, YYYY-MM-DD, YYYY_MM_DD (optionally followed by time).
 * Returns null if no recognisable date pattern is found.
 */
export function extractDateFromFilename(name: string): Date | null {
  const match = name.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

/**
 * Extracts the best available date from a parsed ExifTags object.
 * Priority: DateTimeOriginal → DateTime.
 * Returns null if neither tag is present or parseable.
 */
export function extractDateFromTags(tags: ExifTags): Date | null {
  const dto = (tags['DateTimeOriginal'] as { description?: string } | undefined)?.description
  const parsed = parseExifDateString(dto)
  if (parsed) return parsed

  const dt = (tags['DateTime'] as { description?: string } | undefined)?.description
  return parseExifDateString(dt)
}

// ---------------------------------------------------------------------------
// File I/O (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Default ExifLoader: reads EXIF tags from a file using exifreader.
 * Returns null on any error (unreadable file, unsupported format, no EXIF).
 */
export async function defaultExifLoader(filePath: string): Promise<ExifTags | null> {
  try {
    return await ExifReader.load(filePath, { async: true })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExifDateResult {
  date: Date
  source: DateSource
}

/**
 * Determines the best available capture date for an image file.
 * Applies the following fallback chain (per spec §2.6):
 *   1. EXIF DateTimeOriginal
 *   2. EXIF DateTime
 *   3. Filename pattern
 *   4. File modification time
 *
 * @param filePath  - Absolute path to the image file.
 * @param mtime     - File modification time (from fs.stat).
 * @param loadExif  - Injectable EXIF loader (defaults to defaultExifLoader).
 */
export async function readExifDate(
  filePath: string,
  mtime: Date,
  loadExif: ExifLoader = defaultExifLoader
): Promise<ExifDateResult> {
  const tags = await loadExif(filePath)
  if (tags) {
    const exifDate = extractDateFromTags(tags)
    if (exifDate) return { date: exifDate, source: 'exif' }
  }

  const filenameDate = extractDateFromFilename(basename(filePath))
  if (filenameDate) return { date: filenameDate, source: 'filename' }

  return { date: mtime, source: 'file_mtime' }
}
