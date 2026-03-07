# TASK-041 — Fix missing progress during Phase 1

## Status: Complete (PR #42, merged)

## Problem

After PERF-001 introduced the two-phase pattern (Phase 1: parallel CPU-bound work, Phase 2: sequential DB writes + progress), the UI stays stuck on "Starting..." during the entire Phase 1. The `onProgress` callback is only called during Phase 2, which means the user sees no feedback until all files have been processed.

This affects:
- **Indexer** (`runIndexer`): no progress during pHash + EXIF extraction
- **Planner** (`buildImportPlan`): no progress during pHash + EXIF + HEIC staging
- **Executor** (`executeImportPlan`): no progress during file copy/move operations

## Solution

1. **Initial progress event**: send `{ total, processed: 0 }` immediately after the scan, before Phase 1 starts.
2. **Phase 1 per-file progress**: use a shared counter incremented after each file completes in `withConcurrency`. Since JavaScript is single-threaded, a simple `let counter = 0; counter++` between `await` points is safe.
3. **Phase 2 progress**: keep existing behavior (updates `indexed`/`skipped`/`imported` counts).

### Progress semantics

During Phase 1, `processed` increments from 0 to total. `indexed`/`skipped` remain 0 (not known yet).
During Phase 2, `processed` stays at total. `indexed`/`skipped` increment as DB writes happen.

## Files Modified

- `src/main/indexer.ts` — add initial + Phase 1 progress
- `src/main/importer.ts` — add initial + Phase 1 progress to both `buildImportPlan` and `executeImportPlan`
- `tests/main/indexer.test.ts` — update progress assertions
- `tests/main/importer.test.ts` — update progress assertions

## IPC Channels

No new IPC channels. Uses existing `onProgress` callbacks.
