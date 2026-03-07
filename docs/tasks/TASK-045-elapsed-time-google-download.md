# TASK-045: Elapsed Time in Google Picker Download

## Goal

Display elapsed time in the Google Picker download screen, consistent with the elapsed time added to import and re-index reports in TASK-043.

## Changes

- **`GoogleDownloadScreen.svelte`**: track `startTime` on download start, compute `elapsedMs` on completion, display via `formatElapsed()` in the completion message

## Session

Completed in session 040 (2026-03-07), PR #47 (combined with PERF-003).
