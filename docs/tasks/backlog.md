# KeePic — Task Backlog

> All tasks use a single `TASK-NNN` numbering sequence in chronological order.
> The type tag after the number indicates the nature: `feat`, `fix`, `perf`, `refactor`, `doc`.
> Example: `TASK-046-feat-...`, `TASK-047-perf-...`, `TASK-048-fix-...`
> Each task has a detailed file at `docs/tasks/TASK-NNN-*.md`.
> **Legacy exception**: tasks before TASK-046 may use older prefixes (`FEAT-`, `PERF-`, `REFACTOR-`).
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

> Bugs found during manual testing of v0.2.0 (2026-02-26) and v0.2.1 (2026-03-02).
> Targeting a v0.2.1 release.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-037](TASK-037-fix-heic-double-decode.md) | Fix slow HEIC processing — replace WASM decoder with native ffmpeg | P0 | `[x]` | 2026-03-01-session-031 |
| [TASK-038](TASK-038-fix-picker-list-url.md) | Fix Picker API list URL — sessionId must be a query param, not a path segment | P1 | `[x]` | 2026-03-01-session-030 |
| [TASK-039](TASK-039-fix-heic-ffmpeg-windows.md) | Fix HEIC handling: replace ffmpeg with heic-decode, error reporting, default keep | P0 | `[x]` | 2026-03-05-session-033 |

### CI fixes (committed directly to `develop`)

| Fix | Description | Commit |
|---|---|---|
| `libsecret-1-dev` missing | Install system dep for keytar on Ubuntu 24.04 | `91f91fd` |
| Release Windows EOF | Transient network error downloading nsis-resources — re-run triggered | — |

---

## Phase 9 — Performance (v0.3.x)

> PERF-001 introduced `withConcurrency` (async semaphore in a single Worker thread).
> Effective for I/O-bound and native (sharp) work, but WASM (heic-decode) blocks the
> V8 event loop, so HEIC decodes are effectively sequential. See Phase 11 for true parallelism.

| ID | Title | Priority | Status | Session |
|---|---|---|---|---|
| [PERF-001](PERF-001-concurrent-processing.md) | Concurrent processing — parallelize indexer, planner, executor (N workers = `os.cpus().length`) | P3 | `[x]` | 2026-03-05-session-034 |

---

## Phase 10 — Bug fixes & UX improvements (v0.2.3)

> Bugs and UX issues found during manual testing of v0.2.2 (2026-03-07).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-041](TASK-041-fix-progress-phase1.md) | Fix missing progress during Phase 1 — UI stuck on "Starting..." (indexer, planner, executor) | P0 | `[x]` | 2026-03-07-session-036 |
| [TASK-042](TASK-042-fix-picker-heic-jpeg.md) | Fix Google Picker HEIC files served as JPEG — detect magic bytes, rename extension | P0 | `[x]` | 2026-03-07-session-036 |
| [TASK-043](TASK-043-elapsed-time-reports.md) | Display elapsed time in operation reports (re-index, analysis, import) | P3 | `[x]` | 2026-03-07-session-037 |
| [TASK-044](TASK-044-heic-settings-ui.md) | Add HEIC keep/convert option to settings UI | P3 | `[x]` | 2026-03-07-session-037 |

---

## Phase 11 — HEIC Decoding Performance (v0.3.x)

