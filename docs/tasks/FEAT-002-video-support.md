# FEAT-002: Video Support

## Goal

Add video file support to KeePic: index videos in the library, import from local folder and Google Picker, detect and skip Live Photo video companions.

## Context

The user's library contains ~9000 video files alongside ~58000 images. Currently KeePic only indexes/imports images. Videos need to be tracked in the DB during indexing and imported via local folder or Google Picker.

Key subtlety: iPhone Live Photos = `.HEIC` + `.MP4` pair (same stem). These short video companions should be detected and skipped by default. Real videos (no sibling photo) should be imported normally.

## Supported Video Formats

`.mp4`, `.mov`, `.avi`, `.mts`, `.3gp`, `.m4v`, `.mpg`

## Ignored Formats

`.thm` (camera thumbnails), `.flv`, `.mpo`, `.dng`, `.gif`, `.psd`, and all non-media files.

## Key Design Decisions

1. **No pHash for videos**: Too expensive. Deduplication uses filename + file size matching instead.
2. **Live Photo detection**: `.mp4`/`.mov` with sibling `.heic`/`.heif`/`.jpg`/`.jpeg` (same stem) = Live Photo companion = skipped.
3. **DB `media_type` column**: `'photo'` (default, backfilled) or `'video'`. Migration 2→3.
4. **Video thumbnails**: Placeholder icon in V1 (no ffmpeg frame extraction).
5. **EXIF from videos**: ExifReader supports MP4/MOV metadata. Fallback chain still applies.

## Tasks

| Task | Title | Depends on |
|------|-------|------------|
| TASK-V01 | DB migration + media type infrastructure | — |
| TASK-V02 | Live Photo detection (.MP4 support) | V01 |
| TASK-V03 | Video-aware import pipeline | V01, V02 |
| TASK-V04 | Indexer + dedup + stats + thumbnails | V01, V02, V03 |

## IPC Channels

No new IPC channels. Existing channels updated to handle video media type:
- `import:plan` — returns entries with `mediaType: 'photo' | 'video'`
- `library:get-stats` — returns `totalPhotos` + `totalVideos`
- `library:scan-duplicates` — returns groups with `mediaType` field
