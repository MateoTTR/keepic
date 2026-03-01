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

## Affected modules

Three code paths process HEIC files and all three must be updated:

| Module | Current behaviour | Target behaviour |
|---|---|---|
| **Planner** (`buildImportPlan`) | WASM decode → pHash | ffmpeg → staged JPEG → pHash (sharp) |
| **Executor** (`executeImportPlan`) | WASM decode → JPEG | move staged JPEG (no re-decode) |
| **Indexer** (`runIndexer`) | sharp fails silently → null | ffmpeg → temp JPEG → pHash (sharp) → delete temp |

The indexer currently stores `null` pHash for every HEIC file in the library (sharp cannot
decode HEIC). This means HEIC files are never deduplicated against library contents.
TASK-037 must fix this as well.

---

## Deliverables

### 1. Dependencies
- Remove: `heic-decode`, `libheif-js`
- Add: `ffmpeg-static` (pre-built static binaries, no native compilation)

### 2. `src/main/heic.ts`
- Replace `defaultHeicConverter` implementation: use `child_process.spawn(ffmpegPath, ['-i', src, '-q:v', quality, dest])`
- Remove `createHeicPhashComputer` / `defaultHeicPhashComputer` (replaced by universal computer)
- Export `getFfmpegPath()` helper: resolves binary path for dev vs production (asar.unpacked)
- Export `createUniversalPhashComputer(ffmpegPath)`: routes by extension
  - `.heic` / `.heif`: ffmpeg → temp JPEG → sharp pHash → delete temp
  - all others: native sharp directly
  - Used by the indexer via `RunIndexerOptions.computePhash` injection (no interface change)

### 3. `src/main/indexer.ts`
- No interface change to `RunIndexerOptions` — `computePhash` already injectable
- Default value: replace `defaultPhashComputer` with `createUniversalPhashComputer(getFfmpegPath())`
- HEIC files in the library now get a real pHash stored in DB ✅

### 4. `src/main/importer.ts`
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

### 5. `src/shared/types.ts` — `ImportPlanEntry`
- Add `stagedPath?: string` (internal, not displayed in UI)

### 6. `electron-builder.yml` (or equivalent config)
- Add `asarUnpack: ["**/node_modules/ffmpeg-static/**"]`

### 7. `tests/main/heic.test.ts`
- Remove tests for `createHeicPhashComputer` (deleted function)
- Add tests for `createHeicConverter` ffmpeg-based implementation
- Add tests for `createUniversalPhashComputer` (HEIC path + non-HEIC path)
- Add test for `getFfmpegPath()` (dev vs prod path resolution)

### 8. `tests/main/indexer.test.ts`
- Update: inject mock `computePhash` that simulates HEIC-aware behaviour
- Add test: HEIC file in library → pHash computed and stored (non-null)

### 9. `tests/main/importer.test.ts`
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

### Indexer
- HEIC file in library → `createUniversalPhashComputer` called → pHash non-null stored in DB
- Non-HEIC file → native sharp path used

### Planner
- HEIC + conversion enabled: `convertHeicFn` called → staged JPEG → `computePhash(stagedPath)` → duplicate detection works
- HEIC + conversion disabled: normal `computePhash(srcPath)` (no staging)

### Executor
- Entry with `stagedPath`: move to library (no re-conversion), pHash from plan stored
- Entry with `stagedPath` + move error: error recorded, staged file cleaned up in finally
- Cancellation: all remaining `stagedPath` files cleaned up

### `createUniversalPhashComputer`
- HEIC input: routes through ffmpeg → temp JPEG → pHash → temp deleted
- Non-HEIC input: routes through native sharp directly
- HEIC decode error (ffmpeg fails): returns null

### `createHeicConverter` (ffmpeg-based)
- Calls ffmpeg with correct arguments
- Passes quality parameter to ffmpeg `-q:v`
- Propagates error if ffmpeg exits non-zero
