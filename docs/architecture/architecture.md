# KeePic — Architecture Overview

> **Status**: Draft v0.4 — 2026-02-21
> **Changelog**:
> - v0.4: UI framework closed → Svelte 5 + Tailwind CSS + shadcn-svelte (ADR-004). Tech stack updated to reflect implemented choices (Vitest, custom DCT pHash). Open questions updated.
> - v0.3: Multi-user shared folder, append-only policy, per-instance local index, folder naming convention (YYYY/YYYY.MM/), event folders manual, year-based filtering. CI/CD + Git Flow added.
> - v0.2: ADR-001 closed (Electron + TypeScript). App data separated from library folder. HEIC/Live Photo handling added. Browse feature deferred.
> - v0.1: Initial draft.

---

## 1. System Context

KeePic is a **desktop application** (Electron, Windows + macOS) used by **multiple users** who share a common library folder synchronized via a Synology NAS (Synology Drive). Each user runs their own instance of KeePic with its own local index. There is no central server — the shared folder is the single source of truth for photo files.

The app is **append-only**: it never modifies or deletes files already in the shared folder.

```
┌────────────────────────────────────────────────────────────────────┐
│  User A's Machine                   User B's Machine              │
│  ┌───────────────────────┐          ┌───────────────────────┐     │
│  │  KeePic (Electron)    │          │  KeePic (Electron)    │     │
│  │  Main + Workers + UI  │          │  Main + Workers + UI  │     │
│  │  App Data:            │          │  App Data:            │     │
│  │  index.db config.json │          │  index.db config.json │     │
│  │  temp/        thumbs/ │          │  temp/        thumbs/ │     │
│  └───────────┬───────────┘          └───────────┬───────────┘     │
└──────────────┼───────────────────────────────────┼────────────────┘
               │                                   │
     ┌─────────▼───────────────────────▼──────────┐
     │           Shared Library Folder             │
     │    2025/2025.01/  2025/2025.04.15-19.../   │
     │    2026/2026.01/  ...                       │
     └──────────────────────┬──────────────────────┘
                            ↕ Synology Drive sync
                       Synology NAS
```

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Desktop framework | Electron (latest stable) | HEIC support via `sharp`, TypeScript full-stack (see ADR-001) |
| Build toolchain | `electron-vite` | Fast HMR, modern bundling |
| Language | TypeScript (main + renderer + workers) | Single language |
| UI framework | Svelte 5 + Tailwind CSS + shadcn-svelte | Zero runtime overhead, minimal boilerplate (see ADR-004) |
| Image processing | `sharp` + `heic-decode` | sharp for JPEG/PNG/TIFF; heic-decode (WASM libheif) for HEIC full-image decode (see [ADR-005](adr/ADR-005-heic-decoding-strategy.md)) |
| EXIF reading | `exifreader` | Pure JS, comprehensive EXIF support |
| Perceptual hashing | Custom DCT pHash (64-bit) | Implemented in `src/main/phash.ts` — no external dependency |
| SQLite | `better-sqlite3` | Synchronous, fast, Node.js main process |
| OAuth / keychain | `keytar` | OS keychain on Windows + macOS |
| Background workers | Node.js `worker_threads` | CPU-intensive tasks off the main thread |
| Packaging | `electron-builder` | NSIS installer (Windows), DMG (macOS) |
| Test framework | Vitest + `@vitest/coverage-v8` | 100% coverage on non-frontend code |
| CI/CD | GitHub Actions | Lint, test, coverage gate, release builds |

---

## 3. Components

### 3.1 Renderer Process (UI)
- Web-based interface in the Electron renderer
- Responsibilities: import wizard, settings screen, progress display, duplicate review
- Communicates with Main Process via IPC (contextBridge)
- In v1: no photo browser (users use OS file explorer)

### 3.2 Main Process
- Node.js/TypeScript, full filesystem access
- Responsibilities:
  - IPC handler: receives commands from renderer, returns results
  - Import orchestration: coordinates the import pipeline
  - File system operations: copy, move, organize into `YYYY/MM/DD`
  - Google Photos OAuth and API calls
  - SQLite access via `better-sqlite3`
  - Spawns worker threads for CPU-intensive work
  - OS keychain access via `keytar`

### 3.3 Worker Threads (background)
Separate threads spawned by the main process for CPU-intensive tasks:
- **EXIF worker**: reads EXIF from image files, applies fallback date chain
- **pHash worker**: computes perceptual hash for duplicate detection
- **HEIC conversion worker**: decodes HEIC via `heic-decode` (WASM), converts to JPEG via `sharp`
- **Index worker**: scans the shared library folder, upserts DB records

### 3.4 Storage

**Shared library folder** (raw photos only, sync-safe — never contains app data):
```
<library_root>/                          ← user-configured, synced by Synology Drive
├── 2025/                                ← year folder (only \d{4} folders are scanned)
│   ├── 2025.01/                         ← monthly folder (created by app on import)
│   ├── 2025.01.31-02.02.Center.Parcs/   ← event folder (created manually by users)
│   ├── 2025.04/
│   └── 2025.04.15-19.Londres/
└── 2026/
    └── 2026.01/
```

