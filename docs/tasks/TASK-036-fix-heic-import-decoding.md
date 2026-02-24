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

## Root Cause (hypothesis)

The error `"No decoding plugin installed for this compression format"` comes from
sharp's underlying libheif/libvips library. This typically means:

1. **Missing HEIF decoder plugin**: sharp@0.33.x bundles prebuilt binaries with libheif
   support, but the HEIF decoder (libde265 or similar) may not be included in the
   platform-specific binary, or may fail to load at runtime.

2. **Electron packaging issue**: sharp is listed in `asarUnpack` in electron-builder config,
   but the native `.node` addon or its companion shared libraries (`.dll`/`.dylib`) may
   not be correctly unpacked or may have path resolution issues at runtime.

3. **sharp version**: The bundled sharp@0.33.5 may have a regression or incompatibility
   with the Electron version being used.

## Investigation steps

1. **Reproduce locally**: Run a unit test that calls `sharp(heicPath).jpeg().toFile(dest)`
   on a real HEIC file to confirm whether the issue is sharp-level or Electron-level.

2. **Check sharp HEIF support**: Run `sharp.format` to see if `heif` input is listed as
   supported. If not, the prebuilt binary is missing HEIF support.

3. **Test in dev mode vs packaged**: If it works in `npm run dev` but fails in the
   packaged app, the issue is electron-builder's `asarUnpack` configuration.

4. **Check sharp version compatibility**: Verify sharp@0.33.5 supports HEIF on Windows.
   Consider upgrading to sharp@0.34.x if needed.

## Affected code

- `src/main/heic.ts` — `defaultHeicConverter` calls `sharp(src).jpeg({ quality }).withMetadata().toFile(dest)`
- `src/main/importer.ts` — calls converter during both planning (pHash) and execution
- `src/workers/planner.worker.ts` — runs planning in worker thread
- `src/workers/importer.worker.ts` — runs execution in worker thread

## Deliverables

1. Identify whether the issue is sharp config, packaging, or library version
2. Fix the HEIC decoding — all HEIC files should convert to JPEG and import successfully
3. Add a test with a real HEIC file if feasible (or document why not)
4. Verify fix works in packaged app on Windows
