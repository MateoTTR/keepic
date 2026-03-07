# KeePic — Specifications

> **Status**: Draft v0.3 — 2026-02-21
> **Changelog**:
> - v0.3 (2026-02-21): Multi-user shared folder, append-only policy, per-instance local index, folder naming convention (YYYY/YYYY.MM/), event folders managed manually, year-based folder filtering.
> - v0.2 (2026-02-21): Cross-platform (Windows + macOS), Synology Drive compatibility, library folder = raw photos only, metadata in OS app data, iPhone Live Photo handling, HEIC conversion, Google Photos date filter, browse/view deferred to later phase.
> - v0.1 (2026-02-21): Initial draft.

---

## 1. Context & Goals

KeePic is a personal desktop application (Windows 10/11 and macOS) that allows **multiple users** to import and organize photos into a **shared local library folder**. The shared folder is synchronized across machines via a Synology NAS (using Synology Drive).

Each user runs their own instance of KeePic on their machine. The shared folder is the single source of truth for photo files. Each instance maintains its own local index (SQLite) built by scanning the shared folder.

The application is **append-only by default**: it never modifies, renames, or deletes files that already exist in the shared folder. It only adds new photos.

Browse and visualization features are **deferred** — users can use the OS file explorer and native photo viewers to browse the organized library.

---

## 2. Functional Specifications

### 2.1 Library Folder

- The user configures the shared library folder path once on first launch
- The library folder is organized according to a strict naming convention (see §2.2)
- The app **only considers folders whose name starts with a 4-digit year** (e.g. `2025`, `2026`); all other folders at the root level are ignored
- The library folder contains **only raw photo files** — no database, thumbnails, or temp files
- The library folder is safe to sync with Synology Drive (append-only writes, predictable structure)

### 2.2 Folder Naming Convention

The library uses a 2-level hierarchy inside each year folder:

```
<library_root>/
├── 2025/
│   ├── 2025.01/                          ← monthly folder
│   ├── 2025.01.31-02.02.Center.Parcs/    ← event folder (cross-month: Jan 31 – Feb 2)
│   ├── 2025.02/
│   ├── 2025.03/
│   ├── 2025.04/
│   ├── 2025.04.15-19.Londres/            ← event folder (same month: Apr 15–19)
│   ├── 2025.05/
│   ├── 2025.05.29-06.01.WE.Tarn/        ← event folder (cross-month: May 29 – Jun 1)
│   └── 2025.06/
└── 2026/
    ├── 2026.01/
    └── ...
```

**Year folder**: `YYYY`

**Monthly folder**: `YYYY.MM`
- One per calendar month
- Created by the app when importing photos for that month (if not yet present)

**Event folder**: `YYYY.MM.DD[-[MM.]DD].EventName[.words]`
- Created and named **manually by users** in V1
- Users move photos from monthly folders into event folders themselves
- The app does not create, rename, or modify event folders
- Event name words are separated by dots (spaces not used)

**Folder pattern examples**:
| Folder name | Type | Period |
|---|---|---|
| `2025` | Year | Full year |
| `2025.01` | Monthly | January 2025 |
| `2025.04.15-19.Londres` | Event | Apr 15–19, 2025 |
| `2025.01.31-02.02.Center.Parcs` | Event | Jan 31 – Feb 2, 2025 |
| `2025.05.29-06.01.WE.Tarn` | Event | May 29 – Jun 1, 2025 |

**Validation rule**: the app only reads and writes inside folders matching `\d{4}` at the root level of the library. All other root-level folders are ignored entirely.

### 2.3 Library Indexing

On startup (and on demand), each app instance **scans the shared library folder** to build or refresh its local index:

- Walk all year folders (`\d{4}`) at library root
- Walk all subfolders (monthly and event folders)
- For each image file found: compute pHash and read EXIF → upsert into local SQLite DB
- Files already indexed (path + mtime unchanged) are skipped for performance
- Files removed from the shared folder (e.g., by another user) are marked as deleted in the local index
- The local index is a **derived cache**: it can always be fully rebuilt from the shared folder

The scan runs in a background worker; the UI remains usable during indexing.

### 2.4 Photo Import

