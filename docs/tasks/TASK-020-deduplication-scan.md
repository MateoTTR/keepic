# TASK-020 — Implement standalone deduplication scan

## Goal

Allow users to scan the existing library index for photos that are already duplicated within the library (same pHash, different paths). The result is a **read-only report** — the app is append-only and never deletes files. Users resolve duplicates manually in the shared folder, then re-index.

---

## Context

During import (TASK-010/013), the planner catches duplicates before they enter the library. But the library may already contain duplicates from:
- Imports made before pHash deduplication was in place
- Photos copied manually into the shared folder by a user
- Two users importing the same photo independently

This task adds a fast, synchronous duplicate-detection pass directly against the local SQLite index (no filesystem I/O needed — all pHashes are already stored).

---

## Append-only contract

The scan is **read-only**: it queries the DB and returns results. No files are deleted. No DB rows are modified. The user resolves duplicates manually (delete files from shared folder → re-index via TASK-021).

---

## Deliverables

| File | Action |
|---|---|
| `src/main/ipc/dedup-scan-handler.ts` | New — IPC handler + SQL query |
| `tests/main/ipc/dedup-scan-handler.test.ts` | New — 100% coverage |
| `src/shared/types/index.ts` | Add `DuplicatePhoto` + `DuplicateGroup` interfaces |
| `src/preload/index.ts` + `index.d.ts` | Add `library.scanDuplicates` bridge |
| `src/main/index.ts` | Register `library:scan-duplicates` handler |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | New — scan results display |
| `src/renderer/src/screens/HomeScreen.svelte` | Add "Scan for duplicates" button + `onDedupScan` prop |
| `src/renderer/src/App.svelte` | Add `'dedup-scan'` screen state + navigation |

---

## Shared types

```typescript
// src/shared/types/index.ts

export interface DuplicatePhoto {
  path: string
  filename: string
  fileSize: number | null
  dateTaken: string | null
  importedAt: string
}

export interface DuplicateGroup {
  phash: string
  photos: DuplicatePhoto[] // always 2+ items, sorted by importedAt ASC
}
```

---

## IPC handler

**File**: `src/main/ipc/dedup-scan-handler.ts`

```typescript
export function handleScanDuplicates(db: KeePicDatabase): DuplicateGroup[]
```

### Algorithm

1. Single SQL query: fetch all non-deleted photos whose pHash appears more than once, ordered by `phash` then `imported_at ASC`.
2. Group the flat rows by `phash` in TypeScript.

```sql
SELECT path, filename, file_size, date_taken, imported_at, phash
FROM photos
WHERE deleted_at IS NULL
  AND phash IS NOT NULL
  AND phash IN (
    SELECT phash
    FROM photos
    WHERE deleted_at IS NULL AND phash IS NOT NULL
    GROUP BY phash
    HAVING COUNT(*) > 1
  )
ORDER BY phash ASC, imported_at ASC
```

### Implementation sketch

```typescript
import type { KeePicDatabase } from '../db/database'
import type { DuplicateGroup, DuplicatePhoto } from '../../shared/types'

export function handleScanDuplicates(db: KeePicDatabase): DuplicateGroup[] {
  const rows = db.db
    .prepare(
      `SELECT path, filename, file_size, date_taken, imported_at, phash
       FROM photos
       WHERE deleted_at IS NULL
         AND phash IS NOT NULL
         AND phash IN (
           SELECT phash FROM photos
           WHERE deleted_at IS NULL AND phash IS NOT NULL
           GROUP BY phash HAVING COUNT(*) > 1
         )
       ORDER BY phash ASC, imported_at ASC`
    )
    .all() as Array<{
      path: string
      filename: string
      file_size: number | null
      date_taken: string | null
      imported_at: string
      phash: string
    }>

  // Group rows by phash
  const groupMap = new Map<string, DuplicatePhoto[]>()
  for (const row of rows) {
    const photo: DuplicatePhoto = {
      path: row.path,
      filename: row.filename,
      fileSize: row.file_size,
      dateTaken: row.date_taken,
      importedAt: row.imported_at
    }
    const existing = groupMap.get(row.phash)
    if (existing) {
      existing.push(photo)
    } else {
      groupMap.set(row.phash, [photo])
    }
  }

  return Array.from(groupMap.entries()).map(([phash, photos]) => ({ phash, photos }))
}
```

---

## IPC channel

| Channel | Direction | Payload |
|---|---|---|
| `library:scan-duplicates` | invoke → reply | `DuplicateGroup[]` |

