# TASK-058-feat — Purge database when library path changes

## Context

When the user changes the library folder path, the SQLite database retains index data
(photos, import_jobs) from the previous library. These stale entries reference files
that no longer exist at the configured path.

Needed primarily for testing scenarios where users switch between libraries.

## Goal

Purge the `photos` and `import_jobs` tables when the library path changes to a different value.

## Design

- Added an optional `onLibraryChanged` callback parameter to `handleSelectLibraryFolder`
- The callback fires only when the library path changes (not on first selection, same path, or cancelled dialog)
- In `index.ts`, the callback executes `DELETE FROM photos` and `DELETE FROM import_jobs`
- 4 new tests cover: path changed, same path, first selection, cancelled dialog

## Deliverables

- [x] Add `onLibraryChanged` callback to `handleSelectLibraryFolder`
- [x] Wire purge logic in `index.ts`
- [x] Add 4 tests — 531 total, 100% coverage

## Files Changed

| File | Change |
|------|--------|
| `src/main/ipc/config-handlers.ts` | Add `onLibraryChanged` callback parameter |
| `src/main/index.ts` | Pass purge callback (DELETE FROM photos + import_jobs) |
| `tests/main/ipc/config-handlers.test.ts` | 4 new tests for callback behavior |
