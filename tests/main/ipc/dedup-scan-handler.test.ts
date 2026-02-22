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
    fileSize?: number | null
    dateTaken?: string | null
    importedAt?: string
    deletedAt?: string | null
  } = {}
): void {
  const path = overrides.path ?? `/lib/photo-${++pathCounter}.jpg`
  const filename = overrides.filename ?? 'photo.jpg'
  const phash = 'phash' in overrides ? overrides.phash : null
  const fileSize = 'fileSize' in overrides ? overrides.fileSize : 1024
  const dateTaken = 'dateTaken' in overrides ? overrides.dateTaken : null
  const importedAt = overrides.importedAt ?? '2025-01-01T00:00:00Z'
  const deletedAt = overrides.deletedAt ?? null

  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, source, phash, file_size, date_taken, imported_at, created_at, deleted_at)
       VALUES (?, ?, 'local', ?, ?, ?, ?, '2025-01-01T00:00:00Z', ?)`
    )
    .run(path, filename, phash, fileSize, dateTaken, importedAt, deletedAt)
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
    insertPhoto(db, { phash: 'aaa111' })
    insertPhoto(db, { phash: 'bbb222' })
    insertPhoto(db, { phash: 'ccc333' })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('two photos with same phash, both non-deleted: returns one group with 2 photos', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/a.jpg',
      filename: 'a.jpg',
      phash: 'abc123',
      fileSize: 2000,
      dateTaken: '2024-06-15',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/b.jpg',
      filename: 'b.jpg',
      phash: 'abc123',
      fileSize: 2100,
      dateTaken: '2024-06-15',
      importedAt: '2025-02-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].phash).toBe('abc123')
    expect(result[0].photos).toHaveLength(2)
    expect(result[0].photos[0].path).toBe('/lib/a.jpg')
    expect(result[0].photos[1].path).toBe('/lib/b.jpg')
  })

  it('three photos with same phash: returns one group with 3 photos', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/x1.jpg', phash: 'dup999', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/x2.jpg', phash: 'dup999', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/x3.jpg', phash: 'dup999', importedAt: '2025-03-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos).toHaveLength(3)
  })

  it('two duplicate groups: both groups returned', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/lib/g1a.jpg', phash: 'group1', importedAt: '2025-01-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g1b.jpg', phash: 'group1', importedAt: '2025-02-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2a.jpg', phash: 'group2', importedAt: '2025-03-01T00:00:00Z' })
    insertPhoto(db, { path: '/lib/g2b.jpg', phash: 'group2', importedAt: '2025-04-01T00:00:00Z' })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(2)
    const hashes = result.map((g) => g.phash).sort()
    expect(hashes).toEqual(['group1', 'group2'])
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
      phash: 'deaddup',
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/dead.jpg',
      phash: 'deaddup',
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
      phash: 'bothgone',
      deletedAt: '2025-06-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/del2.jpg',
      phash: 'bothgone',
      deletedAt: '2025-06-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result).toEqual([])
  })

  it('photos sorted by importedAt ASC within a group: oldest first', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/lib/newer.jpg',
      phash: 'sortme',
      importedAt: '2025-06-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/older.jpg',
      phash: 'sortme',
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
      phash: 'nullsz',
      fileSize: null,
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/nullsize2.jpg',
      phash: 'nullsz',
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
      phash: 'nodate',
      dateTaken: null,
      importedAt: '2025-01-01T00:00:00Z'
    })
    insertPhoto(db, {
      path: '/lib/nodate2.jpg',
      phash: 'nodate',
      dateTaken: null,
      importedAt: '2025-02-01T00:00:00Z'
    })
    const result = handleScanDuplicates(db)
    expect(result).toHaveLength(1)
    expect(result[0].photos[0].dateTaken).toBeNull()
    expect(result[0].photos[1].dateTaken).toBeNull()
  })

  it('photo fields are mapped correctly: path, filename, fileSize, dateTaken, importedAt', () => {
    const db = makeDb()
    insertPhoto(db, {
      path: '/2024/2024.06/IMG_1234.jpg',
      filename: 'IMG_1234.jpg',
      phash: 'fieldcheck',
      fileSize: 2100000,
      dateTaken: '2024-06-15',
      importedAt: '2025-01-15T10:30:00Z'
    })
    insertPhoto(db, {
      path: '/2024/2024.07/IMG_1234.jpg',
      filename: 'IMG_1234.jpg',
      phash: 'fieldcheck',
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
})
