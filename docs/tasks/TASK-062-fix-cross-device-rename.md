# TASK-062-fix — Fix cross-device rename error during import (EXDEV)

## Context

When the temp directory (in `%APPDATA%` on C:) and the library folder (on D:) are on different drives, `fs.renameSync()` fails with `EXDEV: cross-device link not permitted`. This affects both local imports and Google Picker imports when the staged/temp file is moved to the library destination.

## Root Cause

`fs.renameSync()` only works within the same filesystem/partition. On Windows, `C:\Users\...\AppData\...` → `D:\Pictures\...` is a cross-device move.

## Fix

Replace the default `moveFileFn` in `executeImport` with an EXDEV-aware fallback:
1. Try `renameSync(src, dest)` (fast, same-device)
2. On `EXDEV` error, fall back to `copyFileSync(src, dest)` + `unlinkSync(src)`

## Files Changed

| File | Change |
|------|--------|
| `src/main/importer.ts` | EXDEV fallback in default `moveFileFn` |
| `tests/main/importer.test.ts` | Test for EXDEV cross-device fallback |
| `docs/tasks/backlog.md` | Add TASK-062 |
