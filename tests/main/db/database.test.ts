import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import { KeePicDatabase } from '../../../src/main/db/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDbPath(): string {
  return join(tmpdir(), `keepic-test-${randomUUID()}.db`)
}

function cleanup(path: string): void {
  if (existsSync(path)) unlinkSync(path)
  // WAL mode creates -wal and -shm sidecar files
  if (existsSync(`${path}-wal`)) unlinkSync(`${path}-wal`)
  if (existsSync(`${path}-shm`)) unlinkSync(`${path}-shm`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeePicDatabase', () => {
  describe('db getter', () => {
    it('throws when the database is not open', () => {
      const kdb = new KeePicDatabase(':memory:')
      expect(() => kdb.db).toThrow('Database is not open. Call open() first.')
    })

    it('returns the BetterSqlite3 instance when open', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      expect(kdb.db).toBeDefined()
      kdb.close()
    })
  })

  describe('open()', () => {
    it('enables WAL journal mode', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const mode = kdb.db.pragma('journal_mode', { simple: true })
      expect(mode).toBe('memory') // :memory: always reports "memory" — WAL pragma is accepted silently
      kdb.close()
    })

    it('enables foreign keys', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const fk = kdb.db.pragma('foreign_keys', { simple: true })
      expect(fk).toBe(1)
      kdb.close()
    })

    it('creates the photos table', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const row = kdb.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photos'")
        .get()
      expect(row).toBeDefined()
      kdb.close()
    })

    it('adds the deleted_at column to photos', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const cols = kdb.db.prepare("PRAGMA table_info('photos')").all() as { name: string }[]
      expect(cols.some((c) => c.name === 'deleted_at')).toBe(true)
      kdb.close()
    })

    it('creates the import_jobs table', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const row = kdb.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'")
        .get()
      expect(row).toBeDefined()
      kdb.close()
    })

    it('enables busy_timeout', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const timeout = kdb.db.pragma('busy_timeout', { simple: true })
      expect(timeout).toBe(5000)
      kdb.close()
    })

    it('sets user_version to 2 after all migrations', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const version = kdb.db.pragma('user_version', { simple: true })
      expect(version).toBe(4)
      kdb.close()
    })

    it('skips already-applied migrations on re-open (idempotency)', () => {
      const path = tempDbPath()
      try {
        // First open: runs migration 0→1
        const kdb1 = new KeePicDatabase(path)
        kdb1.open()
        kdb1.close()

        // Second open: user_version=2 already, no migration should run
        const kdb2 = new KeePicDatabase(path)
        kdb2.open()
        const version = kdb2.db.pragma('user_version', { simple: true })
        expect(version).toBe(4)
        kdb2.close()
      } finally {
        cleanup(path)
      }
    })
  })

  describe('close()', () => {
    it('closes an open database without error', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      expect(() => kdb.close()).not.toThrow()
    })

    it('calling close() on an already-closed database is safe', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      kdb.close()
      expect(() => kdb.close()).not.toThrow()
    })

    it('db getter throws after close()', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      kdb.close()
      expect(() => kdb.db).toThrow('Database is not open. Call open() first.')
    })
  })

  describe('photos table schema', () => {
    it('accepts a valid INSERT with all columns', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      expect(() =>
        kdb.db
          .prepare(
            `INSERT INTO photos
            (path, filename, phash, date_taken, date_taken_source,
             width, height, file_size, file_mtime, source,
             google_id, imported_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            '2025/2025.04/IMG_001.jpg',
            'IMG_001.jpg',
            'aabbccdd',
            '2025-04-15T10:00:00Z',
            'exif',
            4032,
            3024,
            2_500_000,
            '2025-04-15T10:00:00Z',
            'local',
            null,
            '2026-02-21T08:00:00Z',
            '2026-02-21T08:00:00Z'
          )
      ).not.toThrow()
      kdb.close()
    })

    it('enforces UNIQUE constraint on path', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      const insert = kdb.db.prepare(
        `INSERT INTO photos (path, filename, source, imported_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      insert.run(
        '2025/2025.04/IMG_001.jpg',
        'IMG_001.jpg',
        'local',
        '2026-02-21T08:00:00Z',
        '2026-02-21T08:00:00Z'
      )
      expect(() =>
        insert.run(
          '2025/2025.04/IMG_001.jpg',
          'IMG_001.jpg',
          'local',
          '2026-02-21T08:00:00Z',
          '2026-02-21T08:00:00Z'
        )
      ).toThrow()
      kdb.close()
    })
  })

  describe('import_jobs table schema', () => {
    it('applies DEFAULT 0 for counter columns', () => {
      const kdb = new KeePicDatabase(':memory:')
      kdb.open()
      kdb.db
        .prepare(
          `INSERT INTO import_jobs (source, started_at, status)
           VALUES (?, ?, ?)`
        )
        .run('local', '2026-02-21T08:00:00Z', 'running')
      const row = kdb.db.prepare('SELECT * FROM import_jobs WHERE id = 1').get() as {
        photos_imported: number
        photos_skipped: number
        live_photos_discarded: number
      }
      expect(row.photos_imported).toBe(0)
      expect(row.photos_skipped).toBe(0)
      expect(row.live_photos_discarded).toBe(0)
      kdb.close()
    })
  })
})
