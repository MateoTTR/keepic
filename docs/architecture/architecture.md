# KeePic — Architecture Overview

> **Status**: Draft v0.1 — 2026-02-21
> This document summarizes the high-level architecture of KeePic. It evolves as ADRs are decided.

---

## 1. System Context

KeePic is a **single-user desktop application** with no backend server. It runs entirely on the user's machine. The only external dependency is the Google Photos API, which is called exclusively when the user explicitly triggers an import.

```
┌─────────────────────────────────────────────────────────┐
│                     User's Machine                      │
│                                                         │
│   ┌─────────────────────────────────────────────────┐  │
│   │                  KeePic App                     │  │
│   │                                                 │  │
│   │  ┌──────────┐   ┌──────────┐   ┌────────────┐  │  │
│   │  │    UI    │──▶│  Core    │──▶│  Storage   │  │  │
│   │  │ (Web UI) │   │  Logic   │   │  (Local)   │  │  │
│   │  └──────────┘   └────┬─────┘   └────────────┘  │  │
│   │                      │                          │  │
│   └──────────────────────┼──────────────────────────┘  │
│                          │                              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│    SD Card /       Local Folders    Google Photos      │
│    Camera                           API (internet)     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Components

### 2.1 UI Layer
- Web-based interface rendered inside the desktop shell (Electron or Tauri — see ADR-001)
- Responsible for: photo grid, import wizard, settings, deduplication review
- Communicates with Core Logic via IPC (inter-process communication)
- UI framework: TBD (React, Vue, or Svelte)

### 2.2 Core Logic
- Runs in the main process (Electron) or backend process (Tauri/Rust)
- Responsibilities:
  - Import orchestration (sources → library)
  - EXIF reading and date extraction
  - Perceptual hash (pHash) computation for deduplication
  - Thumbnail generation and caching
  - Google Photos OAuth and API calls
  - File system operations

### 2.3 Storage Layer
- **Photo files**: organized on disk as `library/YYYY/MM/DD/filename.ext`
- **Metadata index**: SQLite database (see ADR-002)
  - Photo records (path, hash, date, source, dimensions...)
  - Album definitions and memberships
  - Import job history
- **Thumbnail cache**: separate folder, derivable from originals
- **Config**: JSON or similar, stored in OS app data directory

---

## 3. Key Data Flows

### 3.1 Import from Local / SD Card
```
User selects source folder
        │
        ▼
Scan source → list of image files
        │
        ▼
For each file:
  ├─ Read EXIF → extract date
  ├─ Compute pHash
  ├─ Check pHash against DB → duplicate?
  │     ├─ YES → flag for user review
  │     └─ NO  → copy to library/YYYY/MM/DD/
  └─ Insert record in SQLite DB
```

### 3.2 Import from Google Photos
```
User triggers Google Photos import
        │
        ▼
OAuth 2.0 → access token
        │
        ▼
Fetch media items (paginated, incremental)
        │
        ▼
For each item:
  ├─ Check if already imported (by Google ID) → skip if yes
  ├─ Download original file
  ├─ Compute pHash → deduplication check
  └─ Copy to library + insert in DB
```

### 3.3 Browse
```
User opens app
        │
        ▼
Query SQLite DB → list of photos (paginated, sorted by date)
        │
        ▼
Render thumbnails (from cache, or generate on demand)
        │
        ▼
User clicks photo → full-res from disk + metadata from DB
```

---

## 4. Architecture Decision Records

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-001](adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | Proposed | 2026-02-21 |
| [ADR-002](adr/ADR-002-local-storage-strategy.md) | Local storage strategy | Proposed | 2026-02-21 |
| [ADR-003](adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed | 2026-02-21 |

---

## 5. Open Architecture Questions

- UI framework (React / Vue / Svelte) — to be decided after ADR-001
- Thumbnail format and resolution (WebP? Multiple resolutions?)
- pHash library choice (native binding vs pure JS/Rust)
- Background worker strategy (worker threads vs separate process)