> Manual testing (session 038) confirmed HEIC WASM decoding as the main bottleneck:
> ~400-500ms/HEIC file vs ~14ms/JPEG (30-40x slower). `withConcurrency` (PERF-001)
> provides no benefit because WASM blocks the V8 event loop.
>
> **POC-001 completed** (session 038): benchmarked 5 strategies on 10 iPhone 12MP HEIC files.
> **Recommended**: `libheif-node-dy` (libheif N-API addon) with `worker_threads`:
> - Sequential: 282ms/file (1.6x faster than WASM)
> - Parallel N=8: 370ms total for 10 files = **12.6x faster** than WASM baseline (4662ms)
> - Full report: `~/heic-decode-poc/REPORT.md`, integration spec: `~/heic-decode-poc/docs/integration-strategy.md`
>
> TASK-046-perf plan: create `@keepic/heif-decode` addon (N-API, prebuild per platform), replace `heic-decode` in KeePic.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| POC-001 | HEIC decoding benchmark PoC — compare WASM vs native strategies | P1 | `[x]` | 2026-03-07-session-038 |
| [TASK-046-perf](TASK-046-perf-native-heic-decode.md) | Native HEIC decoding via libheif-node-dy (N-API addon + HeicDecodePool worker_threads) — 12.6x faster than WASM | P2 | `[x]` | 2026-03-07-session-044 |
| [TASK-050-feat](TASK-050-feat-static-libheif-addon.md) | Package libheif as static-linked N-API addon for Electron release builds (Windows + macOS) | P2 | `[x]` | 2026-03-07-session-045 |
| PERF-003 | Concurrent Google Picker downloads — apply withConcurrency to HTTP fetches (I/O-bound) | P3 | `[x]` | 2026-03-07-session-040 |

---

## Phase 12 — UX improvements (v0.3.x)

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| TASK-045 | Display elapsed time during Google Picker download | P3 | `[x]` | 2026-03-07-session-040 |

---

## Backlog — Refactoring / Features

| ID | Title | Type | Priority |
|---|---|---|---|
| [REFACTOR-001](REFACTOR-001-heic-phash-simplification.md) | Simplify HEIC pHash workflow — superseded by TASK-037 | Refactor | `[x]` |
| TASK-040 | Native C addon (libheif) for faster HEIC decode — superseded by POC-001 | Performance | `[-]` |

---

## Phase 13 — Duplicate Viewer (FEAT-001)

> Visual duplicate comparison with thumbnail previews and "Reveal in Folder" button.
> Custom Electron protocol (`keepic-photo://`) for serving images to the sandboxed renderer.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| FEAT-001a | Thumbnail protocol + shell IPC (backend: `thumbnail.ts`, `protocol.ts`, `shell-handlers.ts`) | P2 | `[x]` | 2026-03-07-session-039 |
| FEAT-001b | Thumbnail UI components + screen updates (frontend: `PhotoThumbnail.svelte`, ReviewScreen, DeduplicationScreen) | P2 | `[x]` | 2026-03-07-session-039 |

---

## Phase 14 — Video Support (FEAT-002)

> Add video file support to KeePic: index videos in the library, import from local folder
> and Google Picker, detect and skip Live Photo video companions (.MP4/.MOV paired with .HEIC/.JPG).
>
> Supported video formats: `.mp4`, `.mov`, `.avi`, `.mts`, `.3gp`, `.m4v`, `.mpg`
> Ignored formats: `.thm`, `.flv`, `.mpo`, `.dng`, `.gif`, `.psd`, and all non-media files.
>
> Video deduplication uses filename + file size (no pHash for videos).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| TASK-V01 | DB migration (`media_type` column) + shared media type helpers + extend extension sets | P1 | `[x]` | 2026-03-07-session-041 |
| TASK-V02 | Live Photo detection: extend to `.MP4` companions (not just `.MOV`), check `.JPG/.JPEG` siblings | P1 | `[x]` | 2026-03-07-session-041 |
| TASK-V03 | Video-aware import pipeline: skip pHash for videos, filename+size dedup | P1 | `[x]` | 2026-03-07-session-041 |
| TASK-V04 | Video-aware indexer + dedup scan + stats + video thumbnail placeholder | P1 | `[x]` | 2026-03-07-session-041 |

---

## Phase 15 — Import/Scan Transparency (FEAT-003)

> Report skipped and unrecognized files during import and library scan so the user
> knows exactly what KeePic ignored and why. Covers Live Photo companions, unsupported
> formats, and any other non-imported files.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| FEAT-003a | Backend: collect skipped/ignored file lists during import scan and library indexer (Live Photo videos, unrecognized extensions) and include them in results | P2 | `[x]` | 2026-03-07-session-042 |
| FEAT-003b | Frontend: display skipped/ignored files in import report and re-index report (collapsible sections by category) | P2 | `[x]` | 2026-03-07-session-042 |