**Import destination**: new photos are always placed in the **monthly folder** corresponding to their capture date:
- Destination: `<library_root>/YYYY/YYYY.MM/<filename>`
- The year and monthly folders are created if they do not yet exist
- The app never moves or modifies photos already in the library

#### 2.4.1 Import Safety Checks

Before placing a photo in the library, the app verifies:

1. **Hash check**: the photo's pHash is compared against the local index. If a matching hash is found, the photo is considered a duplicate — the user is prompted (see §2.5)
2. **Destination safety**: the target path (`YYYY/YYYY.MM/filename`) is computed deterministically from the photo's capture date; no existing file is ever overwritten without confirmation

#### 2.4.2 Import from Google Photos

> **Implementation note**: KeePic uses the **Google Photos Picker API** (not the deprecated Library API). The `photoslibrary.readonly` scope was removed by Google on March 31, 2025. The Picker API (`photospicker.mediaitems.readonly`) is the only officially supported path for reading user photos in third-party apps.

**Authentication**:
- Each user independently authenticates with their own Google account via **OAuth 2.0 + PKCE** (loopback redirect)
- Tokens are stored in the OS keychain (Windows Credential Manager / macOS Keychain)
- The app verifies at connect time that the `photospicker.mediaitems.readonly` scope was granted

**Picker-based import flow**:
1. The user clicks "Open Google Photos Picker" — KeePic creates a Picker session and opens the Google Photos Picker UI in the default browser
2. The user browses their Google Photos library and selects photos (selection can be done by day)
3. The user clicks "Done" in the Picker UI — KeePic detects the confirmed selection by polling every 3 seconds (timeout: 5 minutes)
4. KeePic downloads the selected photos to `temp/` (OS app data staging folder)
5. The downloaded folder is handed off to the local import pipeline: plan → deduplication review → execute → library write

**Download details**:
- Photos are downloaded using `baseUrl=d` parameter (best available quality)
- **HEIC format limitation**: the Picker API converts HEIC files to JPEG server-side while preserving the original `.HEIC` filename. KeePic detects this by inspecting the file's magic bytes after download and renames `.HEIC` → `.jpg` when the content is actually JPEG. There is no API parameter to force the original HEIC format.
- Filename collisions in the staging folder are resolved with `_N` suffixes
- The access token is refreshed automatically during long downloads
- Individual file errors are recorded but do not abort the overall download

**Out of scope**: uploading to Google Photos, two-way sync, programmatic library access

#### 2.4.3 Import from SD Card / Camera
- The user selects a source folder or removable drive
- The app scans recursively for supported image formats
- The user reviews the list before confirming import
- Photos are **copied** (not moved) from source → temp → library

#### 2.4.4 Import from Local Folders
- Same behavior as SD card import
- Suitable for WhatsApp/Signal media folders, Downloads, etc.

#### 2.4.5 Import from WhatsApp / Signal
> Scope: folder scan only — no API or app integration.
- The user points to the media folder; the app imports via the local folder flow
- Photos without EXIF use the fallback date chain (see §2.6)

### 2.5 Deduplication

- Before placing any photo in the library, the app checks its pHash against the local index
- If a match is found, the user is shown a side-by-side comparison and can: skip, replace (with confirmation), or import both (renamed)
- A standalone deduplication scan can be triggered on the existing library at any time

### 2.6 Date Extraction

Photos are organized by date of capture using the following priority chain:

| Priority | Source | Notes |
|---|---|---|
| 1 | EXIF `DateTimeOriginal` | Most reliable |
| 2 | EXIF `DateTime` | Fallback |
| 3 | Date extracted from filename | e.g. `IMG_20230415_120000.jpg` |
| 4 | File modification date | Unreliable but usable |
| 5 | Import date | Last resort — user is warned |

### 2.7 iPhone Live Photos and HEIC Handling

An iPhone Live Photo consists of: `IMG_1234.HEIC` (still) + `IMG_1234.MOV` (video clip).

**Default behavior**:
- `.HEIC` is imported and archived in the monthly folder **as-is** (no conversion)
- `.MOV` is discarded (not imported); count shown in import summary

**HEIC mode** (configured in settings as `heic.mode`):

| Mode | Behaviour | Default |
|---|---|---|
| `'keep'` | Copy the original HEIC file into the library unchanged | **Yes** |
| `'convert'` | Convert to JPEG at full native resolution before storing | No |

