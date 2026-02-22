# TASK-019 — Implement library statistics view

## Goal

Display a summary of the local library directly on the home screen: photo count, total size, date range, and import history. This gives users a quick health-check of their library without leaving the app.

---

## Context

The local SQLite index (`photos` and `import_jobs` tables) already contains all the data needed for statistics. This task adds:
1. A `handleGetLibraryStats` IPC handler that runs synchronous SQL queries against the DB
2. A `LibraryStats` type in shared types
3. A `StatsPanel` Svelte component displayed on the `HomeScreen` below the import actions

No worker thread is needed — the queries are fast (aggregates on an indexed table).

---

## Deliverables

| File | Action |
|---|---|
| `src/main/ipc/library-stats-handler.ts` | New — IPC handler + SQL queries |
| `tests/main/ipc/library-stats-handler.test.ts` | New — 100% coverage |
| `src/shared/types/index.ts` | Add `LibraryStats` interface |
| `src/preload/index.ts` + `index.d.ts` | Add `library.getStats` bridge |
| `src/main/index.ts` | Register `library:get-stats` handler |
| `src/renderer/src/components/StatsPanel.svelte` | New — stats display component |
| `src/renderer/src/screens/HomeScreen.svelte` | Add `StatsPanel` below import actions |

---

## Shared type

```typescript
// src/shared/types/index.ts

export interface LibraryStats {
  totalPhotos: number           // non-deleted photos in the index
  totalSizeBytes: number        // sum of file_size for non-deleted photos
  oldestDate: string | null     // ISO date string (YYYY-MM-DD) or null if empty
  newestDate: string | null     // ISO date string (YYYY-MM-DD) or null if empty
  photosByYear: Array<{ year: string; count: number }>  // sorted ascending
  recentImports: Array<{        // last 5 completed import_jobs, newest first
    source: ImportSource
    finishedAt: string          // ISO 8601
    photosImported: number
    photosSkipped: number
  }>
}
```

---

## IPC handler

**File**: `src/main/ipc/library-stats-handler.ts`

```typescript
export function handleGetLibraryStats(db: KeePicDatabase): LibraryStats
```

### SQL queries (all synchronous via `better-sqlite3`)

```sql
-- Totals
SELECT COUNT(*) AS totalPhotos, COALESCE(SUM(file_size), 0) AS totalSizeBytes
FROM photos
WHERE deleted_at IS NULL;

-- Date range
SELECT MIN(date_taken) AS oldestDate, MAX(date_taken) AS newestDate
FROM photos
WHERE deleted_at IS NULL AND date_taken IS NOT NULL;

-- Photos by year
SELECT substr(date_taken, 1, 4) AS year, COUNT(*) AS count
FROM photos
WHERE deleted_at IS NULL AND date_taken IS NOT NULL
GROUP BY year
ORDER BY year ASC;

-- Recent imports (last 5 completed)
SELECT source, finished_at, photos_imported, photos_skipped
FROM import_jobs
WHERE status = 'completed'
ORDER BY finished_at DESC
LIMIT 5;
```

### Injectable dependency pattern

```typescript
export interface LibraryStatsDeps {
  now?: () => string   // injectable for testing; not used in current implementation
}
```

`now` is not needed for the current implementation but is included for consistency with the project pattern. The ESLint `args: "after-used"` rule prevents including an unused `deps` parameter after `db`, so the interface is defined for documentation purposes only.

---

## IPC channel

| Channel | Direction | Payload |
|---|---|---|
| `library:get-stats` | invoke → reply | `LibraryStats` |

Registration in `src/main/index.ts`:

```typescript
ipcMain.handle('library:get-stats', () => {
  if (!database) return null
  return handleGetLibraryStats(database)
})
```

Preload (`src/preload/index.ts`):

```typescript
library: {
  // existing: startIndex, onIndexProgress, onIndexComplete
  getStats: () => ipcRenderer.invoke('library:get-stats') as Promise<LibraryStats | null>,
}
```

---

## UI — `StatsPanel.svelte`

**Location**: `src/renderer/src/components/StatsPanel.svelte`

### Props

```typescript
interface Props {
  stats: LibraryStats | null
}
```

### Layout (single card, below import actions on HomeScreen)

```
┌─────────────────────────────────────────────────────┐
│  Library                                            │
│                                                     │
│  12,450 photos   •   48.2 GB   •   2019 – 2026     │
│                                                     │
│  Recent imports                                     │
│  ─────────────────────────────────────────────────  │
│  Local folder   Apr 12, 2026    +234 photos         │
│  Google Photos  Mar 1, 2026     +87 photos          │
│  Local folder   Feb 22, 2026    +12 photos          │
└─────────────────────────────────────────────────────┘
```

- If `stats === null` (library not yet configured or indexed): render nothing
- `totalSizeBytes` formatted as `X.X GB` / `X MB` / `X KB`
- Date range: `oldestDate.slice(0,4)` – `newestDate.slice(0,4)` (years only)
- Source labels: `'local'` → `"Local folder"`, `'google_photos'` → `"Google Photos"`
- `finishedAt` formatted as locale date string
- If `recentImports` is empty: show `"No imports yet"`

### Integration in `HomeScreen.svelte`

```typescript
// onMount: call getStats
import { onMount } from 'svelte'
// ...
let stats: LibraryStats | null = $state(null)

onMount(async () => {
  stats = await window.keepic.library.getStats()
})
```

Add `<StatsPanel {stats} />` below the import action card (both wrapped in a `<div class="space-y-6">`).

---

## Testing strategy

**File**: `tests/main/ipc/library-stats-handler.test.ts`

Use in-memory SQLite: `new KeePicDatabase(':memory:'); db.open()`.

### Test scenarios

| Scenario | Expected |
|---|---|
| Empty DB (no photos, no jobs) | `totalPhotos: 0`, `totalSizeBytes: 0`, `oldestDate: null`, `newestDate: null`, `photosByYear: []`, `recentImports: []` |
| Single photo, no date_taken | Photo counted, `oldestDate: null`, `newestDate: null`, not in `photosByYear` |
| Multiple photos across years | Correct `photosByYear` order and counts |
| Photos with `deleted_at` set | Excluded from all counts |
| `file_size` is NULL for some photos | `COALESCE` handles it (counted but size = 0) |
| 6 completed import_jobs | Only 5 returned, newest first |
| Import jobs with non-`completed` status | Excluded from `recentImports` |
| Mix of `local` and `google_photos` sources | Both appear in `recentImports` correctly |

---

## Checklist

- [x] `LibraryStats` type added to `src/shared/types/index.ts`
- [x] `handleGetLibraryStats` implemented and exported
- [x] Tests: 100% coverage (statements, branches, functions, lines)
- [x] `library:get-stats` registered in `src/main/index.ts`
- [x] Preload + type declaration updated
- [x] `StatsPanel.svelte` component created
- [x] `HomeScreen.svelte` updated to fetch and display stats
- [x] `npm run lint` → 0 errors
- [x] `npm run typecheck` → clean
- [x] `npm run test:coverage` → 100% non-frontend coverage (305 tests)
- [x] PR #9 opened targeting `develop`
