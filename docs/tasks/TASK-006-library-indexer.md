# TASK-006 — Implement Library Indexer

> **Status**: In progress
> **Phase**: 1 — Core Foundation
> **Session**: 2026-02-21-session-006

---

## Goal

Scan the shared library folder and build/refresh the local SQLite index. For each image file found, extract EXIF metadata (TASK-007) and compute a perceptual hash (TASK-008), then upsert the record in the DB. Run the scan in a Node.js worker thread so the UI stays responsive.

## Deliverables

- [ ] `src/main/exif.ts` — EXIF date extraction with fallback chain (TASK-007 scope)
- [ ] `src/main/phash.ts` — DCT-based pHash computation via `sharp` (TASK-008 scope)
- [ ] `src/main/indexer.ts` — `runIndexer(libraryPath, db, onProgress, options)` — scanner, upsert, deletion marking
- [ ] `src/workers/indexer.worker.ts` — worker_threads bootstrap (excluded from coverage)
- [ ] `src/main/db/migrations.ts` — migration 2: add `deleted_at TEXT` to `photos`
- [ ] `src/main/db/database.ts` — add `PRAGMA busy_timeout = 5000`
- [ ] `src/main/index.ts` — `library:start-index` IPC handler
- [ ] `src/shared/types/index.ts` — `IndexProgress`, `IndexResult`
- [ ] `vitest.config.ts` — exclude `src/workers/**` from coverage
- [ ] `tests/main/exif.test.ts`
- [ ] `tests/main/phash.test.ts`
- [ ] `tests/main/indexer.test.ts`

## IPC Channels

| Channel | Direction | Description |
|---|---|---|
| `library:start-index` | renderer → main | Starts background indexer worker; returns `{ started }` or `{ alreadyRunning }` |
| `library:index-progress` | main → renderer (push) | Progress updates during scan |
| `library:index-complete` | main → renderer (push) | Final result or error |

## Key Design Decisions

- **Injectable dependencies**: `ExifLoader` and `PhashComputer` are function types passed as parameters to `runIndexer`. This allows testing without real image files.
- **Relative paths in DB**: `path` column stores paths relative to the library root (e.g., `2025/2025.01/IMG_001.jpg`) for multi-user portability.
- **Skip unchanged files**: if `path` + `file_mtime` are unchanged in the DB, the file is skipped.
- **Deletion marking**: after scan, photos in DB whose path was not found on disk are marked with `deleted_at`.
- **Worker thread**: the indexer logic runs in a separate thread; the main process forwards progress via `webContents.send`.

## Packages Added

- `exifreader` — pure JS EXIF parser (no native compilation)

## EXIF Fallback Chain (§2.6)

| Priority | Source | `date_taken_source` value |
|---|---|---|
| 1 | EXIF `DateTimeOriginal` | `'exif'` |
| 2 | EXIF `DateTime` | `'exif'` |
| 3 | Filename pattern (`YYYYMMDD`, `YYYY-MM-DD`, `YYYY_MM_DD`) | `'filename'` |
| 4 | File modification time | `'file_mtime'` |
