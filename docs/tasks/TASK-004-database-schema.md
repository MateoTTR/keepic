# TASK-004 — Implement SQLite Schema and Migrations

> **Status**: Completed
> **Phase**: 1 — Core Foundation
> **Session**: [2026-02-21-session-004](../sessions/2026-02-21-session-004.md)

---

## Goal

Define the SQLite database schema and implement a migration runner so the schema can evolve safely across app versions.

## Deliverables

- [x] `src/main/db/migrations.ts` — readonly array of SQL migration strings
- [x] `src/main/db/database.ts` — `KeePicDatabase` class (open / close / db getter + migration runner)
- [x] `tests/main/db/database.test.ts` — 14 tests, 100% coverage

## Schema (migration 1)

| Table | Key columns |
|---|---|
| `photos` | `path` (UNIQUE), `filename`, `phash`, `date_taken`, `date_taken_source`, `width`, `height`, `file_size`, `file_mtime`, `source`, `google_id`, `imported_at`, `created_at` |
| `import_jobs` | `source`, `started_at`, `status`, `photos_imported`, `photos_skipped`, `live_photos_discarded`, `last_imported_date`, `last_page_token` |

## Notes

- Migration strategy: `PRAGMA user_version` as version counter; each migration runs in its own transaction.
- Idempotent: only migrations with index ≥ `user_version` are applied.
- No CRUD methods — those are added per feature task.
