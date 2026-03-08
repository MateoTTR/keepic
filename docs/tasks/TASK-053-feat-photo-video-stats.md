# TASK-053-feat — Differentiate photos vs videos in stats and reports

## Context

Since FEAT-002 (Video Support, Phase 14), KeePic indexes both photos and videos with a `media_type` column (`'photo'` | `'video'`). The backend already queries separate counts (`totalPhotos`, `totalVideos` in `LibraryStats`), but the UI and reports don't fully leverage this distinction:

- **StatsPanel** (`StatsPanel.svelte:31`): shows only `totalPhotos`, ignores `totalVideos`
- **ResultScreen** (import completion): says "X photos imported" even if some are videos
- **ReviewScreen** (import plan): summary counts don't distinguish photos from videos
- **Re-index report**: says "X indexed" without media type breakdown
- **Dedup screen heading**: describes all groups as "photos"

## Goal

Display "X photos, Y videos" (or "X photos" / "Y videos" when one is zero) across all stats and reports in the UI. Backend types already support this — the work is primarily frontend.

## Key Changes

### 1. Frontend — `StatsPanel.svelte`

- Display `totalPhotos` and `totalVideos` separately (e.g., "1,234 photos · 56 videos")
- Show total size as before (combined)

### 2. Frontend — `ResultScreen.svelte`

- Break down `result.imported` and `result.skipped` by media type
- Requires backend change: `ImportResult` needs `importedPhotos`, `importedVideos`, `skippedPhotos`, `skippedVideos` (or a breakdown object)

### 3. Frontend — `ReviewScreen.svelte`

- Summary bar: "X photos ready, Y videos ready, Z duplicates"
- Can be computed client-side from `plan.entries[].mediaType`

### 4. Frontend — `DeduplicationScreen.svelte`

- Heading: "X photo duplicates, Y video duplicates" (or just "X duplicates" if all same type)

### 5. Backend — `ImportResult` type extension

Current (`src/shared/types/index.ts:111–118`):
```typescript
interface ImportResult {
  imported: number
  skipped: number
  ...
}
```

Add breakdown fields:
```typescript
interface ImportResult {
  imported: number
  importedPhotos: number
  importedVideos: number
  skipped: number
  skippedPhotos: number
  skippedVideos: number
  ...
}
```

### 6. Backend — `importer.ts` (executeImportPlan)

- Count imported/skipped photos vs videos during Phase 2 (check `entry.mediaType`)
- Include in returned `ImportResult`

### 7. Backend — `IndexResult` type extension

Current (`src/shared/types/index.ts:60–66`):
```typescript
interface IndexResult {
  indexed: number
  skipped: number
  deleted: number
  ...
}
```

Add:
```typescript
interface IndexResult {
  indexed: number
  indexedPhotos: number
  indexedVideos: number
  ...
}
```

### 8. Backend — `indexer.ts` (runIndexer)

- Count indexed photos vs videos during Phase 2
- Include in returned `IndexResult`

### 9. Tests

- Update `importer.test.ts`: verify photo/video counts in import results
- Update `indexer.test.ts`: verify photo/video counts in index results
- Update `library-stats-handler.test.ts`: verify existing photo/video separation (already tested)
- Frontend: no coverage requirement

## Design Decisions

- **Additive fields**: keep `imported`/`skipped`/`indexed` as totals for backward compat, add `*Photos`/`*Videos` alongside
- **Client-side computation** for ReviewScreen/DeduplicationScreen — data is already there via `mediaType` on entries
- **Singular/plural**: use "1 photo" / "2 photos", "1 video" / "2 videos" — handle in UI with a simple helper

## Risks

| Risk | Mitigation |
|------|-----------|
| Breaking existing tests | Additive — old fields stay, new ones added |
| UI clutter for photo-only users | Hide video count if zero |
| Import history (recentImports in stats) | Keep as `photosImported` for now — renaming to `mediaImported` is a larger change, defer |

## Validation

- [ ] StatsPanel shows separate photo/video counts
- [ ] ResultScreen shows photo/video breakdown for imported and skipped
- [ ] ReviewScreen summary distinguishes photos from videos
- [ ] DeduplicationScreen heading adapts to media type
- [ ] Full test suite passes with 100% coverage
- [ ] Manual test with mixed photo+video library

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types/index.ts` | **Modified** — add photo/video breakdown fields to ImportResult, IndexResult |
| `src/main/importer.ts` | **Modified** — count photos vs videos in executeImportPlan |
| `src/main/indexer.ts` | **Modified** — count photos vs videos in runIndexer |
| `src/renderer/src/components/StatsPanel.svelte` | **Modified** — show totalPhotos + totalVideos |
| `src/renderer/src/screens/ResultScreen.svelte` | **Modified** — photo/video breakdown |
| `src/renderer/src/screens/ReviewScreen.svelte` | **Modified** — photo/video in summary |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | **Modified** — adapt heading |
| `tests/main/importer.test.ts` | **Modified** — assert photo/video counts |
| `tests/main/indexer.test.ts` | **Modified** — assert photo/video counts |
