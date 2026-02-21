# KeePic — Architecture Overview

> **Status**: Draft v0.3 — 2026-02-21
> **Changelog**:
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
| UI framework | TBD (React or Svelte) | Decided in TASK-003 |
| Image processing | `sharp` | HEIC read/write, JPEG conversion, thumbnails — cross-platform |
| EXIF reading | `exifreader` | Pure JS, comprehensive EXIF support |
| Perceptual hashing | `imghash` or `blockhash` | Duplicate detection |
| SQLite | `better-sqlite3` | Synchronous, fast, Node.js main process |
| OAuth / keychain | `keytar` | OS keychain on Windows + macOS |
| Background workers | Node.js `worker_threads` | CPU-intensive tasks off the main thread |
| Packaging | `electron-builder` | NSIS installer (Windows), DMG (macOS) |
| Test framework | Jest or Vitest (TBD in TASK-003) | 100% coverage on non-frontend code |
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
- **HEIC conversion worker**: converts HEIC → JPEG using `sharp`, preserves EXIF
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
HEIC conversion worker (if enabled in settings):
  ├─ Convert HEIC → JPEG in temp/
  └─ Copy EXIF metadata to JPEG
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

### 4.3 Import from Google Photos

```
User opens Google Photos import
        │
        ▼
App pre-fills start date = day after last successfully imported photo
  (from import_jobs table; empty on first import)
  User can adjust the date before confirming
        │
        ▼
OAuth 2.0 → access token (from OS keychain, or new browser auth flow)
        │
        ▼
Fetch media items: creationTime >= start date, paginated
  → Skip items whose google_id is already in index.db
        │
        ▼
For each new item:
  ├─ Download to temp/
  ├─ Detect Live Photo MOV → discard
  ├─ pHash check + HEIC conversion (same pipeline as local import)
  └─ Move to library_root/YYYY/YYYY.MM/ + upsert in index.db
        │
        ▼
Record import job in import_jobs (last imported date, count)
```

---

## 5. Architecture Decision Records

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-001](adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | **Accepted** | 2026-02-21 |
| [ADR-002](adr/ADR-002-local-storage-strategy.md) | Local storage strategy | **Accepted** | 2026-02-21 |
| [ADR-003](adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed | 2026-02-21 |

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

- UI framework: React vs Svelte (TASK-003)
- Test framework: Jest vs Vitest (TASK-003)
- pHash library: `imghash` vs `blockhash` — benchmark needed
- Temp folder cleanup: on app start, after each import, or both?
- Re-index trigger: automatic on startup or manual only?
