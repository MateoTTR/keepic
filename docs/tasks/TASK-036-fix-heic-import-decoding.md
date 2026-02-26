# TASK-036 — Fix HEIC import decoding failure

## Priority

P0 — HEIC files are the primary format from iPhones. All HEIC imports fail.

## Problem

During local import, all HEIC files fail with the following error:

```
IMG_0982.HEIC — C:\Temp\TESTS_KEEPIC\Import\IMG_0982.HEIC: bad seek to 1965438
heif: Error while loading plugin: No decoding plugin installed for this compression format
(11.6003)
```

JPEG files import successfully. Only HEIC files are affected.

## Root Cause (confirmed)

sharp@0.33.5's prebuilt binaries **do not include the HEVC/H.265 decoder** (libde265)
due to patent licensing concerns. The bundled libheif only supports AV1/AVIF decoding.

Evidence: `sharp.format.heif.input.fileSuffix` only contains `[".avif"]` — no `.heic`
or `.heif`. This fails in both dev mode and packaged app (not an Electron packaging issue).

## Solution

Replace the sharp-only HEIC→JPEG pipeline with a two-step approach:

1. **Decode**: `heic-decode` (npm) — uses `libheif-js` which bundles a WebAssembly port
   of libde265 (HEVC decoder). The WASM binary is inlined in `libheif-bundle.js` (base64),
   so no external `.wasm` file loading — works seamlessly inside Electron's asar archive.

2. **Encode**: `sharp` — receives raw RGBA pixels from heic-decode, encodes to JPEG via
   mozjpeg with quality control.

### EXIF metadata note

The output JPEG does not embed EXIF metadata from the original HEIC. This is acceptable
because the import pipeline already extracts and stores all metadata (date_taken, GPS,
dimensions) in the SQLite database via `exifreader` before conversion.

## Changes

| File | Change |
|---|---|
| `package.json` | Add `heic-decode@^2.0.0` dependency |
| `src/main/heic.ts` | New `createHeicConverter()` factory with injectable `HeicPixelDecoder`; `defaultHeicConverter` uses real `heic-decode` |
| `src/main/heic-decode.d.ts` | TypeScript declarations for `heic-decode` (no `@types` package available) |
| `tests/main/heic.test.ts` | Rewritten: tests use injectable mock decoder for the decode step, real sharp for JPEG encoding |

## Deliverables

1. ~~Identify whether the issue is sharp config, packaging, or library version~~ → **Confirmed: sharp prebuilt missing HEVC decoder**
2. ~~Fix the HEIC decoding~~ → **Done: heic-decode + sharp pipeline**
3. ~~Add a test with a real HEIC file if feasible~~ → **Not feasible without a test fixture; used injectable mock decoder instead (6 tests covering the full pipeline)**
4. Verify fix works in packaged app on Windows → **Pending manual test after merge**

## PR

[#28](https://github.com/MateoTTR/keepic/pull/28) — targeting `develop`
