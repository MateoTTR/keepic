# TASK-038 — Fix Picker API list media items URL (404)

## Priority
P1 — Google Photos import completely broken after picker selection

## Problem

`listPickerMediaItems` constructs the wrong URL. The `sessionId` is used as a
**path segment** instead of a **query parameter**, producing a 404 from Google's API.

### Error observed

```
Failed to list picker media items: 404 <!DOCTYPE html>...
The requested URL /v1/sessions/89c4f165-.../mediaItems?pageSize=100 was not found
```

### Root cause

In `src/main/google-photos-picker.ts`, line 109:

```typescript
// WRONG — sessionId as path segment
`${PICKER_API_BASE}/sessions/${sessionId}/mediaItems?${params.toString()}`

// CORRECT — sessionId as query parameter
`${PICKER_API_BASE}/mediaItems?${params.toString()}`
// with params including: sessionId, pageSize, (pageToken?)
```

The Picker API endpoint for listing selected media items is:
```
GET https://photospicker.googleapis.com/v1/mediaItems?sessionId={sessionId}&pageSize=100
```
Not:
```
GET https://photospicker.googleapis.com/v1/sessions/{sessionId}/mediaItems
```

---

## Fix

### `src/main/google-photos-picker.ts` — `listPickerMediaItems`

```typescript
// BEFORE (line 103-109):
const params = new URLSearchParams({ pageSize: '100' })
if (pageToken) {
  params.set('pageToken', pageToken)
}
const response = await fetchFn(
  `${PICKER_API_BASE}/sessions/${sessionId}/mediaItems?${params.toString()}`,

// AFTER:
const params = new URLSearchParams({ sessionId, pageSize: '100' })
if (pageToken) {
  params.set('pageToken', pageToken)
}
const response = await fetchFn(
  `${PICKER_API_BASE}/mediaItems?${params.toString()}`,
```

### `tests/main/google-photos-picker.test.ts`

Update URL assertions in `listPickerMediaItems` tests to match the corrected endpoint:
- `photospicker.googleapis.com/v1/mediaItems?sessionId=...&pageSize=100`
- `photospicker.googleapis.com/v1/mediaItems?sessionId=...&pageSize=100&pageToken=...`

---

## Deliverables

1. `src/main/google-photos-picker.ts`: 2-line fix in `listPickerMediaItems`
2. `tests/main/google-photos-picker.test.ts`: update URL assertions

## Effort estimate

~30 minutes (trivial fix + test update)

## Test Coverage

- `listPickerMediaItems` calls correct URL with `sessionId` as query param
- `listPickerMediaItems` includes `pageToken` in query params when provided
- All existing tests updated to reflect correct URL structure