**pHash computation**: regardless of mode, HEIC files are decoded in full resolution using
`heic-decode` (WebAssembly) to compute an accurate perceptual hash. This ensures cross-format
deduplication (HEIC vs JPEG) works correctly.

**HEIC conversion** (`mode = 'convert'`):
- HEIC → JPEG conversion via heic-decode + sharp in the staging folder
- Only the JPEG is moved to the library
- Full native resolution preserved (e.g. 3024x4032 for iPhone 12MP)

### 2.8 Event Folders (V1 — Manual)

In V1, event folders are created and populated entirely by users:
- Users manually create event folders inside a year folder (e.g., `2025/2025.04.15-19.Londres/`)
- Users manually move photos from a monthly folder into the event folder
- The app does **not** assist with event folder creation or photo assignment in V1
- The local index is refreshed after such changes (via re-index)

This feature may be enhanced in a future version (e.g., date-based auto-assignment, UI for creating events).

---

## 3. Non-Functional Specifications

### 3.1 Platform
- **Primary targets**: Windows 10/11, macOS (Apple Silicon + Intel)
- Self-contained: no external runtime required by the user
- One distributable per platform

### 3.2 Multi-User Safety
- The app is **append-only**: it never modifies or deletes files already in the shared library folder
- Multiple users can safely use the app against the same shared folder (via Synology Drive sync)
- Concurrent import sessions by different users are not coordinated — each user is responsible for syncing before importing
- Recommended workflow: sync → re-index → import

### 3.3 App Data Storage (per user instance)

All working data is stored in the **OS standard application data directory** — NOT in the shared library folder:

| OS | App data path |
|---|---|
| Windows | `%APPDATA%\KeePic\` |
| macOS | `~/Library/Application Support/KeePic/` |

Contents:
- `config.json` — library folder path, user preferences
- `index.db` — local SQLite index (hashes, metadata, import history)
- `thumbs/` — thumbnail cache (future use)
- `temp/` — import staging area (cleaned after each import)

### 3.4 Library Folder Compatibility
- Only raw photo files in the shared folder (no hidden files, no metadata sidecars)
- Compatible with Synology Drive, Dropbox, OneDrive, or any folder-sync tool
- Folder structure is stable and deterministic

### 3.5 Performance
- Must handle libraries of up to 50,000 photos
- Initial index build: background, non-blocking
- Incremental re-index: fast (skip unchanged files by path + mtime)
- Import pipeline runs in background workers

### 3.6 Privacy & Security
- No telemetry, no external calls except Google Photos import
- Google OAuth tokens stored in OS keychain
- No photo data transmitted outside the machine except for Google Photos import

### 3.7 Reliability & Non-Destructive Behavior
- Import staging in temp folder: files moved to library only after successful processing
- Original source files never modified
- Crash during import leaves no partial files in the library
- SQLite index fully rebuildable from the shared folder

### 3.8 Supported Formats

| Format | Support |
|---|---|
| JPEG / JPG | Full |
| HEIC / HEIF | Full (kept as-is by default; optional JPEG conversion via heic-decode + sharp) |
| PNG | Full |
| TIFF | Full |
| RAW (CR2, NEF, ARW) | EXIF + pHash only; archived as-is |
| MOV (Live Photo) | Discarded by default |
| Other video | Out of scope |

---

## 4. Out of Scope (v1)

- In-app photo browser / viewer
- Event folder creation or management by the app
- Mobile application
- Multi-user coordination / conflict detection
- Upload to Google Photos or any external service
- Video management
- AI-based face recognition or scene detection
- RAW file conversion

---

## 5. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| Q1 | HEIC conversion: user-configurable JPEG quality, or fixed? | — | **Closed** — configurable via `heic.jpegQuality` (default 90) |
| Q2 | Duplicates during import: review one by one, or batch review at end? | User | Open |
| Q3 | HEIC on Windows without conversion: show one-time warning + codec link? | User | Open |
| Q4 | Google Photos date filter: **Closed** — app pre-fills with last imported date; user can adjust | — | Closed |
| Q5 | Re-index: triggered manually only, or also on app startup? | User | Open |
| Q6 | If two users import the same photo independently: detected on next re-index + reported? | User | Open |
