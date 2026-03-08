import type { KeePicDatabase } from '../db/database'
import type { ImportSource, LibraryStats } from '../../shared/types'

// ---------------------------------------------------------------------------
// Injectable dependency pattern (for future extensibility)
// ---------------------------------------------------------------------------

export interface LibraryStatsDeps {
  now?: () => string // injectable for testing; not used in current implementation
}

// ---------------------------------------------------------------------------
// handleGetLibraryStats
// ---------------------------------------------------------------------------

/**
 * Computes library statistics synchronously from the local SQLite index.
 * All queries run as aggregates on indexed columns — fast even on large libraries.
 *
 * The `LibraryStatsDeps` interface is defined above for future extensibility
 * (e.g., injectable clock via `now()`). No injectable deps are needed yet.
 */
export function handleGetLibraryStats(db: KeePicDatabase): LibraryStats {
  const totals = db.db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE media_type = 'photo') AS totalPhotos,
         COUNT(*) FILTER (WHERE media_type = 'video') AS totalVideos,
         COALESCE(SUM(file_size), 0) AS totalSizeBytes
       FROM photos
       WHERE deleted_at IS NULL`
    )
    .get() as { totalPhotos: number; totalVideos: number; totalSizeBytes: number }

  const dateRange = db.db
    .prepare(
      `SELECT MIN(date_taken) AS oldestDate, MAX(date_taken) AS newestDate
       FROM photos
       WHERE deleted_at IS NULL AND date_taken IS NOT NULL`
    )
    .get() as { oldestDate: string | null; newestDate: string | null }

  const photosByYear = db.db
    .prepare(
      `SELECT substr(date_taken, 1, 4) AS year, COUNT(*) AS count
       FROM photos
       WHERE deleted_at IS NULL AND date_taken IS NOT NULL
       GROUP BY year
       ORDER BY year ASC`
    )
    .all() as Array<{ year: string; count: number }>

  const recentImportRows = db.db
    .prepare(
      `SELECT
         j.source, j.finished_at, j.photos_imported, j.photos_skipped,
         MIN(p.date_taken) AS oldest_media_date,
         MAX(p.date_taken) AS newest_media_date
       FROM import_jobs j
       LEFT JOIN photos p ON p.job_id = j.id AND p.deleted_at IS NULL
       WHERE j.status = 'completed'
       GROUP BY j.id
       ORDER BY j.finished_at DESC
       LIMIT 5`
    )
    .all() as Array<{
    source: ImportSource
    finished_at: string
    photos_imported: number
    photos_skipped: number
    oldest_media_date: string | null
    newest_media_date: string | null
  }>

  return {
    totalPhotos: totals.totalPhotos,
    totalVideos: totals.totalVideos,
    totalSizeBytes: totals.totalSizeBytes,
    oldestDate: dateRange.oldestDate,
    newestDate: dateRange.newestDate,
    photosByYear,
    recentImports: recentImportRows.map((row) => ({
      source: row.source,
      finishedAt: row.finished_at,
      photosImported: row.photos_imported,
      photosSkipped: row.photos_skipped,
      oldestMediaDate: row.oldest_media_date,
      newestMediaDate: row.newest_media_date
    }))
  }
}
