# TASK-032 — Implement Picker API session management

## Goal

Implement the backend (main process) logic for creating, polling, and reading Google Photos
Picker sessions. This is the core API integration layer that replaces the old
`mediaItems:search` approach.

## Context

The Picker API flow:
1. App creates a session → receives a `pickerUri` + `id`
2. User opens `pickerUri` in browser, selects photos, clicks "Done"
3. App polls the session until `mediaItemsSet` becomes `true`
4. App lists the selected media items from the session

Reference: https://developers.google.com/photos/picker/guides/get-started-picker

## Deliverables

### New module: `src/main/google-photos-picker.ts`

1. **`createPickerSession(accessToken, deps?)`**
   - POST to Picker API session creation endpoint
   - Returns `{ id, pickerUri }` (session ID + URL for user)
   - Injectable `fetch` dep for testing

2. **`pollPickerSession(sessionId, accessToken, deps?)`**
   - GET session status
   - Returns `{ mediaItemsSet: boolean }` (+ any other session fields)
   - Injectable `fetch` dep for testing

3. **`listPickerMediaItems(sessionId, accessToken, pageToken?, deps?)`**
   - GET media items from a completed session (paginated)
   - Returns `{ items: PickerMediaItem[], nextPageToken? }`
   - `PickerMediaItem` type: `{ id, baseUrl, mimeType, filename, mediaMetadata }`
   - Injectable `fetch` dep for testing

### New IPC handlers in `src/main/ipc/google-photos-handlers.ts`

4. **`handleCreatePickerSession`** — calls `createPickerSession`, returns `{ pickerUri, sessionId }`
5. **`handlePollPickerSession`** — calls `pollPickerSession`, returns `{ ready: boolean }`

### Types

6. Add `PickerMediaItem`, `PickerSession` types to `src/shared/types.ts`

### Tests

7. Full unit tests for all 3 functions + 2 IPC handlers
8. Mock fetch responses based on Picker API documentation
9. Error handling: invalid session, network error, expired token (401 → refresh retry)
10. 100% coverage

## Key design decisions

- Same injectable dependency pattern as existing code (`deps?.fetch ?? globalThis.fetch`)
- Token refresh on 401 follows the same pattern as the old downloader
- The Picker session is short-lived (created per import, not persisted)
