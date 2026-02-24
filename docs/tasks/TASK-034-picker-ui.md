# TASK-034 — Implement Picker UI flow

## Goal

Redesign the Google Photos import UI to use the Picker API flow: open browser for selection,
poll for completion, show download progress, then hand off to the existing local import
pipeline.

## Context

The old flow was: date picker → automatic download → plan/review → execute.
The new flow is: open Picker in browser → user selects photos → download selected → plan/review → execute.

## Deliverables

### Redesign `GoogleDownloadScreen.svelte`

1. **State machine** with states:
   - `idle` — "Import from Google Photos" button + explanation text
   - `waiting` — Picker opened in browser, polling for user selection (spinner + "Waiting for your selection in Google Photos…")
   - `downloading` — Downloading selected photos (progress bar: X / Y downloaded)
   - `complete` — Download finished, "Analyse" button to proceed to plan/review
   - `error` — Error message + retry/back buttons

2. **idle → waiting**: Call `handleCreatePickerSession` → open `pickerUri` in browser → start polling

3. **waiting → downloading**: Poll returns `ready: true` → start download worker

4. **downloading → complete**: Worker sends `complete` → show results

5. **complete → plan/review**: Same handoff as today — pass staging folder to local import

### Update preload bindings

6. **`src/preload/index.ts` + `index.d.ts`** — Add IPC bindings:
   - `google.createPickerSession()` → returns `{ pickerUri, sessionId }`
   - `google.pollPickerSession(sessionId)` → returns `{ ready: boolean }`
   - `google.startPickerDownload(sessionId)` → starts worker
   - `google.cancelPickerDownload()` → cancels worker
   - `google.onPickerDownloadProgress(cb)` / `onPickerDownloadComplete(cb)` — event listeners
   - Keep existing `getAuthStatus`, `connect`, `disconnect`

### Update `HomeScreen.svelte`

7. Update the Google Photos section if needed (e.g., button text, flow entry point)

### Update `src/main/index.ts`

8. Register new IPC handlers for Picker session + download

### Tests

9. No unit tests for Svelte components (per project convention)
10. IPC handler tests covered in TASK-032 and TASK-033

## UX details

- The "Waiting for selection" state should have a clear message explaining what the user
  needs to do ("Select photos in the Google Photos tab that just opened, then click Done")
- If the browser tab is closed without selecting, the polling should timeout gracefully
  and return to idle state with an appropriate message
- The Picker URL can be re-opened if the user accidentally closes the tab
