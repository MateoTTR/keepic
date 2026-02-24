# TASK-031 — Remove deprecated Library API code + update OAuth scope

## Goal

Clean removal of all code implementing the deprecated Google Photos Library API
(`photoslibrary.readonly` scope, `mediaItems:search` endpoint). Update the OAuth scope
to whatever the Picker API requires. This is the prerequisite cleanup step before
building the new Picker integration.

## Context

Google deprecated `photoslibrary.readonly` on March 31, 2025. All existing Google Photos
download/search code is non-functional. This task removes dead code to avoid confusion
and prepares the codebase for the Picker API.

## Deliverables

### Code removal

1. **Delete** `src/main/google-photos-downloader.ts` — the Library API fetch/download logic
2. **Delete** `src/workers/google-photos-download.worker.ts` — the download worker
3. **Delete** `tests/main/google-photos-downloader.test.ts` — associated tests
4. **Remove** from `electron.vite.config.ts` the worker entry for `google-photos-download.worker`

### Code to update (not delete)

5. **`src/main/google-auth.ts`** — Update `GOOGLE_SCOPE` to remove `photoslibrary.readonly`
   and add the Picker API scope (to be determined from Picker API docs during implementation).
   Update scope verification in `startOAuthFlow` and `getValidAccessToken` accordingly.

6. **`src/main/ipc/google-photos-handlers.ts`** — Remove `handleStartDownload` and
   `handleCancelDownload`. Keep `handleGetLastDownloadDate` and `handleCleanupDownloadDir`
   (may be reused). Add placeholder exports for the new Picker handlers (TASK-032).

7. **`src/renderer/src/screens/GoogleDownloadScreen.svelte`** — Replace with a temporary
   "Google Photos import is being upgraded" placeholder screen. The real Picker UI is TASK-034.

8. **`src/preload/index.ts` + `src/preload/index.d.ts`** — Remove `startDownload`,
   `cancelDownload`, `onDownloadProgress`, `onDownloadComplete` IPC bindings.
   Keep `getAuthStatus`, `connect`, `disconnect`, `getLastDownloadDate`.

9. **`src/main/index.ts`** — Remove IPC handler registrations for deleted handlers.

### Tests

10. Remove tests for deleted code. Update remaining Google auth/handler tests if they
    reference the old scope or removed handlers. Maintain 100% coverage.

## Notes

- The `import_jobs` table rows with `source = 'google_photos'` remain in the DB — no migration needed.
- The `photos.google_id` column remains (unused but harmless).
- OAuth connect/disconnect flow is preserved — only the scope and download logic change.
