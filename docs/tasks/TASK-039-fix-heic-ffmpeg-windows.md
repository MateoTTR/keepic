# TASK-039 — Fix HEIC handling: replace ffmpeg with heic-decode, error reporting, default keep-as-HEIC

## Status

`[x]` Completed — Session 033

## Phase

Phase 8 — Post-release bug fixes (v0.2.x)

## Priority

P0

## Context

Identified during manual testing of v0.2.1 on Windows (2026-03-02, session 032).
Cross-format pHash testing performed in session 033 (2026-03-05) confirmed the approach.

Three distinct problems with HEIC handling were found, plus a spec change:
- **Bug A**: ffmpeg crashes on Windows — Linux ELF binary packaged in Windows installer
- **Bug B**: pHash computed on tile 0 only (512x512 = 2% of image) — cross-format HEIC/JPEG dedup broken
- **Bug C**: Silent failures when HEIC processing fails — no user feedback
- **Spec change**: default to keeping HEIC files as-is (`heic.mode = 'keep'`), conversion optional

## Solution — Replace ffmpeg with heic-decode v2.1.0

All three bugs were resolved by **completely removing the ffmpeg dependency** and replacing it with
`heic-decode` (WebAssembly HEIC decoder using libheif-js/libde265):

| Problem | How heic-decode fixes it |
|---|---|
| Bug A (Windows crash) | No native binary to package — WASM works everywhere |
| Bug B (tile 0 pHash) | Full-image RGBA decode — pHash represents 100% of the image |
| Bug C (silent failures) | Errors now caught and reported to the user |

### Cross-format pHash validation

Tested on 20 real iPhone 12MP HEIC files (session 033):

| Comparison | Avg Hamming distance | Max | Conclusion |
|---|---|---|---|
| RGBA direct vs JPEG intermediate | 0.1 bits | 1 bit | Identical — no JPEG intermediate needed |
| Tile 0 vs full image | 32.6 bits | — | Completely different — tile 0 was wrong |

The RGBA-to-grayscale path (heic-decode) produces pHash values compatible with the
JPEG-to-grayscale path (sharp). Cross-format deduplication (HEIC vs JPEG) now works correctly.

### Performance

heic-decode v2.1.0 performance (12MP iPhone HEIC):
- Average: **393ms/file** (min 214ms, max 513ms)
- v1.x was 2000-5000ms/file — **~10x improvement** in v2
- Acceptable for batch indexing; native addon deferred to optional future task (TASK-040)

## Spec change — Default to keep HEIC as-is

### New config shape

```typescript
// Before (v0.2.1)
heicConversion: {
  enabled: boolean        // default: true
  jpegQuality: number     // default: 85
}

// After (v0.2.2)
heic: {
  mode: 'keep' | 'convert'   // default: 'keep'
  jpegQuality: number         // default: 90, only used when mode = 'convert'
}
```

### Backward compatibility

`mergeWithDefaults()` detects the old `heicConversion` key and migrates:
- `enabled: true` → `mode: 'convert'`
- `enabled: false` → `mode: 'keep'`

### Rationale

- Keeping HEIC preserves original quality and metadata
- HEIC files are smaller than JPEG at equivalent quality
- Synology Photo Station supports HEIC natively
- Avoids conversion complexity for the common case
- pHash now uses full-image decode regardless of copy mode

## Error reporting (Bug C)

### Indexer
- `IndexResult` now includes `errors: Array<{ file: string; error: string }>`
- pHash computation wrapped in try/catch — errors collected, file still indexed with `phash=null`
- Non-Error throws handled (stringified)

### Importer (planner)
- pHash failure sets `status = 'error'` with `errorMessage` instead of silently setting `phash=null`
- HEIC conversion failure sets `status = 'error'` with `errorMessage`
- Both Error and non-Error throws handled

## Files modified

| File | Changes |
|---|---|
| `package.json` | Removed `ffmpeg-static`, added `heic-decode@^2.1.0`, removed `asarUnpack` for ffmpeg |
| `src/main/heic.ts` | Complete rewrite: removed ffmpeg, implemented heic-decode + sharp |
| `src/main/importer.ts` | New config shape (`heic.mode`), error reporting for pHash/conversion |
| `src/main/indexer.ts` | Error collection, `createUniversalPhashComputer()` as default |
| `src/main/config.ts` | New defaults (`heic.mode = 'keep'`), backward compat migration |
| `src/shared/types/index.ts` | `AppConfig.heic`, `IndexResult.errors` |
| `tests/main/heic.test.ts` | Complete rewrite for heic-decode |
| `tests/main/importer.test.ts` | New config shape, both modes, error reporting |
| `tests/main/indexer.test.ts` | Error reporting tests |
| `tests/main/config.test.ts` | Migration tests |
| `tests/main/ipc/config-handlers.test.ts` | Updated config shape |
| `tests/main/ipc/import-handlers.test.ts` | Updated config shape |

## Test results

- **394 tests passing**, 100% coverage
- Lint clean
- All existing tests updated for new config shape and error reporting

## Key technical decisions

- **heic-decode v2.x API**: uses `{ buffer: ... }` (not `{ data: ... }` from v1.x)
- **No JPEG intermediate for pHash**: RGBA→gray produces compatible hashes (max 1 bit diff)
- **Injectable dependencies**: `HeicDecodeFn`, `HeicConverter`, `PhashComputer` all injectable for testing
- **`isHeicFile()` helper**: shared between converter and phash computer

## Deferred

- TASK-040: Native C addon (libheif) for faster HEIC decode — optional future optimization
- Settings UI for `heic.mode` toggle — follow-up task
