# TASK-046-perf — Native HEIC Decoding via libheif N-API + Worker Pool

> **Type**: Performance
> **Priority**: P2
> **Status**: In progress
> **Depends on**: POC-001 (completed)
> **Branch**: `feature/TASK-046-perf-native-heic-decode`

---

## Goal

Replace the WASM-based HEIC decoder (`heic-decode`) with a native N-API addon (`libheif-node-dy`)
and enable true CPU parallelism via a dedicated `worker_threads` pool. This addresses two problems:

1. **Speed**: WASM decode is ~463ms/file; native is ~282ms/file (1.6x faster sequential)
2. **Parallelism**: WASM blocks the V8 event loop, making `withConcurrency` ineffective for HEIC.
   A worker pool achieves 12.6x speedup (370ms for 10 files at N=8).

---

## Deliverables

1. **`src/workers/heic-decode.worker.ts`** — Worker script that loads `libheif-node-dy`, receives
   file paths, reads + decodes HEIC files, and returns RGBA pixels via `transferList` (zero-copy).

2. **`src/main/heic-pool.ts`** — `HeicDecodePool` class managing N worker threads for parallel
   HEIC decoding. Exposes `decode(filePath): Promise<HeicDecodeResult>` compatible with
   the existing `HeicDecodeFn` interface.

3. **Updated `src/main/heic.ts`** — Replace `heic-decode` import with `libheif-node-dy` for
   single-file synchronous use (thumbnails). Add `createPooledHeicDecode()` factory that wraps
   a `HeicDecodePool` into a `HeicDecodeFn`.

4. **Updated operation workers** — `indexer.worker.ts`, `planner.worker.ts`, `importer.worker.ts`
   create a `HeicDecodePool` at startup, inject `pool.decode` as `HeicDecodeFn` into the main
   module functions, and terminate the pool on completion.

5. **Build config** — Register `heic-decode.worker` in `electron.vite.config.ts` rollup inputs.
   Add `libheif-node-dy` to `asarUnpack` in `package.json`.

6. **Tests** — Unit tests for `HeicDecodePool` and updated `heic.ts` exports. 100% coverage.

---

## Architecture

### Current Flow (WASM, single-threaded)

```
Main Process
  └─ Worker (indexer/planner/executor)
       └─ withConcurrency(files, 8, async fn)
            └─ heic-decode(buffer)  ← WASM, blocks V8 event loop
                                      All 8 async workers serialize
```

### New Flow (Native N-API, parallel via worker pool)

```
Main Process
  └─ Worker (indexer/planner/executor)
       ├─ HeicDecodePool.create(N=8)
       │    ├─ heic-decode-worker #1  (loads libheif-node-dy)
       │    ├─ heic-decode-worker #2
       │    ├─ ...
       │    └─ heic-decode-worker #N
       │
       └─ withConcurrency(files, 8, async fn)
            └─ pool.decode(filePath)  ← dispatches to available worker
                                        True CPU parallelism
```

### Data Flow per Decode

```
Operation Worker → HeicDecodePool → HEIC Worker
  postMessage({ type: 'decode', id, filePath })

HEIC Worker:
  1. readFileSync(filePath)     → Buffer (~5 MB)
  2. libheif.decode(buffer)     → RGBA Buffer (~46 MB, 3024×4032×4)
  3. libheif.getInfo(buffer)    → { width, height }
  4. postMessage({ type: 'result', id, width, height, data }, [data.buffer])
                                  ↑ transferList = zero-copy
```

---

## Key Design Decisions

### Why a worker pool (not AsyncWorker)?

`libheif-node-dy`'s `decode()` is synchronous N-API — it blocks the calling thread.
Creating a custom C++ addon with `Napi::AsyncWorker` would offload to libuv's threadpool,
but requires building and maintaining a native addon with platform-specific prebuilds.

A JavaScript worker pool achieves the same parallelism with zero C++ code:
- Each worker thread has its own V8 isolate and runs `libheif.decode()` independently
- The pool manages dispatch and lifecycle
- Proven by POC-001 benchmarks (12.6x speedup at N=8)

### Why file paths (not buffers) as input?

Sending a ~5 MB HEIC buffer via `postMessage` copies it. Reading the file inside the worker
avoids this copy. The output RGBA buffer (~46 MB) is transferred via `transferList` (zero-copy).

### Why create the pool inside operation workers?

The indexer, planner, and executor never run concurrently. Creating the pool inside each
worker thread avoids sharing state across processes. The pool is created on demand and
terminated after each operation.

---

## IPC / Message Protocol

### heic-decode.worker.ts

**Inbound messages:**

| Message | Fields |
|---------|--------|
| `decode` | `{ type: 'decode', id: number, filePath: string }` |
| `exit` | `{ type: 'exit' }` |

**Outbound messages:**

| Message | Fields | Transfer |
|---------|--------|----------|
| `ready` | `{ type: 'ready' }` | — |
| `result` | `{ type: 'result', id: number, width: number, height: number, data: Buffer }` | `[data.buffer]` |
| `error` | `{ type: 'error', id: number, message: string }` | — |

---

## Files Changed

| File | Change |
|------|--------|
| `src/workers/heic-decode.worker.ts` | **New** — HEIC decode worker |
| `src/main/heic-pool.ts` | **New** — HeicDecodePool class |
| `src/main/heic.ts` | Replace `heic-decode` with `libheif-node-dy`, add pool-based decode |
| `src/workers/indexer.worker.ts` | Create pool, inject decode, terminate |
| `src/workers/planner.worker.ts` | Create pool, inject decode, terminate |
| `src/workers/importer.worker.ts` | Create pool, inject decode, terminate |
| `electron.vite.config.ts` | Add `heic-decode.worker` to rollup inputs |
| `package.json` | Replace `heic-decode` dep with `libheif-node-dy`, add to `asarUnpack` |
| `tests/main/heic-pool.test.ts` | **New** — HeicDecodePool tests |
| `tests/main/heic.test.ts` | Update for new decode backend |

---

## Packaging Note

`libheif-node-dy` dynamically links to the system `libheif.so`/`.dylib`/`.dll`.
This works in development but **will not work in production Electron builds** without
either:
- Bundling `libheif` shared libraries alongside the app
- Creating a custom addon with static linking (future TASK)

This task focuses on the integration architecture. Production packaging will be
addressed in a follow-up task once the architecture is validated.

---

## Performance Expectations

| Scenario | Before (WASM) | After (N-API pool) | Speedup |
|----------|---------------|---------------------|---------|
| 1 HEIC file | ~463 ms | ~282 ms | 1.6x |
| 10 HEIC files | ~4660 ms | ~370 ms | 12.6x |
| 100 HEIC files | ~46 s | ~3.7 s (est.) | ~12x |
| 1000 HEIC files | ~7.7 min | ~37 s (est.) | ~12x |

---

## Risks

| Risk | Mitigation |
|------|------------|
| `libheif-node-dy` uses `bindings` module — may fail in bundled Electron | Test with electron-vite build; fallback: patch binding path |
| Nested worker_threads (pool inside operation worker) | Supported by Node.js; validated in POC |
| ~46 MB RGBA transfer per decode | `transferList` for zero-copy; peak ~368 MB at N=8 is acceptable |
| Dynamic linking breaks in production builds | Documented as out-of-scope; follow-up task for static linking |
