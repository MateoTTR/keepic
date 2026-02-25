import { rmSync } from 'fs'
import type { KeePicDatabase } from '../db/database'

// ---------------------------------------------------------------------------
// handleGetLastDownloadDate
// ---------------------------------------------------------------------------

/**
 * Returns the last_imported_date of the most recent completed google_photos job,
 * or null if no such job exists.
 */
export function handleGetLastDownloadDate(db: KeePicDatabase): { date: string | null } {
  const row = db.db
    .prepare(
      `SELECT last_imported_date FROM import_jobs
       WHERE source = 'google_photos' AND status = 'completed'
       ORDER BY finished_at DESC
       LIMIT 1`
    )
    .get() as { last_imported_date: string | null } | undefined

  return { date: row?.last_imported_date ?? null }
}

// ---------------------------------------------------------------------------
// handleCleanupDownloadDir
// ---------------------------------------------------------------------------

/**
 * Deletes the Google Photos download staging directory.
 * Called from the renderer when the user dismisses the result screen.
 */
export function handleCleanupDownloadDir(
  dirPath: string,
  rmDir: (p: string) => void = (p) => rmSync(p, { recursive: true, force: true })
): void {
  rmDir(dirPath)
}
