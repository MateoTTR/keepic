# TASK-013 — Google Photos Media Fetch, Date Filter, and Download

> **Status**: In progress
> **Branch**: `feature/TASK-013-google-photos-import`
> **Base branch**: `develop`
> **Depends on**: TASK-012 (OAuth 2.0 + keychain — completed, merged)

---

## Goal

Implement the Google Photos import as a **two-phase pipeline**:

1. **Phase 1 — Download**: Fetch all media items from Google Photos for the selected date range
   and download them to a local staging folder. Fast, no analysis.
2. **Phase 2 — Local import**: Run the downloaded folder through the existing local import
   pipeline (plan → review → execute), unchanged.

This approach is intentionally aligned with the existing local import flow and does not require
the `google_id` column for deduplication — pHash handles it. This also naturally handles the case
where photos were **manually copied from Google Photos into the library before using KeePic**:
the indexer will have computed their pHash, so duplicates are caught during planning (Phase 2),
just like any other local import.

This task closes the open question in CLAUDE.md:
_"Google Photos date filter: remember last import date, or always prompt?"_
**Decision**: pre-fill from `import_jobs` (last completed download); user adjusts if needed.

---

## Why two phases and not a single streaming import

| Concern | Two-phase approach | Single streaming |
|---|---|---|
| Already-imported photos (no `google_id`) | ✅ pHash catches them in review | ❌ google_id miss |
| Handles partial downloads | ✅ Retry by re-running Phase 2 on temp dir | ❌ All-or-nothing |
| Code reuse | ✅ Phase 2 = existing pipeline, zero new code | ❌ Duplicate pipeline |
| User review before writing to library | ✅ Existing review screen | ❌ Need to add |
| Temp URL constraint (valid ~60 min) | ✅ Download fast in Phase 1, analyse after | ⚠️ Must interleave download + analysis |

---

## Deliverables

### New files

| File | Role |
|---|---|
| `src/main/google-photos-downloader.ts` | List + download all items for a date range |
| `src/workers/google-photos-download.worker.ts` | Thin worker wrapper (untested) |
| `src/main/ipc/google-photos-handlers.ts` | IPC: get-last-download-date, start-download, cancel-download |
| `src/renderer/src/screens/GoogleDownloadScreen.svelte` | UI for Phase 1 (date picker + progress) |
| `tests/main/google-photos-downloader.test.ts` | Unit tests — 100% coverage |
| `tests/main/ipc/google-photos-handlers.test.ts` | Unit tests — 100% coverage |

### Modified files

| File | Change |
|---|---|
| `src/shared/types/index.ts` | Add `GoogleDownloadProgress`, `GoogleDownloadResult` |
| `src/preload/index.ts` | Extend `google` namespace (get-last-download-date, start-download, cancel-download, onDownloadProgress, onDownloadComplete) |
| `src/preload/index.d.ts` | Update `KeePickAPI` types |
| `src/main/index.ts` | Register new `google:*` handlers |
| `src/renderer/src/App.svelte` | Add `'google-download'` screen + routing |
| `src/renderer/src/screens/HomeScreen.svelte` | Enable "Import from Google Photos →" button |
| `docs/architecture/adr/ADR-003-google-photos-integration.md` | Status: Proposed → Accepted |
| `docs/tasks/backlog.md` | TASK-013 in progress |

> **Note**: Phase 2 (local import) requires **zero changes** to the existing pipeline.
> `import:plan`, `import:execute`, PlanningScreen, ReviewScreen, ExecutionScreen, ResultScreen
> are all reused without modification.

---

## Full UI flow

```
HomeScreen
  └── "Import from Google Photos →"
        │
        ▼
GoogleDownloadScreen                              ← new screen
  State: date-select
    │  User picks start date, clicks "Download"
    ▼
  State: downloading
    │  Worker downloads files to userData/temp/google-<ts>/
    │  Progress: "147 photos found · 89 downloaded"
    ▼
  State: complete
    │  "89 photos downloaded — Analyse →"
    │  (sourceFolder = download dir)
    ▼
PlanningScreen  ←────────────────────────────── existing screen, unchanged
    │  pHash + EXIF scan
    ▼
ReviewScreen    ←────────────────────────────── existing screen, unchanged
    │  User reviews duplicates, confirms
    ▼
ExecutionScreen ←────────────────────────────── existing screen, unchanged
    │
    ▼
ResultScreen    ←────────────────────────────── existing screen, unchanged
    │  User clicks "Done" → cleanup download dir → home
    ▼
HomeScreen
```

---

## Architecture — Phase 1 (Download)

### Data flow

