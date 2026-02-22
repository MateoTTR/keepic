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
| [TASK-013](TASK-013-google-photos-import.md) | Implement Google Photos media fetch, date filter, and download | `[~]` | 2026-02-22-session-011 |
| [TASK-014](TASK-014-whatsapp-signal-import.md) | Implement WhatsApp / Signal folder import | `[ ]` | — |

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
| [TASK-019](TASK-019-library-stats.md) | Implement library statistics view | `[~]` | 2026-02-22-session-012 |
| [TASK-020](TASK-020-deduplication-scan.md) | Implement standalone deduplication scan on existing library | `[ ]` | — |
| [TASK-021](TASK-021-reindex.md) | Implement manual re-index of library folder | `[ ]` | — |

## Phase 5 — Packaging & Distribution

| # | Title | Status | Session |
|---|---|---|---|
| [TASK-018](TASK-018-packaging.md) | Configure electron-builder for Windows (NSIS) + macOS (DMG) releases | `[ ]` | — |

---

## Upcoming / Not Yet Planned

- In-app browse/viewer (Phase 6 — deferred)
- Event folder creation UI
- Settings screen (currently embedded in first-launch flow)
