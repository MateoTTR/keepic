# PERF-001 — Concurrent processing for indexer, planner, and executor

## Priority
P3 — Significant UX improvement for large collections, no correctness impact

## Dependency
**Must be implemented after TASK-039** (heic-decode-based HEIC processing).
- TASK-039 rewrites the per-file logic in all three affected modules (replacing ffmpeg with heic-decode)
- heic-decode (WASM) + sharp (native addon) both release the V8 lock during computation,
  enabling true parallelism via `Promise.all` within a single worker thread
- Implementing PERF-001 before TASK-039 risks large merge conflicts

---

## Problem

All three heavy workflows process files **strictly sequentially**, leaving N-1 CPU cores idle:

| Workflow | Main bottleneck | Files/s estimate (HEIC, post-TASK-037) |
|---|---|---|
| **Indexer** (`runIndexer`) | pHash (heic-decode WASM → sharp) | ~2.5/s on 1 core (HEIC ~393ms/file) |
| **Planner** (`buildImportPlan`) | pHash + staging (heic-decode) | ~2.5/s on 1 core |
| **Executor** (`executeImportPlan`) | file copy/convert | I/O bound |

On a typical MacBook (8 cores) or Windows desktop (6-16 cores), parallelizing to N workers
gives a theoretical N× speedup on CPU-bound operations.

---

## Approach: controlled concurrency in existing worker threads

**No new worker threads needed.** The three workflows already run in dedicated worker threads
(indexer.worker.ts, importer.worker.ts). The parallelism comes from launching N concurrent
async operations within each worker thread:

- `sharp` (native addon): releases the V8 lock → true native parallelism
- `heic-decode` (WASM): computation-heavy WASM calls release the event loop → concurrent execution
- `better-sqlite3` (synchronous): DB calls naturally serialize in a single thread → no
  concurrent write issues

**Concurrency level**: `os.cpus().length` (default), capped at a maximum (e.g. 8) to avoid
overwhelming the filesystem or spawning too many ffmpeg processes simultaneously.

**Implementation**: a lightweight async semaphore (no external dependencies):

```typescript
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const queue = [...items.entries()]
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (const [i, item] of queue.splice(0, 1); queue.length >= 0; ) {
      await fn(item, i)
      if (queue.length === 0) break
      ;[i, item] = queue.splice(0, 1)[0] // pull next
    }
  })
  await Promise.all(workers)
}
```

Or use `p-limit` (3 kB, zero deps, typed) — decision at implementation time.

---

## Per-workflow design

### 1. Indexer (`runIndexer`)

**Current**: sequential `for` loop — mtime check → pHash + EXIF → DB upsert.

**Proposed**:
```
Phase 1 (parallel, N workers):
  For each file: statSync → mtime check (DB read) → if changed: computePhash + readExifDate
  Collect results: Array<{ relativePath, phash, exif, stat } | 'skipped'>

Phase 2 (sequential, main fiber):
  For each result: upsertPhoto (DB write) + onProgress
  markDeleted (DB write)
```

**Serialization points**:
- `getStoredMtime`: DB read — safe to parallelize (read-only)
- `upsertPhoto`: DB write — called sequentially in Phase 2 after all parallel work completes
- `onProgress`: called in Phase 2 to maintain ordered progress reporting

**Note**: `presentPaths` Set is built during Phase 2 (sequential), no concurrency issue.

---

### 2. Planner (`buildImportPlan`)

**Current**: sequential `for` loop — pHash + EXIF → duplicate check → collision check → push entry.

**Proposed**:
```
Phase 1 (parallel, N workers):
  For each candidate: statSync + computePhash (ffmpeg staging for HEIC) + readExifDate
  Collect results in original order: Array<{ srcPath, phashResult, exifResult, stagedPath? }>

Phase 2 (sequential, main fiber):
  For each result (in original order):
    - DB duplicate check (read — fast, sequential is acceptable here)
    - Collision check + resolveCollision (uses shared seenDestPaths set — must be sequential)
    - entries.push(entry)
    - onProgress
```

**Serialization points**:
- **Collision detection** (`checkExists` + `seenDestPaths`): must remain sequential. Two parallel
  files with the same capture date and filename would both pass the `checkExists` check and claim
  the same destination path. Phase 2 maintains a `seenDestPaths: Set<string>` to track
  already-claimed paths within the current plan.
