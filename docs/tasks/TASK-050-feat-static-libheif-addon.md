# TASK-050-feat — Static-linked libheif N-API addon for Electron release builds

> **Type**: Feature
> **Priority**: P2
> **Status**: In progress
> **Depends on**: TASK-046-perf (completed)
> **Branch**: `feature/TASK-050-feat-static-libheif-addon`

---

## Goal

`libheif-node-dy` dynamically links to the system `libheif.so`/`.dylib`/`.dll`. This works
in development but **breaks in production Electron builds** because end-user machines don't
have libheif installed.

Create `@keepic/heif-decode` — a custom N-API addon with **static linking** of libheif
and libde265, so the `.node` binary is self-contained and works without system dependencies.

---

## Approach — Option A (Custom addon with static linking)

Based on the integration strategy from POC-001 (`~/heic-decode-poc/docs/integration-strategy.md`).

### Architecture

```
packages/heif-decode/
├── src/
│   └── heif-decode.cc          # ~150 LOC, node-addon-api + AsyncWorker
├── binding.gyp                  # Supports dynamic (dev) and static (release) linking
├── index.js                     # Runtime loader via node-gyp-build
├── index.d.ts                   # TypeScript declarations
├── package.json                 # @keepic/heif-decode
└── scripts/
    └── build-deps.sh            # Downloads + compiles libde265 + libheif as static libs
```

### Linking modes

| Mode | Flag | When |
|------|------|------|
| Dynamic | Default (`-lheif`) | Dev (WSL2), CI tests (`libheif-dev` installed) |
| Static | `--heif_static=true` | Release builds (CI downloads + compiles libheif from source) |

### API

```js
const { decode, decodeAsync, getInfo } = require('@keepic/heif-decode')

// Synchronous (blocks thread) — same API as libheif-node-dy
const rgba = decode(heicBuffer)            // → Buffer (RGBA pixels)
const info = getInfo(heicBuffer)           // → { width, height, hasAlphaChannel }

// Async (runs in libuv threadpool, non-blocking)
const { width, height, data } = await decodeAsync(heicBuffer)  // → Promise<{ width, height, data: Buffer }>
```

---

## Deliverables

1. **`packages/heif-decode/`** — Self-contained N-API addon package
   - C++ source ported from libheif-node-dy to `node-addon-api`
   - Added `Napi::AsyncWorker`-based `decodeAsync()` for non-blocking decode
   - `binding.gyp` with `heif_static` variable for dynamic/static linking switch
   - `build-deps.sh` script that downloads and compiles libde265 + libheif as static libs

2. **`.github/workflows/build-heif-addon.yml`** — CI matrix workflow
   - Builds prebuilds on linux-x64, win32-x64, darwin-x64, darwin-arm64
   - Downloads libde265 + libheif source, builds static, compiles addon
   - Uploads prebuild artifacts

3. **Updated `release.yml`** — Release builds now compile libheif from source
   - Windows: MSVC + cmake via `ilammy/msvc-dev-cmd`
   - macOS: native cmake
   - Both: `build-deps.sh` + `node-gyp rebuild --heif_static=true`

4. **KeePic source updates**
   - Replaced all `libheif-node-dy` references with `@keepic/heif-decode`
   - `package.json`: local dep `"file:packages/heif-decode"`
   - `asarUnpack`: updated pattern
   - `heic.ts`, `heic-decode.worker.ts`, `heic-pool.ts`: updated require/comments

---

## Files Changed

| File | Change |
|------|--------|
| `packages/heif-decode/src/heif-decode.cc` | **New** — N-API addon with decode, decodeAsync, getInfo |
| `packages/heif-decode/binding.gyp` | **New** — node-gyp config with dynamic/static linking |
| `packages/heif-decode/index.js` | **New** — Loader via node-gyp-build |
| `packages/heif-decode/index.d.ts` | **New** — TypeScript declarations |
| `packages/heif-decode/package.json` | **New** — Package metadata |
| `packages/heif-decode/scripts/build-deps.sh` | **New** — Static lib build script |
| `.github/workflows/build-heif-addon.yml` | **New** — Cross-platform prebuild CI |
| `.github/workflows/release.yml` | **Modified** — Added static HEIF build steps |
| `package.json` | **Modified** — Replaced libheif-node-dy with @keepic/heif-decode |
| `src/main/heic.ts` | **Modified** — Updated require and comments |
| `src/main/heic-pool.ts` | **Modified** — Updated comments |
| `src/workers/heic-decode.worker.ts` | **Modified** — Updated require and comments |

---

## Key Design Decisions

### Why node-addon-api over raw N-API?

- Cleaner C++ code (~150 LOC vs ~184 LOC)
- Native `Napi::AsyncWorker` support for non-blocking decode
- Exception-safe with RAII-style error handling
- Same ABI stability as raw N-API (N-API version 8)

### Why keep HeicDecodePool with AsyncWorker available?

`decodeAsync()` uses libuv's threadpool (default 4 threads), which is shared with
other async operations (fs, dns). The HeicDecodePool creates dedicated worker threads
with their own event loops, providing isolated parallelism. Both approaches are valid:

- **AsyncWorker alone**: Simpler, ~4 parallel decodes, good for most use cases
- **HeicDecodePool + sync decode**: Current approach, isolated parallelism, proven 12.6x speedup

The current HeicDecodePool architecture is kept unchanged — it continues to use the
synchronous `decode()` in worker threads. `decodeAsync()` is available for future
simplification if desired.

### Why build deps from source in CI?

Static linking requires compiling libde265 + libheif with `-DBUILD_SHARED_LIBS=OFF`
and `-DCMAKE_POSITION_INDEPENDENT_CODE=ON`. System packages only provide shared libraries.
Building from source in CI ensures consistent versions across all platforms.

---

## References

- [POC-001 integration strategy](~/heic-decode-poc/docs/integration-strategy.md)
- [TASK-046 task doc](TASK-046-perf-native-heic-decode.md)
- [ADR-005](../architecture/adr/ADR-005-heic-decoding-strategy.md)
