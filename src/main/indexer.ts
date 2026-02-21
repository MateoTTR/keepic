import { readdirSync, statSync, type Dirent } from 'fs'
import { join, basename, extname } from 'path'
import { isYearFolder } from '../shared/library-path'
import { readExifDate, defaultExifLoader, type ExifLoader } from './exif'
import { defaultPhashComputer, type PhashComputer } from './phash'
import type { KeePicDatabase } from './db/database'
import type { IndexProgress, IndexResult } from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.heic',
  '.heif',
  '.png',
  '.tiff',
  '.tif',
  '.cr2',
  '.nef',
  '.arw'
])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(name).toLowerCase())
}

/**
 * Recursively walks the library folder structure and collects all image files.
 * Only descends into year folders (`\d{4}`) at the root level.
 * Returns an array of relative paths: "YYYY/subfolder/filename".
 */
export function scanLibraryFiles(libraryPath: string): string[] {
  const files: string[] = []
  let entries: Dirent<string>[]

  try {
    entries = readdirSync(libraryPath, { withFileTypes: true })
  } catch {
    return files
  }

  for (const yearEntry of entries) {
    if (!yearEntry.isDirectory() || !isYearFolder(yearEntry.name)) continue

    const yearDir = join(libraryPath, yearEntry.name)
    let subEntries: Dirent<string>[]
    try {
      subEntries = readdirSync(yearDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue

      const subDir = join(yearDir, subEntry.name)
      let fileEntries: Dirent<string>[]
      try {
        fileEntries = readdirSync(subDir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const fileEntry of fileEntries) {
        if (fileEntry.isFile() && isImageFile(fileEntry.name)) {
          files.push(`${yearEntry.name}/${subEntry.name}/${fileEntry.name}`)
        }
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface StoredPhoto {
  file_mtime: string | null
}

function getStoredMtime(db: KeePicDatabase, relativePath: string): string | null {
  const row = db.db.prepare('SELECT file_mtime FROM photos WHERE path = ?').get(relativePath) as
    | StoredPhoto
    | undefined
  return row?.file_mtime ?? null
}

function upsertPhoto(
  db: KeePicDatabase,
  params: {
    path: string
    filename: string
    phash: string | null
    dateTaken: string | null
    dateTakenSource: string | null
    width: number | null
    height: number | null
    fileSize: number
    fileMtime: string
    now: string
  }
): void {
  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, phash, date_taken, date_taken_source,
          width, height, file_size, file_mtime, source,
          google_id, imported_at, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?, ?, NULL)
       ON CONFLICT(path) DO UPDATE SET
         phash             = excluded.phash,
         date_taken        = excluded.date_taken,
         date_taken_source = excluded.date_taken_source,
         width             = excluded.width,
         height            = excluded.height,
         file_size         = excluded.file_size,
         file_mtime        = excluded.file_mtime,
         deleted_at        = NULL`
    )
    .run(
      params.path,
      params.filename,
      params.phash,
      params.dateTaken,
      params.dateTakenSource,
      params.width,
      params.height,
      params.fileSize,
      params.fileMtime,
      params.now,
      params.now
    )
}

function markDeleted(db: KeePicDatabase, presentPaths: Set<string>, now: string): number {
  // Fetch all non-deleted paths from DB
  const rows = db.db.prepare('SELECT path FROM photos WHERE deleted_at IS NULL').all() as {
    path: string
  }[]

  let count = 0
  for (const { path } of rows) {
    if (!presentPaths.has(path)) {
      db.db.prepare('UPDATE photos SET deleted_at = ? WHERE path = ?').run(now, path)
      count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunIndexerOptions {
  loadExif?: ExifLoader
  computePhash?: PhashComputer
}

/**
 * Scans the shared library folder and upserts records into the local SQLite index.
 *
 * - Files whose path + mtime are unchanged are skipped.
 * - Files on disk whose DB record was previously marked deleted are revived.
 * - Files in the DB that are no longer on disk are marked with `deleted_at`.
 *
 * @param libraryPath - Absolute path to the shared library root.
 * @param db          - Open KeePicDatabase instance.
 * @param onProgress  - Called after each processed file.
 * @param options     - Injectable ExifLoader and PhashComputer (for testing).
 */
export async function runIndexer(
  libraryPath: string,
  db: KeePicDatabase,
  onProgress: (progress: IndexProgress) => void,
  options: RunIndexerOptions = {}
): Promise<IndexResult> {
  const loadExif = options.loadExif ?? defaultExifLoader
  const computePhash = options.computePhash ?? defaultPhashComputer

  const relativePaths = scanLibraryFiles(libraryPath)
  const total = relativePaths.length
  const presentPaths = new Set<string>()

  let indexed = 0
  let skipped = 0

  for (let i = 0; i < relativePaths.length; i++) {
    const relativePath = relativePaths[i]
    presentPaths.add(relativePath)

    const absolutePath = join(libraryPath, relativePath)
    const stat = statSync(absolutePath)
    const fileMtime = stat.mtime.toISOString()

    const storedMtime = getStoredMtime(db, relativePath)
    if (storedMtime === fileMtime) {
      skipped++
      onProgress({ total, processed: i + 1, indexed, skipped })
      continue
    }

    // Process the file
    const phashResult = await computePhash(absolutePath)
    const exifResult = await readExifDate(relativePath, stat.mtime, loadExif)

    const now = new Date().toISOString()
    upsertPhoto(db, {
      path: relativePath,
      filename: basename(relativePath),
      phash: phashResult?.phash ?? null,
      dateTaken: exifResult.date.toISOString(),
      dateTakenSource: exifResult.source,
      width: phashResult?.width ?? null,
      height: phashResult?.height ?? null,
      fileSize: stat.size,
      fileMtime,
      now
    })
    indexed++
    onProgress({ total, processed: i + 1, indexed, skipped })
  }

  const now = new Date().toISOString()
  const deleted = markDeleted(db, presentPaths, now)

  return { indexed, skipped, deleted }
}