**Per-user app data** (OS standard directory, never synced):
```
Windows:  %APPDATA%\KeePic\
macOS:    ~/Library/Application Support/KeePic/
├── config.json    ← library path, user preferences
├── index.db       ← SQLite: photo hashes, metadata, import history
├── thumbs/        ← thumbnail cache (future use)
└── temp/          ← import staging area (cleaned after each import)
```

---

## 4. Key Data Flows

### 4.1 Library Index Build / Refresh

```
Trigger: app startup or user request
        │
        ▼
Index worker: walk all folders matching \d{4} at library root
  (all other root-level folders are ignored)
        │
        ▼
For each image file found:
  ├─ Path + mtime unchanged → skip (already indexed)
  └─ New or modified:
       ├─ Read EXIF → extract date
       ├─ Compute pHash
       └─ Upsert record in index.db
        │
        ▼
Mark DB records for files no longer on disk as deleted
```

### 4.2 Import from Local Folder / SD Card

```
User selects source folder
        │
        ▼
Scan source → list of image files
        │
        ▼
Detect iPhone Live Photo pairs (.HEIC + .MOV, same basename)
  → Mark MOV for discard; keep HEIC only
        │
        ▼
For each image → parallel worker threads:
  ├─ EXIF worker: extract capture date (fallback chain)
  └─ pHash worker: compute perceptual hash
        │
        ▼
Check pHash against index.db:
  ├─ Match found → queue for duplicate review (side-by-side UI)
  └─ No match → continue
        │
        ▼
HEIC handling (based on heic.mode setting):
  ├─ 'keep': copy HEIC as-is to library (default)
  └─ 'convert': heic-decode → sharp JPEG in temp/ (staged)
        │
        ▼
Destination: library_root/YYYY/YYYY.MM/filename
  → Create year + monthly folder if not present
  → Never overwrite existing file without explicit confirmation
        │
        ▼
Move file from temp/ to library; upsert in index.db
        │
        ▼
Import summary: N imported, M duplicates, K Live Photo videos discarded
```

### 4.3 Import from Google Photos (Picker API)

```
User clicks "Open Google Photos Picker"
        │
        ▼
OAuth 2.0 → access token (from OS keychain, or new browser auth flow)
  Scope: photospicker.mediaitems.readonly
        │
        ▼
Create Picker session → open Picker UI in default browser
  User selects photos → clicks "Done"
        │
        ▼
App polls session status every 3s (timeout 5min)
  Once confirmed → list all selected media items
        │
        ▼
Download selected items to temp/ (original quality, baseUrl=d)
  → Auto-refresh access token during long downloads
  → Individual errors recorded, do not abort batch
        │
        ▼
Hand off downloaded folder to local import pipeline:
  plan → deduplication review → execute → library write
```

---

## 5. Architecture Decision Records

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-001](adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | **Accepted** | 2026-02-21 |
| [ADR-002](adr/ADR-002-local-storage-strategy.md) | Local storage strategy | **Accepted** | 2026-02-21 |
| [ADR-003](adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed | 2026-02-21 |
| [ADR-004](adr/ADR-004-ui-framework.md) | UI framework: Svelte 5 + Tailwind CSS + shadcn-svelte | **Accepted** | 2026-02-21 |
| [ADR-005](adr/ADR-005-heic-decoding-strategy.md) | HEIC decoding strategy: heic-decode (WASM) | **Accepted** | 2026-03-05 |

---

## 6. Development Process

### Git Flow

| Branch | Purpose |
|---|---|
| `main` | Production-ready code only. Never commit directly. |
| `develop` | Integration branch. All features merge here first. |
| `feature/TASK-NNN-short-desc` | One branch per task, branched from `develop` |
| `release/vX.Y.Z` | Release preparation, branched from `develop` |
| `hotfix/short-desc` | Critical fixes from `main`, merged to `main` + `develop` |

### CI/CD (GitHub Actions)

- **On every PR and push to `develop` / `main`**: lint → TypeScript type-check → tests → coverage gate
- **Coverage gate**: 100% coverage on all non-frontend code (main process, workers, shared utilities)
- **On `main` tag**: `electron-builder` produces Windows (NSIS) + macOS (DMG) installers as GitHub Release assets

---

## 7. Open Architecture Questions

| Question | Status | Resolution |
|---|---|---|
| UI framework: React vs Svelte | **Closed** | Svelte 5 + Tailwind CSS + shadcn-svelte (ADR-004) |
| Test framework: Jest vs Vitest | **Closed** | Vitest + `@vitest/coverage-v8` |
| pHash: external library vs custom | **Closed** | Custom DCT 64-bit implementation (`src/main/phash.ts`) |
| Temp folder cleanup: on start vs after import | Open | — |
| Re-index trigger: automatic on startup or manual only? | Open | — |