---

## Phase 16 — v0.3.x Bug Fixes & Improvements

> Bugs and improvements found during manual testing of v0.3.0 (2026-03-07).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| TASK-047-fix | Fix `plan.skippedFiles is not iterable` — skippedFiles not propagated through UI flow (PlanningScreen -> App -> ExecutionScreen) | P0 | `[x]` | 2026-03-07-session-043 |
| [TASK-048-feat](TASK-048-feat-live-photo-reindex.md) | Detect and exclude Live Photo video companions during library re-index (consistent with import behavior) | P3 | `[x]` | 2026-03-08-session-050 |
| [TASK-049-fix](TASK-049-fix-temp-dir-cleanup.md) | Cleanup stale temp directories on app startup (`temp/import-*`, `picker-staging/*` in userData) | P3 | `[x]` | 2026-03-08-session-049 |

---

## Phase 17 — v0.3.x Release Fixes & Improvements

> Bugs and improvements found during manual testing of v0.3.1/v0.3.2 (2026-03-07).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-051-fix](TASK-051-fix-libheif-upgrade.md) | Upgrade libheif 1.17.6 → 1.21.2 — fix "Too many auxiliary image references" on Apple HDR HEIC files | P1 | `[x]` | 2026-03-08-session-048 |
| [TASK-052-fix](TASK-052-fix-picker-staging-cleanup.md) | Fix EPERM on picker-staging cleanup (Windows file lock on `unlink`) | P2 | `[x]` | 2026-03-08-session-049 |
| [TASK-053-feat](TASK-053-feat-photo-video-stats.md) | Differentiate photos vs videos in stats and reports (library stats, import history, scan/analysis/import reports) | P3 | `[x]` | 2026-03-08-session-049 |

---

## Phase 18 — v0.3.3 Bug Fixes & Improvements

> Bugs found during manual testing of v0.3.3 (2026-03-08).

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-054-fix](TASK-054-fix-picker-video-download.md) | Fix Google Picker video download — truncated files (`=d` instead of `=dv`) + wrong date (mtime fallback) | P0 | `[x]` | 2026-03-08-session-051 |
| [TASK-055-feat](TASK-055-feat-app-icon.md) | Add application icon (taskbar, shortcut, title bar) | P3 | `[x]` | 2026-03-08-session-051 |

---

## Phase 19 — macOS Compatibility (v0.3.5)

> First macOS user testing (issue #66). App blocked by Gatekeeper (unsigned),
> icon file was invalid ICNS.

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-056-fix](TASK-056-fix-macos-icon.md) | Fix macOS icon — `icon.icns` was a 16x16 PNG instead of proper ICNS bundle | P1 | `[x]` | 2026-03-08-session-052 |
| [TASK-057-fix](TASK-057-fix-sharp-macos-packaging.md) | Fix sharp native module loading on macOS — add `@img` packages to `asarUnpack` | P0 | `[x]` | 2026-03-08-session-052 |

---

## Phase 20 — Quality of Life Improvements

| # | Title | Priority | Status | Session |
|---|---|---|---|---|
| [TASK-058-feat](TASK-058-feat-purge-db-on-library-change.md) | Purge database (photos + import_jobs) when library path changes | P3 | `[x]` | 2026-03-08-session-052 |
| [TASK-059-feat](TASK-059-feat-tabbed-ui.md) | Refactor UI with tabbed navigation (Library / Import / Settings) | P2 | `[ ]` | — |
| [TASK-060-fix](TASK-060-fix-mov-live-photo-detection.md) | Fix MOV files incorrectly detected as Live Photo companions — only MP4 should match | P1 | `[x]` | 2026-03-08-session-053 |
| [TASK-061-fix](TASK-061-fix-heic-jpeg-magic-bytes.md) | Handle `.HEIC` files that are actually JPEG (magic bytes detection) — 4841 errors on real library | P0 | `[x]` | 2026-03-08-session-053 |

---

## Upcoming / Not Yet Planned

- In-app browse/viewer (deferred)
- Event folder creation UI