- **DB duplicate check**: read-only, could be parallelized, but kept in Phase 2 for simplicity
  since it is fast (indexed query).
- **`entries.push`**: sequential in Phase 2.

**Order preservation**: Phase 1 results must be collected in input order to ensure deterministic
plan output (same files always produce the same plan, regardless of concurrency timing).

---

### 3. Executor (`executeImportPlan`)

**Current**: sequential `for` loop — copy/convert → mkdir → move → stat → DB upsert.

**Proposed**:
```
Phase 1 (parallel, N workers):
  For each entry: mkdir (safe — idempotent) + copy/convert/move to destAbsPath
  Collect results: Array<{ entry, fileStat } | { entry, error }>

Phase 2 (sequential, main fiber):
  For each result:
    - upsertImportedPhoto (DB write)
    - onProgress
    - track imported/errors counts

Finally (sequential):
  updateImportJob + rmTempDir + stagedPath cleanup
```

**Serialization points**:
- `mkdirSync` with `{ recursive: true }`: safe to call concurrently for different paths;
  idempotent by design.
- Concurrent writes to the same destination directory: safe — each entry has a unique
  destination path (guaranteed by planner collision detection).
- **`upsertImportedPhoto`**: DB write — sequential in Phase 2.
- **`isCancelled` check**: checked before each entry in Phase 1 workers. On cancellation, drain
  the in-flight operations cleanly before returning.

**Note**: after TASK-039, HEIC entries in `'convert'` mode use `stagedPath` (file move, very fast).
In `'keep'` mode (default), HEIC files are copied directly. The executor's bottleneck for large
collections is I/O (copying files). Parallelism helps most when source and library are on
different physical devices (e.g. SD card → NAS).

---

## Concurrency level

```typescript
import { cpus } from 'os'

// Sensible default: use all cores, cap at 8 to avoid overwhelming slow NAS storage
const DEFAULT_CONCURRENCY = Math.min(cpus().length, 8)
```

Not exposed as a user setting in v1 — can be made configurable later if needed (PERF-002).

---

## Deliverables

1. **`src/main/concurrency.ts`** (new): `withConcurrency<T>` helper + `DEFAULT_CONCURRENCY`
2. **`src/main/indexer.ts`**: split into Phase 1 (parallel) + Phase 2 (sequential)
3. **`src/main/importer.ts`**:
   - `buildImportPlan`: split into Phase 1 (parallel) + Phase 2 (sequential)
   - `executeImportPlan`: split into Phase 1 (parallel) + Phase 2 (sequential)
4. **`tests/main/concurrency.test.ts`** (new): unit tests for `withConcurrency`
5. **`tests/main/indexer.test.ts`**: update to verify parallel results still ordered and correct
6. **`tests/main/importer.test.ts`**: update to verify plan correctness under concurrency

## Non-deliverables (out of scope for PERF-001)
- User-configurable concurrency level (deferred to PERF-002 if ever needed)
- New worker threads (existing architecture is sufficient)
- Parallelizing the scan phase (`scanLibraryFiles`, `scanSourceFiles`) — already instant

---

## Expected impact

| Workflow | Current (1 core) | With PERF-001 (8 cores) | Note |
|---|---|---|---|
| Indexer — 1000 JPEGs | ~5 min | ~40 s | pHash is CPU-bound (sharp) |
| Indexer — 1000 HEICs | ~6.5 min | ~50 s | heic-decode ~393ms + sharp ~50ms per file |
| Planner — 100 HEICs | ~45 s | ~6 s | heic-decode CPU-bound |
| Executor — 100 HEICs (staged) | ~5 s | ~2 s | move is fast, limited by filesystem |

---

## Test Coverage

### `withConcurrency`
- Runs all tasks and returns results in input order
- Limits concurrency to N simultaneous tasks
- Propagates errors from individual tasks

### Indexer
- Results are correct regardless of processing order (each file independent)
- `onProgress` called exactly `total` times
- DB writes happen for all changed files

### Planner
- Plan entries in same order as input candidates (deterministic)
- No two entries claim the same destination path (collision detection correct under concurrency)
- HEIC staged files created in Phase 1, referenced in Phase 2 entries

### Executor
- All `ready`/`collision` entries processed
- DB upserted for each successfully moved file
- Errors in individual files do not abort the whole import
- Cancellation drains in-flight operations cleanly
