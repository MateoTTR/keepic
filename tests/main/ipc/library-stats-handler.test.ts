import { describe, it, expect } from 'vitest'
import { handleGetLibraryStats } from '../../../src/main/ipc/library-stats-handler'
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

function insertPhoto(
  db: KeePicDatabase,
  overrides: {
    path?: string
    filename?: string
    dateTaken?: string | null
    fileSize?: number | null
    deletedAt?: string | null
    mediaType?: string
  } = {}
): void {
  const path = overrides.path ?? `/lib/${Math.random()}.jpg`
  const filename = overrides.filename ?? 'photo.jpg'
  const dateTaken = 'dateTaken' in overrides ? overrides.dateTaken : null
  const fileSize = 'fileSize' in overrides ? overrides.fileSize : 1024
  const deletedAt = overrides.deletedAt ?? null
  const mediaType = overrides.mediaType ?? 'photo'

  db.db
    .prepare(
      `INSERT INTO photos
         (path, filename, source, imported_at, created_at, date_taken, file_size, deleted_at, media_type)
       VALUES (?, ?, 'local', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', ?, ?, ?, ?)`
    )
    .run(path, filename, dateTaken, fileSize, deletedAt, mediaType)
}

function insertJob(
  db: KeePicDatabase,
  overrides: {
    source?: string
    startedAt?: string
    finishedAt?: string | null
    status?: string
    photosImported?: number
    photosSkipped?: number
  } = {}
): void {
  const source = overrides.source ?? 'local'
  const startedAt = overrides.startedAt ?? '2025-01-01T00:00:00Z'
  const finishedAt = 'finishedAt' in overrides ? overrides.finishedAt : '2025-01-01T01:00:00Z'
  const status = overrides.status ?? 'completed'
  const photosImported = overrides.photosImported ?? 0
  const photosSkipped = overrides.photosSkipped ?? 0

  db.db
    .prepare(
      `INSERT INTO import_jobs
         (source, started_at, finished_at, status, photos_imported, photos_skipped,
          live_photos_discarded)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
    .run(source, startedAt, finishedAt, status, photosImported, photosSkipped)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleGetLibraryStats', () => {
  it('empty DB: returns zeros, nulls, and empty arrays', () => {
    const db = makeDb()
    const stats = handleGetLibraryStats(db)
    expect(stats).toEqual({
      totalPhotos: 0,
      totalVideos: 0,
      totalSizeBytes: 0,
      oldestDate: null,
      newestDate: null,
      photosByYear: [],
      recentImports: []
    })
  })

  it('single photo with no date_taken: counted but excluded from date range and photosByYear', () => {
    const db = makeDb()
    insertPhoto(db, { dateTaken: null, fileSize: 500 })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalPhotos).toBe(1)
    expect(stats.totalSizeBytes).toBe(500)
    expect(stats.oldestDate).toBeNull()
    expect(stats.newestDate).toBeNull()
    expect(stats.photosByYear).toEqual([])
  })

  it('multiple photos across different years: correct photosByYear order and counts', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/a.jpg', dateTaken: '2020-06-01', fileSize: 100 })
    insertPhoto(db, { path: '/b.jpg', dateTaken: '2020-08-15', fileSize: 200 })
    insertPhoto(db, { path: '/c.jpg', dateTaken: '2022-03-20', fileSize: 300 })
    insertPhoto(db, { path: '/d.jpg', dateTaken: '2024-11-30', fileSize: 400 })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalPhotos).toBe(4)
    expect(stats.totalSizeBytes).toBe(1000)
    expect(stats.oldestDate).toBe('2020-06-01')
    expect(stats.newestDate).toBe('2024-11-30')
    expect(stats.photosByYear).toEqual([
      { year: '2020', count: 2 },
      { year: '2022', count: 1 },
      { year: '2024', count: 1 }
    ])
  })

  it('photos with deleted_at set: excluded from all counts and ranges', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/active.jpg', dateTaken: '2023-05-01', fileSize: 500 })
    insertPhoto(db, {
      path: '/deleted.jpg',
      dateTaken: '2023-07-01',
      fileSize: 800,
      deletedAt: '2024-01-01T00:00:00Z'
    })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalPhotos).toBe(1)
    expect(stats.totalSizeBytes).toBe(500)
    expect(stats.oldestDate).toBe('2023-05-01')
    expect(stats.newestDate).toBe('2023-05-01')
    expect(stats.photosByYear).toEqual([{ year: '2023', count: 1 }])
  })

  it('file_size NULL for some photos: COALESCE handles it (counted, size = 0)', () => {
    const db = makeDb()
    insertPhoto(db, { dateTaken: '2025-01-01', fileSize: null })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalPhotos).toBe(1)
    expect(stats.totalSizeBytes).toBe(0)
  })

  it('6 completed import_jobs: only the 5 most recent returned, newest first', () => {
    const db = makeDb()
    for (let i = 1; i <= 6; i++) {
      const month = String(i).padStart(2, '0')
      insertJob(db, {
        startedAt: `2025-${month}-01T00:00:00Z`,
        finishedAt: `2025-${month}-01T01:00:00Z`,
        photosImported: i * 10
      })
    }
    const stats = handleGetLibraryStats(db)
    expect(stats.recentImports).toHaveLength(5)
    // newest first: months 6, 5, 4, 3, 2
    expect(stats.recentImports[0].photosImported).toBe(60)
    expect(stats.recentImports[1].photosImported).toBe(50)
    expect(stats.recentImports[4].photosImported).toBe(20)
  })

  it('import jobs with non-completed status: excluded from recentImports', () => {
    const db = makeDb()
    insertJob(db, {
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T01:00:00Z',
      status: 'failed'
    })
    insertJob(db, { startedAt: '2025-02-01T00:00:00Z', finishedAt: null, status: 'running' })
    insertJob(db, {
      startedAt: '2025-03-01T00:00:00Z',
      finishedAt: '2025-03-01T01:00:00Z',
      status: 'cancelled'
    })
    insertJob(db, {
      startedAt: '2025-04-01T00:00:00Z',
      finishedAt: '2025-04-01T01:00:00Z',
      status: 'completed',
      photosImported: 7
    })
    const stats = handleGetLibraryStats(db)
    expect(stats.recentImports).toHaveLength(1)
    expect(stats.recentImports[0].finishedAt).toBe('2025-04-01T01:00:00Z')
    expect(stats.recentImports[0].photosImported).toBe(7)
  })

  it('counts photos and videos separately in totalPhotos and totalVideos', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/a.jpg', dateTaken: '2025-01-01', fileSize: 100, mediaType: 'photo' })
    insertPhoto(db, { path: '/b.jpg', dateTaken: '2025-01-02', fileSize: 200, mediaType: 'photo' })
    insertPhoto(db, { path: '/c.mp4', dateTaken: '2025-01-03', fileSize: 5000, mediaType: 'video' })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalPhotos).toBe(2)
    expect(stats.totalVideos).toBe(1)
    expect(stats.totalSizeBytes).toBe(5300)
  })

  it('excludes deleted videos from totalVideos', () => {
    const db = makeDb()
    insertPhoto(db, { path: '/a.mp4', mediaType: 'video', fileSize: 1000 })
    insertPhoto(db, {
      path: '/b.mp4',
      mediaType: 'video',
      fileSize: 2000,
      deletedAt: '2025-01-01T00:00:00Z'
    })
    const stats = handleGetLibraryStats(db)
    expect(stats.totalVideos).toBe(1)
  })

  it('mix of local and google_photos sources: both appear correctly in recentImports', () => {
    const db = makeDb()
    insertJob(db, {
      source: 'local',
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T01:00:00Z',
      photosImported: 10,
      photosSkipped: 2
    })
    insertJob(db, {
      source: 'google_photos',
      startedAt: '2025-02-01T00:00:00Z',
      finishedAt: '2025-02-01T01:00:00Z',
      photosImported: 50,
      photosSkipped: 5
    })
    const stats = handleGetLibraryStats(db)
    expect(stats.recentImports).toHaveLength(2)
    // newest first
    expect(stats.recentImports[0].source).toBe('google_photos')
    expect(stats.recentImports[0].photosImported).toBe(50)
    expect(stats.recentImports[0].photosSkipped).toBe(5)
    expect(stats.recentImports[1].source).toBe('local')
    expect(stats.recentImports[1].photosImported).toBe(10)
    expect(stats.recentImports[1].photosSkipped).toBe(2)
  })
})
