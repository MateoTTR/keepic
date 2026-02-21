# KeePic — Specifications

> **Status**: Draft v0.2 — 2026-02-21
> **Changelog**:
> - v0.2 (2026-02-21): Cross-platform (Windows + macOS), Synology Drive compatibility, library folder = raw photos only, metadata in OS app data, iPhone Live Photo handling, HEIC conversion, Google Photos date filter, browse/view deferred to later phase.
> - v0.1 (2026-02-21): Initial draft.

---

## 1. Context & Goals

KeePic is a personal desktop application (Windows 10/11 and macOS) that allows a single user to:
- **Import** photos from multiple sources into a single organized local library
- **Deduplicate** photos automatically to avoid redundant storage
- **Organize** photos by date based on EXIF metadata
- **Convert** iPhone Live Photos to archival-friendly formats

The application has no backend server. Everything runs locally. The library folder contains only raw photo files and is compatible with folder-sync tools such as Synology Drive. The app itself (thumbnails, database, temp files) stores working data separately in the OS application data directory.

Browse and visualization features are **deferred** — users can use the OS file explorer and native photo viewers (Windows Photos, macOS Photos / Finder) to browse the organized library folder.

---

## 2. Functional Specifications

### 2.1 Library Folder

- The user configures the library folder once on first launch (stored in app config)
- The library folder contains **only raw photo files**, organized by date:
  ```
  ~/Pictures/KeePic/
  ├── 2023/
  │   └── 04/
  │       └── 15/
  │           └── IMG_1234.jpg
  └── 2024/
      └── ...
  ```
- **No thumbnails, no database, no temp files** are stored in the library folder
- The library folder is safe to sync with Synology Drive or any folder-sync tool
- The user can change the library folder location at any time (the app re-indexes the new location)

### 2.2 Photo Import

#### 2.2.1 Import from Google Photos
- The user authenticates with their Google account via OAuth 2.0
- The user specifies a **start date**: only photos taken on or after that date are imported
  - This handles the case where older photos are already organized locally
  - The date filter is applied to the `creationTime` field (date taken, not upload date)
- The user can also filter by album (optional)
- Photos are downloaded to a **temporary folder** during import, then moved to the library
- On re-import (incremental sync): only photos not yet imported are fetched (checked by Google Media ID stored in the DB)
- **Out of scope**: uploading to Google Photos, two-way sync

#### 2.2.2 Import from SD Card / Camera
- The user selects a folder or removable drive
- The app scans recursively for supported image formats
- The user previews the list of found photos before import
- Photos are **copied** (not moved) from the source to a temp folder, then processed and moved to the library
- The original source is never modified

#### 2.2.3 Import from Local Folders
- Same behavior as SD card import
- Useful for importing from Downloads, WhatsApp/Signal media folders, etc.

#### 2.2.4 Import from WhatsApp / Signal
> **Scope**: folder scan only — no API or app integration.
- The user points to the WhatsApp or Signal media export folder
- The app scans for image files and imports them via the local folder import flow
- These photos may lack EXIF data; the fallback date chain applies (see §2.3)

### 2.3 Date Extraction & Organization

Photos are organized by date of capture using the following priority chain:

| Priority | Source | Notes |
|---|---|---|
| 1 | EXIF `DateTimeOriginal` | Most reliable |
| 2 | EXIF `DateTime` (modification) | Fallback |
| 3 | Date extracted from filename | e.g. `IMG_20230415_120000.jpg`, `2023-04-15 12.00.00.jpg` |
| 4 | File modification date | Unreliable but usable |
| 5 | Import date | Last resort — user is warned |

The on-disk structure is: `<library_root>/YYYY/MM/DD/<filename>.<ext>`

### 2.4 iPhone Live Photos

An iPhone Live Photo consists of two files sharing the same base name:
- `IMG_1234.HEIC` — the still photo
- `IMG_1234.MOV` — the short video clip

**Default behavior**:
- The `.HEIC` file is imported and archived
- The `.MOV` file is **silently discarded** (not imported)
- The user is shown a summary at the end of import: "X Live Photo videos discarded"

**HEIC conversion (optional)**:
- Before archiving, the user can enable automatic conversion: HEIC → JPEG
- This is configured globally in settings (on/off, JPEG quality level)
- Conversion happens in the temp folder; only the converted JPEG is moved to the library
- Original HEIC is discarded after successful conversion
- Conversion is lossless in terms of EXIF metadata (metadata is copied to the JPEG)

