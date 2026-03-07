# ADR-005 — HEIC Decoding Strategy

> **Status**: Accepted
> **Date**: 2026-03-05
> **Deciders**: Mateo, Claude

---

## Context

KeePic needs to process HEIC files (the default photo format on iPhones) for two purposes:
1. **Perceptual hashing (pHash)**: decode pixels to compute a 64-bit DCT hash for deduplication
2. **JPEG conversion** (optional): convert HEIC to JPEG when the user enables `heic.mode = 'convert'`

iPhone HEIC files use a **HEVC Tile Grid** structure: the 3024x4032 image is encoded as 48
independent 512x512 HEVC tiles assembled into a grid. This structure is important because not
all decoders handle it correctly.

The project went through three iterations:

1. **v0.1.x (TASK-009)**: `sharp` alone — failed because sharp's prebuilt binaries do not include
   the HEVC decoder (patent licensing restrictions). Only AVIF is supported for HEIF input.

2. **v0.2.0 (TASK-036)**: `heic-decode` v1.x (WASM libheif) — worked correctly but was slow
   (2-5 seconds per 12MP file).

3. **v0.2.1 (TASK-037)**: `ffmpeg-static` (native binary) — fast (~40ms/file) but had critical issues:
   - Could not assemble HEVC tile grids (decoded only tile 0 = 512x512 top-left corner)
   - pHash represented only 2% of the image, breaking cross-format deduplication (HEIC vs JPEG)
   - Linux ELF binary packaged in Windows installer, causing crashes

---

## Decision Drivers

- **Cross-platform**: must work on Windows + macOS without native build toolchain
- **Full-image decode**: must decode the complete tile grid, not just the first tile
- **Cross-format pHash compatibility**: HEIC pHash must match JPEG pHash for the same photo
- **No native binary packaging**: avoid platform-specific binary distribution issues
- **Acceptable performance**: must handle batch indexing of thousands of photos
- **Correctness over speed**: a slower correct decoder is preferred over a fast incorrect one

---

## Considered Options

### Option A — ffmpeg-static (native binary)

**Description**: Spawn `ffmpeg` as a child process to decode HEIC to JPEG, then process with sharp.

**Pros**:
- Very fast (~40ms per file for 512x512 output)
- Well-known, widely used tool

**Cons**:
- Cannot assemble HEVC tile grids — outputs only tile 0 (512x512) instead of full 3024x4032
- Platform-specific binary must be packaged correctly (failed on Windows in v0.2.1)
- Large binary (~80MB) included in the app
- Adds complexity with child process spawning and stderr parsing

---

### Option B — heic-decode v2.x (WASM libheif/libde265)

**Description**: Use `heic-decode` npm package which bundles libheif compiled to WebAssembly.
Decodes HEIC to raw RGBA pixels, then use `sharp` for resize/conversion.

**Pros**:
- Full-image decode — correctly assembles HEVC tile grids
- Cross-platform — WASM runs identically on all platforms
- No native binary to package (WASM inlined as base64 in the bundle)
- v2.x is ~10x faster than v1.x (393ms avg vs 2-5s for 12MP)
- Cross-format pHash compatible (RGBA-to-gray produces hashes within 1 bit of JPEG-to-gray)

**Cons**:
- ~393ms per 12MP file (slower than native, but acceptable)
- WASM bundle is ~1.4MB (inlined, no external .wasm file needed)

---

### Option C — Native C addon (libheif + node-gyp)

**Description**: Build libheif as a native Node.js addon for maximum performance.

**Pros**:
- Fastest possible decode (~50-100ms per 12MP file estimated)
- Full-image decode support

**Cons**:
- Requires C/C++ build toolchain on developer machines
- Platform-specific native addon must be prebuilt for each target (electron-rebuild)
- Complex build and distribution pipeline
- Maintenance burden for native code

---

## Decision

**Chosen option**: Option B — heic-decode v2.x (WASM libheif/libde265)

**Rationale**:

1. **Correctness**: heic-decode is the only option that correctly decodes full HEVC tile grids.
   ffmpeg's tile 0 output makes cross-format deduplication impossible.

2. **Cross-platform simplicity**: WASM eliminates all platform-specific packaging issues that
   plagued the ffmpeg approach (Linux binary in Windows installer).

