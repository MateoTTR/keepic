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
  // Photo duplicates: group by pHash
  const photoRows = db.db
    .prepare(
      `SELECT path, filename, file_size, date_taken, imported_at, phash
       FROM photos
       WHERE deleted_at IS NULL
         AND media_type = 'photo'
         AND phash IS NOT NULL
         AND phash IN (
           SELECT phash FROM photos
           WHERE deleted_at IS NULL AND media_type = 'photo' AND phash IS NOT NULL
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

  const photoGroups: DuplicateGroup[] = []
  const photoGroupMap = new Map<string, DuplicatePhoto[]>()
  for (const row of photoRows) {
    const photo: DuplicatePhoto = {
      path: row.path,
      filename: row.filename,
      fileSize: row.file_size,
      dateTaken: row.date_taken,
      importedAt: row.imported_at
    }
    const existing = photoGroupMap.get(row.phash)
    if (existing) {
      existing.push(photo)
    } else {
      photoGroupMap.set(row.phash, [photo])
    }
  }
  for (const [phash, photos] of photoGroupMap) {
    photoGroups.push({ phash, mediaType: 'photo', photos })
  }

  // Video duplicates: group by filename + file_size
  const videoRows = db.db
    .prepare(
      `SELECT path, filename, file_size, date_taken, imported_at
       FROM photos
       WHERE deleted_at IS NULL
         AND media_type = 'video'
         AND (filename || ':' || file_size) IN (
           SELECT filename || ':' || file_size FROM photos
           WHERE deleted_at IS NULL AND media_type = 'video'
           GROUP BY filename, file_size HAVING COUNT(*) > 1
         )
       ORDER BY filename ASC, file_size ASC, imported_at ASC`
    )
    .all() as Array<{
    path: string
    filename: string
    file_size: number | null
    date_taken: string | null
    imported_at: string
  }>

  const videoGroups: DuplicateGroup[] = []
  const videoGroupMap = new Map<string, DuplicatePhoto[]>()
  for (const row of videoRows) {
    const key = `${row.filename}:${row.file_size}`
    const photo: DuplicatePhoto = {
      path: row.path,
      filename: row.filename,
      fileSize: row.file_size,
      dateTaken: row.date_taken,
      importedAt: row.imported_at
    }
    const existing = videoGroupMap.get(key)
    if (existing) {
      existing.push(photo)
    } else {
      videoGroupMap.set(key, [photo])
    }
  }
  for (const [key, photos] of videoGroupMap) {
    videoGroups.push({ phash: key, mediaType: 'video', photos })
  }

  return [...photoGroups, ...videoGroups]
}
