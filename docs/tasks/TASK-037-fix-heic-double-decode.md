# TASK-037 — Fix slow HEIC processing: replace WASM decoder with native ffmpeg

## Priority
P0 — Blocks practical use of HEIC import

## Problem

Each HEIC file triggers `heic-decode` (WASM/libde265) **twice** per import:

1. **Planner** (`createHeicPhashComputer`): decodes full HEIC → raw RGBA pixels → pHash → pixels discarded
2. **Executor** (`createHeicConverter`): decodes full HEIC again → raw RGBA pixels → JPEG

On a typical iPhone 12MP photo (4032×3024), each WASM decode takes ~2–5 seconds.
For 20 photos: 80–200 seconds total. Clearly unacceptable.

### Why the indexer is fast

The library indexer uses `defaultPhashComputer` (native sharp). Sharp fails silently on HEIC
files → pHash null, no WASM involved → fast. This confirms the slowness is entirely in the
planner's `createHeicPhashComputer` WASM call + the executor's `createHeicConverter` WASM call.

### Root cause

REFACTOR-001 (session 028) eliminated the temp file but introduced a WASM decode in the
planner for pHash. The executor was already doing a WASM decode for conversion. v0.2.0
now does 2 WASM decodes per HEIC file. Before v0.2.0, HEIC conversion was silently failing
(sharp couldn't decode HEIC), so zero WASM decodes occurred.

---

## Solution: Replace WASM decoder with native ffmpeg

Discard `heic-decode` entirely. Use `ffmpeg-static` (pre-built static binaries for
Windows + macOS) to convert HEIC → JPEG. ffmpeg uses native C code → 10–50× faster
than WASM/libde265 for the same task.

Combined with "stage in planner" (convert once, reuse in executor): **1 native ffmpeg call**
per HEIC file instead of 2 WASM decodes.

### Architecture

```
Planner:
  HEIC → ffmpeg → staged JPEG (in tempDir)
       → sharp native → pHash  ← fast (native sharp on JPEG)
       → duplicate detection ✅

Executor:
  entry.stagedPath? → move to library  ← no re-decode
  compute pHash from destAbsPath (already stored from planner)
```

### Why not accept 2× ffmpeg calls instead of staging?

Even at ~500ms/file, 2× ffmpeg = ~1s/file. With staging (1× ffmpeg): ~500ms/file.
Staging is cleaner and avoids any risk of the JPEG differing between plan and execute phases.

---

## Deliverables

### 1. Dependencies
- Remove: `heic-decode`, `libheif-js`
- Add: `ffmpeg-static` (pre-built static binaries, no native compilation)

### 2. `src/main/heic.ts`
- Replace `defaultHeicConverter` implementation: use `child_process.spawn(ffmpegPath, ['-i', src, '-q:v', quality, dest])`
- Remove `createHeicPhashComputer` / `defaultHeicPhashComputer` (no longer needed — pHash computed from JPEG via native sharp)
- Export `getFfmpegPath()` helper: resolves binary path for dev vs production (asar.unpacked)

### 3. `src/main/importer.ts`
- `PlannerOptions`:
  - Remove `computeHeicPhash?: PhashComputer`
  - Add `stagingDir?: string` (where planner writes temp JPEGs)
  - Add `mkdirp?: (path: string) => void`
- `buildImportPlan` for HEIC + conversion enabled:
  - Convert HEIC → temp JPEG via `convertHeicFn` → store path in `entry.stagedPath`
  - Compute pHash from temp JPEG via `computePhash` (native sharp) → duplicate detection ✅
- `ExecutorOptions`: no change (still has `convertHeic?`)
- `executeImportPlan` for entry with `stagedPath`:
  - Move `stagedPath` directly to `destAbsPath` (no re-conversion)
  - Cleanup: in `finally`, delete any remaining `stagedPath` files

### 4. `src/shared/types.ts` — `ImportPlanEntry`
- Add `stagedPath?: string` (internal, not displayed in UI)

### 5. `electron-builder.yml` (or equivalent config)
- Add `asarUnpack: ["**/node_modules/ffmpeg-static/**"]`

### 6. `tests/main/heic.test.ts`
- Remove tests for `createHeicPhashComputer` (deleted function)
- Add tests for `createHeicConverter` ffmpeg-based implementation
- Add test for `getFfmpegPath()` (dev vs prod path resolution)

### 7. `tests/main/importer.test.ts`
- Update planner HEIC tests: `convertHeic` now produces a staged JPEG, `computePhash` called on it
- Update executor HEIC tests: entry with `stagedPath` → move instead of convert
- Add executor test: staged JPEG moved to library, pHash stored
- Add executor test: stagedPath cleanup in finally block

---

## Packaging / cross-platform notes

- `ffmpeg-static` downloads the binary for the **host platform** at `npm install`.
- CI Windows builds run on `windows-latest` → Windows binary present ✅
- CI macOS builds run on `macos-latest` → macOS binary present ✅
- Dev on WSL: Linux binary in `node_modules/`, but building for Windows requires Windows runner (CI only).
- `asarUnpack` extracts the binary from the asar archive so it can be executed at runtime.
- `getFfmpegPath()` must detect `app.asar.unpacked` path in production vs `node_modules` in dev:

```typescript
// Pseudo-code
function getFfmpegPath(): string {
  const ffmpegStatic = require('ffmpeg-static') as string
  // In production, the binary is in resources/app.asar.unpacked/...
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}
```

---

## Trade-offs

| | WASM (v0.2.0) | ffmpeg (TASK-037) |
|---|---|---|
| WASM decodes | 2× per file | 0 |
| ffmpeg calls | 0 | 1× per file |
| ~time/file (12MP) | 4–10s | ~0.5s |
| Duplicate detection in planner | ✅ | ✅ |
| pHash accuracy | from HEIC pixels | from staged JPEG |
| Extra binary | — | ~50–100 MB/platform |

---

## Test Coverage

- `buildImportPlan` HEIC + conversion: `convertHeicFn` called → staged JPEG created → `computePhash(stagedPath)` called → pHash stored
- `buildImportPlan` HEIC + conversion disabled: normal `computePhash(srcPath)` as before
- `executeImportPlan` HEIC + stagedPath: move (not convert) to library, pHash from plan stored
- `executeImportPlan` HEIC + stagedPath + move error: error recorded, staged file cleaned up
- `executeImportPlan` finally: staged files cleaned up on cancellation
