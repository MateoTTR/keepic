import { readdirSync, statSync, type Dirent } from 'fs'
import { join, basename, extname } from 'path'
import { isYearFolder } from '../shared/library-path'
import { readExifDate, defaultExifLoader, type ExifLoader } from './exif'
import { type PhashComputer, type PhashResult } from './phash'
import { createUniversalPhashComputer } from './heic'
import { withConcurrency, DEFAULT_CONCURRENCY } from './concurrency'
import { getMediaType, type MediaType } from '../shared/media-type'
import type { KeePicDatabase } from './db/database'
import type { IndexProgress, IndexResult, SkippedFile } from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.heic',
  '.heif',
  '.png',
  '.tiff',
  '.tif',
  '.cr2',
  '.nef',
  '.arw',
  '.mp4',
  '.mov',
  '.avi',
  '.mts',
  '.3gp',
  '.m4v',
  '.mpg'
])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isMediaFile(name: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(name).toLowerCase())
}

const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.picasa.ini'])

function isSystemOrHidden(name: string): boolean {
  if (name.startsWith('.')) return true
  return SYSTEM_FILES.has(name.toLowerCase())
}

/**
 * Recursively walks the library folder structure and collects all image files.
 * Only descends into year folders (`\d{4}`) at the root level.
 * Returns an array of relative paths: "YYYY/subfolder/filename".
 */
export function scanLibraryFiles(libraryPath: string): {
  files: string[]
  skippedFiles: SkippedFile[]
} {
  const files: string[] = []
  const skippedFiles: SkippedFile[] = []
  let entries: Dirent<string>[]

  try {
    entries = readdirSync(libraryPath, { withFileTypes: true })
  } catch {
    return { files, skippedFiles }
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
        if (!fileEntry.isFile()) continue
        const relativePath = `${yearEntry.name}/${subEntry.name}/${fileEntry.name}`
        if (isSystemOrHidden(fileEntry.name)) {
          // Silently skip system/hidden files
        } else if (isMediaFile(fileEntry.name)) {
          files.push(relativePath)
        } else {
          skippedFiles.push({
            path: relativePath,
            reason: 'unrecognized-extension',
            extension: extname(fileEntry.name).toLowerCase() || undefined
          })
        }
      }
    }
  }

  return { files, skippedFiles }
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
    mediaType: MediaType
    now: string
  }
): void {
  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, phash, date_taken, date_taken_source,
          width, height, file_size, file_mtime, source,
          google_id, imported_at, created_at, deleted_at, media_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?, ?, NULL, ?)
       ON CONFLICT(path) DO UPDATE SET
         phash             = excluded.phash,
         date_taken        = excluded.date_taken,
         date_taken_source = excluded.date_taken_source,
         width             = excluded.width,
         height            = excluded.height,
         file_size         = excluded.file_size,
         file_mtime        = excluded.file_mtime,
         media_type        = excluded.media_type,
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
      params.now,
      params.mediaType
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
  concurrency?: number
}

/** Result of Phase 1 processing for a single file. */
interface IndexFileResult {
  relativePath: string
  mediaType: MediaType
  skipped:
    | true
    | {
        absolutePath: string
        phashResult: PhashResult | null
        exifDate: Date
        exifSource: string
        fileSize: number
        fileMtime: string
        error?: { file: string; error: string }
      }
}

/**
 * Scans the shared library folder and upserts records into the local SQLite index.
 *
 * Uses a two-phase approach for performance:
 * - Phase 1 (parallel): stat + mtime check + pHash + EXIF (CPU-bound, N workers)
 * - Phase 2 (sequential): DB upserts + progress reporting (must be ordered)
 *
 * @param libraryPath - Absolute path to the shared library root.
 * @param db          - Open KeePicDatabase instance.
 * @param onProgress  - Called after each processed file.
 * @param options     - Injectable ExifLoader, PhashComputer, and concurrency level.
 */
export async function runIndexer(
  libraryPath: string,
  db: KeePicDatabase,
  onProgress: (progress: IndexProgress) => void,
  options: RunIndexerOptions = {}
): Promise<IndexResult> {
  const loadExif = options.loadExif ?? defaultExifLoader
  const computePhash = options.computePhash ?? createUniversalPhashComputer()
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  const { files: relativePaths, skippedFiles } = scanLibraryFiles(libraryPath)
  const total = relativePaths.length

  // Initial progress: signal scan complete, Phase 1 starting
  onProgress({ total, processed: 0, indexed: 0, skipped: 0 })

  // Phase 1: parallel — stat, mtime check (DB read), pHash, EXIF
  let phase1Processed = 0
  const phase1Results = await withConcurrency(
    relativePaths,
    concurrency,
    async (relativePath): Promise<IndexFileResult> => {
      const absolutePath = join(libraryPath, relativePath)
      const mediaType = getMediaType(relativePath)
      const stat = statSync(absolutePath)
      const fileMtime = stat.mtime.toISOString()

      const storedMtime = getStoredMtime(db, relativePath)
      if (storedMtime === fileMtime) {
        phase1Processed++
        onProgress({ total, processed: phase1Processed, indexed: 0, skipped: 0 })
        return { relativePath, mediaType, skipped: true }
      }

      let phashResult: PhashResult | null = null
      let error: { file: string; error: string } | undefined
      if (mediaType !== 'video') {
        try {
          phashResult = await computePhash(absolutePath)
        } catch (err) {
          error = {
            file: relativePath,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      }

      const exifResult = await readExifDate(relativePath, stat.mtime, loadExif)

      phase1Processed++
      onProgress({ total, processed: phase1Processed, indexed: 0, skipped: 0 })

      return {
        relativePath,
        mediaType,
        skipped: {
          absolutePath,
          phashResult,
          exifDate: exifResult.date,
          exifSource: exifResult.source,
          fileSize: stat.size,
          fileMtime,
          error
        }
      }
    }
  )

  // Phase 2: sequential — DB writes + progress reporting
  const presentPaths = new Set<string>()
  const errors: Array<{ file: string; error: string }> = []
  let indexed = 0
  let indexedPhotos = 0
  let indexedVideos = 0
  let skipped = 0

  for (let i = 0; i < phase1Results.length; i++) {
    const result = phase1Results[i]
    presentPaths.add(result.relativePath)

    if (result.skipped === true) {
      skipped++
    } else {
      const data = result.skipped
      if (data.error) {
        errors.push(data.error)
      }

      const now = new Date().toISOString()
      upsertPhoto(db, {
        path: result.relativePath,
        filename: basename(result.relativePath),
        phash: data.phashResult?.phash ?? null,
        dateTaken: data.exifDate.toISOString(),
        dateTakenSource: data.exifSource,
        width: data.phashResult?.width ?? null,
        height: data.phashResult?.height ?? null,
        fileSize: data.fileSize,
        fileMtime: data.fileMtime,
        mediaType: result.mediaType,
        now
      })
      indexed++
      if (result.mediaType === 'video') indexedVideos++
      else indexedPhotos++
    }

    onProgress({ total, processed: i + 1, indexed, skipped })
  }

  const now = new Date().toISOString()
  const deleted = markDeleted(db, presentPaths, now)

  // Add indexing errors to skipped files
  const allSkippedFiles: SkippedFile[] = [...skippedFiles]
  for (const err of errors) {
    allSkippedFiles.push({ path: err.file, reason: 'error' })
  }

  return { indexed, indexedPhotos, indexedVideos, skipped, deleted, errors, skippedFiles: allSkippedFiles }
}
