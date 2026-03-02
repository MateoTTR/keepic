# TASK-039 — Fix HEIC handling: Windows crash, full-res conversion, default keep-as-HEIC

## Status

`[ ]` Pending

## Phase

Phase 8 — Post-release bug fixes (v0.2.x)

## Priority

P0

## Context

Identified during manual testing of v0.2.1 on Windows (2026-03-02, session 032).
Confirmed and extended during HEIC investigation session (2026-03-02, session 032).

Three distinct problems with HEIC handling were found:
- **Bug A**: ffmpeg crashes on Windows — no HEIC processing at all in the packaged app
- **Bug B**: ffmpeg produces 512×512 thumbnails instead of full-res when converting — affects Linux too
- **New spec**: default behaviour should be to keep HEIC files as-is (no conversion), with optional JPEG conversion

## Bugs

### Bug A — ffmpeg crashes on Windows (exit 3199971767)

**Symptom**: `IMG_0982.HEIC — ffmpeg exited with code 3199971767` during import (local folder and Google
Photos Picker).

**Root cause**: `ffmpeg-static` downloads a platform-specific binary at `npm install` time. The GitHub
Actions CI pipeline runs on Ubuntu → downloads the **Linux ELF** binary. `electron-builder --win`
then packages this Linux binary into the Windows installer. On Windows, the Linux binary cannot be
executed and crashes with exit code `0xBEBBB1B7`.

`electron-builder`'s `npmRebuild: true` only rebuilds native `.node` addons — it does not re-run
`ffmpeg-static`'s post-install script for the target platform.

**Impact**:
- Import of HEIC files fails with an error at the execution phase
- At the planning phase, the ffmpeg error is silently swallowed → `phashResult = null`,
  `stagedPath = undefined` → no duplicate detection for HEIC files → photos already in the library
  appear as "collisions" instead of "duplicates"

### Bug B — ffmpeg outputs 512×512 tile instead of full-res when converting

**Symptom**: HEIC → JPEG conversion produces a 512×512 JPEG (5KB) instead of the native
3024×4032 (148KB). This bug exists on **all platforms**, including Linux in development.

**Root cause**: iPhone HEIC files use a **HEVC Tile Grid** structure. The 3024×4032 image is encoded
as 48 independent 512×512 HEVC tiles (`dependent` streams) assembled into a stream group (`default`).

Without an explicit `-vf scale=W:H` filter, ffmpeg selects the first tile stream (stream `#0:0`,
512×512) rather than assembling the full tile grid. The `-vf scale=W:H` filter forces ffmpeg to
decode and assemble the complete tile grid, but requires knowing the target dimensions in advance.

```
# Current command — outputs first tile (512×512) ❌
ffmpeg -i FILE.heic -q:v 85 dest.jpg -y  →  512×512, 5KB

# With explicit scale — outputs full image ✓
ffmpeg -i FILE.heic -vf scale=3024:4032 -update 1 -q:v 85 dest.jpg -y  →  3024×4032, 148KB
```

**Impact on pHash**: ✅ No impact — the 512×512 tile is sufficient for pHash computation.
The DCT hash is identical between the 512×512 tile and the full 3024×4032 image (Hamming 0 bits),
because pHash resizes to 32×32 anyway. The current pHash approach (no scale filter) is **correct and
fast** and must NOT be changed.

**Impact on conversion**: ❌ Critical — the library would store degraded 512×512 JPEGs instead of
full-resolution images.

## Spec change — Default to keep HEIC as-is

### New behaviour

Add a **copy mode** flag for HEIC handling with two options:

| Mode | Behaviour | Default |
|---|---|---|
| `'keep'` | Copy the original HEIC file into the library unchanged | ✅ **Yes** |
| `'convert'` | Convert to JPEG at full native resolution before storing | No |

This replaces the current `heicConversion.enabled` boolean with a new `heicMode` setting.

### Rationale

- Keeping HEIC preserves original quality and metadata
- HEIC files are smaller than JPEG at equivalent quality
- Synology Photo Station supports HEIC natively
- Avoids the full-res conversion complexity (Bug B) for the common case
- pHash always uses the fast 512×512 tile decode regardless of the copy mode

### Settings change