```
google:start-download (invoke, { startDate })
      │
      ▼
Main process:
  1. getValidAccessToken() + read StoredTokens from keytar
  2. Create download dir: userData/temp/google-<timestamp>/
  3. Spawn google-photos-download.worker.ts
      │
      ▼
Worker loop:
  ┌─ fetchMediaPage(accessToken, startDate, pageToken?)
  │     POST https://photoslibrary.googleapis.com/v1/mediaItems:search
  │     filters: { dateFilter: { ranges: [startDate..2099] },
  │                mediaTypeFilter: { mediaTypes: ["PHOTO"] } }
  │
  ├─ For each item in page:
  │    ├─ Skip if mimeType starts with 'video/' (defensive guard)
  │    ├─ GET ${item.baseUrl}=d  (original quality)
  │    ├─ Save to downloadDir/<filename> (resolve collisions with _N suffix)
  │    └─ Post progress update
  │
  ├─ Refresh access token if 401 received
  │    (via POST to GOOGLE_TOKEN_URL, no keytar involved)
  │
  └─ Continue with nextPageToken until exhausted or cancelled
      │
      ▼
Worker sends: { type: 'complete', downloaded, skipped, errors,
               downloadDir, updatedAccessToken?, updatedExpiresAt? }
      │
      ▼
Main process:
  - If updatedAccessToken: update keytar
  - Record import_jobs entry: source='google_photos', status='completed',
    last_imported_date = <today's date>
  - Push google:download-complete to renderer
  - Renderer sets sourceFolder = downloadDir → transitions to 'planning' screen
```

### Download directory management

- **Location**: `userData/temp/google-<timestamp>/` (consistent with existing `temp/` pattern)
- **Lifetime**: created at download start, persists until the user dismisses ResultScreen
- **Cleanup**: `App.svelte` tracks `googleDownloadDir` state; on `handleReset()` after a Google
  import, the main process is called to delete it
- **If Phase 2 is cancelled mid-import**: the download dir still exists. The user can
  re-run Phase 2 by clicking "Import from Google Photos" again — the app will notice the
  download is already complete (TODO: detect this in V2). In V1, the dir is orphaned and cleaned
  on next app startup (temp dir cleanup — open question in architecture.md).

### Token handling

Same approach as described in the original spec:
1. Main process fetches valid token + raw `StoredTokens` from keytar before spawning the worker
2. Worker refreshes the token itself if it expires during download (HTTP only, no keytar)
3. On completion, worker sends back updated token data if a refresh occurred
4. Main process updates keytar

---

## Google Photos API

### List endpoint

```
POST https://photoslibrary.googleapis.com/v1/mediaItems:search
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "pageSize": 100,
  "pageToken": "<omit on first page>",
  "filters": {
    "dateFilter": {
      "ranges": [{
        "startDate": { "year": 2025, "month": 1, "day": 1 },
        "endDate":   { "year": 2099, "month": 12, "day": 31 }
      }]
    },
    "mediaTypeFilter": { "mediaTypes": ["PHOTO"] }
  }
}
```

Response fields used:

| Field | Usage |
|---|---|
| `id` | Not stored in Phase 1; ignored (pHash handles dedup in Phase 2) |
| `filename` | Destination filename in the download dir |
| `mimeType` | Defensive filter for `video/*` |
| `baseUrl` | Append `=d` for original-quality download |
| `mediaMetadata.creationTime` | Not used in Phase 1 (EXIF reader handles dates in Phase 2) |
| `nextPageToken` | Pagination |

### Download

```
GET ${item.baseUrl}=d
Authorization: Bearer <accessToken>
```

Save to `downloadDir/<filename>`. Filename collision: append `_1`, `_2`, ... `_99` (same logic
as `resolveCollision` in `importer.ts`).

---

## Incremental sync (date filter)

### Reading the last download date

```sql
SELECT last_imported_date
FROM import_jobs
WHERE source = 'google_photos' AND status = 'completed'
ORDER BY finished_at DESC
LIMIT 1
```

`last_imported_date` is set to **today's date** (at download start time) when the download
completes successfully. This represents: "I have fetched all photos up to this date."

### Default date on first download

No completed `google_photos` job → default to **today − 365 days** (formatted `YYYY-MM-DD`).

### Why record "today" and not the date of the last photo

Recording today's date means the next import will start from a known clean boundary, avoiding
re-fetching photos from the tail of the previous range. The alternative (recording the date of
the last downloaded photo) would cause a one-day overlap on each subsequent import. Both are
acceptable; "today's date" is simpler and avoids redundant downloads.

---

## IPC Channels

### New channels

