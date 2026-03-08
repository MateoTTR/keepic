# TASK-061-fix — Handle .HEIC files that are actually JPEG (magic bytes detection)

## Context

During real-world indexing of a library spanning 2020–2024, 4,841 `.HEIC` files caused errors:
```
heif_error: Invalid input: No 'ftyp' box (2, 102)
```

Investigation of a sample file (`IMG_1854.HEIC`, iPhone XS, iOS 13.5.1) revealed that these files are **JPEG images with a `.HEIC` extension**. The magic bytes are `FF D8 FF` (JFIF), not the expected HEIC `ftyp` box.

This is the same problem as TASK-042 (Google Picker serving HEIC as JPEG), but occurring in local library files — likely caused by Synology Photos, iCloud sync, or another tool that converted HEIC→JPEG while preserving the original filename.

## Root Cause

The HEIC decoding pipeline (indexer, planner, executor) assumes that files with `.heic`/`.heif` extensions are genuine HEIC containers. When the native libheif decoder encounters a JPEG file, it fails with "No 'ftyp' box".

## Fix

Before attempting HEIC decoding, check the first bytes of the file buffer:
- If magic bytes are `FF D8 FF` (JPEG) → skip HEIC decoding, treat as JPEG directly (sharp can handle JPEG natively)
- If magic bytes indicate a valid HEIC container (`ftyp` at offset 4) → proceed with HEIC decoding as usual

We already have `isJpegBuffer()` from TASK-042 (`src/main/google-photos-picker-downloader.ts`). This utility should be extracted to a shared location and reused.

## Design

1. Extract `isJpegBuffer()` to a shared utility (e.g., `src/main/media-utils.ts` or into `src/main/heic.ts`)
2. In the HEIC decode path (wherever `heicDecode` / `HeicDecodePool.decode` is called):
   - Read the file buffer
   - If `isJpegBuffer(buffer)` → return the buffer directly to sharp (no HEIC decode needed)
   - Otherwise → decode via libheif as usual
3. The pHash and EXIF extraction will work correctly since sharp handles JPEG natively

## Affected code paths

The HEIC decode is called in three workers:
- **Indexer** (`src/main/indexer.ts`) — pHash computation for `.heic` files
- **Planner** (`src/main/importer.ts` planning phase) — pHash for duplicate detection
- **Executor** (`src/main/importer.ts` execution phase) — HEIC→JPEG conversion (if mode=convert)

All three need the magic bytes check before attempting HEIC decode.

## Deliverables

- [ ] Extract `isJpegBuffer()` to shared utility
- [ ] Add magic bytes check before HEIC decoding in indexer
- [ ] Add magic bytes check before HEIC decoding in planner
- [ ] Add magic bytes check before HEIC decoding in executor
- [ ] Add tests with a JPEG-in-HEIC-extension fixture
- [ ] Verify 100% coverage

## Files to change

| File | Change |
|------|--------|
| `src/main/heic.ts` (or new `media-utils.ts`) | Extract/add `isJpegBuffer()` |
| `src/main/google-photos-picker-downloader.ts` | Import shared `isJpegBuffer()` instead of local copy |
| `src/main/indexer.ts` | Check magic bytes before HEIC decode |
| `src/main/importer.ts` | Check magic bytes before HEIC decode (planner + executor) |
| Tests | Add JPEG-in-HEIC test cases |
