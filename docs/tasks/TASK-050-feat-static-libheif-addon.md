# TASK-050-feat — Static-linked libheif N-API addon for Electron release builds

> **Type**: Feature
> **Priority**: P2
> **Status**: Pending
> **Depends on**: TASK-046-perf (completed)
> **Branch**: TBD

---

## Goal

`libheif-node-dy` dynamically links to the system `libheif.so`/`.dylib`/`.dll`. This works
in development but **breaks in production Electron builds** because end-user machines don't
have libheif installed.

Create a custom N-API addon (or fork of libheif-node-dy) with **static linking** of libheif
and libde265, so the `.node` binary is self-contained and works without system dependencies.

---

## Problem

Current state after TASK-046:
- `libheif-node-dy` compiles from source with `node-gyp` and links against `-lheif`
- On CI (Ubuntu), this works because we install `libheif-dev`
- On Windows/macOS release builds, this will fail: no libheif headers or libraries available
- Even if compilation succeeds, the resulting `.node` would depend on a system `.so`/`.dll`
  that users don't have

---

## Approach Options

### Option A — Custom `@keepic/heif-decode` addon with static linking

Based on the integration strategy from POC-001 (`~/heic-decode-poc/docs/integration-strategy.md`):

1. Create a new package `@keepic/heif-decode` with the ~184 LOC C++ code from libheif-node-dy
2. Add libheif + libde265 as git submodules, compile them statically
3. Link the static libs into the `.node` binary via `binding.gyp`
4. Optionally add `Napi::AsyncWorker` for non-blocking decode (removes need for HeicDecodePool)
5. Build prebuilds for each platform via GitHub Actions CI matrix
6. Publish as `optionalDependencies` per platform (`@keepic/heif-decode-win32-x64`, etc.)

**Pros**: Self-contained, clean distribution, could remove HeicDecodePool complexity
**Cons**: Complex build setup, CI matrix, maintenance burden

### Option B — Bundle shared libraries alongside the app

1. Pre-compile `libheif.so`/`.dll`/`.dylib` for each platform
2. Include them in `extraResources` in electron-builder config
3. Set `LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH` at runtime to find them
4. Keep using `libheif-node-dy` as-is

**Pros**: Simpler than Option A, no custom C++ code
**Cons**: Platform-specific library path management, larger app size, fragile

### Option C — ImageMagick CLI fallback

Use ImageMagick (`magick convert`) as the decode backend instead of a native addon:
1. Bundle the ImageMagick binary with the Electron app
2. Spawn `child_process.execFile()` for each HEIC decode
3. 7.4x faster than WASM (POC-001 results)

**Pros**: No compilation, no native addon, well-tested
**Cons**: +30-50 MB app size, fork/exec overhead, less parallelism than N-API

### Recommendation

**Option A** for maximum performance and clean packaging.
**Option C** as fallback if Option A proves too complex.

---

## Deliverables

TBD based on chosen approach.

---

## References

- [POC-001 integration strategy](~/heic-decode-poc/docs/integration-strategy.md) — detailed plan for Option A
- [TASK-046 task doc](TASK-046-perf-native-heic-decode.md) — current implementation
- [ADR-005](../architecture/adr/ADR-005-heic-decoding-strategy.md) — HEIC decoding decisions
- [libheif-node-dy C++ source](node_modules/libheif-node-dy/src/libheif-node.cc) — 184 LOC to port
