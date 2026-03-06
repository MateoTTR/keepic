# TASK-042 — Fix Google Picker HEIC files served as JPEG

## Status: In Progress

## Problem

The Google Picker API (`baseUrl=d`) converts HEIC files to JPEG server-side but preserves the original `.HEIC` filename. When the import pipeline encounters these files, it tries HEIC decoding on what is actually JPEG data, causing pHash computation to fail with "input buffer is not a HEIC image".

## Root Cause

- Google Picker API's download endpoint serves JPEG content with `.HEIC` filename
- No API parameter exists to force the original HEIC format
- Magic bytes confirm: `FF D8 FF` (JPEG) vs expected `....ftyp` (HEIC)

## Solution

1. Add `isJpegBuffer(data: Buffer): boolean` — checks first 3 bytes for JPEG magic `FF D8 FF`
2. Add `fixHeicJpegExtension(filename: string, data: Buffer): string` — if JPEG content with `.heic`/`.heif` extension, return filename with `.jpg`
3. Modify `downloadMediaItem` to return the `Buffer` in addition to writing the file
4. In `downloadPickerPhotos`, after downloading each item, check if extension needs fixing. If so, rename the file and update `usedFilenames`.
5. Add `renameFile` to `DownloaderDeps` for injectable rename operation.

## Files Modified

- `src/main/google-photos-picker-downloader.ts` — add helpers + modify download flow
- `tests/main/google-photos-picker-downloader.test.ts` — add tests for magic bytes detection + rename

## IPC Channels

No new IPC channels.
