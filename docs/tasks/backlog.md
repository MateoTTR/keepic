# KeePic — Task Backlog

> Tasks are numbered in planned execution order. Each task has a detailed file at `TASK-NNN-*.md`.
> Update this file at the end of each session.

---

## Status Legend

| Symbol | Meaning |
|---|---|
| `[ ]` | Pending |
| `[~]` | In progress |
| `[x]` | Completed |
| `[-]` | Cancelled / Deferred |

---

## Phase 0 — Project Setup & Documentation

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-001](TASK-001-documentation-setup.md) | Set up project documentation structure | `[x]` | 2026-02-21-session-001 |
| [TASK-002](TASK-002-adr-decisions.md) | Refine specs + close ADR-001 (Electron) and ADR-002 | `[x]` | 2026-02-21-session-002 |
| [TASK-003](TASK-003-tech-stack-setup.md) | Set up Electron project scaffold (electron-vite, TypeScript, UI framework, test framework) | `[x]` | 2026-02-21-session-004 |
| [TASK-003b](TASK-003b-cicd-setup.md) | Set up GitHub Actions CI/CD (lint, tests, coverage gate, release build) | `[x]` | 2026-02-21-session-004 |

## Phase 1 — Core Foundation

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-004](TASK-004-database-schema.md) | Implement SQLite schema and migrations | `[x]` | 2026-02-21-session-004 |
| [TASK-005](TASK-005-library-folder-init.md) | Implement library folder initialization and first-launch config | `[x]` | 2026-02-21-session-005 |
| [TASK-006](TASK-006-library-indexer.md) | Implement library indexer (scan year folders, EXIF + pHash, upsert DB) | `[x]` | 2026-02-21-session-006 |
| [TASK-007](TASK-007-exif-reader.md) | Implement EXIF reader and date extraction with fallback chain | `[x]` | 2026-02-21-session-006 |
| [TASK-008](TASK-008-phash.md) | Implement perceptual hash (pHash) computation | `[x]` | 2026-02-21-session-006 |
| [TASK-009](TASK-009-heic-handling.md) | Implement Live Photo detection and HEIC → JPEG conversion | `[x]` | 2026-02-21-session-007 |

## Phase 2 — Import

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-010](TASK-010-import-local-folder.md) | Implement local folder / SD card import pipeline | `[x]` | 2026-02-21-session-008 |
| [TASK-011](TASK-011-deduplication-ui.md) | Implement deduplication review UI | `[x]` | 2026-02-22-session-009 |
| [TASK-012](TASK-012-google-photos-oauth.md) | Implement Google Photos OAuth 2.0 flow + keychain token storage | `[x]` | 2026-02-22-session-010 |
| [TASK-013](TASK-013-google-photos-import.md) | Implement Google Photos media fetch, date filter, and download | `[x]` | 2026-02-22-session-011 |
| [TASK-014](TASK-014-whatsapp-signal-import.md) | Implement WhatsApp / Signal folder import | `[-]` | — |

## Phase 3 — Browsing UI

> **Note**: Browse/view features are deferred to a later version. Users rely on OS file explorer and native viewers in v1.

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-015](TASK-015-photo-grid.md) | Implement chronological photo grid with pagination | `[-]` | — |
| [TASK-016](TASK-016-date-filter.md) | Implement date range filter (year / month / day) | `[-]` | — |
| [TASK-017](TASK-017-fullscreen-viewer.md) | Implement full-screen photo viewer with metadata panel | `[-]` | — |
| [TASK-018](TASK-018-search.md) | Implement search by filename | `[-]` | — |

## Phase 4 — Library Management

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-019](TASK-019-library-stats.md) | Implement library statistics view | `[x]` | 2026-02-22-session-012 |
| [TASK-020](TASK-020-deduplication-scan.md) | Implement standalone deduplication scan on existing library | `[x]` | 2026-02-22-session-013 |
| [TASK-021](TASK-021-reindex.md) | Implement manual re-index of library folder | `[x]` | 2026-02-22-session-014 |

## Phase 5 — Packaging & Distribution

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-022](TASK-022-packaging.md) | Configure electron-builder for Windows (NSIS) + macOS (DMG) releases | `[x]` | 2026-02-22-session-015 |

## Phase 6 — Post-release bug fixes (v0.1.x)