**HEIC without conversion**:
- HEIC files are archived as-is
- On Windows, HEIC preview in File Explorer requires the HEIC codec (users are informed)

### 2.5 Deduplication

- Before archiving a photo, the app checks if an identical photo already exists in the library
- Detection is based on **perceptual hash (pHash)** of the image content — not filename
- If a duplicate is detected:
  - The user is shown the two photos side by side with their metadata
  - Options: skip (keep existing), replace (overwrite), keep both (import with renamed filename)
- A standalone deduplication scan can be triggered on the existing library at any time

### 2.6 Browse & Visualization

> **Status**: Deferred — not in scope for v1.

The library folder is organized in a human-readable `YYYY/MM/DD` structure. Users can:
- Browse photos using the OS file explorer (Windows Explorer, macOS Finder)
- View photos with the OS default photo viewer (Windows Photos, macOS Preview / Photos)
- Benefit from Synology Drive's web interface if the folder is synced

No in-app photo browser will be built in v1. This feature may be added in a future version.

---

## 3. Non-Functional Specifications

### 3.1 Platform

- **Primary targets**: Windows 10/11, macOS (Apple Silicon + Intel)
- Single distributable per platform (installer or portable app)
- **Self-contained**: no external runtime required by the user (Node.js, Python, etc.)

### 3.2 App Data Storage

All working data is stored in the **OS standard application data directory** — NOT in the library folder:

| OS | App data path |
|---|---|
| Windows | `%APPDATA%\KeePic\` |
| macOS | `~/Library/Application Support/KeePic/` |

This directory contains:
- `config.json` — app settings (library folder path, preferences)
- `index.db` — SQLite metadata index
- `thumbs/` — thumbnail cache (for future browse feature)
- `temp/` — temporary import staging area

### 3.3 Library Folder Sync Compatibility

- The library folder contains **only raw photo files** — no hidden metadata files, no database, no thumbnails
- Compatible with Synology Drive, Dropbox, OneDrive, or any folder-sync tool
- The `YYYY/MM/DD` structure is stable and deterministic (same photo always maps to the same path)
- If the library folder is modified externally (e.g., by Synology Drive sync), the app can re-index it

### 3.4 Performance

- Must handle libraries of up to **50,000 photos** without becoming sluggish
- Import jobs run in the background; the UI remains responsive
- HEIC conversion, pHash computation, and EXIF reading run in background workers
- Thumbnail generation (for future browse) is lazy and cached

### 3.5 Privacy & Security

- No telemetry, no analytics, no external network calls except Google Photos import (explicit user action)
- Google OAuth tokens stored in OS keychain (Windows Credential Manager, macOS Keychain)
- No photo data is transmitted outside the machine except for Google Photos import

### 3.6 Reliability & Non-Destructive Behavior

- All import operations stage files in a temp folder first; they are only moved to the library after successful processing
- Original source files are never modified or deleted
- If the app crashes during import, no partial files are left in the library (temp staging ensures atomicity)
- The SQLite index is a derived cache; it can be fully rebuilt by re-scanning the library folder
- All destructive actions (delete, replace on duplicate) require explicit user confirmation

### 3.7 Supported Formats

**Images (import + archive)**:
- JPEG / JPG
- HEIC / HEIF (with optional JPEG conversion)
- PNG
- TIFF
- RAW: CR2, NEF, ARW — read-only for EXIF/pHash; archived as-is without conversion

**Video**:
- `.MOV` from iPhone Live Photos: discarded by default (not archived)
- Other video formats: out of scope for v1

---

## 4. Out of Scope (v1)

- In-app photo browser / viewer
- Mobile application
- Multi-user support
- Upload to Google Photos or any external service
- Video management
- AI-based face recognition or scene detection
- RAW file conversion

---

## 5. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| Q1 | HEIC conversion quality: user-configurable JPEG quality, or fixed (e.g. 90%)? | User | Open |
| Q2 | Duplicates during import: review one by one, or batch review at the end? | User | Open |
| Q3 | Should the app offer to re-index if it detects the library was modified externally? | User | Open |
| Q4 | HEIC on Windows without conversion: show one-time warning with link to Microsoft HEIC codec? | User | Open |
| Q5 | Google Photos date filter: remember last import date automatically, or always ask? | User | Open |
