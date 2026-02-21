# ADR-003 — Google Photos API Integration

> **Status**: Proposed
> **Date**: 2026-02-21
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
- Incremental sync: use `pageToken` to resume, filter by `createdAfter` date

**Cons**:
- Google Photos Library API requires a Google Cloud project with OAuth credentials (the user or developer must set this up)
- The API has quotas (10,000 requests/day for free tier) — not a problem for personal use
- **Important limitation**: downloaded URLs are temporary (valid ~60 min); originals must be downloaded immediately
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

> **To be decided** — Proposed approach: **Option A (Official API + loopback OAuth)**

**Rationale**: Option A provides the best user experience with full automation. Option B is a fallback for users who prefer not to create a Google Cloud project. Option C is rejected.

**Implementation note**: The app may ship with a developer-provided OAuth client ID (client_id + client_secret in the app bundle), or require the user to provide their own. The latter is more private but significantly less user-friendly. This is a sub-decision to be made.

---

## OAuth Scope

Request the minimum required scope:

```
https://www.googleapis.com/auth/photoslibrary.readonly
```

This grants read-only access to the user's media items and albums. No write access is needed.

---

## Token Storage

- Access token and refresh token stored in the **OS keychain** (Windows Credential Manager, macOS Keychain, libsecret on Linux)
- Use a library like `keytar` (Node.js / Electron) or the Tauri equivalent
- Tokens are never stored in plain text on disk

---

## Incremental Sync Strategy

```
On each sync run:
  1. Load last_sync_timestamp from import_jobs table
  2. Fetch media items from Google Photos API, filtered by creationTime >= last_sync_timestamp
  3. For each new item:
     a. Check if google_id already exists in DB → skip if yes
     b. Download original file
     c. Compute pHash → deduplication check
     d. Store in library + insert DB record
  4. Update last_sync_timestamp = now()
```

---

## Consequences

### Positive
- Fully automated, incremental sync
- Secure token storage via OS keychain
- Minimal OAuth scope (read-only)

### Negative / Trade-offs
- Requires a Google Cloud project with OAuth credentials (developer burden or user burden)
- API quotas apply (not a concern for personal use at ~50k photos)
- Temporary download URLs require immediate download after listing

### Neutral
- A fallback "import from Takeout folder" feature would be a good complement for users migrating an existing library

---

## References

- [Google Photos Library API — Overview](https://developers.google.com/photos/library/guides/overview)
- [OAuth 2.0 for Desktop Apps — Google](https://developers.google.com/identity/protocols/oauth2/native-app)
- [keytar — OS keychain from Node.js](https://github.com/atom/node-keytar)
- [Google Photos Takeout format](https://support.google.com/accounts/answer/3024190)
