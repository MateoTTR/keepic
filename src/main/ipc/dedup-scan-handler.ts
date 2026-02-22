import type { KeePicDatabase } from '../db/database'
import type { DuplicateGroup, DuplicatePhoto } from '../../shared/types'

// ---------------------------------------------------------------------------
// handleScanDuplicates
// ---------------------------------------------------------------------------

/**
 * Scans the local SQLite index for photos that share the same perceptual hash
 * (pHash), indicating they are visually identical duplicates within the library.
 *
 * The scan is read-only: no files are deleted, no DB rows are modified.
 * Users resolve duplicates manually (delete files → re-index via TASK-021).
 *
 * A single SQL query fetches all non-deleted photos whose pHash appears more
 * than once, then TypeScript groups the flat rows by phash.
 */
export function handleScanDuplicates(db: KeePicDatabase): DuplicateGroup[] {
  const rows = db.db
    .prepare(
      `SELECT path, filename, file_size, date_taken, imported_at, phash
       FROM photos
       WHERE deleted_at IS NULL
         AND phash IS NOT NULL
         AND phash IN (
           SELECT phash FROM photos
           WHERE deleted_at IS NULL AND phash IS NOT NULL
           GROUP BY phash HAVING COUNT(*) > 1
         )
       ORDER BY phash ASC, imported_at ASC`
    )
    .all() as Array<{
    path: string
    filename: string
    file_size: number | null
    date_taken: string | null
    imported_at: string
    phash: string
  }>

  const groupMap = new Map<string, DuplicatePhoto[]>()
  for (const row of rows) {
    const photo: DuplicatePhoto = {
      path: row.path,
      filename: row.filename,
      fileSize: row.file_size,
      dateTaken: row.date_taken,
      importedAt: row.imported_at
    }
    const existing = groupMap.get(row.phash)
    if (existing) {
      existing.push(photo)
    } else {
      groupMap.set(row.phash, [photo])
    }
  }

  return Array.from(groupMap.entries()).map(([phash, photos]) => ({ phash, photos }))
}
