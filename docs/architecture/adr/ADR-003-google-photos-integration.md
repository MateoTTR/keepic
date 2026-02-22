# ADR-003 — Google Photos API Integration

> **Status**: Accepted
> **Date**: 2026-02-21
> **Decided**: 2026-02-22
> **Deciders**: Project owner

---

## Context

KeePic needs to import photos from Google Photos. This requires:
1. Authenticating the user with their Google account (OAuth 2.0)
2. Fetching the list of media items (paginated)
3. Downloading the original photo files

The integration must be secure (no credential leakage), transparent to the user, and resumable if interrupted.

There are two approaches to OAuth 2.0 from a desktop app: the **loopback redirect** approach (local HTTP server) and the **Out-of-Band (OOB)** approach (deprecated). Additionally, there is a question of whether to use the official Google Photos Library API or an alternative.

---

## Decision Drivers

- Security: OAuth tokens must not be accessible to malicious processes; stored securely
- User experience: the OAuth flow should be seamless (browser popup, auto-redirect)
- API stability: the integration should be based on officially supported APIs
- Incremental sync: re-running import should only fetch new photos, not re-download everything
- Privacy: minimize the OAuth scopes requested

---

## Considered Options

### Option A — Google Photos Library API (official) with loopback OAuth

**Description**: Use the official [Google Photos Library API](https://developers.google.com/photos/library/guides/overview). OAuth 2.0 with a loopback redirect URI (`http://127.0.0.1:<port>/callback`): the app opens a browser, the user authorizes, Google redirects to the local server, the app captures the auth code.

**Pros**:
- Official and supported API
- Loopback OAuth is the recommended approach for desktop apps (no OOB deprecation issues)
- Supports listing albums, paginated media items, downloading originals
- Incremental sync: filter by creation date, remember last download date

**Cons**:
- Google Photos Library API requires a Google Cloud project with OAuth credentials (the user or developer must set this up)
- The API has quotas (10,000 requests/day for free tier) — not a problem for personal use
- **Important limitation**: downloaded URLs are temporary (valid ~60 min); originals must be downloaded immediately after listing
- The API does not provide raw EXIF data — EXIF must be read from the downloaded file
- Google may change or restrict the API (happened in 2019 when write scopes were heavily restricted)

---

### Option B — Google Takeout (manual export)

**Description**: The user exports their Google Photos library via Google Takeout (a zip archive), then imports the folder into KeePic as a local folder import.

**Pros**:
- No OAuth integration required — greatly simplified implementation
- No API quotas
- The Takeout archive includes JSON metadata files with album, description, and date info
- One-time implementation effort

**Cons**:
- Not automated: the user must manually trigger a Takeout export (takes hours/days for large libraries)
- Not incremental: a new full export is needed for each sync
- Poor user experience for ongoing use

---

### Option C — google-photos-api unofficial wrapper / scraping

**Description**: Use an unofficial library that scrapes or uses undocumented Google Photos endpoints.

**Pros**:
- May bypass API restrictions

**Cons**:
- Unstable: could break at any time
- Against Google's Terms of Service
- Security risk

**Rejected immediately.**

---

## Decision

**Option A — Official Google Photos Library API with loopback OAuth 2.0 + PKCE.**

**Rationale**: Option A provides the best user experience with full automation. Option B is a
fallback for users who prefer not to create a Google Cloud project. Option C is rejected.

**Implementation note**: The app ships with a developer-provided OAuth client ID (client_id +
client_secret baked in at build time from environment variables). This is the standard pattern
for personal-use desktop apps and avoids requiring users to set up a Google Cloud project.

---

## Import Pipeline Architecture (decided in TASK-013)

The Google Photos import uses a **two-phase pipeline**, deliberately consistent with the existing
local import flow:

### Phase 1 — Download (new)

A dedicated worker thread (`google-photos-download.worker.ts`) handles:
1. Paginated listing via `mediaItems:search` (filter: `PHOTO` type only, date range)
2. Download of each original file to a local staging folder (`userData/temp/google-<ts>/`)
3. Token refresh if the access token expires mid-download
4. Records a `google_photos` import_job in the DB upon completion

**Why a dedicated download phase instead of streaming import:**
- The temporary URL constraint (~60 min) requires downloading immediately after listing — a
  two-pass approach (list all then download) is not viable.
- By downloading first and analysing later, we decouple the network-bound phase from the
  CPU-bound phase (pHash, EXIF, HEIC conversion).
- The staging folder is a plain folder of image files — it can feed directly into Phase 2.

### Phase 2 — Local import (existing, unchanged)

The downloaded staging folder is passed as `sourceFolder` to the existing local import pipeline:
plan → user review → execute. Zero new code required for this phase.

**Why reuse the local import pipeline instead of a custom Google Photos pipeline:**
- Photos already manually imported from Google Photos (before using KeePic, no `google_id` in DB)
  are correctly detected as duplicates via pHash during planning.
- The user reviews duplicates before any write to the library — consistent UX.
- Maintenance burden is minimised: a single import pipeline for all source types.

### google_id — not stored

The `photos.google_id` column exists in the schema but is **not populated** by this pipeline.
Deduplication relies exclusively on pHash (same as local import). Incremental sync is achieved
via the date filter (`last_imported_date` recorded in `import_jobs`), not by google_id lookup.

---

## OAuth Scope

Request the minimum required scope:

```
https://www.googleapis.com/auth/photoslibrary.readonly
```

This grants read-only access to the user's media items and albums. No write access is needed.

---

## Token Storage

- Access token and refresh token stored in the **OS keychain** (Windows Credential Manager,
  macOS Keychain, libsecret on Linux) via `keytar`.
- Tokens are never stored in plain text on disk.
- Token refresh: handled in the main process via `getValidAccessToken()` (`google-auth.ts`).
  The download worker receives a token snapshot at start and refreshes it independently via
  HTTP if the token expires during a long download. The updated token is sent back to the main
  process for keytar persistence on completion.

---

## Incremental Sync Strategy

```
On each Google Photos import:
  1. Query import_jobs WHERE source='google_photos' AND status='completed'
     → last_imported_date (= date of previous download completion; null on first import)
  2. Default start date = last_imported_date + 1 day (or today − 365 days on first import)
  3. User adjusts start date if needed
  4. Download all PHOTO items with creationTime >= start date
  5. Record new import_job with last_imported_date = today
  6. Run downloaded folder through local import pipeline
     → pHash deduplication catches any overlaps
```

This approach records "today's date" (download start time) as the next start boundary, not the
date of the last downloaded photo. This avoids one-day overlaps on subsequent imports.

---

## Consequences

### Positive
- Fully automated, incremental sync with user-adjustable date filter
- Secure token storage via OS keychain
- Minimal OAuth scope (read-only)
- Handles pre-existing manually imported Google Photos (pHash deduplication)
- Phase 2 reuses existing code — no maintenance overhead

### Negative / Trade-offs
- Requires a Google Cloud project with OAuth credentials (developer burden)
- API quotas apply (not a concern for personal use at ~50k photos)
- Downloaded staging folder can become orphaned if Phase 2 is cancelled (cleaned up on next reset)
- `google_id` not stored — re-import same date range will re-download files (caught as dups by pHash)

### Neutral
- A fallback "import from Takeout folder" feature would complement this for bulk migrations

---

## References

- [Google Photos Library API — Overview](https://developers.google.com/photos/library/guides/overview)
- [OAuth 2.0 for Desktop Apps — Google](https://developers.google.com/identity/protocols/oauth2/native-app)
- [keytar — OS keychain from Node.js](https://github.com/atom/node-keytar)
- [Google Photos Takeout format](https://support.google.com/accounts/answer/3024190)