```typescript
// Before
heicConversion: {
  enabled: boolean        // default: true
  jpegQuality: number     // default: 85
}

// After
heic: {
  mode: 'keep' | 'convert'   // default: 'keep'
  jpegQuality: number         // default: 85, only used when mode = 'convert'
}
```

## Deliverables

### 1. Fix Bug A — Windows binary packaging

**Recommended approach**: replace `ffmpeg-static` with `@ffmpeg-installer/ffmpeg`.

`@ffmpeg-installer/ffmpeg` provides platform-specific binaries as separate optional npm dependencies
(similar to `sharp`'s model). During `electron-builder --win` on the Ubuntu CI runner, npm installs
the Windows binary via the optional dep `@ffmpeg-installer/ffmpeg-win32-x64`. The Linux binary is
never packaged into the Windows installer.

Migration:
- `npm uninstall ffmpeg-static`
- `npm install @ffmpeg-installer/ffmpeg`
- Update `getFfmpegPath()` in `heic.ts`: `require('@ffmpeg-installer/ffmpeg').path`
- Update `asarUnpack` in `package.json` to point to the new binary location
- Verify on Windows (dev + packaged)

### 2. Fix Bug B — Full-res conversion via probe step

When `heic.mode === 'convert'`, the conversion must output the full native resolution:

**Two-step approach**:
1. Parse the ffmpeg info output (stderr from `ffmpeg -i FILE`) to extract the Tile Grid dimensions
   from the `Stream group ... Tile Grid: ... NxM` line.
2. Use those dimensions in the scale filter: `ffmpeg -i FILE -vf scale=N:M -update 1 -q:v Q DEST -y`

This requires 2 ffmpeg spawns per HEIC file for conversion, but conversion is an explicit opt-in.
For pHash computation (default case), the single spawn without scale filter is retained.

### 3. Implement new HEIC mode setting

- Update `AppConfig` type in `src/shared/types/index.ts`: replace `heicConversion` with `heic`
- Update `configDefaults` in config module: `heic.mode = 'keep'`
- Update `buildImportPlan` planner: use `heic.mode` instead of `heicConversion.enabled`
  - `'keep'`: copy HEIC file directly (no staging, no ffmpeg for conversion)
  - `'convert'`: use two-step ffmpeg with probe dimensions → scale → staged JPEG
- Update `executeImportPlan` executor: handle `'keep'` mode (copy, not move staged file)
- Update `Settings.svelte` (or equivalent UI): add radio/toggle for HEIC mode
- Update pHash computation: **unchanged** — always uses the fast single-spawn (no scale filter)

### 4. Fix error reporting (Bug C from initial analysis)

- When ffmpeg fails during pHash computation, log the error and surface it to the user
- Indexer: add `failedFiles: Array<{ path: string; error: string }>` to `IndexResult`
- Planner: when HEIC staging fails, set `status = 'error'` instead of silently setting `phash = null`

## HEIC pHash — confirmed working approach (do NOT change)

Investigation confirmed (158 files, all iPhone HEIC):
- `ffmpeg -i FILE -frames:v 1 tempPath -y` reliably outputs a 512×512 first tile
- pHash from 512×512 tile is **identical** to pHash from full 3024×4032 image (Hamming 0 bits)
- 22/158 files differ by 1 bit between the tile decode and quality-converted JPEG (still correct)
- This approach is fast and correct for duplicate detection — no changes needed

## Tests

- 100% coverage target maintained
- Unit tests for new `heic.mode` config (mock config)
- Planner tests: `'keep'` mode copies HEIC directly, no staging; `'convert'` mode uses two-step probe
- Executor tests: `'keep'` mode for HEIC entry (no staged path, direct copy)
- Tests for `getFfmpegPath` with new `@ffmpeg-installer/ffmpeg` path
- Tests for dimension probe parser (parse ffmpeg stderr for Tile Grid dimensions)

## Notes

- TASK-037 introduced ffmpeg for HEIC but was only tested on Linux/WSL — the Windows packaging
  scenario and the tile grid issue were not covered
- Bug B (512×512 conversion) was not caught because the import was failing on Windows before
  reaching the conversion step, and development testing was on Linux where the import succeeded
  but the output quality was not verified
- The Picker API flow (TASK-032–035) is confirmed working on Windows
