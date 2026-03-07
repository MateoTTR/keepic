# PERF-003: Concurrent Google Picker Downloads

## Goal

Parallelize HTTP downloads from Google Picker API using `withConcurrency` (I/O-bound, benefits from async parallelism unlike WASM HEIC decoding).

## Changes

- **`google-photos-picker-downloader.ts`**: apply `withConcurrency` to the download phase
  - Pre-assign filenames before parallel download (avoids collision detection races)
  - Each worker downloads one file independently
  - Progress reported after each file completes
- **Concurrency**: `os.cpus().length` workers (same as PERF-001 pattern)

## Key Design Decisions

- **Pre-assign filenames**: collision resolution (`_N` suffix) must happen before parallel download starts, since multiple workers writing to the same staging directory could race
- **I/O-bound**: unlike HEIC WASM decoding, HTTP downloads release the event loop during `await fetch()`, so `withConcurrency` provides real parallelism

## Session

Completed in session 040 (2026-03-07), PR #47 (combined with TASK-045).