| Channel | Direction | Type | Payload |
|---|---|---|---|
| `google:get-last-download-date` | Renderer → Main | invoke | `{ date: string \| null }` |
| `google:start-download` | Renderer → Main | invoke | `{ started: true } \| { alreadyRunning: true } \| { error: string }` |
| `google:cancel-download` | Renderer → Main | invoke | void |
| `google:download-progress` | Main → Renderer | push | `GoogleDownloadProgress` |
| `google:download-complete` | Main → Renderer | push | `GoogleDownloadResult` |

### Phase 2 IPC (unchanged, zero new channels)

`import:plan`, `import:plan-progress`, `import:execute`, `import:progress`,
`import:complete`, `import:cancel`

### Existing google channels (unchanged)

`google:get-auth-status`, `google:connect`, `google:disconnect`

---

## New Shared Types

```typescript
// src/shared/types/index.ts additions

export interface GoogleDownloadProgress {
  fetched: number        // API items returned so far (across all pages)
  downloaded: number     // files written to disk
  currentFile: string | null
}

export interface GoogleDownloadResult {
  status: ImportStatus   // 'completed' | 'cancelled' | 'failed'
  downloaded: number
  errors: Array<{ filename: string; error: string }>
  downloadDir: string    // absolute path to the staging folder
}
```

---

## Module Signatures

### `src/main/google-photos-downloader.ts`

```typescript
export interface GoogleMediaItem {
  id: string
  filename: string
  mimeType: string
  baseUrl: string
  mediaMetadata: {
    creationTime: string  // ISO 8601
    width: string
    height: string
  }
}

export interface FetchPageResult {
  items: GoogleMediaItem[]
  nextPageToken?: string
}

// Injectable dependencies
export interface DownloaderDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  writeFile?: (path: string, data: Buffer) => void
  mkdirp?: (path: string) => void
  isCancelled?: () => boolean
}

/**
 * Fetches one page of media items from Google Photos API, filtered by start date.
 * startDate format: 'YYYY-MM-DD'. Throws on HTTP error.
 */
export async function fetchMediaPage(
  accessToken: string,
  startDate: string,
  pageToken?: string,
  deps?: Pick<DownloaderDeps, 'fetch'>
): Promise<FetchPageResult>

/**
 * Downloads the original file for one media item.
 * Throws on HTTP error or write failure.
 */
export async function downloadMediaItem(
  item: GoogleMediaItem,
  accessToken: string,
  destPath: string,
  deps?: Pick<DownloaderDeps, 'fetch' | 'writeFile'>
): Promise<void>

/**
 * Refreshes the access token. Returns new { accessToken, expiresAt } or null on failure.
 */
export async function refreshAccessToken(
  refreshToken: string,
  credentials: { clientId: string; clientSecret: string },
  deps?: Pick<DownloaderDeps, 'fetch'>
): Promise<{ accessToken: string; expiresAt: number } | null>

/**
 * Downloads all Google Photos items in the given date range to downloadDir.
 * Handles pagination, token refresh, filename collisions, and cancellation.
 */
export async function downloadGooglePhotos(
  startDate: string,           // 'YYYY-MM-DD'
  tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    credentials: { clientId: string; clientSecret: string }
  },
  downloadDir: string,
  onProgress: (p: GoogleDownloadProgress) => void,
  deps?: DownloaderDeps
): Promise<GoogleDownloadResult & { updatedAccessToken?: string; updatedExpiresAt?: number }>
```

### `src/main/ipc/google-photos-handlers.ts`

```typescript
export interface ActiveWorkerRef {
  value: Worker | null
}

export type WorkerFactory = (scriptPath: string, options: WorkerOptions) => Worker

/**
 * Returns the last_imported_date of the most recent completed google_photos job,
 * or null if none exists.
 */
export function handleGetLastDownloadDate(db: KeePicDatabase): { date: string | null }

/**
 * Starts the download worker. Returns immediately.
 * The worker pushes progress via onProgress and completion via onComplete.
 */
export async function handleStartDownload(
  startDate: string,
  db: KeePicDatabase,
  dbPath: string,
  userDataPath: string,
  onProgress: (p: GoogleDownloadProgress) => void,
  onComplete: (r: GoogleDownloadResult) => void,
  activeWorkerRef: ActiveWorkerRef,
  workerPath: string,
  deps?: {
    getToken?: typeof getValidAccessToken
    keytarGet?: (service: string, account: string) => Promise<string | null>
    keytarSet?: (service: string, account: string, value: string) => Promise<void>
    createWorker?: WorkerFactory
  }
): Promise<{ started: true } | { alreadyRunning: true } | { error: string }>

/**
 * Sends a cancel message to the running download worker.
 */
export function handleCancelDownload(activeWorkerRef: ActiveWorkerRef): void
```