No worker thread: the query is a fast in-memory aggregate on an indexed column. Runs synchronously in the main process.

### Registration in `src/main/index.ts`

```typescript
ipcMain.handle('library:scan-duplicates', () => {
  if (!database) return []
  return handleScanDuplicates(database)
})
```

### Preload (`src/preload/index.ts`)

```typescript
library: {
  // existing: startIndex, onIndexProgress, onIndexComplete, getStats
  scanDuplicates: () =>
    ipcRenderer.invoke('library:scan-duplicates') as Promise<DuplicateGroup[]>,
}
```

---

## UI

### `DeduplicationScreen.svelte`

**Location**: `src/renderer/src/screens/DeduplicationScreen.svelte`

**Props:**
```typescript
interface Props {
  onBack: () => void
}
```

**Behaviour:**
- On mount: call `window.keepic.library.scanDuplicates()`
- Show a loading state while waiting
- Display results (see layout below)

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Duplicate Scan                          [← Back]   │
│                                                     │
│  Scanning…                                          │
│  (or, after scan:)                                  │
│                                                     │
│  ✓ No duplicates found                             │
│  (or:)                                              │
│  3 duplicate groups found (7 photos total)         │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Group 1 — 2 identical photos                       │
│  2024/2024.06/IMG_1234.jpg  2.1 MB  Jun 15, 2024  │
│  2024/2024.07/IMG_1234.jpg  2.1 MB  Jun 15, 2024  │
│                                                     │
│  Group 2 — 3 identical photos                       │
│  ...                                                │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  To remove duplicates: delete the unwanted files   │
│  from the shared folder, then re-index.            │
└─────────────────────────────────────────────────────┘
```

- `fileSize` formatted as `X.X GB` / `X MB` / `X KB` (reuse same helper as `StatsPanel`)
- `dateTaken` formatted as locale date string (or `—` if null)
- `importedAt` formatted as locale date string
- Each group header: `Group N — M identical photos`
- Footer note only shown when at least 1 duplicate group exists

### Integration in `HomeScreen.svelte`

Add `onDedupScan` callback prop. Add a button below the import section:

```typescript
interface Props {
  // existing props...
  onDedupScan: () => void
}
```

Button placement: inside the import card, after the Google Photos section, after a `<hr>`.

```svelte
<hr class="border-gray-200" />
<div class="space-y-3">
  <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Library</p>
  <Button variant="outline" onclick={onDedupScan}>Scan for duplicates</Button>
</div>
```

### Integration in `App.svelte`

Add `'dedup-scan'` to the `Screen` union type. Wire `onDedupScan` on `HomeScreen` and render `DeduplicationScreen` for the `dedup-scan` state.

---

## Testing strategy

**File**: `tests/main/ipc/dedup-scan-handler.test.ts`

Use in-memory SQLite: `new KeePicDatabase(':memory:'); db.open()`.

### Helper

```typescript
function insertPhoto(db, { path, phash, deletedAt?, fileSize?, dateTaken?, importedAt? }): void
```

### Test scenarios

| Scenario | Expected |
|---|---|
| Empty DB | `[]` |
| All photos have unique phash | `[]` |
| Two photos with same phash, both non-deleted | One group with 2 photos |
| Three photos with same phash | One group with 3 photos |
| Two duplicate groups | Both groups returned |
| Photo with `phash = NULL` | Not included (even if paired with another NULL) |
| One photo deleted (`deleted_at` set) of a pair | No group (only 1 non-deleted remains) |
| Both photos deleted of a pair | No group |
| Photos sorted by `imported_at ASC` within a group | Oldest first within each group |
| `file_size = NULL` for a photo | Included, `fileSize: null` |
| `date_taken = NULL` for a photo | Included, `dateTaken: null` |

---

## Checklist

- [ ] `DuplicatePhoto` + `DuplicateGroup` types added to `src/shared/types/index.ts`
- [ ] `handleScanDuplicates` implemented and exported
- [ ] Tests: 100% coverage (statements, branches, functions, lines)
- [ ] `library:scan-duplicates` registered in `src/main/index.ts`
- [ ] Preload + type declaration updated
- [ ] `DeduplicationScreen.svelte` component created
- [ ] `HomeScreen.svelte` updated with `onDedupScan` prop + button
- [ ] `App.svelte` updated with `dedup-scan` screen
- [ ] `npm run lint` → 0 errors
- [ ] `npm run typecheck` → clean
- [ ] `npm run test:coverage` → 100% non-frontend coverage
- [ ] PR opened targeting `develop`
