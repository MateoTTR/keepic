import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  isLivePhotoVideo,
  isLivePhotoVideoExtension,
  isHeicFile,
  createHeicConverter,
  createUniversalPhashComputer,
  type HeicConverter
} from './heic'
import { readExifDate, defaultExifLoader, type ExifLoader } from './exif'
import { type PhashComputer, type PhashResult } from './phash'
import { getDestinationPath } from '../shared/library-path'
import { withConcurrency, DEFAULT_CONCURRENCY } from './concurrency'
import { getMediaType, type MediaType } from '../shared/media-type'
import type { KeePicDatabase } from './db/database'
import type {
  AppConfig,
  DateSource,
  ImportEntryStatus,
  ImportPlan,
  ImportPlanEntry,
  ImportProgress,
  ImportResult,
  ImportStatus,
  PlanProgress,
  SkippedFile
} from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPORT_MEDIA_EXTENSIONS = new Set([
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
// Helpers
// ---------------------------------------------------------------------------

function isImportableMedia(name: string): boolean {
  return IMPORT_MEDIA_EXTENSIONS.has(extname(name).toLowerCase())
}

const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.picasa.ini'])

function isSystemOrHidden(name: string): boolean {
  if (name.startsWith('.')) return true
  return SYSTEM_FILES.has(name.toLowerCase())
}

/**
 * Finds a free destination path by appending _1, _2, ... _99 to the stem.
 * Returns null if no free slot is found after 99 attempts.
 */
function resolveCollision(
  libraryPath: string,
  destRelPath: string,
  checkExists: (p: string) => boolean = existsSync
): string | null {
  const dir = dirname(destRelPath)
  const name = basename(destRelPath)
  const ext = extname(name)
  const stem = name.slice(0, -ext.length)

  for (let n = 1; n <= 99; n++) {
    const candidate = join(dir, `${stem}_${n}${ext}`)
    if (!checkExists(join(libraryPath, candidate))) {
      return candidate
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Phase 1 — Scan
// ---------------------------------------------------------------------------

/**
 * Recursively walks a source folder and classifies files into:
 * - candidates: supported image files to import
 * - livePhotoVideos: .MOV/.MP4 files identified as Live Photo companions (to discard)
 * - skippedFiles: files that were ignored (Live Photo videos, unrecognized extensions)
 */
export function scanSourceFiles(sourceFolder: string): {
  candidates: string[]
  livePhotoVideos: string[]
  skippedFiles: SkippedFile[]
} {
  const candidates: string[] = []
  const livePhotoVideos: string[] = []
  const skippedFiles: SkippedFile[] = []

  function walk(dir: string): void {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        if (isSystemOrHidden(entry.name)) {
          // Silently skip system/hidden files
        } else if (isLivePhotoVideoExtension(entry.name) && isLivePhotoVideo(fullPath)) {
          livePhotoVideos.push(fullPath)
          skippedFiles.push({ path: fullPath, reason: 'live-photo' })
        } else if (isImportableMedia(entry.name)) {
          candidates.push(fullPath)
        } else {
          skippedFiles.push({
            path: fullPath,
            reason: 'unrecognized-extension',
            extension: extname(entry.name).toLowerCase() || undefined
          })
        }
      }
    }
  }

  walk(sourceFolder)
  return { candidates, livePhotoVideos, skippedFiles }
}

// ---------------------------------------------------------------------------
// Phase 1 — Planning
// ---------------------------------------------------------------------------

export interface PlannerOptions {
  loadExif?: ExifLoader
  computePhash?: PhashComputer
  checkExists?: (path: string) => boolean
  convertHeic?: HeicConverter
  stagingDir?: string
  mkdirp?: (path: string) => void
  concurrency?: number
}

/**
 * Scans a source folder and builds an import plan without writing anything.
 *
 * For each candidate file:
 *   1. Computes pHash and extracts EXIF date
 *   2. Checks for duplicate against the local DB index
 *   3. Computes destination path in the library
 *   4. Detects filename collisions and resolves them with _N suffix
 *
 * The resulting ImportPlan is returned to the renderer for user review
 * before any write operation takes place.
 */
/** Phase 1 result for a single candidate file. */
interface PlanPhase1Result {
  srcPath: string
  phashResult: PhashResult | null
  exifDate: Date
  exifSource: string
  fileSize: number
  destFilename: string
  isConvertHeic: boolean
  mediaType: MediaType
  stagedPath?: string
  errorMessage?: string
}

export async function buildImportPlan(
  sourceFolder: string,
  libraryPath: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: PlanProgress) => void,
  options: PlannerOptions = {}
): Promise<ImportPlan> {
  const loadExif = options.loadExif ?? defaultExifLoader
  const computePhash = options.computePhash ?? createUniversalPhashComputer()
  const checkExists = options.checkExists ?? existsSync
  const convertHeicFn = options.convertHeic ?? createHeicConverter()
  const stagingDir = options.stagingDir ?? join(tmpdir(), `keepic-plan-${randomUUID()}`)
  const mkdirpFn = options.mkdirp ?? ((p: string) => mkdirSync(p, { recursive: true }))
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  let stagingDirCreated = false

  const { candidates, livePhotoVideos, skippedFiles } = scanSourceFiles(sourceFolder)
  const total = candidates.length

  // Initial progress: signal scan complete, Phase 1 starting
  onProgress({ total, processed: 0, currentFile: null })

  // Phase 1: parallel — stat, pHash, EXIF, HEIC staging
  let phase1Processed = 0
  const phase1Results = await withConcurrency(
    candidates,
    concurrency,
    async (srcPath): Promise<PlanPhase1Result> => {
      const stat = statSync(srcPath)
      const mediaType = getMediaType(srcPath)
      const isHeic = isHeicFile(srcPath)
      const convertHeic = isHeic && config.heic.mode === 'convert'

      let phashResult: PhashResult | null = null
      let stagedPath: string | undefined
      let errorMessage: string | undefined

      if (mediaType === 'video') {
        // Videos: skip pHash computation entirely
      } else if (convertHeic) {
        if (!stagingDirCreated) {
          mkdirpFn(stagingDir)
          stagingDirCreated = true
        }
        const srcExt = extname(srcPath).toLowerCase()
        const stagedFilename = `${randomUUID()}-${basename(srcPath, srcExt)}.jpg`
        const candidateStagedPath = join(stagingDir, stagedFilename)
        try {
          await convertHeicFn(srcPath, candidateStagedPath, config.heic.jpegQuality)
          stagedPath = candidateStagedPath
          phashResult = await computePhash(stagedPath)
        } catch (err) {
          phashResult = null
          errorMessage = `HEIC conversion failed: ${err instanceof Error ? err.message : String(err)}`
        }
      } else {
        try {
          phashResult = await computePhash(srcPath)
        } catch (err) {
          phashResult = null
          errorMessage = `pHash computation failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }

      const exifResult = await readExifDate(srcPath, stat.mtime, loadExif)

      const srcBasename = basename(srcPath)
      const srcExt2 = extname(srcPath).toLowerCase()
      const destFilename = convertHeic
        ? srcBasename.slice(0, -srcExt2.length) + '.jpg'
        : srcBasename

      phase1Processed++
      onProgress({ total, processed: phase1Processed, currentFile: srcPath })

      return {
        srcPath,
        phashResult,
        exifDate: exifResult.date,
        exifSource: exifResult.source,
        fileSize: stat.size,
        destFilename,
        isConvertHeic: convertHeic,
        mediaType,
        stagedPath,
        errorMessage
      }
    }
  )

  // Phase 2: sequential — duplicate check, collision resolution, progress
  const entries: ImportPlanEntry[] = []
  const seenDestPaths = new Set<string>()

  for (let i = 0; i < phase1Results.length; i++) {
    const r = phase1Results[i]
    onProgress({ total, processed: i, currentFile: r.srcPath })

    // Check for duplicate in the existing library index
    let status: ImportEntryStatus = r.errorMessage ? 'error' : 'ready'
    let duplicateOf: string | undefined
    let errorMessage = r.errorMessage

    if (r.mediaType === 'video') {
      // Video dedup: filename + file_size
      const match = db.db
        .prepare(
          `SELECT path FROM photos
           WHERE filename = ? AND file_size = ? AND media_type = 'video' AND deleted_at IS NULL
           LIMIT 1`
        )
        .get(basename(r.srcPath), r.fileSize) as { path: string } | undefined
      if (match) {
        status = 'duplicate'
        duplicateOf = match.path
      }
    } else if (r.phashResult?.phash) {
      // Photo dedup: pHash
      const match = db.db
        .prepare('SELECT path FROM photos WHERE phash = ? AND deleted_at IS NULL LIMIT 1')
        .get(r.phashResult.phash) as { path: string } | undefined
      if (match) {
        status = 'duplicate'
        duplicateOf = match.path
      }
    }

    // Compute destination path and resolve collisions (only for non-duplicates)
    let destRelPath = getDestinationPath(r.exifDate, r.destFilename)
    let originalDestination: string | undefined

    if (status === 'ready') {
      // Check both filesystem and already-claimed paths in this plan
      const destAbsPath = join(libraryPath, destRelPath)
      if (checkExists(destAbsPath) || seenDestPaths.has(destRelPath)) {
        const resolved = resolveCollision(
          libraryPath,
          destRelPath,
          (p) =>
            checkExists(p) ||
            seenDestPaths.has(p.replace(libraryPath + '/', '').replace(libraryPath + '\\', ''))
        )
        if (resolved === null) {
          status = 'error'
          errorMessage = `No free filename slot found after 99 attempts for ${r.destFilename}`
        } else {
          originalDestination = destRelPath
          destRelPath = resolved
          status = 'collision'
        }
      }
    }

    if (status === 'ready' || status === 'collision') {
      seenDestPaths.add(destRelPath)
    }

    entries.push({
      sourcePath: r.srcPath,
      destinationRelativePath: destRelPath,
      dateTaken: r.exifDate.toISOString(),
      dateTakenSource: r.exifSource as DateSource,
      phash: r.phashResult?.phash ?? null,
      width: r.phashResult?.width ?? null,
      height: r.phashResult?.height ?? null,
      fileSize: r.fileSize,
      status,
      duplicateOf,
      originalDestination,
      errorMessage,
      stagedPath: r.stagedPath,
      mediaType: r.mediaType
    })

    onProgress({ total, processed: i + 1, currentFile: r.srcPath })
  }

  return {
    entries,
    livePhotosDiscarded: livePhotoVideos.length,
    sourceFolder,
    skippedFiles
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — Execution (DB helpers)
// ---------------------------------------------------------------------------

function createImportJob(db: KeePicDatabase, source: string, now: string): number {
  const result = db.db
    .prepare(
      `INSERT INTO import_jobs
         (source, started_at, status, photos_imported, photos_skipped, live_photos_discarded)
       VALUES (?, ?, 'running', 0, 0, 0)`
    )
    .run(source, now)
  return result.lastInsertRowid as number
}

function updateImportJob(
  db: KeePicDatabase,
  jobId: number,
  params: {
    status: ImportStatus
    imported: number
    skipped: number
    livePhotosDiscarded: number
    finishedAt: string
  }
): void {
  db.db
    .prepare(
      `UPDATE import_jobs
       SET status = ?, photos_imported = ?, photos_skipped = ?,
           live_photos_discarded = ?, finished_at = ?
       WHERE id = ?`
    )
    .run(
      params.status,
      params.imported,
      params.skipped,
      params.livePhotosDiscarded,
      params.finishedAt,
      jobId
    )
}

function upsertImportedPhoto(
  db: KeePicDatabase,
  params: {
    relativePath: string
    filename: string
    phash: string | null
    dateTaken: string
    dateTakenSource: string
    width: number | null
    height: number | null
    fileSize: number
    fileMtime: string
    mediaType: MediaType
    now: string
    jobId: number
  }
): void {
  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, phash, date_taken, date_taken_source,
          width, height, file_size, file_mtime, source,
          google_id, imported_at, created_at, deleted_at, media_type, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?, ?, NULL, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         phash             = excluded.phash,
         date_taken        = excluded.date_taken,
         date_taken_source = excluded.date_taken_source,
         width             = excluded.width,
         height            = excluded.height,
         file_size         = excluded.file_size,
         file_mtime        = excluded.file_mtime,
         media_type        = excluded.media_type,
         job_id            = excluded.job_id,
         deleted_at        = NULL`
    )
    .run(
      params.relativePath,
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
      params.mediaType,
      params.jobId
    )
}

// ---------------------------------------------------------------------------
// Phase 2 — Execution
// ---------------------------------------------------------------------------

/**
 * Move a file, falling back to copy+unlink when source and destination
 * are on different devices/partitions (EXDEV).
 */
export function moveFileAcrossDevices(
  src: string,
  dest: string,
  deps?: { rename: typeof renameSync; copy: typeof copyFileSync; unlink: typeof unlinkSync }
): void {
  const { rename, copy, unlink } = deps ?? { rename: renameSync, copy: copyFileSync, unlink: unlinkSync }
  try {
    rename(src, dest)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EXDEV') {
      copy(src, dest)
      unlink(src)
    } else {
      throw err
    }
  }
}

export interface ExecutorOptions {
  convertHeic?: HeicConverter
  copyFile?: (src: string, dest: string) => void
  moveFile?: (src: string, dest: string) => void
  mkdirp?: (path: string) => void
  statFile?: (path: string) => { size: number; mtime: Date }
  rmTempDir?: (path: string) => void
  rmStagedFile?: (path: string) => void
  isCancelled?: () => boolean
  concurrency?: number
}

/**
 * Executes a confirmed ImportPlan: stages each file to a temp directory,
 * then moves it to the appropriate monthly folder in the shared library.
 *
 * - Entries with status 'duplicate' are skipped (counted in skipped).
 * - Entries with status 'error' are added to ImportResult.errors.
 * - The temp directory is always cleaned up on completion or failure.
 * - No source file is ever modified.
 */
/** Phase 1 result for a single executor entry. */
interface ExecuteFileResult {
  entry: ImportPlanEntry
  fileStat?: { size: number; mtime: Date }
  error?: string
}

export async function executeImportPlan(
  plan: ImportPlan,
  libraryPath: string,
  tempDir: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: ImportProgress) => void,
  options: ExecutorOptions = {}
): Promise<ImportResult> {
  const convertHeicFn = options.convertHeic ?? createHeicConverter()
  const copyFileFn = options.copyFile ?? ((src, dest) => copyFileSync(src, dest))
  const moveFileFn = options.moveFile ?? moveFileAcrossDevices
  const mkdirpFn = options.mkdirp ?? ((p) => mkdirSync(p, { recursive: true }))
  const statFileFn = options.statFile ?? ((p) => statSync(p))
  const rmTempDirFn = options.rmTempDir ?? ((p) => rmSync(p, { recursive: true, force: true }))
  const rmStagedFileFn = options.rmStagedFile ?? ((p) => rmSync(p, { force: true }))
  const isCancelled = options.isCancelled ?? (() => false)
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  const now = new Date().toISOString()
  const jobId = createImportJob(db, 'local', now)

  mkdirpFn(tempDir)

  const entriesToProcess = plan.entries.filter(
    (e) => e.status === 'ready' || e.status === 'collision'
  )
  const duplicates = plan.entries.filter((e) => e.status === 'duplicate')
  const duplicateCount = duplicates.length
  const skippedPhotos = duplicates.filter((e) => e.mediaType === 'photo').length
  const skippedVideos = duplicates.filter((e) => e.mediaType === 'video').length
  const errors: Array<{ sourcePath: string; error: string }> = []

  // Pre-collect planning errors
  for (const entry of plan.entries.filter((e) => e.status === 'error')) {
    errors.push({
      sourcePath: entry.sourcePath,
      error: entry.errorMessage ?? 'Planning error'
    })
  }

  const total = entriesToProcess.length
  let imported = 0
  let importedPhotos = 0
  let importedVideos = 0
  let status: ImportStatus = 'completed'

  // Initial progress: signal Phase 1 starting
  onProgress({
    total,
    processed: 0,
    imported: 0,
    skipped: duplicateCount,
    duplicates: duplicateCount,
    livePhotosDiscarded: plan.livePhotosDiscarded,
    currentFile: null
  })

  // Phase 1: parallel — copy/convert/move files to library
  // Each worker checks isCancelled() before processing its entry
  let phase1Processed = 0
  const phase1Results = await withConcurrency(
    entriesToProcess,
    concurrency,
    async (entry): Promise<ExecuteFileResult> => {
      if (isCancelled()) {
        return { entry, error: undefined }
      }

      try {
        const isHeic = isHeicFile(entry.sourcePath)
        const doConvert = isHeic && config.heic.mode === 'convert'

        const destAbsPath = join(libraryPath, entry.destinationRelativePath)

        if (entry.stagedPath) {
          mkdirpFn(dirname(destAbsPath))
          moveFileFn(entry.stagedPath, destAbsPath)
        } else {
          const tempFilename = `${randomUUID()}-${basename(entry.destinationRelativePath)}`
          const tempPath = join(tempDir, tempFilename)

          if (doConvert) {
            await convertHeicFn(entry.sourcePath, tempPath, config.heic.jpegQuality)
          } else {
            copyFileFn(entry.sourcePath, tempPath)
          }

          mkdirpFn(dirname(destAbsPath))
          moveFileFn(tempPath, destAbsPath)
        }

        const fileStat = statFileFn(destAbsPath)
        phase1Processed++
        onProgress({
          total,
          processed: phase1Processed,
          imported: 0,
          skipped: duplicateCount,
          duplicates: duplicateCount,
          livePhotosDiscarded: plan.livePhotosDiscarded,
          currentFile: entry.sourcePath
        })
        return { entry, fileStat }
      } catch (err) {
        phase1Processed++
        onProgress({
          total,
          processed: phase1Processed,
          imported: 0,
          skipped: duplicateCount,
          duplicates: duplicateCount,
          livePhotosDiscarded: plan.livePhotosDiscarded,
          currentFile: entry.sourcePath
        })
        return {
          entry,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  // Phase 2: sequential — DB upserts + progress reporting
  for (let i = 0; i < phase1Results.length; i++) {
    const result = phase1Results[i]

    // Report "before" progress
    onProgress({
      total,
      processed: i,
      imported,
      skipped: duplicateCount,
      duplicates: duplicateCount,
      livePhotosDiscarded: plan.livePhotosDiscarded,
      currentFile: result.entry.sourcePath
    })

    if (isCancelled() && !result.fileStat) {
      // This entry was not processed due to cancellation
      status = 'cancelled'
    } else if (result.error) {
      errors.push({
        sourcePath: result.entry.sourcePath,
        error: result.error
      })
    } else if (result.fileStat) {
      const importedAt = new Date().toISOString()
      upsertImportedPhoto(db, {
        relativePath: result.entry.destinationRelativePath,
        filename: basename(result.entry.destinationRelativePath),
        phash: result.entry.phash,
        dateTaken: result.entry.dateTaken,
        dateTakenSource: result.entry.dateTakenSource,
        width: result.entry.width,
        height: result.entry.height,
        fileSize: result.fileStat.size,
        fileMtime: result.fileStat.mtime.toISOString(),
        mediaType: result.entry.mediaType,
        now: importedAt,
        jobId
      })
      imported++
      if (result.entry.mediaType === 'video') importedVideos++
      else importedPhotos++
    }

    // Report "after" progress
    onProgress({
      total,
      processed: i + 1,
      imported,
      skipped: duplicateCount,
      duplicates: duplicateCount,
      livePhotosDiscarded: plan.livePhotosDiscarded,
      currentFile: result.entry.sourcePath
    })
  }

  // Cleanup
  for (const entry of entriesToProcess) {
    if (entry.stagedPath) {
      try {
        rmStagedFileFn(entry.stagedPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  try {
    rmTempDirFn(tempDir)
  } catch {
    // Ignore cleanup errors — temp files will be removed on next OS cleanup
  }

  const finishedAt = new Date().toISOString()
  updateImportJob(db, jobId, {
    status,
    imported,
    skipped: duplicateCount,
    livePhotosDiscarded: plan.livePhotosDiscarded,
    finishedAt
  })

  // Build skippedFiles: start with planner-collected skipped files, add execution errors
  const allSkippedFiles: SkippedFile[] = [...plan.skippedFiles]
  for (const err of errors) {
    allSkippedFiles.push({ path: err.sourcePath, reason: 'error' })
  }

  return {
    imported,
    importedPhotos,
    importedVideos,
    skipped: duplicateCount,
    skippedPhotos,
    skippedVideos,
    livePhotosDiscarded: plan.livePhotosDiscarded,
    errors,
    status,
    skippedFiles: allSkippedFiles
  }
}
