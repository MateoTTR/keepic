import type { KeePicDatabase } from '../db/database'
import type { DuplicateGroup, DuplicatePhoto } from '../../shared/types'
import { hammingDistance, HAMMING_THRESHOLD } from '../phash'

// ---------------------------------------------------------------------------
// Union-Find for grouping duplicates
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[]
  private rank: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
    this.rank = new Array(size).fill(0)
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x])
    }
    return this.parent[x]
  }

  union(x: number, y: number): void {
    const px = this.find(x)
    const py = this.find(y)
    if (px === py) return
    /* v8 ignore next 2 */
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px
    } else {
      this.parent[py] = px
      this.rank[px]++
    }
  }
}

// ---------------------------------------------------------------------------
// handleScanDuplicates
// ---------------------------------------------------------------------------

/**
 * Scans the local SQLite index for photos that are visually identical duplicates.
 *
 * Uses dual-hash matching: two photos are duplicates when both their pHash AND
 * dHash Hamming distances are ≤ HAMMING_THRESHOLD (4 bits).
 *
 * The scan is read-only: no files are deleted, no DB rows are modified.
 * Users resolve duplicates manually (delete files → re-index via TASK-021).
 */
export function handleScanDuplicates(db: KeePicDatabase): DuplicateGroup[] {
  // Photo duplicates: dual-hash Hamming matching
  const photoRows = db.db
    .prepare(
      `SELECT path, filename, file_size, date_taken, imported_at, phash, dhash
       FROM photos
       WHERE deleted_at IS NULL
         AND media_type = 'photo'
         AND phash IS NOT NULL
       ORDER BY imported_at ASC`
    )
    .all() as Array<{
    path: string
    filename: string
    file_size: number | null
    date_taken: string | null
    imported_at: string
    phash: string
    dhash: string | null
  }>

  // Use Union-Find to group photos by Hamming proximity
  const uf = new UnionFind(photoRows.length)
  for (let i = 0; i < photoRows.length; i++) {
    for (let j = i + 1; j < photoRows.length; j++) {
      if (hammingDistance(photoRows[i].phash, photoRows[j].phash) <= HAMMING_THRESHOLD) {
        // pHash matches — verify dHash if both available
        const di = photoRows[i].dhash
        const dj = photoRows[j].dhash
        if (di && dj) {
          if (hammingDistance(di, dj) <= HAMMING_THRESHOLD) {
            uf.union(i, j)
          }
        } else {
          // Legacy data without dHash: accept pHash match alone
          uf.union(i, j)
        }
      }
    }
  }

  // Collect groups (only those with 2+ members)
  const groupMap = new Map<number, number[]>()
  for (let i = 0; i < photoRows.length; i++) {
    const root = uf.find(i)
    const group = groupMap.get(root)
    if (group) {
      group.push(i)
    } else {
      groupMap.set(root, [i])
    }
  }

  const photoGroups: DuplicateGroup[] = []
  for (const indices of groupMap.values()) {
    if (indices.length < 2) continue
    const photos: DuplicatePhoto[] = indices.map((i) => ({
      path: photoRows[i].path,
      filename: photoRows[i].filename,
      fileSize: photoRows[i].file_size,
      dateTaken: photoRows[i].date_taken,
      importedAt: photoRows[i].imported_at
    }))
    photoGroups.push({ phash: photoRows[indices[0]].phash, mediaType: 'photo', photos })
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
