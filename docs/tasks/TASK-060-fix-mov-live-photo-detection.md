# TASK-060-fix — Fix MOV files incorrectly detected as Live Photo companions

## Context

During real-world indexing of 54,434 files, MOV videos paired with a JPG of the same name are incorrectly classified as Live Photo companions and excluded from the index. In reality, only `.mp4` files are Live Photo video companions on iPhone. `.mov` files with a same-name JPG sibling are typically separate recordings that happen to share a filename stem.

## Root Cause

`LIVE_PHOTO_VIDEO_EXTENSIONS` in `src/main/heic.ts` includes both `.mov` and `.mp4`. The original assumption was that older iOS versions used `.mov` for Live Photos, but in practice:
- **Live Photos**: always `.mp4` (paired with `.heic` or `.jpg`)
- **MOV files**: standalone videos (QuickTime format), not Live Photo companions

## Fix

1. Remove `.mov` from `LIVE_PHOTO_VIDEO_EXTENSIONS` in `src/main/heic.ts`
2. Update the specification (`docs/specs/specifications.md` §2.7) to clarify that only `.mp4` is a Live Photo video format
3. Update tests accordingly

## Impact

- MOV files previously skipped as "Live Photo companions" will now be indexed as regular videos
- No change to MP4 Live Photo detection behavior

## Deliverables

- [ ] Remove `.mov` from `LIVE_PHOTO_VIDEO_EXTENSIONS` in `src/main/heic.ts`
- [ ] Update `docs/specs/specifications.md` §2.7 — only `.mp4` for Live Photos
- [ ] Update tests in `tests/main/heic.test.ts`
- [ ] Update tests in `tests/main/indexer.test.ts` (if Live Photo MOV test cases exist)
- [ ] Update tests in `tests/main/importer.test.ts` (if Live Photo MOV test cases exist)

## Files to change

| File | Change |
|------|--------|
| `src/main/heic.ts` | Remove `.mov` from `LIVE_PHOTO_VIDEO_EXTENSIONS` |
| `docs/specs/specifications.md` | Update §2.7 — only `.mp4` for Live Photos |
| `tests/main/heic.test.ts` | Update Live Photo extension tests |
| `tests/main/indexer.test.ts` | Update if MOV Live Photo test cases exist |
| `tests/main/importer.test.ts` | Update if MOV Live Photo test cases exist |
