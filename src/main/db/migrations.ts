/**
 * SQLite migrations for KeePic.
 *
 * Each entry is a SQL string applied in a single transaction.
 * The index corresponds to the schema version after the migration runs
 * (migrations[0] brings the DB from version 0 to version 1, etc.).
 *
 * Never modify an existing migration — always append a new one.
 */
export const migrations: readonly string[] = [
  // Migration 0 → 1: initial schema
  `
  CREATE TABLE photos (
    id                INTEGER PRIMARY KEY,
    path              TEXT    NOT NULL UNIQUE,
    filename          TEXT    NOT NULL,
    phash             TEXT,
    date_taken        TEXT,
    date_taken_source TEXT,
    width             INTEGER,
    height            INTEGER,
    file_size         INTEGER,
    file_mtime        TEXT,
    source            TEXT    NOT NULL,
    google_id         TEXT,
    imported_at       TEXT    NOT NULL,
    created_at        TEXT    NOT NULL
  );

  CREATE TABLE import_jobs (
    id                    INTEGER PRIMARY KEY,
    source                TEXT    NOT NULL,
    started_at            TEXT    NOT NULL,
    finished_at           TEXT,
    status                TEXT    NOT NULL,
    photos_imported       INTEGER NOT NULL DEFAULT 0,
    photos_skipped        INTEGER NOT NULL DEFAULT 0,
    live_photos_discarded INTEGER NOT NULL DEFAULT 0,
    last_imported_date    TEXT,
    last_page_token       TEXT
  );
  `,

  // Migration 1 → 2: add deleted_at to track files removed from the shared library
  `ALTER TABLE photos ADD COLUMN deleted_at TEXT;`,

  // Migration 2 → 3: add media_type to distinguish photos from videos
  `ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo';`,

  // Migration 3 → 4: add job_id to link photos to their import job
  `ALTER TABLE photos ADD COLUMN job_id INTEGER REFERENCES import_jobs(id);`,

  // Migration 4 → 5: add dhash for dual-hash deduplication (pHash + dHash)
  // Also nullifies existing phash values since the threshold changed (mean → median).
  // A re-index is required after this migration to recompute all hashes.
  `ALTER TABLE photos ADD COLUMN dhash TEXT;
   UPDATE photos SET phash = NULL WHERE phash IS NOT NULL;`
]
