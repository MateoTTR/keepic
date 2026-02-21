# KeePic — Specifications

> **Status**: Draft v0.1 — 2026-02-21
> This document is a living specification. It will be updated as features are refined and new decisions are made.

---

## 1. Context & Goals

KeePic is a personal desktop application that allows a single user to:
- **Import** photos from multiple sources into a single local library
- **Deduplicate** photos automatically to avoid redundant storage
- **Organize** photos by date based on EXIF metadata
- **Browse** their photo library in a clear and fast interface

The application has no backend server and stores everything locally. It is designed for personal use (single user, single machine).

---

## 2. Functional Specifications

### 2.1 Photo Import

#### 2.1.1 Import from Google Photos
- The user can connect their Google account via OAuth 2.0
- The app fetches the list of albums and photos from the Google Photos API
- The user can choose to import:
  - All photos
  - A specific date range
  - One or more albums
- Photos are downloaded and stored locally in the KeePic library
- EXIF metadata is preserved; Google Photos metadata (description, album) is stored in the local database
- The user can re-trigger a sync at any time (incremental: only new photos since last sync)
- **Out of scope**: two-way sync, upload to Google Photos

#### 2.1.2 Import from SD Card / Camera
- The user selects a folder or removable drive as the import source
- The app scans the source recursively for supported image formats
- The user can preview the list of found photos before import
- Photos are copied (not moved) to the local library
- Duplicates are detected and flagged before copy (see §2.3)

#### 2.1.3 Import from Local Folders
- Same behavior as SD card import
- The user selects one or more folders on their filesystem
- Photos are copied into the KeePic library (original source is not modified)

#### 2.1.4 Import from WhatsApp / Signal
> **Status**: To be confirmed. Scope is limited to folder scanning — no API or application integration.
- The user points to the WhatsApp or Signal media export/storage folder
- The app scans for image files and imports them
- These photos may lack EXIF data; the app uses file creation date as a fallback

### 2.2 Photo Organization

#### 2.2.1 Automatic Date-Based Organization
- Photos are organized by date of capture (EXIF `DateTimeOriginal` field)
- Fallback priority if EXIF is missing:
  1. File modification date
  2. File creation date
  3. Date extracted from filename (e.g. `IMG_20230415_120000.jpg`)
  4. Import date (with a warning shown to the user)
- The folder structure on disk follows: `YYYY/MM/DD/filename.ext`
- Example: `library/2023/04/15/IMG_1234.jpg`

#### 2.2.2 Manual Albums
> **Status**: Planned for a later iteration.
- The user can create named albums and add photos to them
- Albums are logical groupings; they do not move files on disk
- A photo can belong to multiple albums

#### 2.2.3 Tagging / AI
> **Status**: Out of scope for v1. May be considered for a future version.

### 2.3 Deduplication

- Before importing a photo, the app checks if an identical photo already exists in the library
- Duplicate detection is based on a perceptual hash (pHash) of the image content — not filename
- If a duplicate is detected:
  - The user is shown a side-by-side comparison (existing vs incoming)
  - The user can: skip the duplicate, replace the existing, or import both
- Deduplication is also available as a standalone scan on the existing library

### 2.4 Photo Browsing

- The main view shows a chronological grid of photos (most recent first by default)
- The user can:
  - Filter by date range (year / month / day)
  - Search by filename or album name
  - View a single photo in full-screen
- Thumbnails are generated and cached on first display for performance
- Basic metadata is shown in a side panel (date, location if available, dimensions, file size, source)

### 2.5 Library Management

- The user can see storage statistics (total photos, total size, duplicates detected)
- The user can manually trigger a deduplication scan
- The user can export photos to a folder (copies, originals untouched)
- **Non-destructive**: the app never deletes or modifies original files without explicit confirmation

---

## 3. Non-Functional Specifications

### 3.1 Performance
- The app must remain responsive with libraries of up to **50,000 photos**
- Thumbnail generation should be done lazily (on demand) and cached
- Import jobs run in the background; the UI remains usable during import
- Indexing and pHash computation should be done in a background worker

### 3.2 Privacy & Security
- No telemetry, no analytics, no external calls except when the user explicitly triggers a Google Photos sync
- Google OAuth tokens are stored securely (OS keychain or equivalent)
- No photo data is ever transmitted outside the user's machine except for Google Photos import

### 3.3 Reliability
- Import operations are resumable: if interrupted, the next run picks up where it left off
- The local database is the source of truth for the library index; it can be rebuilt from the files on disk if corrupted
- The app must not corrupt or delete photos even in case of crash

### 3.4 Usability
- The app targets non-technical users; no configuration files to edit manually
- All destructive actions (delete, replace) require explicit confirmation
- Import progress is shown with a progress bar and estimated time remaining

### 3.5 Portability
- Primary target: **Windows 10/11**
- Secondary targets: macOS, Linux (not guaranteed for v1, to be confirmed)
- No internet connection required for any feature except Google Photos import

### 3.6 Supported Formats
- **Images**: JPEG, PNG, HEIC/HEIF, TIFF, RAW (CR2, NEF, ARW — best effort)
- **Videos**: Out of scope for v1

---

## 4. Out of Scope (v1)

- Mobile application
- Multi-user support
- Cloud backup or sync (other than import from Google Photos)
- Video management
- AI-based face recognition or scene detection
- Upload to any external service

---

## 5. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| Q1 | Confirm WhatsApp/Signal import scope | User | Open |
| Q2 | Target OS: Windows only or cross-platform for v1? | User | Open |
| Q3 | Should RAW formats be supported in v1 or deferred? | User | Open |
| Q4 | Manual album feature: v1 or later iteration? | User | Open |
| Q5 | Should the user be able to define where the library folder is stored? | User | Open |
