# TASK-064-fix — Improve pHash deduplication robustness

## Context

Manual testing with real-world photos revealed two classes of pHash issues:

### Case 1 — False negative: same photo in HEIC and JPEG not detected as duplicate

The same photo exists as `IMG_2505.HEIC` (24MP, 4284×5712) and `IMG_2505.jpg`. Their pHash values differ by **1 bit** (Hamming distance = 1):

```
HEIC: ff00802080008080
JPG:  ff00800080008080
```

**Root cause**: HEIC decoding (libheif, HEVC tile grid) and JPEG decoding (libjpeg via sharp) produce slightly different sub-pixel values. After resize to 32×32 and DCT, this micro-difference flips 1 bit.

**Current behavior**: KeePic uses exact pHash equality (`WHERE phash = ?`), so this 1-bit difference causes a miss.

### Case 2 — False positive: two different photos produce the same pHash

`Arès 149.jpg` (2048×1536) and `IMG_3564.JPG` (1704×2272) are completely different photos but share the same pHash:

```
Both: 8080808000000080
```

**Root cause**: DCT hash collision. The 64-bit hash space has non-uniform distribution — some hashes are "attractors" that many structurally different images converge to. This hash has only 7 bits set out of 64, indicating both images have a very flat frequency distribution after 32×32 greyscale reduction.

## Proposed fix

Both problems must be addressed together, as relaxing the match threshold (to fix case 1) would increase false positives (case 2).

### Option A — Hamming tolerance + secondary criteria (recommended)

1. **Replace exact match with Hamming distance ≤ N** (e.g., N=4) in the dedup query
2. **Add secondary confirmation criteria** to filter out false positives:
   - Same aspect ratio (within tolerance, e.g., ±5%)
   - Similar file size (within tolerance, e.g., ±50%)
   - Or: same image dimensions

The dedup query would become something like:
```sql
-- For each candidate, find potential duplicates
SELECT path, phash, width, height, file_size
FROM photos
WHERE deleted_at IS NULL
  AND phash IS NOT NULL
```

