# TASK-009 — Implement Live Photo detection and HEIC → JPEG conversion

## Goal

Provide a reusable, injectable utility module (`src/main/heic.ts`) that the import pipeline (TASK-010) can use to:

1. **Detect Live Photo MOV companions** — identify `.MOV` files that are the video part of an iPhone Live Photo and should be discarded at import time.
2. **Convert HEIC → JPEG** — when `heicConversion.enabled` is true, convert a HEIC/HEIF file to JPEG in a temp directory (EXIF metadata preserved) before copying to the library.

---

## Deliverables

| File | Status |
|---|---|
| `src/main/heic.ts` | new |
| `tests/main/heic.test.ts` | new |

---

## Key Design Decisions

### Live Photo detection

An iPhone Live Photo generates two files with the same stem:
- `IMG_1234.HEIC` — the still image
- `IMG_1234.MOV` — the video clip (to be discarded)

Detection logic: a `.MOV` file is a Live Photo companion if a `.heic` or `.heif` file with the same stem exists in the same directory. The check is case-insensitive (Windows/macOS filesystems).

### HEIC conversion

- Uses `sharp` (already installed) — `sharp(src).jpeg({ quality }).withMetadata().toFile(dest)`
- `withMetadata()` preserves EXIF tags (date, GPS, orientation…) in the output JPEG
- Quality is read from `AppConfig.heicConversion.jpegQuality` (default 90) — the import pipeline passes it in
- Conversion happens in `temp/` (OS app data); the JPEG is moved to the library only after successful conversion

### Injectable pattern

Follows the same pattern as `ExifLoader` / `PhashComputer`:
- `ExistsChecker` — injectable `(path: string) => boolean` for Live Photo detection (default: `existsSync`)
- `HeicConverter` — injectable `(src, dest, quality) => Promise<void>` for conversion (default: `defaultHeicConverter`)
- `convertHeicToJpeg(src, dest, quality, converter?)` — thin wrapper, used by the import pipeline

---

## Public API

```typescript
// Pure helper
export function getHeicCandidatePaths(movPath: string): string[]

// Live Photo detection
export type ExistsChecker = (path: string) => boolean
export function isLivePhotoMov(movPath: string, checkExists?: ExistsChecker): boolean

// HEIC → JPEG conversion
export type HeicConverter = (src: string, dest: string, quality: number) => Promise<void>
export const defaultHeicConverter: HeicConverter
export async function convertHeicToJpeg(src, dest, quality, converter?): Promise<void>
```

---

## Out of Scope (TASK-009)

- Windows HEIC codec detection / warning UI (deferred to TASK-010 or settings UI)
- IPC channels (no new renderer-facing API in this task)
- Integration into the import pipeline (TASK-010)
