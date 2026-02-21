# KeePic — Architecture Overview

> **Status**: Draft v0.2 — 2026-02-21
> **Changelog**:
> - v0.2: ADR-001 closed (Electron + TypeScript). App data separated from library folder. HEIC/Live Photo handling added. Browse feature deferred.
> - v0.1: Initial draft.

---

## 1. System Context

KeePic is a **single-user desktop application** (Electron, Windows + macOS) with no backend server. It runs entirely on the user's machine. The only external dependency is the Google Photos API, called exclusively when the user explicitly triggers an import.

The library folder (raw photos only) is kept clean and sync-safe. All app working data lives separately in the OS app data directory.

```
┌──────────────────────────────────────────────────────────────────┐
│                        User's Machine                            │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    KeePic (Electron)                     │  │
│   │                                                          │  │
│   │  ┌──────────────┐   ┌─────────────────┐                 │  │
│   │  │  Renderer    │   │   Main Process  │                 │  │
│   │  │  (Web UI /   │◄─►│   (Node.js /    │                 │  │
│   │  │   TypeScript)│   │   TypeScript)   │                 │  │
│   │  └──────────────┘   └────────┬────────┘                 │  │
│   │                              │                           │  │
│   │                    ┌─────────┼──────────┐               │  │
│   │                    ▼         ▼          ▼               │  │
│   │              Worker      Worker     Worker              │  │
│   │              (EXIF)     (pHash)   (HEIC conv.)         │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌─────────────────────┐   ┌──────────────────────────────┐   │
│   │   Library Folder    │   │     OS App Data Directory     │   │
│   │  (user-configured)  │   │  (%APPDATA%\KeePic\ or       │   │
│   │  ← Synology Drive   │   │  ~/Library/Applic. Support/) │   │
│   │                     │   │                              │   │
│   │  YYYY/MM/DD/        │   │  index.db  config.json       │   │
│   │  *.jpg *.heic ...   │   │  thumbs/   temp/             │   │
│   └─────────────────────┘   └──────────────────────────────┘   │
│                                                                  │
│         ┌──────────────────────────────────────┐               │
│         │           Import Sources             │               │
│         │  SD Card / Camera  Local Folders     │               │
│         │  WhatsApp folder                     │               │
│         └──────────────────────┬───────────────┘               │
└────────────────────────────────┼─────────────────────────────── ┘
                                 │ (internet, explicit user action)
                        Google Photos API
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

### 3.4 Storage
- **Library folder**: `YYYY/MM/DD/<filename>` — raw photos only, sync-safe
- **App data (OS standard dir)**:
  - `index.db`: SQLite — photo records, import history, album memberships
  - `config.json`: library folder path, user preferences (HEIC conversion on/off, JPEG quality)
  - `temp/`: import staging area — files are staged here before being moved to library
  - `thumbs/`: thumbnail cache (future use)

---

## 4. Key Data Flows

### 4.1 Import from Local Folder / SD Card

```
User selects source folder
        │
        ▼
Scan source → list of image files
        │
        ▼
Detect iPhone Live Photo pairs (HEIC + MOV same basename)
  → Keep HEIC, discard MOV (count discarded, report at end)
        │
        ▼
For each image file → Worker threads (parallel):
  ├─ EXIF worker: extract date (fallback chain)
  ├─ pHash worker: compute perceptual hash
        │
        ▼
Check pHash in DB → duplicate?
  ├─ YES → queue for user review (side-by-side diff)
  └─ NO  → continue
        │
        ▼
HEIC conversion worker (if enabled in settings):
  ├─ Convert HEIC → JPEG in temp/
  └─ Copy EXIF metadata to JPEG
        │
        ▼
Move file from temp/ to library/YYYY/MM/DD/filename
        │
        ▼
Insert record in SQLite DB
```

### 4.2 Import from Google Photos

```
User triggers Google Photos import
  → Enter start date (photos from this date onwards)
        │
        ▼
OAuth 2.0 → access token (from OS keychain or new auth)
        │
        ▼
Fetch media items from API:
  - Filter: creationTime >= start date
  - Paginated, incremental (skip google_id already in DB)
        │
        ▼
For each new item:
  ├─ Download to temp/
  ├─ Detect Live Photo MOV → discard
  ├─ pHash check → duplicate review if needed
  ├─ HEIC conversion if enabled
  └─ Move to library + insert in DB
        │
        ▼
Update last_sync_timestamp in import_jobs table
```

### 4.3 Re-index Library

```
User triggers re-index (or library folder changed)
        │
        ▼
Scan library folder recursively → list of image files
        │
        ▼
For each file:
  ├─ Check if path already in DB → skip if unchanged (mtime match)
  ├─ Otherwise: read EXIF, compute pHash → upsert in DB
        │
        ▼
Remove DB records for files no longer on disk
```

---

## 5. Architecture Decision Records

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-001](adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | **Accepted** | 2026-02-21 |
| [ADR-002](adr/ADR-002-local-storage-strategy.md) | Local storage strategy | **Accepted** | 2026-02-21 |
| [ADR-003](adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed | 2026-02-21 |

---

## 6. Open Architecture Questions

- UI framework: React vs Svelte (decided during TASK-003 scaffold)
- pHash library: `imghash` vs `blockhash` — benchmark needed
- HEIC conversion: use `sharp` directly or wrap in a dedicated service module?
- Temp folder cleanup strategy: clean on app start, on import completion, or both?
- Re-index trigger: automatic (file watcher on library folder) or manual only?
