import { describe, it, expect, vi } from 'vitest'

// Mock Electron and keytar — these cannot load in a Node test environment.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  handleGetLastDownloadDate,
  handleCleanupDownloadDir
} from '../../../src/main/ipc/google-photos-handlers'
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
// handleGetLastDownloadDate
// ---------------------------------------------------------------------------

describe('handleGetLastDownloadDate', () => {
  it('returns null when no google_photos job exists', () => {
    const db = makeDb()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns null when only non-completed google_photos jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, status, photos_imported,
         photos_skipped, live_photos_discarded)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', 'failed', 0, 0, 0)`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns null when only local jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('local', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 10, 0, 0, '2025-01-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns the last_imported_date of the most recent completed google_photos job', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 10, 0, 0, '2025-01-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: '2025-01-01' })
  })

  it('returns the most recent date when multiple completed jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 5, 0, 0, '2025-01-01')`
      )
      .run()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-06-01T00:00:00Z', '2025-06-01T01:00:00Z', 'completed', 20, 0, 0, '2025-06-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: '2025-06-01' })
  })
})

// ---------------------------------------------------------------------------
// handleCleanupDownloadDir
// ---------------------------------------------------------------------------

describe('handleCleanupDownloadDir', () => {
  it('calls rmDir with the provided path', () => {
    const rmDir = vi.fn()
    handleCleanupDownloadDir('/some/download/dir', rmDir)
    expect(rmDir).toHaveBeenCalledWith('/some/download/dir')
  })

  it('uses default rmSync when no rmDir dep provided', () => {
    // We can't easily test the real rmSync without a real directory,
    // but we verify the function is callable and doesn't throw for a non-existent path
    // (rmSync with force:true is safe for non-existent paths)
    expect(() => handleCleanupDownloadDir('/tmp/keepic-test-nonexistent-dir-xyz')).not.toThrow()
  })
})
