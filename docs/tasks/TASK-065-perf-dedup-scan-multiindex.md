# TASK-065-perf — Optimize dedup scan with Multi-Index Hashing + worker thread

## Context

TASK-064 replaced exact pHash matching (`GROUP BY phash HAVING COUNT(*) > 1`) with
Hamming distance ≤ 4 dual-hash matching (pHash + dHash). This introduced an O(n²)
nested loop in `handleScanDuplicates()` running **synchronously on the main process**.

With 10,000 photos: ~50 million comparisons → **app freezes for 10-15 seconds**.
With 50,000 photos: ~1.25 billion comparisons → **freeze of 5-10 minutes**.

The old SQL `GROUP BY` was O(n) and instantaneous. We need to restore near-instant
performance while keeping the Hamming tolerance.

## Goal

1. Replace O(n²) brute-force with **Multi-Index Hashing** (pigeonhole principle) → O(n × k) where k ≪ n
2. Move the computation to a **worker thread** so the main process never blocks
3. Add **progress reporting** to the renderer
4. Apply the same optimization to `importer.ts` library hash lookup (secondary)

## Design

### Multi-Index Hashing (pigeonhole principle)

A 64-bit hash encoded as 16 hex characters. Hamming threshold = 4 bits.

**Key insight**: if two 64-bit hashes differ by ≤ 4 bits, and we split each hash into
**5 chunks**, then by the pigeonhole principle **at least one chunk is identical** between
the two hashes (4 differences distributed across 5 chunks → one chunk has 0 differences).

#### Chunk layout

Split the 16 hex characters (64 bits) into 5 chunks:

| Chunk | Hex chars | Bits |
|-------|-----------|------|
| 0     | `[0..2]`  | 12   |
| 1     | `[3..5]`  | 12   |
| 2     | `[6..8]`  | 12   |
| 3     | `[9..11]` | 12   |
| 4     | `[12..15]`| 16   |

(Using 3-char chunks for the first 4 and a 4-char chunk for the last, totaling 16 hex chars.)

#### Data structure

```typescript
// 5 Maps, one per chunk position
type ChunkIndex = Map<string, number[]>  // chunk_value → list of photo indices
const indices: ChunkIndex[] = [new Map(), new Map(), new Map(), new Map(), new Map()]
```

#### Build — O(5n)

For each photo `i`, extract 5 chunks from its pHash, insert `i` into each map.

#### Query — O(5 × bucket_size)

For each photo `i`, look up its 5 chunks in the 5 maps. Collect all candidate indices
(union of the 5 lookups). Deduplicate candidates. For each candidate `j > i`, compute
full Hamming distance on pHash, then on dHash if pHash matches. Union-Find as before.

#### Expected performance

With 12-bit chunks: 4096 possible values per chunk.
- 50,000 photos → average bucket size ≈ 12
- Candidates per photo ≈ 5 × 12 = 60 (with dedup, likely ~30-40 unique)
- Total comparisons: ~50,000 × 40 = **2 million** (vs 1.25 billion for O(n²))
- **Speedup: ~600×**

With 10,000 photos → ~400K comparisons → **sub-second, effectively instant**.

### Worker thread

Create `src/workers/dedup-scanner.worker.ts`:
- Receives: database path (or serialized photo rows from main process)
- Sends progress: `{ type: 'progress', processed: number, total: number }`
- Sends result: `{ type: 'complete', groups: DuplicateGroup[] }`

Since the worker needs DB access (read-only), two options:
1. **Pass DB path** — worker opens its own read-only SQLite connection
2. **Pass photo rows** — main process queries, sends rows via postMessage

Option 2 is simpler and avoids dual DB connections. With 50K photos × ~100 bytes/row
= ~5 MB transfer — acceptable.

**Decision**: Option 2 — pass photo rows via postMessage.

### IPC changes

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `library:scan-duplicates` | invoke → result | Starts scan, returns void (fire-and-forget) |
| `library:dedup-progress` | main → renderer | Progress updates `{ processed, total }` |
| `library:dedup-complete` | main → renderer | Final result `{ groups: DuplicateGroup[] }` |

### Importer optimization (secondary)

`importer.ts` Phase 2 also does a linear scan over `libraryHashes` for each imported
file. Build a Multi-Index on `libraryHashes` once, then query per imported file.
This is less critical (import batch is small) but uses the same data structure.

## Deliverables

- [ ] Create `src/main/multi-index-hash.ts` — `MultiIndexHash` class (build, query)
- [ ] Create `src/workers/dedup-scanner.worker.ts` — worker thread for dedup scan
- [ ] Update `src/main/ipc/dedup-scan-handler.ts` — spawn worker, relay progress/result
- [ ] Update `src/main/index.ts` — wire new IPC channels
- [ ] Update `src/preload/index.ts` — expose progress/complete callbacks
- [ ] Update `src/renderer/src/screens/DeduplicationScreen.svelte` — progress bar UI
- [ ] Update `src/main/importer.ts` — use `MultiIndexHash` for library dedup lookup
- [ ] Add tests for `MultiIndexHash` (build, query, edge cases) — 100% coverage
- [ ] Update tests for `dedup-scan-handler` and `importer`
- [ ] Run full test suite — 100% coverage

## Files changed

| File | Change |
|------|--------|
| `src/main/multi-index-hash.ts` | **New** — MultiIndexHash class |
| `src/workers/dedup-scanner.worker.ts` | **New** — worker thread |
| `src/main/ipc/dedup-scan-handler.ts` | Rewrite — spawn worker instead of sync loop |
| `src/main/index.ts` | Add IPC channels for progress/complete |
| `src/preload/index.ts` | Expose dedup progress/complete callbacks |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Add progress bar |
| `src/main/importer.ts` | Use MultiIndexHash for library lookup |
| `tests/main/multi-index-hash.test.ts` | **New** — unit tests |
| `tests/main/ipc/dedup-scan-handler.test.ts` | Update for async worker pattern |
| `tests/main/importer.test.ts` | Verify MultiIndexHash integration |

## Complexity analysis summary

| Scenario (50K photos) | Before (O(n²)) | After (Multi-Index) |
|------------------------|-----------------|---------------------|
| Comparisons            | 1,250,000,000   | ~2,000,000          |
| Estimated time         | 5-10 min        | < 1 sec             |
| Main thread blocked    | Yes (freeze)    | No (worker thread)  |
| Progress reporting     | None            | Yes                 |
