import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { isLivePhotoMov, defaultHeicConverter, type HeicConverter } from './heic'
import { readExifDate, defaultExifLoader, type ExifLoader } from './exif'
import { defaultPhashComputer, type PhashComputer, type PhashResult } from './phash'
import { getDestinationPath } from '../shared/library-path'
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
  PlanProgress
} from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPORT_EXTENSIONS = new Set([
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
// Helpers
// ---------------------------------------------------------------------------

function isImportable(name: string): boolean {
  return IMPORT_EXTENSIONS.has(extname(name).toLowerCase())
}

function isMovFile(name: string): boolean {
  return extname(name).toLowerCase() === '.mov'
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
 * - livePhotoMovs: .MOV files identified as Live Photo companions (to discard)
 */
export function scanSourceFiles(sourceFolder: string): {
  candidates: string[]
  livePhotoMovs: string[]
} {
  const candidates: string[] = []
  const livePhotoMovs: string[] = []

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
        if (isImportable(entry.name)) {
          candidates.push(fullPath)
        } else if (isMovFile(entry.name) && isLivePhotoMov(fullPath)) {
          livePhotoMovs.push(fullPath)
        }
      }
    }
  }

  walk(sourceFolder)
  return { candidates, livePhotoMovs }
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
export async function buildImportPlan(
  sourceFolder: string,
  libraryPath: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: PlanProgress) => void,
  options: PlannerOptions = {}
): Promise<ImportPlan> {
  const loadExif = options.loadExif ?? defaultExifLoader
  const computePhash = options.computePhash ?? defaultPhashComputer
  const checkExists = options.checkExists ?? existsSync
  const convertHeicFn = options.convertHeic ?? defaultHeicConverter
  const stagingDir = options.stagingDir ?? join(tmpdir(), `keepic-plan-${randomUUID()}`)
  const mkdirpFn = options.mkdirp ?? ((p: string) => mkdirSync(p, { recursive: true }))

  let stagingDirCreated = false

  const { candidates, livePhotoMovs } = scanSourceFiles(sourceFolder)
  const total = candidates.length
  const entries: ImportPlanEntry[] = []

  for (let i = 0; i < candidates.length; i++) {
    const srcPath = candidates[i]
    onProgress({ total, processed: i, currentFile: srcPath })

    const stat = statSync(srcPath)
    const srcExt = extname(srcPath).toLowerCase()
    const isHeic = srcExt === '.heic' || srcExt === '.heif'
    const convertHeic = isHeic && config.heicConversion.enabled

    let phashResult: PhashResult | null
    let stagedPath: string | undefined

    if (convertHeic) {
      // Stage HEIC → JPEG once in planner; compute pHash from the staged JPEG.
      // The executor will then move the staged file instead of re-converting.
      if (!stagingDirCreated) {
        mkdirpFn(stagingDir)
        stagingDirCreated = true
      }
      const stagedFilename = `${randomUUID()}-${basename(srcPath, srcExt)}.jpg`
      const candidateStagedPath = join(stagingDir, stagedFilename)
      try {
        await convertHeicFn(srcPath, candidateStagedPath, config.heicConversion.jpegQuality)
        stagedPath = candidateStagedPath
        phashResult = await computePhash(stagedPath)
      } catch {
        // Staging failed — fall back to no staging; executor will retry conversion
        phashResult = null
      }
    } else {
      phashResult = await computePhash(srcPath)
    }

    // Extract capture date via EXIF fallback chain
    const exifResult = await readExifDate(srcPath, stat.mtime, loadExif)

    // Determine destination filename (rename HEIC → JPG if conversion enabled)
    const srcBasename = basename(srcPath)
    const destFilename = convertHeic ? srcBasename.slice(0, -srcExt.length) + '.jpg' : srcBasename

    // Check for duplicate (pHash match in the existing library index)
    let status: ImportEntryStatus = 'ready'
    let duplicateOf: string | undefined

    if (phashResult?.phash) {
      const match = db.db
        .prepare('SELECT path FROM photos WHERE phash = ? AND deleted_at IS NULL LIMIT 1')
        .get(phashResult.phash) as { path: string } | undefined
      if (match) {
        status = 'duplicate'
        duplicateOf = match.path
      }
    }

    // Compute destination path and resolve collisions (only for non-duplicates)
    let destRelPath = getDestinationPath(exifResult.date, destFilename)
    let originalDestination: string | undefined
    let errorMessage: string | undefined

    if (status === 'ready') {
      if (checkExists(join(libraryPath, destRelPath))) {
        const resolved = resolveCollision(libraryPath, destRelPath, checkExists)
        if (resolved === null) {
          status = 'error'
          errorMessage = `No free filename slot found after 99 attempts for ${destFilename}`
        } else {
          originalDestination = destRelPath
          destRelPath = resolved
          status = 'collision'
        }
      }
    }

    entries.push({
      sourcePath: srcPath,
      destinationRelativePath: destRelPath,
      dateTaken: exifResult.date.toISOString(),
      dateTakenSource: exifResult.source as DateSource,
      phash: phashResult?.phash ?? null,
      width: phashResult?.width ?? null,
      height: phashResult?.height ?? null,
      fileSize: stat.size,
      status,
      duplicateOf,
      originalDestination,
      errorMessage,
      stagedPath
    })

    onProgress({ total, processed: i + 1, currentFile: srcPath })
  }

  return {
    entries,
    livePhotosDiscarded: livePhotoMovs.length,
    sourceFolder
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
      params.now
    )
}

