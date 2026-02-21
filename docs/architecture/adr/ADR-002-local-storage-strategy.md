# ADR-002 — Local Storage Strategy

> **Status**: Accepted
> **Date**: 2026-02-21
> **Deciders**: Project owner

---

## Context

KeePic stores photos and metadata entirely on the user's machine. We need to decide:
1. How photo **files** are organized on disk
2. How **metadata** (dates, hashes, albums, import history) is stored and queried
3. Where **app data** (DB, thumbnails, temp files) is stored

A critical constraint has been established: the **library folder must be clean** (raw photos only) so that it can be safely synchronized with Synology Drive or any other folder-sync tool. No database files, thumbnails, or temp files can live inside the library folder.

The solution must handle libraries up to 50,000 photos while remaining fast, recoverable from corruption, and understandable by the user (they should be able to find their photos without KeePic if needed).

---

## Decision Drivers

- Human readability: the user must be able to browse files without KeePic
- Sync compatibility: library folder must be clean (raw photos only) for Synology Drive
- Query performance: filtering by date, searching by filename
- Resilience: if the DB is lost, the library should be rebuildable from the files
- Simplicity: avoid complex infrastructure (no PostgreSQL, no Docker)
- Portability: the library folder can be moved to another disk

---

## Considered Options

### Option A — Flat folder + JSON metadata sidecar files

**Description**: Photos stored as `library/YYYY/MM/DD/filename.ext`. Each photo has a companion `.json` sidecar file with metadata (hash, source, album membership, etc.).

**Pros**:
- Fully self-contained: the library is human-readable without KeePic
- No database to corrupt or migrate
- Portable: copy the folder anywhere

**Cons**:
- Querying is slow (must scan all sidecars to filter/search)
- No efficient way to query across albums or by hash
- Not suitable for 50,000+ photos without an index

---

### Option B — Filesystem + SQLite index (recommended)

**Description**: Photos stored as `library/YYYY/MM/DD/filename.ext`. A single SQLite database (`library/.keepic/index.db`) stores all metadata, hashes, album memberships, and import history. The DB is a derived index — it can be fully rebuilt by scanning the filesystem.

**Pros**:
- Fast queries (SQL: filter by date, search by hash, join albums)
- SQLite is a single file, no server required, very reliable
- DB loss is recoverable: rescan the filesystem to rebuild the index
- Human-readable file organization preserved
- Well-supported in both Node.js (`better-sqlite3`) and Rust (`rusqlite`)

**Cons**:
- Two sources of truth (files + DB) — must keep them in sync
- DB needs migration management as schema evolves

---

### Option C — SQLite only (files stored as BLOBs)

**Description**: Photos stored as binary BLOBs inside SQLite. No separate files on disk.

**Pros**:
- Single source of truth
- Atomic operations

**Cons**:
- Not human-readable: user cannot browse photos without KeePic
- SQLite is not designed for large BLOBs (poor performance at scale)
- Cannot use native image viewers or other tools
- Catastrophic if DB is corrupted

---

## Decision

**Chosen option: Option B — Filesystem + SQLite index**

**Rationale**: Option B provides the best balance between query performance and human readability. The filesystem remains the primary source of truth for files; SQLite is a derived index that can always be rebuilt. Option A is too slow at scale. Option C sacrifices human readability for no meaningful gain.

The key refinement vs the original proposal: **all app data (SQLite DB, thumbnails, temp folder) is stored in the OS application data directory**, completely separate from the library folder. This ensures the library folder is clean and sync-safe.

---

## Proposed SQLite Schema (draft)

```sql
-- Photos table
CREATE TABLE photos (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,      -- relative path from library root
  filename    TEXT NOT NULL,
  phash       TEXT,                      -- perceptual hash for deduplication
  date_taken  TEXT,                      -- ISO 8601, from EXIF or fallback
  date_taken_source TEXT,               -- 'exif' | 'filename' | 'file_mtime' | 'import'
  width       INTEGER,
  height      INTEGER,
  file_size   INTEGER,
  source      TEXT,                      -- 'local' | 'google_photos' | 'sd_card' | 'whatsapp'
  google_id   TEXT,                      -- Google Photos media item ID (if applicable)
  imported_at TEXT NOT NULL,             -- ISO 8601
  created_at  TEXT NOT NULL
);

-- Albums table
CREATE TABLE albums (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Album memberships
CREATE TABLE album_photos (
  album_id   INTEGER REFERENCES albums(id),
  photo_id   INTEGER REFERENCES photos(id),
  PRIMARY KEY (album_id, photo_id)
);

-- Import jobs history
CREATE TABLE import_jobs (
  id          INTEGER PRIMARY KEY,
  source      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,   -- 'running' | 'completed' | 'failed' | 'cancelled'
  photos_imported INTEGER DEFAULT 0,
  photos_skipped  INTEGER DEFAULT 0,
  last_token  TEXT             -- resumption token for Google Photos incremental sync
);
```

---

## Thumbnail Strategy

- Thumbnails stored in `library/.keepic/thumbs/{photo_id}_{size}.webp`
- Generated lazily on first display, cached permanently
- Sizes: `256` (grid), `1024` (preview panel)
- WebP format for good compression ratio
- Thumbnails are fully derivable from originals and can be deleted/rebuilt at any time

---

## Storage Layout

**Library folder** — user-configurable, sync-safe, raw photos only:
```
~/Pictures/KeePic/            ← user-configurable root (synced by Synology Drive)
├── 2023/
│   ├── 04/
│   │   └── 15/
│   │       └── IMG_1234.jpg
│   └── 07/
│       └── ...
└── 2024/
    └── ...
```

**App data directory** — OS standard location, never synced:
```
Windows:  %APPDATA%\KeePic\
macOS:    ~/Library/Application Support/KeePic/
├── config.json               ← app settings (library path, preferences)
├── index.db                  ← SQLite metadata index
├── thumbs/                   ← thumbnail cache (future browse feature)
└── temp/                     ← import staging area (cleaned after each import)
```

---

## Consequences

### Positive
- Fast browsing and filtering via SQL
- Human-readable on-disk structure
- Resilient: DB can always be rebuilt from files

### Negative / Trade-offs
- Must keep filesystem and DB in sync during imports
- Schema migrations required as features evolve (use a migration tool)

### Neutral
- Library root should be user-configurable (default: `~/Pictures/KeePic`)

---

## References

- [SQLite — Appropriate Uses](https://www.sqlite.org/whentouse.html)
- [better-sqlite3 (Node.js)](https://github.com/WiseLibs/better-sqlite3)
- [rusqlite (Rust)](https://github.com/rusqlite/rusqlite)