> Bugs and UX issues found during manual testing sessions (2026-02-23).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-023](TASK-023-fix-workers-build.md) | Fix workers build config — workers never compiled, all core features broken | P0 | `[x]` | 2026-02-23-session-017 |
| [TASK-024](TASK-024-fix-oauth-callback-crash.md) | Fix OAuth callback server crash on second browser request | P1 | `[x]` | 2026-02-23-session-017 |
| [TASK-025](TASK-025-auto-index-on-library-setup.md) | Warn user to index library after first configuration | P2 | `[x]` | 2026-02-23-session-017 |
| [TASK-026](TASK-026-fix-import-execution-race-condition.md) | Fix import execution race condition (UI frozen on "Starting…") + cancel no-op | P0 | `[x]` | 2026-02-23-session-018 |
| [TASK-027](TASK-027-fix-google-photos-403-scopes.md) | Fix Google Photos 403 insufficient scopes + improve error message | P1 | `[x]` | 2026-02-23-session-018 |
| [TASK-028](TASK-028-fix-google-photos-scope-verification.md) | Fix Google Photos scope verification at connect time | P1 | `[x]` | 2026-02-24-session-020 |
| [TASK-029](TASK-029-fix-import-worker-robustness.md) | Fix import worker robustness (frozen "Starting…" persists after TASK-026) | P0 | `[x]` | 2026-02-24-session-020 |
| [TASK-030](TASK-030-fix-structured-clone-import.md) | Fix structured clone error breaking local import ($state.snapshot) | P0 | `[x]` | 2026-02-24-session-021 |
| [TASK-036](TASK-036-fix-heic-import-decoding.md) | Fix HEIC import decoding failure — sharp/libheif plugin not loading | P0 | `[x]` | 2026-02-25-session-022 |

## Phase 7 — Google Photos Picker API Migration

> Migration from the deprecated Library API to the new Picker API.
> The `photoslibrary.readonly` scope was deprecated by Google on March 31, 2025.
> See [ADR-003 Amendment](../architecture/adr/ADR-003-google-photos-integration.md#amendment--migration-to-picker-api-2026-02-24).

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-031](TASK-031-remove-deprecated-library-api.md) | Remove deprecated Library API code + update OAuth scope | `[x]` | 2026-02-25-session-023 |
| [TASK-032](TASK-032-picker-session-backend.md) | Implement Picker API session management (create, poll, list items) | `[x]` | 2026-02-25-session-024 |
| [TASK-033](TASK-033-picker-download-worker.md) | Implement Picker download worker (fetch selected items + download to staging) | `[x]` | 2026-02-25-session-025 |
| [TASK-034](TASK-034-picker-ui.md) | Implement Picker UI flow (open browser, polling status, progress, handoff to local import) | `[x]` | 2026-02-25-session-026 |
| [TASK-035](TASK-035-picker-integration-test.md) | End-to-end integration test + update error messages and user guidance | `[x]` | 2026-02-25-session-027 |

## Phase 8 — Post-release bug fixes (v0.2.x)

> Bugs found during manual testing of v0.2.0 (2026-02-26).
> Both implemented as feature branches from `develop`, targeting a v0.2.1 release.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-037](TASK-037-fix-heic-double-decode.md) | Fix slow HEIC processing — replace WASM decoder with native ffmpeg | P0 | `[x]` | 2026-03-01-session-031 |
| [TASK-038](TASK-038-fix-picker-list-url.md) | Fix Picker API list URL — sessionId must be a query param, not a path segment | P1 | `[x]` | 2026-03-01-session-030 |

### CI fixes (committed directly to `develop`)

| Fix | Description | Commit |
|---|---|---|
| `libsecret-1-dev` missing | Install system dep for keytar on Ubuntu 24.04 | `91f91fd` |
| Release Windows EOF | Transient network error downloading nsis-resources — re-run triggered | — |

---

## Upcoming / Not Yet Planned

- In-app browse/viewer (Phase 8 — deferred)
- Event folder creation UI
- Settings screen (currently embedded in first-launch flow)

---

## Phase 9 — Performance (v0.3.x)

> **Dependency**: PERF-001 must be implemented after TASK-037 (ffmpeg-based HEIC).
> ffmpeg child processes enable true OS-level parallelism; WASM would not benefit.

| ID | Title | Priority | Status | Session |
|---|---|---|---|---|
| [PERF-001](PERF-001-concurrent-processing.md) | Concurrent processing — parallelize indexer, planner, executor (N workers = `os.cpus().length`) | P3 | `[ ]` | — |

---

## Backlog — Refactoring / Features

| ID | Title | Type | Priority |
|---|---|---|---|
| [REFACTOR-001](REFACTOR-001-heic-phash-simplification.md) | Simplify HEIC pHash workflow — superseded by TASK-037 | Refactor | `[x]` |
| FEAT-001 | Side-by-side duplicate comparison viewer with metadata and "Reveal in Explorer/Finder" | Feature | P4 |