Then compute Hamming distance in JS (SQLite doesn't have bit operations on hex strings) and apply secondary filters.

**Trade-off**: more complex query, slightly slower (need to scan all non-null pHash rows), but much more accurate.

### Option B — Larger hash (128-bit)

Increase `HASH_SIZE` from 8 to 12 (144 coefficients → 144-bit hash). Reduces collision probability but:
- Requires DB migration (wider column)
- Requires full re-index to recompute all hashes
- Doesn't fully solve cross-format 1-bit differences

### Option C — Hybrid (recommended long-term)

Combine Option A (Hamming tolerance + secondary criteria) with a modestly larger hash (e.g., 10×10 = 100 bits). Best of both worlds.

### Note on dimension-based filtering

Case 3 shows that `DSC01442.JPG` and `DSC01445.JPG` have the **same dimensions** (6000×4000) and the same pHash — so dimension matching alone cannot filter all false positives. Additional perceptual metrics are needed.

## Research: complementary similarity techniques

Before implementation, research alternative/complementary perceptual hashing and similarity techniques to strengthen deduplication beyond DCT pHash alone. Candidates to evaluate:

- **dHash** (difference hash) — encodes horizontal gradients, orthogonal to DCT frequency analysis
- **aHash** (average hash) — simple threshold against mean brightness
- **Color histogram comparison** — captures color distribution, insensitive to spatial layout
- **SSIM** (Structural Similarity Index) — pixel-level structural comparison on thumbnails
- **Feature-based matching** (ORB, SIFT descriptors) — more robust but heavier

The goal is to combine 2-3 independent metrics so that a "match" requires agreement across multiple signals, reducing false positives without sacrificing cross-format detection (case 1).

## Decided approach — Option A enriched: median threshold + dHash + Hamming tolerance

Bibliography research completed. Evaluated: dHash, aHash, color histogram, SSIM, feature-based (ORB/SIFT), larger DCT hash (256-bit), median threshold, wavelet hash, Meta PDQ.

### Two core changes

1. **Median threshold** in DCT pHash (replaces mean):
   - Eliminates "attractor" hashes (`8080808080808080`) by ensuring uniform 50/50 bit distribution
   - Same approach as Meta's PDQ (production-validated at scale)
   - 3-line code change in `dctHash()`, zero performance cost

2. **dHash (difference hash)** as secondary hash:
   - Encodes horizontal brightness gradients (spatial domain — orthogonal to DCT frequency domain)
   - Computed from same 32×32 greyscale buffer — zero I/O overhead, ~0.1ms
   - Stable cross-format: relative comparisons survive HEIC/JPEG decode micro-differences

### Matching logic

Two photos are duplicates iff:
- **pHash Hamming distance ≤ 4** AND
- **dHash Hamming distance ≤ 4**

### Why NOT chosen

- **aHash**: too correlated with pHash, no added discriminative power
- **Color histogram**: cross-format instability (P3 vs sRGB gamut), requires extra RGB buffer
- **SSIM**: comparison-based (not hashable), O(N) pairwise, only useful as tie-breaker
- **Feature-based (ORB/SIFT)**: requires OpenCV (~100MB), poor on 32×32 thumbnails
- **Larger hash (256-bit)**: more cross-format bit flips, DB migration pain, doesn't solve attractors alone

### Performance budget

| Step | Time | Change |
|------|------|--------|
| Sharp resize 32×32 greyscale | ~5-10ms | Unchanged |
| 2D DCT (32×32) | ~2-3ms | Unchanged |
| pHash extraction (median) | <0.1ms | 3 lines changed |
| dHash extraction | <0.1ms | ~20 lines new |
| **Total** | **~7-13ms** | **Within 50ms budget** |

### DB impact

- New column `dhash TEXT` in `photos` (migration 4→5)
- All existing pHash values invalidated (mean→median) — re-index required after migration

## Deliverables

- [x] Research complementary perceptual similarity techniques (bibliography)
- [x] Decide on approach: median threshold + dHash + Hamming tolerance ≤ 4
- [ ] Update `phash.ts`: median threshold, dHash computation, Hamming distance helper
- [ ] Update `heic.ts`: compute dHash from same 32×32 buffer
- [ ] DB migration 4→5: add `dhash` column
- [ ] Update `importer.ts`: Hamming tolerance + dual-hash matching in `buildImportPlan`
- [ ] Update `dedup-scan-handler.ts`: Hamming-based grouping + dHash validation
- [ ] Update `indexer.ts`: store dhash
- [ ] Update tests with cross-format and collision test cases
- [ ] Run full test suite — 100% coverage

### Case 3 — False positive: three different photos all produce the same pHash

`DSC01442.JPG` (6000×4000), `DSC01445.JPG` (6000×4000) and `Italie024.JPG` (2048×1536) are three different photos that all share the same pHash:

```
All three: 8080808080808080
```

This is the most "flat" possible hash (alternating 1/0 pattern), another strong DCT attractor. All three pairwise Hamming distances are 0.

## Test samples

Saved in `~/heic-decode-poc/samples/phash/` (separate repo, not committed to KeePic):

| Case | Expected | Files | pHash | Hamming |
|------|----------|-------|-------|---------|
| case_1 | **Duplicates** (same photo, different format) | `IMG_2505.HEIC` + `IMG_2505.jpg` | `ff00802080008080` / `ff00800080008080` | 1 |
| case_2 | **Not duplicates** (different photos) | `Arès 149.jpg` + `IMG_3564.JPG` | both `8080808000000080` | 0 |
| case_3 | **Not duplicates** (3 different photos) | `DSC01442.JPG` + `DSC01445.JPG` + `Italie024.JPG` | all `8080808080808080` | 0 |

The fix must pass all three cases: detect case_1 as duplicate, and reject case_2 and case_3 as non-duplicates.

## Files likely to change

| File | Change |
|------|--------|
| `src/main/importer.ts` | Update dedup query in `buildImportPlan` phase 2 |
| `src/main/ipc/dedup-scan-handler.ts` | Update dedup scan logic |
| `src/main/phash.ts` | Possibly increase hash size |
| `tests/main/importer.test.ts` | Add cross-format and collision test cases |
| `tests/main/ipc/dedup-scan-handler.test.ts` | Update dedup tests |
