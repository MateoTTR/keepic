# FEAT-003: Import/Scan Transparency

## Goal

Report skipped and unrecognized files during import and library scan so the user knows exactly what KeePic ignored and why. Two sub-tasks implemented in a single branch.

## Sub-tasks

### FEAT-003a — Backend

Collect skipped/ignored files during `scanSourceFiles` (import) and `scanLibraryFiles` (indexer) into three categories:

| Category | Reason | Example |
|----------|--------|---------|
| Live Photo video | `live-photo` | `.MP4`/`.MOV` paired with `.HEIC`/`.JPG` sibling |
| Unrecognized extension | `unrecognized-extension` | `.txt`, `.csv`, `.psd`, `.gif` |
| Processing error | `error` | File that failed during execution |

System/hidden files (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.picasa.ini`, dotfiles) are silently filtered — not reported as skipped.

**Type added:**
```typescript
export type SkippedFileReason = 'live-photo' | 'unrecognized-extension' | 'error'
export interface SkippedFile {
  path: string
  reason: SkippedFileReason
  extension?: string
}
```

**Changes:**
- `scanSourceFiles` returns `{ candidates, livePhotoVideos, skippedFiles }`
- `scanLibraryFiles` returns `{ files, skippedFiles }`
- `ImportPlan`, `ImportResult`, `IndexResult` all include `skippedFiles: SkippedFile[]`
- IPC error fallback paths include `skippedFiles: []`

### FEAT-003b — Frontend

Display skipped files in collapsible `<details>` sections:

- **`ResultScreen.svelte`** (import report): 3 categories (Live Photo videos, Unrecognized extensions, Errors)
- **`ReindexScreen.svelte`** (re-index report): 2 categories (Unrecognized extensions, Errors — no live photos in library scan)

## IPC Changes

No new IPC channels. `skippedFiles` is carried through existing plan/result objects.

## Key Design Decisions

- System/hidden files silently skipped to avoid noise
- `skippedFiles` is a required field on `ImportPlan` (not optional) — avoids nullish coalescing branches
- The plan round-trips through the renderer (main → renderer → main for execution), so `skippedFiles` must be propagated through the UI state

## Known Bug (fixed post-release)

The initial implementation missed propagating `skippedFiles` through the UI flow (PlanningScreen -> App.svelte -> ExecutionScreen), causing `plan.skippedFiles is not iterable` at execution time. Fixed by adding the field to all three relay points.

## Testing

- 3 new indexer tests (system files, sub-directories, no-extension files)
- 5 new importer tests (unrecognized extensions, live photos, system files, no-extension)
- All existing tests updated for new return types
- 490 tests, 100% coverage

## Session

Completed in session 042 (2026-03-07), PR #49. Bug fix in session 043.
