# TASK-048-feat — Detect and exclude Live Photo companions during re-index

## Context

During local import (`importer.ts:scanSourceFiles`), KeePic already detects Live Photo video companions (`.mov`/`.mp4` files with a sibling `.heic`/`.heif`/`.jpg`/`.jpeg` sharing the same stem) and excludes them from the import plan. The skipped files appear in the import report under "Live Photo videos".

However, the **library re-indexer** (`indexer.ts:scanLibraryFiles`) has no such detection. If a user manually copies Live Photo pairs into the library folder, the video companions are indexed as regular videos. This is inconsistent with the import behavior.

**Current scan code** (`indexer.ts:92–105`):
```typescript
for (const fileEntry of fileEntries) {
  if (!fileEntry.isFile()) continue
  const relativePath = `${yearEntry.name}/${subEntry.name}/${fileEntry.name}`
  if (isSystemOrHidden(fileEntry.name)) {
    // Silently skip system/hidden files
  } else if (isMediaFile(fileEntry.name)) {
    files.push(relativePath)
  } else {
    skippedFiles.push({ path: relativePath, reason: 'unrecognized-extension', ... })
  }
}
```

## Goal

Exclude Live Photo video companions from the re-index, consistent with import behavior. Report them in `skippedFiles` with `reason: 'live-photo'` so they appear in the re-index report.

## Design Decision

**Option 1 (chosen): Exclude from index** — `scanLibraryFiles` detects Live Photo companions and moves them from `files` to `skippedFiles`. They are not indexed and, if previously indexed, will be removed from the DB via `markDeleted`.

This is more consistent with the import pipeline which also excludes Live Photo companions. The append-only guarantee applies to files in the library folder (never modified/deleted), not to DB records which are routinely updated/deleted during re-index.

## Key Changes

### 1. `src/main/indexer.ts` — `scanLibraryFiles`

Add a **post-scan pass** to detect Live Photo companions among the collected files:

```typescript
// After the main scan loop, detect Live Photo video companions
const fileSet = new Set(files.map(f => f.toLowerCase()))
const livePhotoIndices: number[] = []

for (let i = 0; i < files.length; i++) {
  const rel = files[i]
  if (!isLivePhotoVideoExtension(rel)) continue
  // Check if a photo sibling exists in the same folder
  const stem = rel.slice(0, -extname(rel).length)
  const hasPhotoSibling = ['.heic', '.heif', '.jpg', '.jpeg'].some(
    ext => fileSet.has((stem + ext).toLowerCase())
  )
  if (hasPhotoSibling) {
    livePhotoIndices.push(i)
    skippedFiles.push({ path: rel, reason: 'live-photo' })
  }
}

// Remove Live Photo companions from files (reverse order to preserve indices)
for (let i = livePhotoIndices.length - 1; i >= 0; i--) {
  files.splice(livePhotoIndices[i], 1)
}
```

**Why a post-scan pass instead of inline detection?**
The inline scan processes files one at a time within each directory. To check for a photo sibling, we'd need access to all files in the same directory. A post-scan pass over the full `files` list is simpler and avoids per-directory state tracking.

**Why check `fileSet` instead of using `isLivePhotoVideo` (filesystem `existsSync`)?**
`isLivePhotoVideo` calls `existsSync` on absolute paths. Since we already have the full file list from the scan, checking against a `Set` is faster (no filesystem calls) and more predictable for testing.

Import `isLivePhotoVideoExtension` from `heic.ts` (already exported).

### 2. `src/renderer/src/screens/ReindexScreen.svelte`

Add a `livePhotoSkipped` section in the skipped files details (same pattern as `ResultScreen.svelte`):

```svelte
const livePhotoSkipped = $derived(skippedFiles.filter((f) => f.reason === 'live-photo'))
```

Display before "Unrecognized extensions" in the `<details>` block:
```svelte
{#if livePhotoSkipped.length > 0}
  <div>
    <p class="font-medium text-gray-500 mb-1">Live Photo videos ({livePhotoSkipped.length})</p>
    <ul class="space-y-0.5 text-gray-500">
      {#each livePhotoSkipped as f, i (i)}
        <li class="font-mono">• {f.path}</li>
      {/each}
    </ul>
  </div>
{/if}
```

### 3. `src/renderer/src/screens/ReindexScreen.svelte` — result summary

Update the summary line to show photo/video breakdown (leveraging `indexedPhotos`/`indexedVideos` from TASK-053):

```
✓ Done in Xs — 100 indexed (95 photos, 5 videos), 50 unchanged, 2 removed
```

### 4. Tests — `tests/main/indexer.test.ts`

Add to the `scanLibraryFiles` test group:
- **Test**: `.mov` with a sibling `.heic` in the same folder → excluded from `files`, added to `skippedFiles` with `reason: 'live-photo'`
- **Test**: `.mp4` with a sibling `.jpg` → same behavior
- **Test**: `.mov` without any photo sibling → kept in `files` (normal video)
- **Test**: `.mp4` with a sibling `.heic` in a *different* folder → kept in `files` (not a companion)
- **Test**: case-insensitive matching — `IMG_1234.MOV` with `IMG_1234.HEIC` → detected

Update existing `runIndexer` tests:
- **Test**: re-indexing a library with a Live Photo pair → video companion is excluded, `skippedFiles` contains it
- **Test**: previously indexed Live Photo companion → removed via `markDeleted` after re-index excludes it

## Impact on Existing Data

If a user already has Live Photo companions indexed in their DB, re-indexing will:
1. Exclude them from the scan results
2. `markDeleted` will flag them as deleted in the DB (normal re-index behavior for files no longer in the scan)

This is the desired behavior — aligns the library state with what the import pipeline would have produced.

## Risks

| Risk | Mitigation |
|------|-----------|
| False positive: standalone `.mov` with coincidental same-name `.jpg` | Same heuristic as import — accepted trade-off, documented in specs |
| Previously indexed companions removed from DB | Expected behavior, consistent with import |
| Performance: post-scan pass over all files | O(N) with Set lookup — negligible for typical libraries (< 100K files) |

## Validation

- [ ] `scanLibraryFiles` excludes Live Photo companions
- [ ] `ReindexScreen` displays Live Photo companions in skipped files
- [ ] Full test suite passes with 100% coverage
- [ ] Manual test: add a Live Photo pair to library, re-index, verify companion excluded

## Files Changed

| File | Change |
|------|--------|
| `src/main/indexer.ts` | **Modified** — post-scan Live Photo detection in `scanLibraryFiles` |
| `src/renderer/src/screens/ReindexScreen.svelte` | **Modified** — display Live Photo skipped files + photo/video breakdown |
| `tests/main/indexer.test.ts` | **Modified** — new tests for Live Photo detection in scan + re-index |
