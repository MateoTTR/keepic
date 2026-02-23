# TASK-025 — Auto-index library on first configuration

## Goal

When a user configures a library folder for the first time (or changes it to a different
folder), the local SQLite index is empty. Any import attempted before a manual re-index
will not detect existing photos as duplicates, potentially creating duplicate files in the
library. There is currently no guidance or automation to trigger indexing at this point.

---

## Current behaviour

1. User selects library folder → path saved, DB opened
2. DB is empty
3. User imports photos → planner sees an empty index → all photos appear as "new"
4. Existing library photos are re-imported as duplicates

---

## Desired behaviour

When a library folder is configured (first time or changed), the indexer is launched
automatically in the background so the DB is populated before the user starts their first
import.

---

## Design decisions

### Trigger
Auto-index fires in the `config:select-library-folder` IPC handler, immediately after the
DB is opened, if and only if a **new** library path was configured (i.e. different from the
previously stored path, or first configuration).

### UX
- The home screen shows a progress indicator while indexing is running (reuse the same
  `ReindexScreen` component or an inline progress bar in `HomeScreen`).
- The import and dedup-scan buttons are disabled while auto-index is in progress.
- If the library is empty (no year folders), the indexer completes instantly — no
  noticeable delay.

### Implementation approach
- In `src/main/index.ts`, after opening the DB in the `config:select-library-folder`
  handler, push a `library:index-started-automatically` event to the renderer, then
  start the indexer worker (same logic as `library:start-index`).
- The renderer handles this event to show the progress UI, exactly as it does for the
  manual re-index.

### Alternative (simpler): warning banner only
If the auto-index approach adds too much complexity to the IPC flow, a simpler fallback
is to display a persistent amber warning banner in `HomeScreen` when:
`libraryPath` is set AND `stats.totalPhotos === 0`.

The banner would read:
> "Your library has not been indexed yet. Run **Re-index library** before importing to
> detect existing duplicates."

**Decision**: implement the warning banner approach first (low risk, no new IPC channels).
Auto-index can be added in a follow-up if the UX proves insufficient.

---

## Affected files (warning banner approach)

| File | Change |
|---|---|
| `src/renderer/src/screens/HomeScreen.svelte` | Add amber banner when `libraryPath` set and `stats?.totalPhotos === 0` |

---

## Affected files (auto-index approach, if chosen)

| File | Change |
|---|---|
| `src/main/index.ts` | Trigger indexer worker in `config:select-library-folder` handler |
| `src/renderer/src/screens/HomeScreen.svelte` | Handle auto-index progress event, disable import during indexing |
| `src/renderer/src/App.svelte` | Wire up new event if needed |

---

## Tests

Warning banner: renderer only — excluded from coverage requirement.
Auto-index: if IPC logic is added to `index.ts`, add unit test for the new trigger path.

---

## Checklist

- [ ] Approach confirmed (banner vs auto-index)
- [ ] Implementation done
- [ ] Manual test: configure a non-empty library folder → banner/indexing appears
- [ ] Manual test: configure an empty library folder → no banner / indexing completes silently
- [ ] PR opened targeting `develop`