3. **Acceptable performance**: at ~393ms/file (v2.x), indexing 8000 HEIC photos takes ~53 minutes
   sequentially. **Note**: PERF-001's `withConcurrency` runs async workers in a single thread;
   since WASM blocks the V8 event loop, HEIC decodes are effectively sequential. True
   parallelism requires spawning N Worker threads (see TASK-046-perf in backlog).
   The sequential time is acceptable for a batch operation that runs infrequently.

4. **Validated compatibility**: testing on 20 real iPhone HEIC files confirmed that heic-decode's
   RGBA-to-grayscale path produces pHash values within 1 bit of the JPEG-to-grayscale path.
   Cross-format deduplication works correctly.

5. **Future upgrade path**: Option C (native addon) remains available as TASK-040 if performance
   becomes a bottleneck, but it is not needed for the current use case.

---

## Consequences

### Positive
- Cross-format deduplication (HEIC vs JPEG) works correctly for the first time
- No platform-specific binary packaging — eliminates a class of bugs
- Simpler codebase — no child process spawning, stderr parsing, or binary path resolution
- WASM bundle works inside Electron's asar archive without `asarUnpack`

### Negative / Trade-offs
- ~393ms per HEIC file is slower than native (~40ms for ffmpeg, ~50-100ms for C addon)
- For very large HEIC collections (10,000+), sequential indexing may take over an hour.
  PERF-001's async concurrency does not help for WASM (blocks V8 event loop).
  True parallelism via N Worker threads (TASK-046-perf) would reduce this proportionally to core count.

### Neutral
- All existing HEIC pHash values in the database from v0.2.1 (tile 0 based) are invalidated.
  A full re-index is needed after upgrading. This is expected since the old values were incorrect.
- The WASM bundle (~1.4MB inlined) has negligible impact on app size compared to the
  ffmpeg binary (~80MB) it replaces.

---

## POC-001 — Native HEIC Decoding Benchmark (2026-03-07)

A dedicated PoC (`~/heic-decode-poc/`) benchmarked 5 strategies on 10 real iPhone 12MP HEIC files
(3024x4032, HEVC tile grid). All strategies were validated for correct tile grid assembly via pHash
comparison against the WASM baseline.

### Results Summary

| Strategy | Seq ms/file | N=8 total ms | Speedup vs WASM | Tile grid | Cross-platform |
|----------|-------------|-------------|-----------------|-----------|----------------|
| heic-decode (WASM) — current | 463 | 4662 | 1.0x | OK | Excellent |
| **libheif N-API** (`libheif-node-dy`) | 282 | **370** | **12.6x** | OK | Medium |
| ImageMagick CLI | 267 | 630 | 7.4x | OK | Good |
| libvips CLI | 326 | 731 | 6.4x | OK | Weak |
| sharp HEIF | — | — | — | Blocked | — |

### Recommendation

**libheif N-API with `worker_threads`** is the recommended upgrade path (TASK-046-perf):
- 12.6x faster than WASM in parallel (370ms vs 4662ms for 10 files)
- Same libheif engine = same decoding quality as current WASM baseline
- True CPU parallelism via `worker_threads` (unlike WASM which blocks V8)
- Integration plan: create `@keepic/heif-decode` addon with platform-specific prebuilds

**Fallback**: ImageMagick CLI (7.4x speedup, simpler packaging but larger binary ~30-50MB).

Full report: `~/heic-decode-poc/REPORT.md`
Integration specification: `~/heic-decode-poc/docs/integration-strategy.md`

---

## References

- [heic-decode npm package](https://www.npmjs.com/package/heic-decode)
- [libheif — HEIF/HEIC decoder](https://github.com/nicolo-ribaudo/libheif-js)
- [libheif-node-dy — N-API addon](https://www.npmjs.com/package/libheif-node-dy)
- [TASK-039 — Fix HEIC handling](../../tasks/TASK-039-fix-heic-ffmpeg-windows.md)
- [TASK-037 — Previous ffmpeg approach (superseded)](../../tasks/TASK-037-fix-heic-double-decode.md)
- [TASK-036 — Previous heic-decode v1.x approach](../../tasks/TASK-036-fix-heic-import-decoding.md)
- [PERF-001 — Concurrent processing](../../tasks/PERF-001-concurrent-processing.md)
- [POC-001 — HEIC decoding benchmark](~/heic-decode-poc/REPORT.md)