// ---------------------------------------------------------------------------
// Phase 2 — Execution
// ---------------------------------------------------------------------------

export interface ExecutorOptions {
  convertHeic?: HeicConverter
  copyFile?: (src: string, dest: string) => void
  moveFile?: (src: string, dest: string) => void
  mkdirp?: (path: string) => void
  statFile?: (path: string) => { size: number; mtime: Date }
  rmTempDir?: (path: string) => void
  rmStagedFile?: (path: string) => void
  isCancelled?: () => boolean
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
export async function executeImportPlan(
  plan: ImportPlan,
  libraryPath: string,
  tempDir: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: ImportProgress) => void,
  options: ExecutorOptions = {}
): Promise<ImportResult> {
  const convertHeicFn = options.convertHeic ?? defaultHeicConverter
  const copyFileFn = options.copyFile ?? ((src, dest) => copyFileSync(src, dest))
  const moveFileFn = options.moveFile ?? ((src, dest) => renameSync(src, dest))
  const mkdirpFn = options.mkdirp ?? ((p) => mkdirSync(p, { recursive: true }))
  const statFileFn = options.statFile ?? ((p) => statSync(p))
  const rmTempDirFn = options.rmTempDir ?? ((p) => rmSync(p, { recursive: true, force: true }))
  const rmStagedFileFn = options.rmStagedFile ?? ((p) => rmSync(p, { force: true }))
  const isCancelled = options.isCancelled ?? (() => false)

  const now = new Date().toISOString()
  const jobId = createImportJob(db, 'local', now)

  mkdirpFn(tempDir)

  const entriesToProcess = plan.entries.filter(
    (e) => e.status === 'ready' || e.status === 'collision'
  )
  const duplicateCount = plan.entries.filter((e) => e.status === 'duplicate').length
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
  let status: ImportStatus = 'completed'

  try {
    for (let i = 0; i < entriesToProcess.length; i++) {
      if (isCancelled()) {
        status = 'cancelled'
        break
      }

      const entry = entriesToProcess[i]
      onProgress({
        total,
        processed: i,
        imported,
        skipped: duplicateCount,
        duplicates: duplicateCount,
        livePhotosDiscarded: plan.livePhotosDiscarded,
        currentFile: entry.sourcePath
      })

      try {
        const srcExt = extname(entry.sourcePath).toLowerCase()
        const isHeic = srcExt === '.heic' || srcExt === '.heif'
        const doConvert = isHeic && config.heicConversion.enabled

        // Create destination folder in library if needed
        const destAbsPath = join(libraryPath, entry.destinationRelativePath)

        if (entry.stagedPath) {
          // Planner pre-staged a JPEG — move it directly (no re-conversion)
          mkdirpFn(dirname(destAbsPath))
          moveFileFn(entry.stagedPath, destAbsPath)
        } else {
          // Unique temp filename to avoid collisions between concurrent imports
          const tempFilename = `${randomUUID()}-${basename(entry.destinationRelativePath)}`
          const tempPath = join(tempDir, tempFilename)

          // Stage: copy/convert source → temp
          if (doConvert) {
            await convertHeicFn(entry.sourcePath, tempPath, config.heicConversion.jpegQuality)
          } else {
            copyFileFn(entry.sourcePath, tempPath)
          }

          mkdirpFn(dirname(destAbsPath))
          moveFileFn(tempPath, destAbsPath)
        }

        // DB upsert
        const fileStat = statFileFn(destAbsPath)
        const importedAt = new Date().toISOString()
        upsertImportedPhoto(db, {
          relativePath: entry.destinationRelativePath,
          filename: basename(entry.destinationRelativePath),
          phash: entry.phash,
          dateTaken: entry.dateTaken,
          dateTakenSource: entry.dateTakenSource,
          width: entry.width,
          height: entry.height,
          fileSize: fileStat.size,
          fileMtime: fileStat.mtime.toISOString(),
          now: importedAt
        })

        imported++
      } catch (err) {
        errors.push({
          sourcePath: entry.sourcePath,
          error: err instanceof Error ? err.message : String(err)
        })
      }

      onProgress({
        total,
        processed: i + 1,
        imported,
        skipped: duplicateCount,
        duplicates: duplicateCount,
        livePhotosDiscarded: plan.livePhotosDiscarded,
        currentFile: entry.sourcePath
      })
    }
  } finally {
    // Clean up any staged files that were not moved (errors, cancellation)
    // rmStagedFileFn uses force:true so it silently ignores already-moved files
    for (const entry of entriesToProcess) {
      if (entry.stagedPath) {
        try {
          rmStagedFileFn(entry.stagedPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // Always clean up executor temp dir
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
  }

  return {
    imported,
    skipped: duplicateCount,
    livePhotosDiscarded: plan.livePhotosDiscarded,
    errors,
    status
  }
}
