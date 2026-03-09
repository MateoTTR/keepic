# TASK-066-fix — Fix dedup scan false positives + add pagination

## Context

Manual testing of v0.5.1 on a real library (51,316 photos) revealed two issues
with the duplicate scan introduced in TASK-064/065:

### Issue 1 — Too many false positives

`HAMMING_THRESHOLD = 4` (both pHash and dHash) is too permissive. Empirical
analysis on the real library shows:

| Threshold | Groups | Description |
|-----------|--------|-------------|
| Old `GROUP BY phash` (v0.4.x) | 1,163 | No dHash filter, many collisions |
| **pHash=0 AND dHash=0** | **669** | Best precision — dHash eliminates DCT collisions |
| pHash≤1 AND dHash≤1 | 910 | Adds sequential photos (false positives) |
| Current (≤4 AND ≤4) | 1,406 | Many sequential photos matched |

Key findings:
- **Zero pairs** exist at pHash distance = 1 (median threshold from TASK-064
  made pHash very stable cross-format)
- At pHash distance 2–4, matches are sequential photos (`IMGP0931` vs `IMGP0932`,
  `Rando roller 037` vs `038`) — not duplicates
- dHash at distance 0 correctly rejects DCT collisions that plagued the old
  `GROUP BY` approach (494 fewer groups than v0.4.x)

### Issue 2 — UI freeze on scan completion

With 1,406 groups (2,930 photos), the renderer freezes when Svelte tries to
render all groups + PhotoThumbnail components in a single synchronous DOM update.
Each thumbnail triggers a `keepic-photo://` protocol request, flooding the main
process with ~2,930 concurrent image decode operations.

The progress bar reaches 100% but the UI never transitions to the results view.

## Fix

### 1. Lower HAMMING_THRESHOLD to 0

Set `HAMMING_THRESHOLD = 0` in `phash.ts`. This requires exact match on both
pHash AND dHash. Strictly better than the old `GROUP BY phash`:
- Same exact-match precision on pHash
- Plus dHash confirmation eliminates DCT hash collisions

Since median threshold (TASK-064) eliminated cross-format 1-bit pHash
differences, threshold 0 loses nothing.

### 2. Paginate DeduplicationScreen

Render groups in pages of 20. Show a "Load more" button or infinite scroll
to progressively load additional groups. This prevents the renderer from
creating thousands of DOM elements + thumbnail requests at once.

## Deliverables

- [x] Lower `HAMMING_THRESHOLD` from 4 to 0 in `src/main/phash.ts`
- [x] Update `MultiIndexHash` — no longer needed for neighbor search at distance 0,
      but keep it for potential future use (importer still uses it)
- [x] Add pagination to `DeduplicationScreen.svelte` (20 groups per page)
- [x] Update tests
- [x] Remove diagnostic log from `index.ts`
- [x] 100% test coverage

## Files changed

| File | Change |
|------|--------|
| `src/main/phash.ts` | `HAMMING_THRESHOLD = 0` |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Add pagination |
| `src/main/index.ts` | Remove diagnostic log |
| `tests/main/multi-index-hash.test.ts` | Update threshold expectations |
| `tests/main/ipc/dedup-scan-handler.test.ts` | Update threshold expectations |
| `tests/main/importer.test.ts` | Update threshold expectations |
