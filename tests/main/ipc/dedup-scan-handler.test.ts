import { describe, it, expect } from 'vitest'
import { handleScanDuplicates, findDuplicateGroups } from '../../../src/main/ipc/dedup-scan-handler'
import { KeePicDatabase } from '../../../src/main/db/database'

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

function makeDb(): KeePicDatabase {
  const db = new KeePicDatabase(':memory:')
  db.open()
  return db
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let pathCounter = 0

function insertPhoto(
  db: KeePicDatabase,
  overrides: {
    path?: string
    filename?: string
    phash?: string | null
    dhash?: string | null
    fileSize?: number | null
    dateTaken?: string | null
    importedAt?: string
    deletedAt?: string | null
    mediaType?: string
  } = {}
): void {
  const path = overrides.path ?? `/lib/photo-${++pathCounter}.jpg`
  const filename = overrides.filename ?? 'photo.jpg'
  const phash = 'phash' in overrides ? overrides.phash : null
  const dhash = 'dhash' in overrides ? overrides.dhash : null
  const fileSize = 'fileSize' in overrides ? overrides.fileSize : 1024
  const dateTaken = 'dateTaken' in overrides ? overrides.dateTaken : null
  const importedAt = overrides.importedAt ?? '2025-01-01T00:00:00Z'
  const deletedAt = overrides.deletedAt ?? null
  const mediaType = overrides.mediaType ?? 'photo'

  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, source, phash, dhash, file_size, date_taken, imported_at, created_at, deleted_at, media_type)
       VALUES (?, ?, 'local', ?, ?, ?, ?, ?, '2025-01-01T00:00:00Z', ?, ?)`
    )
    .run(path, filename, phash, dhash, fileSize, dateTaken, importedAt, deletedAt, mediaType)
}

// ---------------------------------------------------------------------------
// handleScanDuplicates — returns { photoRows, videoGroups }
// ---------------------------------------------------------------------------

describe('handleScanDuplicates', () => {
  it('empty DB: returns empty photoRows and videoGroups', () => {
    const db = makeDb()
    const result = handleScanDuplicates(db)
    expect(result.photoRows).toEqual([])
    expect(result.videoGroups).toEqual([])
  })

  it('returns photoRows for non-deleted photos with phash', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/a.jpg', phash: 'abc1230000000000', dhash: 'def4560000000000' })
    insertPhoto(db, { path: '/lib/b.jpg', phash: null }) // no phash → excluded
    const result = handleScanDuplicates(db)
    expect(result.photoRows).toHaveLength(1)
    expect(result.photoRows[0].path).toBe('/lib/a.jpg')
  })

  it('excludes deleted photos from photoRows', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/alive.jpg', phash: 'abc1230000000000' })
    insertPhoto(db, { path: '/lib/dead.jpg', phash: 'abc1230000000000', deletedAt: '2025-06-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result.photoRows).toHaveLength(1)
    expect(result.photoRows[0].path).toBe('/lib/alive.jpg')
  })

  it('video duplicates grouped by filename + file_size', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/2024/clip.mp4',
      filename: 'clip.mp4',
      phash: null,
      fileSize: 50000,
      mediaType: 'video',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/2025/clip.mp4',
      filename: 'clip.mp4',
      phash: null,
      fileSize: 50000,
      mediaType: 'video',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result.videoGroups).toHaveLength(1)
    expect(result.videoGroups[0].id).toBe('video-0')
    expect(result.videoGroups[0].mediaType).toBe('video')
    expect(result.videoGroups[0].photos).toHaveLength(2)
    expect(result.videoGroups[0].photos[0].path).toBe('/lib/2024/clip.mp4')
    expect(result.videoGroups[0].photos[1].path).toBe('/lib/2025/clip.mp4')
  })

  it('videos with same filename but different size are not grouped', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/a/clip.mp4', filename: 'clip.mp4', fileSize: 50000, mediaType: 'video' })
    insertPhoto(db, { path: '/lib/b/clip.mp4', filename: 'clip.mp4', fileSize: 99999, mediaType: 'video' })
    const result = handleScanDuplicates(db)
    expect(result.videoGroups).toEqual([])
  })

  it('deleted videos are excluded from dedup', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/a/vid.mp4',
      filename: 'vid.mp4',
      fileSize: 1000,
      mediaType: 'video',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/b/vid.mp4',
      filename: 'vid.mp4',
      fileSize: 1000,
      mediaType: 'video',
      importedAt: '2025-02-01T00:00:00Z',
      deletedAt: '2025-03-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result.videoGroups).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findDuplicateGroups — Multi-Index Hashing + Union-Find
// ---------------------------------------------------------------------------

describe('findDuplicateGroups', () => {
  it('empty array: returns empty array', () => {
    expect(findDuplicateGroups([])).toEqual([])
  })

  it('all photos have unique phash: returns empty array', () => {
    const db = makeDb()
    insertPhoto(db, { phash: 'aaa1110000000000', dhash: '1111111111111111' })
    insertPhoto(db, { phash: '00000000bbb22200', dhash: '2222222222222222' })
    insertPhoto(db, { phash: '0000ccc333000000', dhash: '3333333333333333' })
    const { photoRows } = handleScanDuplicates(db)
    expect(findDuplicateGroups(photoRows)).toEqual([])
  })

  it('two photos with same phash and dhash: returns one group with 2 photos', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/a.jpg',
      filename: 'a.jpg',
      phash: 'abc1230000000000',
      dhash: 'def4560000000000',
      fileSize: 2000,
      dateTaken: '2024-06-15',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/b.jpg',
      filename: 'b.jpg',
      phash: 'abc1230000000000',
      dhash: 'def4560000000000',
      fileSize: 2100,
      dateTaken: '2024-06-15',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('photo-0')
    expect(result[0].phash).toBe('abc1230000000000')
    expect(result[0].photos).toHaveLength(2)
    expect(result[0].photos[0].path).toBe('/lib/a.jpg')
    expect(result[0].photos[1].path).toBe('/lib/b.jpg')
  })

  it('three photos with same phash and dhash: returns one group with 3 photos', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/x1.jpg', phash: 'dup9990000000000', dhash: 'aaa0000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/x2.jpg', phash: 'dup9990000000000', dhash: 'aaa0000000000000', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/x3.jpg', phash: 'dup9990000000000', dhash: 'aaa0000000000000', importedAt: '2025-03-01T00:00:00Z' })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].photos).toHaveLength(3)
  })

  it('groups have unique sequential ids even when pHash collides', () => {
    const db = makeDb()
    // Two groups with same pHash but different dHash (the bug scenario from TASK-069)
    insertPhoto(db, { path: '/lib/a1.jpg', phash: 'samephash0000000', dhash: '1111111111111111', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/a2.jpg', phash: 'samephash0000000', dhash: '1111111111111111', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/b1.jpg', phash: 'samephash0000000', dhash: 'ffffffffffffffff', importedAt: '2025-03-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/b2.jpg', phash: 'samephash0000000', dhash: 'ffffffffffffffff', importedAt: '2025-04-01T00:00:00Z' })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(2)
    // Both have the same phash but unique ids
    expect(result[0].phash).toBe('samephash0000000')
    expect(result[1].phash).toBe('samephash0000000')
    expect(result[0].id).not.toBe(result[1].id)
    expect(result[0].id).toBe('photo-0')
    expect(result[1].id).toBe('photo-1')
  })

  it('two duplicate groups: both groups returned', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/g1a.jpg', phash: 'aaaa000000000000', dhash: '1111000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g1b.jpg', phash: 'aaaa000000000000', dhash: '1111000000000000', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2a.jpg', phash: '00000000bbbb0000', dhash: '00000000ffff0000', importedAt: '2025-03-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2b.jpg', phash: '00000000bbbb0000', dhash: '00000000ffff0000', importedAt: '2025-04-01T00:00:00Z' })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(2)
    const hashes = result.map((g) => g.phash).sort()
    expect(hashes).toEqual(['00000000bbbb0000', 'aaaa000000000000'])
  })

  it('photo groups have mediaType photo', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/p1.jpg', phash: 'mt10000000000000', dhash: 'mt10000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/p2.jpg', phash: 'mt10000000000000', dhash: 'mt10000000000000', importedAt: '2025-02-01T00:00:00Z' })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].mediaType).toBe('photo')
  })

  it('photos sorted by importedAt ASC within a group: oldest first', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/newer.jpg',
      phash: 'sortme0000000000',
      dhash: 'sm00000000000000',
      importedAt: '2025-06-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/older.jpg',
      phash: 'sortme0000000000',
      dhash: 'sm00000000000000',
      importedAt: '2025-01-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].photos[0].path).toBe('/lib/older.jpg')
    expect(result[0].photos[1].path).toBe('/lib/newer.jpg')
  })

  it('file_size = NULL for a photo: included with fileSize null', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/nullsize1.jpg',
      phash: 'nullsz0000000000',
      dhash: 'ns00000000000000',
      fileSize: null,
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/nullsize2.jpg',
      phash: 'nullsz0000000000',
      dhash: 'ns00000000000000',
      fileSize: null,
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].photos[0].fileSize).toBeNull()
    expect(result[0].photos[1].fileSize).toBeNull()
  })

  it('date_taken = NULL for a photo: included with dateTaken null', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/nodate1.jpg',
      phash: 'nodate0000000000',
      dhash: 'nd00000000000000',
      dateTaken: null,
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/nodate2.jpg',
      phash: 'nodate0000000000',
      dhash: 'nd00000000000000',
      dateTaken: null,
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    expect(result[0].photos[0].dateTaken).toBeNull()
    expect(result[0].photos[1].dateTaken).toBeNull()
  })

  it('photo fields are mapped correctly: path, filename, fileSize, dateTaken, importedAt', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/2024/2024.06/IMG_1234.jpg',
      filename: 'IMG_1234.jpg',
      phash: 'fieldcheck000000',
      dhash: 'fc00000000000000',
      fileSize: 2100000,
      dateTaken: '2024-06-15',
      importedAt: '2025-01-15T10:30:00Z'
    })
    insertPhoto(db, {
      path: '/2024/2024.07/IMG_1234.jpg',
      filename: 'IMG_1234.jpg',
      phash: 'fieldcheck000000',
      dhash: 'fc00000000000000',
      fileSize: 2100000,
      dateTaken: '2024-06-15',
      importedAt: '2025-02-20T08:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
    const photo = result[0].photos[0]
    expect(photo.path).toBe('/2024/2024.06/IMG_1234.jpg')
    expect(photo.filename).toBe('IMG_1234.jpg')
    expect(photo.fileSize).toBe(2100000)
    expect(photo.dateTaken).toBe('2024-06-15')
    expect(photo.importedAt).toBe('2025-01-15T10:30:00Z')
  })

  // -------------------------------------------------------------------------
  // Hamming-based dual-hash matching tests
  // -------------------------------------------------------------------------

  it('rejects photos with 1-bit pHash difference (threshold is 0, exact match only)', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/img.heic',
      phash: 'ff00802080008080',
      dhash: 'aabb000000000000',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/img.jpg',
      phash: 'ff00800080008080', // 1-bit difference from above
      dhash: 'aabb000000000000',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toEqual([])
  })

  it('rejects photos with same pHash but different dHash (false positive)', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/photo_a.jpg',
      phash: '8080808000000080',
      dhash: '1234567890abcdef',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/photo_b.jpg',
      phash: '8080808000000080',
      dhash: 'fedcba0987654321', // very different dHash
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toEqual([])
  })

  it('groups photos when both hashes match within threshold (legacy data without dHash)', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/old1.jpg',
      phash: 'abc1234567890000',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/old2.jpg',
      phash: 'abc1234567890000',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toHaveLength(1)
  })

  it('does not chain near-matches at threshold 0 (each pHash must be identical)', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/a.jpg', phash: '0000000000000000', dhash: '0000000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/b.jpg', phash: '1000000000000000', dhash: '0000000000000000', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/c.jpg', phash: '1100000000000000', dhash: '0000000000000000', importedAt: '2025-03-01T00:00:00Z' })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    // All have different pHash → no groups at threshold 0
    expect(result).toEqual([])
  })

  it('rejects photos when pHash differs by any amount (threshold 0)', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/unrelated1.jpg',
      phash: 'ff00000000000000',
      dhash: '0000000000000000',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/unrelated2.jpg',
      phash: '00ff000000000000', // 8-bit Hamming from above
      dhash: '0000000000000000',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const { photoRows } = handleScanDuplicates(db)
    const result = findDuplicateGroups(photoRows)
    expect(result).toEqual([])
  })

  it('calls onProgress callback during processing', () => {
    const rows = [
      { path: '/a.jpg', filename: 'a.jpg', file_size: 100, date_taken: null, imported_at: '2025-01-01', phash: 'abc1230000000000', dhash: 'def4560000000000' },
      { path: '/b.jpg', filename: 'b.jpg', file_size: 100, date_taken: null, imported_at: '2025-02-01', phash: 'abc1230000000000', dhash: 'def4560000000000' }
    ]
    const progressCalls: Array<[number, number]> = []
    findDuplicateGroups(rows, 0, (processed, total) => {
      progressCalls.push([processed, total])
    })
    expect(progressCalls).toHaveLength(2)
    expect(progressCalls[0]).toEqual([1, 2])
    expect(progressCalls[1]).toEqual([2, 2])
  })

  it('returns both photo and video groups from handleScanDuplicates', () => {
    const db = makeDb()
    // Photo dups
    insertPhoto(db, { path: '/lib/p1.jpg', phash: 'phdup00000000000', dhash: 'pd00000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/p2.jpg', phash: 'phdup00000000000', dhash: 'pd00000000000000', importedAt: '2025-02-01T00:00:00Z' })
    // Video dups
    insertPhoto(db, {
      path: '/lib/v1.mp4',
      filename: 'v.mp4',
      fileSize: 5000,
      mediaType: 'video',
      importedAt: '2025-03-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/v2.mp4',
      filename: 'v.mp4',
      fileSize: 5000,
      mediaType: 'video',
      importedAt: '2025-04-01T00:00:00Z'
    })
    const { photoRows, videoGroups } = handleScanDuplicates(db)
    const photoGroups = findDuplicateGroups(photoRows)
    const allGroups = [...photoGroups, ...videoGroups]
    expect(allGroups).toHaveLength(2)
    const mediaTypes = allGroups.map((g) => g.mediaType).sort()
    expect(mediaTypes).toEqual(['photo', 'video'])
  })
})
