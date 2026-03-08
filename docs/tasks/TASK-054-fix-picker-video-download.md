# TASK-054-fix — Fix Google Picker video download (truncated files + wrong date)

## Context

Manual testing of v0.3.3 revealed that videos downloaded via the Google Photos Picker API are broken:

1. **Truncated files** — Videos are ~200-300 kB instead of their real size. They show a single frame and immediately close in any player.
2. **Wrong date** — Videos are filed in the download month (March) instead of their capture month (February). This is a consequence of bug #1: truncated files have no usable EXIF/metadata, so the fallback uses the file's mtime (= download time).

## Root Cause

In `google-photos-picker-downloader.ts` line 109, the download URL uses `=d` for **all** items:

```typescript
const response = await fetchFn(`${item.baseUrl}=d`, {
  headers: { Authorization: `Bearer ${accessToken}` }
})
```

The `=d` parameter downloads the **photo** content. For videos, it returns a thumbnail/preview image, not the actual video bytes. The correct parameter for videos is `=dv`.

## Fix

### 1. `src/main/google-photos-picker-downloader.ts` — `downloadMediaItem`

Use `=dv` for video items, `=d` for photos:

```typescript
const suffix = item.mimeType.startsWith('video/') ? '=dv' : '=d'
const response = await fetchFn(`${item.baseUrl}${suffix}`, {
  headers: { Authorization: `Bearer ${accessToken}` }
})
```

### 2. `src/main/google-photos-picker.ts` — `mapPickerMediaItem`

Extract `creationTime` from the Picker API response and store it in `PickerMediaItem.mediaMetadata.creationTime`. Currently these fields are initialized to empty strings and the raw API data is discarded.

### 3. `src/main/google-photos-picker-downloader.ts` — File mtime

After writing the downloaded file, set its mtime to `creationTime` from the Picker API metadata (if available). This ensures the EXIF date fallback chain uses the correct capture date even for videos that lack EXIF metadata.

```typescript
if (item.mediaMetadata.creationTime) {
  const captureDate = new Date(item.mediaMetadata.creationTime)
  utimesSync(destPath, captureDate, captureDate)
}
```

### 4. Tests

- Update `downloadMediaItem` tests: verify `=dv` suffix for video mimeTypes, `=d` for image mimeTypes
- Update `mapPickerMediaItem` tests: verify `creationTime` is extracted
- Test mtime is set from `creationTime` when available
- Test fallback when `creationTime` is empty

## Risks

| Risk | Mitigation |
|------|-----------|
| `=dv` may take longer for large videos | Already handled by existing timeout/retry logic; document expected behavior |
| Video still processing on Google's side (`PROCESSING` status) | Out of scope for this fix — can be addressed later if needed |

## Validation

- [ ] Download a video via Picker API → full-size file, playable in MPV
- [ ] Video filed in correct month (capture date, not download date)
- [ ] Photos still download correctly with `=d`
- [ ] Full test suite passes with 100% coverage

## Files Changed

| File | Change |
|------|--------|
| `src/main/google-photos-picker-downloader.ts` | **Modified** — `=dv` for videos, set mtime from `creationTime` |
| `src/main/google-photos-picker.ts` | **Modified** — extract `creationTime` from API response |
| `tests/main/google-photos-picker-downloader.test.ts` | **Modified** — new/updated tests |
| `tests/main/google-photos-picker.test.ts` | **Modified** — test `creationTime` extraction |