---

## App.svelte changes

```typescript
type Screen = 'home' | 'google-download' | 'planning' | 'review' | 'executing' | 'result'

// New state
let googleDownloadDir: string = $state('')

// New handler called from HomeScreen
function handleGoogleImport(): void {
  currentScreen = 'google-download'
}

// Called when GoogleDownloadScreen completes
function handleDownloadComplete(result: GoogleDownloadResult): void {
  googleDownloadDir = result.downloadDir
  sourceFolder = result.downloadDir  // ← reuses existing sourceFolder for PlanningScreen
  planProgress = null
  currentScreen = 'planning'         // ← transition to existing planning flow
}

// In handleReset(): if googleDownloadDir is set, call main process to delete it
function handleReset(): void {
  if (googleDownloadDir) {
    window.keepic.google.cleanupDownloadDir(googleDownloadDir)
    googleDownloadDir = ''
  }
  // ... existing reset logic
}
```

This means PlanningScreen, ReviewScreen, ExecutionScreen, ResultScreen receive `sourceFolder = downloadDir` and work identically to a local import. **Zero changes to these screens.**

A new IPC channel `google:cleanup-download-dir` handles deletion of the download directory.

---

## Cleanup download directory

```typescript
// In preload: google.cleanupDownloadDir(path)
// IPC channel: google:cleanup-download-dir (invoke)
// Main: rimraf(path) — same as existing temp dir cleanup
```

This is a simple, stateless operation. No test coverage needed (delegates entirely to `rmSync`
which is already tested via the importer).

Actually, to keep 100% coverage: the handler function takes a `rmDir` injectable dependency
and is tested to call it with the correct path.

---

## GoogleDownloadScreen states

```
┌──────────────────────────────────────────────────────┐
│ Import from Google Photos                            │
│                                                      │
│  Download photos created since:                      │
│  ┌──────────────┐                                   │
│  │  2025-01-15  │  ← pre-filled; default: today-365 │
│  └──────────────┘                                   │
│                                                      │
│  [← Back]     [Download →]                          │
└──────────────────────────────────────────────────────┘

(downloading)
┌──────────────────────────────────────────────────────┐
│ Downloading from Google Photos…                      │
│                                                      │
│  147 photos found · 89 downloaded                   │
│  IMG_4521.HEIC                                       │
│                                                      │
│  [Cancel]                                            │
└──────────────────────────────────────────────────────┘

(complete)
┌──────────────────────────────────────────────────────┐
│ Download complete                                    │
│                                                      │
│  89 photos downloaded                               │
│  2 errors (expandable list)                          │
│                                                      │
│  [← Back]     [Analyse →]                           │
└──────────────────────────────────────────────────────┘
```

"Analyse →" sets `sourceFolder = downloadDir` and transitions to `'planning'`.

---

## Preload extensions

```typescript
// Additions to src/preload/index.ts — google namespace

getLastDownloadDate: (): Promise<{ date: string | null }> =>
  ipcRenderer.invoke('google:get-last-download-date'),

startDownload: (
  startDate: string
): Promise<{ started: true } | { alreadyRunning: true } | { error: string }> =>
  ipcRenderer.invoke('google:start-download', { startDate }),

cancelDownload: (): Promise<void> =>
  ipcRenderer.invoke('google:cancel-download'),

onDownloadProgress: (callback: (p: GoogleDownloadProgress) => void): void => {
  ipcRenderer.on('google:download-progress', (_event, data) => callback(data))
},

onDownloadComplete: (callback: (r: GoogleDownloadResult) => void): void => {
  ipcRenderer.on('google:download-complete', (_event, data) => callback(data))
},

cleanupDownloadDir: (dirPath: string): Promise<void> =>
  ipcRenderer.invoke('google:cleanup-download-dir', { dirPath })
```

---

## import_jobs record for Phase 1

At the end of a successful download (before pushing `google:download-complete`), the main process
writes a record to `import_jobs`:

```sql
INSERT INTO import_jobs
  (source, started_at, finished_at, status, photos_imported, photos_skipped,
   live_photos_discarded, last_imported_date, last_page_token)
VALUES
  ('google_photos', <startedAt>, <finishedAt>, 'completed', <downloaded>, 0, 0,
   <todayDate>, NULL)
```

`photos_imported` = files successfully written to disk.
`last_imported_date` = today's date (used as start date for next download).

If download is cancelled or fails, no record is written (or status = 'cancelled'/'failed' with
no `last_imported_date`, so the next `getLastDownloadDate` query ignores it).

---

