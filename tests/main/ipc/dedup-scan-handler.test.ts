import { describe, it, expect } from 'vitest'
import { handleScanDuplicates } from '../../../src/main/ipc/dedup-scan-handler'
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
// Tests
// ---------------------------------------------------------------------------

describe('handleScanDuplicates', () => {
  it('empty DB: returns empty array', () => {
    const db = makeDb()
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('all photos have unique phash: returns empty array', () => {
    const db = makeDb()
    insertPhoto(db, { phash: 'aaa1110000000000', dhash: '1111111111111111' })
    insertPhoto(db, { phash: '00000000bbb22200', dhash: '2222222222222222' })
    insertPhoto(db, { phash: '0000ccc333000000', dhash: '3333333333333333' })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('two photos with same phash and dhash, both non-deleted: returns one group with 2 photos', () => {
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos).toHaveLength(3)
  })

  it('two duplicate groups: both groups returned', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/g1a.jpg', phash: 'aaaa000000000000', dhash: '1111000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g1b.jpg', phash: 'aaaa000000000000', dhash: '1111000000000000', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2a.jpg', phash: '00000000bbbb0000', dhash: '00000000ffff0000', importedAt: '2025-03-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2b.jpg', phash: '00000000bbbb0000', dhash: '00000000ffff0000', importedAt: '2025-04-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(2)
    const hashes = result.map((g) => g.phash).sort()
    expect(hashes).toEqual(['00000000bbbb0000', 'aaaa000000000000'])
  })

  it('photo with phash = NULL: not included even if two NULL photos exist', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/n1.jpg', phash: null })
    insertPhoto(db, { path: '/lib/n2.jpg', phash: null })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('one photo deleted of a pair: no group returned (only 1 non-deleted remains)', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/alive.jpg',
      phash: 'deaddup000000000',
      dhash: 'dd00000000000000',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/dead.jpg',
      phash: 'deaddup000000000',
      dhash: 'dd00000000000000',
      importedAt: '2025-02-01T00:00:00Z',
      deletedAt: '2025-06-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('both photos deleted of a pair: no group returned', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/del1.jpg',
      phash: 'bothgone00000000',
      dhash: 'bg00000000000000',
      deletedAt: '2025-06-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/del2.jpg',
      phash: 'bothgone00000000',
      dhash: 'bg00000000000000',
      deletedAt: '2025-06-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
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
    const result = handleScanDuplicates(db)
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
    const result = handleScanDuplicates(db)
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos[0].dateTaken).toBeNull()
    expect(result[0].photos[1].dateTaken).toBeNull()
  })

  it('photo groups have mediaType photo', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/p1.jpg', phash: 'mt10000000000000', dhash: 'mt10000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/p2.jpg', phash: 'mt10000000000000', dhash: 'mt10000000000000', importedAt: '2025-02-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].mediaType).toBe('photo')
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
    expect(result).toHaveLength(1)
    expect(result[0].mediaType).toBe('video')
    expect(result[0].photos).toHaveLength(2)
    expect(result[0].photos[0].path).toBe('/lib/2024/clip.mp4')
    expect(result[0].photos[1].path).toBe('/lib/2025/clip.mp4')
  })

  it('videos with same filename but different size are not grouped', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/a/clip.mp4',
      filename: 'clip.mp4',
      fileSize: 50000,
      mediaType: 'video'
    })
    insertPhoto(db, {
      path: '/lib/b/clip.mp4',
      filename: 'clip.mp4',
      fileSize: 99999,
      mediaType: 'video'
    })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
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
    expect(result).toEqual([])
  })

  it('returns both photo and video groups combined', () => {
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(2)
    const mediaTypes = result.map((g) => g.mediaType).sort()
    expect(mediaTypes).toEqual(['photo', 'video'])
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
    const result = handleScanDuplicates(db)
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

  it('groups photos with pHash Hamming distance ≤ 4 and matching dHash (cross-format)', () => {
    const db = makeDb()
    // Simulate HEIC/JPEG same photo: pHash differs by 1 bit, dHash identical
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos).toHaveLength(2)
  })

  it('rejects photos with same pHash but different dHash (false positive)', () => {
    const db = makeDb()
    // Case 2: same pHash, completely different images → different dHash
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
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('groups photos when both hashes match within threshold (legacy data without dHash)', () => {
    const db = makeDb()
    // Legacy data: dHash is null → falls back to pHash-only matching
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
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
  })

  it('groups chain of near-matches via Union-Find (A~B, B~C → all in one group)', () => {
    const db = makeDb()
    // 5 photos: A~B (union 0,1 → rank 1), C~D (union 2,3 → rank 1), then B~C (merges two equal-rank trees → rank 2)
    // Finally E matches A but not directly D → triggers rank[px] < rank[py] merge
    insertPhoto(db, { path: '/lib/a.jpg', phash: '0000000000000000', dhash: '0000000000000000', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/b.jpg', phash: '1000000000000000', dhash: '0000000000000000', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/c.jpg', phash: '1100000000000000', dhash: '0000000000000000', importedAt: '2025-03-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/d.jpg', phash: '1110000000000000', dhash: '0000000000000000', importedAt: '2025-04-01T00:00:00Z' })
    // E is only near A (rank 0 merged into rank 2 tree) — exercises rank[px] < rank[py]
    insertPhoto(db, { path: '/lib/e.jpg', phash: '0000000000000001', dhash: '0000000000000000', importedAt: '2025-05-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos).toHaveLength(5)
  })

  it('rejects photos when pHash Hamming distance > 4', () => {
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
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })
})
