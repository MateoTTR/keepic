# TASK-021 — Implement manual re-index of library folder

## Goal

Expose the existing library indexer to the user via a "Re-index library" button in the Library section of `HomeScreen`. The indexer (`runIndexer` + `indexer.worker.ts`) is already fully implemented (TASK-006) and its IPC channels are already registered in the main process. TASK-021 is **UI-only**: no new backend code, no new IPC channels, no new tests.

---

## Context

The indexer was implemented in TASK-006 as infrastructure but never exposed in the UI. The full IPC stack already exists:

| IPC channel | Direction | Purpose |
|---|---|---|
| `library:start-index` | invoke → reply | Start the indexer worker |
| `library:index-progress` | push (renderer ← main) | Progress updates during scan |
| `library:index-complete` | push (renderer ← main) | Final result or error |

The preload already exposes:
```typescript
window.keepic.library.startIndex()           // invoke
window.keepic.library.onIndexProgress(cb)    // register progress listener
window.keepic.library.onIndexComplete(cb)    // register complete listener
```

The shared types already define `IndexProgress`, `IndexResult`, `StartIndexResult`, `IndexCompleteEvent`.

---

## Append-only contract

The re-index operation:
- Upserts new or changed photos into the local SQLite index
- Marks photos deleted from the shared folder with `deleted_at`
- **Never modifies or deletes files on disk**

---

## Deliverables

| File | Action |
|---|---|
| `src/renderer/src/screens/ReindexScreen.svelte` | New — progress display + result |
| `src/renderer/src/screens/HomeScreen.svelte` | Add `onReindex` prop + "Re-index library" button |
| `src/renderer/src/App.svelte` | Add `'reindex'` screen state + navigation |

No backend files. No test files. Frontend is excluded from the 100% coverage requirement.

---

## UI

### `ReindexScreen.svelte`

**Location**: `src/renderer/src/screens/ReindexScreen.svelte`

**Props:**
```typescript
interface Props {
  onBack: () => void
}
```

**Behaviour:**
- On mount: call `window.keepic.library.startIndex()`, register `onIndexProgress` and `onIndexComplete` listeners
- If `startIndex()` returns `{ alreadyRunning: true }`: show a message, enable Back immediately
- If `startIndex()` returns `{ error }`: show the error, enable Back immediately
- While running: show progress (`processed / total` files), disable Back button
- On `onIndexComplete` with `type: 'complete'`: show summary (indexed / skipped / deleted), enable Back
- On `onIndexComplete` with `type: 'error'`: show error message, enable Back

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Re-index Library                                   │
│                                                     │
│  (while running:)                                   │
│  Scanning… 350 / 500 files                          │
│  [Back ← disabled]                                  │
│                                                     │
│  (on complete:)                                     │
│  ✓ Done — 12 indexed, 488 unchanged, 0 removed     │
│  [← Back]                                           │
│                                                     │
│  (on error:)                                        │
│  ✗ Error: <message>                                 │
│  [← Back]                                           │
│                                                     │
│  (already running:)                                 │
│  A re-index is already in progress.                 │
│  [← Back]                                           │
└─────────────────────────────────────────────────────┘
```

**Implementation notes:**

- `startIndex` returns immediately (returns `{ started: true }` or one of the error cases). Progress and completion arrive via push events.
- Register both listeners in `onMount`. They are persistent (no `removeListener` exposed by the preload). In a short desktop session, this listener leak is acceptable and consistent with the existing pattern used by `onIndexProgress`/`onIndexComplete` in the preload.
- The Back button is always rendered but `disabled` while the indexer is running (state: `let done = $state(false)`).
- After returning to HomeScreen, `onMount` in `HomeScreen` re-fetches stats automatically (Svelte `{#if}` destroys and recreates the component).

**Svelte 5 state sketch:**

```typescript
let status: 'starting' | 'running' | 'done' | 'error' | 'alreadyRunning' = $state('starting')
let progress: { processed: number; total: number } | null = $state(null)
let result: { indexed: number; skipped: number; deleted: number } | null = $state(null)
let errorMessage: string | null = $state(null)

onMount(async () => {
  window.keepic.library.onIndexProgress((p) => {
    status = 'running'
    progress = { processed: p.processed, total: p.total }
  })

  window.keepic.library.onIndexComplete((r) => {
    if (r.type === 'complete') {
      result = {
        indexed: r.indexed ?? 0,
        skipped: r.skipped ?? 0,
        deleted: r.deleted ?? 0
      }
      status = 'done'
    } else {
      errorMessage = r.message ?? 'Unknown error'
      status = 'error'
    }
  })

  const reply = await window.keepic.library.startIndex()
  if ('alreadyRunning' in reply) {
    status = 'alreadyRunning'
  } else if ('error' in reply) {
    errorMessage = reply.error ?? 'Unknown error'
    status = 'error'
  }
  // 'started' → wait for push events
})
```

### Integration in `HomeScreen.svelte`

Add `onReindex` callback prop. Add a button in the Library section, next to "Scan for duplicates":

```typescript
interface Props {
  // existing props…
  onDedupScan: () => void
  onReindex: () => void
}
```

Updated Library section:
```svelte
<hr class="border-gray-200" />
<div class="space-y-3">
  <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Library</p>
  <Button variant="outline" onclick={onDedupScan}>Scan for duplicates</Button>
  <Button variant="outline" onclick={onReindex}>Re-index library</Button>
</div>
```

### Integration in `App.svelte`

Add `'reindex'` to the `Screen` union type. Wire `onReindex` on `HomeScreen` and render `ReindexScreen` for the `reindex` state.

```typescript
type Screen = 'home' | 'google-download' | 'planning' | 'review' | 'executing' | 'result' | 'dedup-scan' | 'reindex'
```

```typescript
function handleReindex(): void {
  currentScreen = 'reindex'
}
```

In the template:
```svelte
<HomeScreen
  ...
  onDedupScan={handleDedupScan}
  onReindex={handleReindex}
/>
```

```svelte
{:else if currentScreen === 'reindex'}
  <ReindexScreen onBack={handleReset} />
```

---

## What is already implemented (do not re-implement)

| Element | Location | Status |
|---|---|---|
| `runIndexer()` | `src/main/indexer.ts` | Done (TASK-006) |
| `indexer.worker.ts` | `src/workers/indexer.worker.ts` | Done (TASK-006) |
| `library:start-index` IPC handler | `src/main/index.ts` | Done (TASK-006) |
| `library:index-progress` push channel | `src/main/index.ts` | Done (TASK-006) |
| `library:index-complete` push channel | `src/main/index.ts` | Done (TASK-006) |
| Preload bridge (`startIndex`, `onIndexProgress`, `onIndexComplete`) | `src/preload/index.ts` + `index.d.ts` | Done (TASK-006) |
| `IndexProgress`, `IndexResult`, `StartIndexResult`, `IndexCompleteEvent` types | `src/shared/types/index.ts` + `src/preload/index.d.ts` | Done (TASK-006) |

---

## Checklist

- [ ] `ReindexScreen.svelte` created with all 4 states (running, done, error, alreadyRunning)
- [ ] `HomeScreen.svelte` updated with `onReindex` prop + "Re-index library" button
- [ ] `App.svelte` updated with `'reindex'` screen state + `handleReindex` + `ReindexScreen` render
- [ ] `npm run lint` → 0 errors
- [ ] `npm run typecheck` → clean
- [ ] `npm run test:coverage` → 100% non-frontend coverage (unchanged — no new backend code)
- [ ] PR opened targeting `develop`