## Testing Strategy

**Philosophy**: same as all other modules — mock only external boundaries.

### `google-photos-downloader.ts` (100% coverage target)

| Scenario | Test |
|---|---|
| `fetchMediaPage`: single page, no nextPageToken | ✓ returns items |
| `fetchMediaPage`: includes nextPageToken | ✓ token in result |
| `fetchMediaPage`: 401 response | ✓ throws with message |
| `fetchMediaPage`: 500 response | ✓ throws |
| `fetchMediaPage`: date string parsed into API format correctly | ✓ |
| `downloadMediaItem`: success → file written | ✓ |
| `downloadMediaItem`: HTTP error | ✓ throws |
| `refreshAccessToken`: success → returns new token + expiresAt | ✓ |
| `refreshAccessToken`: failure → returns null | ✓ |
| `downloadGooglePhotos`: single page, all succeed | ✓ |
| `downloadGooglePhotos`: multi-page, pagination followed | ✓ |
| `downloadGooglePhotos`: filename collision → resolved with _N suffix | ✓ |
| `downloadGooglePhotos`: 401 → refresh token → retry succeeds | ✓ |
| `downloadGooglePhotos`: 401 → refresh fails → item error, continues | ✓ |
| `downloadGooglePhotos`: cancellation mid-loop | ✓ status='cancelled' |
| `downloadGooglePhotos`: download error on one item → error recorded, continues | ✓ |
| `downloadGooglePhotos`: all items error → status='completed', errors filled | ✓ |
| `downloadGooglePhotos`: video/* item → skipped (defensive) | ✓ |
| `downloadGooglePhotos`: token was refreshed → updatedAccessToken returned | ✓ |

### `google-photos-handlers.ts` (100% coverage target)

| Scenario | Test |
|---|---|
| `handleGetLastDownloadDate`: no completed job → null | ✓ |
| `handleGetLastDownloadDate`: returns most recent date | ✓ |
| `handleStartDownload`: worker already running → alreadyRunning | ✓ |
| `handleStartDownload`: getToken returns null → error | ✓ |
| `handleStartDownload`: keytarGet returns null → error | ✓ |
| `handleStartDownload`: spawns worker, sets activeWorkerRef | ✓ |
| `handleStartDownload`: progress messages forwarded | ✓ |
| `handleStartDownload`: complete message: db updated, keytar updated if token refreshed | ✓ |
| `handleStartDownload`: complete message: onComplete called with correct result | ✓ |
| `handleCancelDownload`: sends cancel to worker | ✓ |
| `handleCancelDownload`: no-op if no worker running | ✓ |

### Worker file (`google-photos-download.worker.ts`)

Excluded from coverage (`/* v8 ignore file */`). Thin bootstrap only.

---

## Session Checklist

- [ ] **S1** Update `ADR-003`: status Proposed → Accepted, document final decisions
- [ ] **S2** Add `GoogleDownloadProgress`, `GoogleDownloadResult` to `src/shared/types/index.ts`
- [ ] **S3** Implement `src/main/google-photos-downloader.ts` + `tests/main/google-photos-downloader.test.ts`
- [ ] **S4** Implement `src/main/ipc/google-photos-handlers.ts` + `tests/main/ipc/google-photos-handlers.test.ts`
- [ ] **S5** Implement `src/workers/google-photos-download.worker.ts`
- [ ] **S6** Register new handlers in `src/main/index.ts`
- [ ] **S7** Extend `src/preload/index.ts` + `index.d.ts`
- [ ] **S8** Add `GoogleDownloadScreen.svelte`
- [ ] **S9** Update `App.svelte`: add `'google-download'` screen, `handleGoogleImport`, `handleDownloadComplete`, download dir cleanup
- [ ] **S10** Enable "Import from Google Photos" button in `HomeScreen.svelte`
- [ ] **S11** `npm run lint && npm run typecheck && npm run test:coverage` — all green
- [ ] **S12** Open PR targeting `develop`

---

## Open Questions (resolved during spec)

| Question | Decision |
|---|---|
| Temp vs user-defined download folder? | Temp (`userData/temp/google-<ts>/`); cleaned up on reset |
| google_id storage? | **Not stored** — pHash handles dedup in Phase 2 |
| Default date on first import? | Today − 365 days |
| What does `last_imported_date` record? | Today's date (at download start) |
| What if Phase 2 is cancelled? | Download dir orphaned; cleaned on next reset or app restart |
| Skip videos? | Yes — `mediaTypeFilter: ["PHOTO"]` in API + defensive `video/*` guard |
| HEIC files? | Downloaded as-is; Phase 2 HEIC conversion handles them |
