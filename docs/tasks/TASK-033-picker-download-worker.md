# TASK-033 — Implement Picker download worker

## Goal

Implement the worker thread that downloads the photos selected via the Picker API to a
local staging folder. This replaces the old `google-photos-download.worker.ts`.

## Context

After the user selects photos in the Picker UI and the session reports `mediaItemsSet: true`,
the app needs to:
1. List all selected media items from the session (paginated)
2. Download each item's original file to a staging folder
3. Report progress to the main thread
4. Support cancellation

This is Phase 1 of the two-phase pipeline (download → local import).

## Deliverables

### New module: `src/main/google-photos-picker-downloader.ts`

1. **`downloadPickerPhotos(sessionId, tokens, downloadDir, onProgress, deps?)`**
   - Paginates through `listPickerMediaItems` to get all selected items
   - Downloads each item's original file via `baseUrl` (+ `=d` suffix if applicable)
   - Reports progress: `{ total, downloaded, currentFile }`
   - Handles filename collisions (reuse `resolveFilenameCollision`)
   - Returns `{ status, downloaded, errors, downloadDir, updatedAccessToken? }`
   - Supports cooperative cancellation via `deps.isCancelled()`

### New worker: `src/workers/google-photos-picker.worker.ts`

2. Thin worker entry point (same pattern as existing workers)
   - Receives `{ sessionId, tokens, downloadDir, dbPath, config }` via `workerData`
   - Calls `downloadPickerPhotos`
   - Posts `progress`, `complete`, `error` messages
   - Listens for `cancel` message

### Update `electron.vite.config.ts`

3. Add worker entry: `'workers/google-photos-picker.worker'`

### Update IPC handlers

4. **`handleStartPickerDownload`** in `google-photos-handlers.ts`
   - Similar to old `handleStartDownload` but receives `sessionId` instead of `startDate`
   - Spawns the new worker, wires up progress/complete/error/exit handlers
   - Persists updated tokens on completion
   - Records `google_photos` import_job in DB on success

### Tests

5. Full unit tests for `downloadPickerPhotos` (mock fetch, cancellation, errors, token refresh)
6. IPC handler tests (same patterns as existing handler tests)
7. 100% coverage

## Key design decisions

- The download logic is extracted into a testable module (not in the worker file)
- Same `DownloaderTokens` type and token refresh pattern as before
- Same `resolveFilenameCollision` utility reused
- Phase 2 (local import pipeline) is completely unchanged
