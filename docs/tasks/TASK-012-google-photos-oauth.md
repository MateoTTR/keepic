# TASK-012 — Google Photos OAuth 2.0 + Keychain Token Storage

> **Status**: Ready to implement
> **Session**: —
> **Branch**: `feature/TASK-012-google-photos-oauth`
> **Base branch**: `develop`
> **Dependencies**: TASK-011 (renderer infrastructure, Svelte screens, preload pattern)

---

## Goal

Implement the Google Photos authentication flow in KeePic:

1. **OAuth 2.0 flow** — open the browser, capture the callback via a local HTTP server, exchange the auth code for tokens (with PKCE)
2. **Keychain storage** — store/retrieve/delete tokens via `keytar` (already installed)
3. **IPC handlers** — `google:get-auth-status`, `google:connect`, `google:disconnect`
4. **Preload extension** — expose the `google` namespace to the renderer
5. **UI** — add a "Google Photos" section to `HomeScreen.svelte`

The actual media fetch and download (TASK-013) will call `getValidAccessToken()` exported from this module.

---

## Deliverables

| File | Action | Notes |
|---|---|---|
| `src/main/google-auth.ts` | new | OAuth flow, PKCE, keytar wrappers — injectable, fully tested |
| `src/main/ipc/google-auth-handlers.ts` | new | IPC handlers — injectable, fully tested |
| `tests/main/google-auth.test.ts` | new | Unit tests for OAuth + keytar logic |
| `tests/main/ipc/google-auth-handlers.test.ts` | new | Unit tests for IPC handlers |
| `src/shared/types/index.ts` | update | Add `GoogleAuthStatus` |
| `src/preload/index.ts` | update | Add `google` namespace |
| `src/preload/index.d.ts` | update | Add `google` types to `KeePickAPI` |
| `src/main/index.ts` | update | Register `google:*` IPC handlers |
| `src/renderer/src/screens/HomeScreen.svelte` | update | Add Google Photos section |
| `src/renderer/src/App.svelte` | update | Load + hold `googleAuthStatus` state |
| `.env.example` | new | Template for local credentials |
| `docs/tasks/TASK-012-google-photos-oauth.md` | update | Mark complete at end of session |

---

## Credentials Management

Google OAuth requires a **client_id** and **client_secret** obtained from a Google Cloud project (type: "Desktop application"). These identify the app, not the user.

**In development**: place in a `.env` file at the project root (already gitignored):

```
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

**In production**: inject at build time via environment variables.

**In `src/main/google-auth.ts`**: load via `import.meta.env`:

```typescript
const DEFAULT_CREDENTIALS: GoogleCredentials = {
  clientId: (import.meta.env['GOOGLE_CLIENT_ID'] as string) ?? '',
  clientSecret: (import.meta.env['GOOGLE_CLIENT_SECRET'] as string) ?? ''
}
```

If credentials are empty, `startOAuthFlow` returns `{ error: 'Google OAuth credentials not configured' }`.

**`.env.example`** (committed to repo — no real values):

```
# Google Photos OAuth credentials
# Create a project at https://console.cloud.google.com
# Enable: Google Photos Library API
# Create credentials: OAuth 2.0 Client ID > Desktop application
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Google Cloud Setup (for the developer — one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g., "KeePic")
3. Enable the **Google Photos Library API**
4. Go to **APIs & Services > OAuth consent screen** → External → fill in app name, email; add scope `photoslibrary.readonly`
5. Go to **APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID** → type: **Desktop application**
6. Download or copy `client_id` and `client_secret` into `.env`
7. In the OAuth consent screen, add test users (up to 100 without Google review)

> **Note**: The loopback redirect URI (`http://127.0.0.1`) does not need to be explicitly registered for Desktop application type — Google allows any port automatically.

---

## OAuth 2.0 Flow (with PKCE)

```
Renderer                  Main process              Browser / Google
   │                           │                          │
   │──google:connect──▶        │                          │
   │                    generate PKCE + state             │
   │                    start HTTP server (port 0)        │
   │                           │──shell.openExternal──▶   │
   │                           │        (auth URL)        │
   │                           │                   user logs in
   │                           │◀── GET /callback?code=X&state=Y ──│
   │                           │ validate state                     │
   │                           │ send HTML response ("Close tab")   │
   │                           │ close HTTP server                  │
   │                           │──POST /token──▶         Google
   │                           │◀── { access_token, refresh_token }─│
   │                           │ extract email from id_token        │
   │                           │ store in keytar                    │
   │◀── { success, email } ────│                          │
```

### PKCE Parameters

```typescript
import { randomBytes, createHash } from 'crypto'

// code_verifier: 32 random bytes → base64url (43 chars)
const codeVerifier = randomBytes(32).toString('base64url')

// code_challenge: SHA-256 of verifier → base64url
const codeChallenge = createHash('sha256')
  .update(codeVerifier)
  .digest('base64url')

// state: 16 random bytes → hex (anti-CSRF)
const state = randomBytes(16).toString('hex')
```

### Auth URL

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id={clientId}
  &redirect_uri=http://127.0.0.1:{port}/callback
  &response_type=code
  &scope=openid%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotoslibrary.readonly
  &state={state}
  &code_challenge={codeChallenge}
  &code_challenge_method=S256
  &access_type=offline
  &prompt=consent
```

> `access_type=offline` + `prompt=consent` are required to obtain a `refresh_token`.

### Token Exchange (POST)

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

code={code}
&client_id={clientId}
&client_secret={clientSecret}
&redirect_uri=http://127.0.0.1:{port}/callback
&grant_type=authorization_code
&code_verifier={codeVerifier}
```

Response:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3599,
  "id_token": "...",
  "token_type": "Bearer"
}
```

### Email Extraction from `id_token`

The `id_token` is a JWT. The payload is the middle segment (base64url-decoded):

```typescript
function extractEmailFromIdToken(idToken: string): string {
  const payload = JSON.parse(
    Buffer.from(idToken.split('.')[1], 'base64url').toString('utf-8')
  ) as { email?: string }
  return payload.email ?? ''
}
```

### Token Refresh

Called automatically by `getValidAccessToken()` when the access token is within 5 minutes of expiry:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id={clientId}
&client_secret={clientSecret}
&refresh_token={refreshToken}
&grant_type=refresh_token
```

Response: `{ access_token, expires_in }` — update `accessToken` and `expiresAt` in keytar.

### HTTP Server (callback)

- Listen on `port 0` → OS assigns a free port → read with `server.address().port`
- Timeout: **5 minutes** — if no callback, close server and reject with `'OAuth timeout'`
- On receiving the callback:
  1. Parse query params: `code`, `state`, `error`
  2. If `error` param present → reject with the error message
  3. If `state` does not match → reject with `'Invalid state parameter'`
  4. Send HTML response: `<html><body><h2>Authentication successful — you can close this tab.</h2></body></html>`
  5. Close the server
  6. Resolve with `{ code }`

---

## Keytar Storage

```typescript
const KEYTAR_SERVICE = 'com.keepic.app'
const KEYTAR_ACCOUNT = 'google-tokens'

interface StoredTokens {
  accessToken: string
  refreshToken: string
  email: string
  expiresAt: number   // Unix timestamp in ms (Date.now() + expires_in * 1000)
}
```

Store: `keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(tokens))`
Retrieve: `JSON.parse(await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT) ?? 'null')`
Delete: `keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)`

---

## Public API — `src/main/google-auth.ts`

```typescript
export interface GoogleCredentials {
  clientId: string
  clientSecret: string
}

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  email: string
  expiresAt: number
}

// Injectable dependencies (all optional — defaults use real implementations)
export interface GoogleAuthDeps {
  credentials?: GoogleCredentials
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  openBrowser?: (url: string) => Promise<void>       // default: shell.openExternal
  keytarGet?: (service: string, account: string) => Promise<string | null>
  keytarSet?: (service: string, account: string, password: string) => Promise<void>
  keytarDelete?: (service: string, account: string) => Promise<boolean>
}

// Start the full OAuth 2.0 + PKCE flow. Opens browser, waits for callback.
// Returns { email } on success, throws on error.
export async function startOAuthFlow(
  deps?: GoogleAuthDeps
): Promise<{ email: string }>

// Returns current auth status (reads from keytar, no network call).
export async function getAuthStatus(
  deps?: GoogleAuthDeps
): Promise<{ authenticated: boolean; email?: string }>

// Removes stored tokens from keytar.
export async function disconnect(
  deps?: GoogleAuthDeps
): Promise<void>

// Returns a valid access token, refreshing it if needed.
// Returns null if not authenticated or refresh fails.
// Used by TASK-013.
export async function getValidAccessToken(
  deps?: GoogleAuthDeps
): Promise<string | null>
```

### Default implementations

```typescript
// default openBrowser
import { shell } from 'electron'
const defaultOpenBrowser = (url: string) => shell.openExternal(url)

// default keytar
import keytar from 'keytar'
const defaultKeytarGet = keytar.getPassword.bind(keytar)
const defaultKeytarSet = keytar.setPassword.bind(keytar)
const defaultKeytarDelete = keytar.deletePassword.bind(keytar)

// default fetch
const defaultFetch = globalThis.fetch
```

---

## IPC Handlers — `src/main/ipc/google-auth-handlers.ts`

Same injectable pattern as `import-handlers.ts`.

```typescript
export async function handleGetAuthStatus(
  deps?: GoogleAuthDeps
): Promise<GoogleAuthStatus>

export async function handleConnect(
  deps?: GoogleAuthDeps
): Promise<{ success: true; email: string } | { error: string }>

export async function handleDisconnect(
  deps?: GoogleAuthDeps
): Promise<{ success: true } | { error: string }>
```

---

## IPC Channels

| Channel | Direction | Payload (request) | Payload (response) |
|---|---|---|---|
| `google:get-auth-status` | renderer → main (invoke) | — | `GoogleAuthStatus` |
| `google:connect` | renderer → main (invoke) | — | `{ success: true; email: string } \| { error: string }` |
| `google:disconnect` | renderer → main (invoke) | — | `{ success: true } \| { error: string }` |

> `google:connect` is a blocking invoke — the renderer waits until the browser flow completes (or times out after 5 min).

---

## Shared Types — additions to `src/shared/types/index.ts`

```typescript
export interface GoogleAuthStatus {
  authenticated: boolean
  email?: string
}
```

---

## Preload Extensions

### `src/preload/index.ts` — add `google` namespace

```typescript
import type { GoogleAuthStatus } from '../shared/types'

// Inside keepicAPI:
google: {
  getAuthStatus: (): Promise<GoogleAuthStatus> =>
    ipcRenderer.invoke('google:get-auth-status'),

  connect: (): Promise<{ success: true; email: string } | { error: string }> =>
    ipcRenderer.invoke('google:connect'),

  disconnect: (): Promise<{ success: true } | { error: string }> =>
    ipcRenderer.invoke('google:disconnect')
}
```

### `src/preload/index.d.ts` — add to `KeePickAPI`

```typescript
import type { GoogleAuthStatus } from '../shared/types'

// Inside KeePickAPI:
google: {
  getAuthStatus: () => Promise<GoogleAuthStatus>
  connect: () => Promise<{ success: true; email: string } | { error: string }>
  disconnect: () => Promise<{ success: true } | { error: string }>
}
```

---

## Main Process Registration — `src/main/index.ts`

```typescript
import {
  handleGetAuthStatus,
  handleConnect,
  handleDisconnect
} from './ipc/google-auth-handlers'

// In app.whenReady():
ipcMain.handle('google:get-auth-status', () => handleGetAuthStatus())
ipcMain.handle('google:connect', () => handleConnect())
ipcMain.handle('google:disconnect', () => handleDisconnect())
```

---

## Renderer Changes

### `src/shared/types/index.ts`

Add `GoogleAuthStatus` (see above).

### `src/renderer/src/App.svelte`

Add Google auth status to shared state:

```typescript
import type { GoogleAuthStatus } from '../../shared/types'

let googleAuthStatus: GoogleAuthStatus | null = $state(null)

// In onMount, after loading config:
googleAuthStatus = await window.keepic.google.getAuthStatus()
```

Pass to `HomeScreen`:

```svelte
<HomeScreen
  {sourceFolder}
  {googleAuthStatus}
  onSourceFolder={handleSourceFolder}
  onAnalyse={handleAnalyse}
  onGoogleAuthChange={(status) => { googleAuthStatus = status }}
/>
```

### `src/renderer/src/screens/HomeScreen.svelte`

Add a "Google Photos" section below the local folder section:

```
┌─────────────────────────────────────────┐
│  KeePic                                 │
│  Import photos from a local folder      │
│                                         │
│  ── Local folder / SD card ──────────   │
│  [Select folder…]                       │
│  Selected: /Volumes/SD/DCIM             │
│  [Analyse →]                            │
│                                         │
│  ── Google Photos ────────────────────  │
│  (if not connected)                     │
│  [Connect Google Photos]                │
│                                         │
│  (if connected)                         │
│  Connected as: user@gmail.com           │
│  [Disconnect]                           │
│  [Import from Google Photos →]  ← disabled (TASK-013)
└─────────────────────────────────────────┘
```

**Props additions**:
```typescript
interface Props {
  // ... existing props ...
  googleAuthStatus: GoogleAuthStatus | null
  onGoogleAuthChange: (status: GoogleAuthStatus) => void
}
```

**Behaviour**:
- "Connect Google Photos" → calls `window.keepic.google.connect()` → on success, calls `onGoogleAuthChange({ authenticated: true, email })`; on error, shows inline error message
- "Disconnect" → calls `window.keepic.google.disconnect()` → calls `onGoogleAuthChange({ authenticated: false })`
- "Import from Google Photos →" → **disabled** (TASK-013); render as `disabled` Button with a tooltip or "(coming soon)" label
- While connecting: button shows "Connecting…" and is disabled

---

## Testing Strategy

### `tests/main/google-auth.test.ts`

All external boundaries are mocked via injectable deps:
- `fetch` → `vi.fn()` returning crafted JSON responses
- `openBrowser` → `vi.fn()` that captures the auth URL, extracts the port, and immediately makes an HTTP GET to the callback URL (simulating the browser redirect)
- `keytarGet/Set/Delete` → `vi.fn()` with in-memory store

**Key test cases**:

| Test | Description |
|---|---|
| `startOAuthFlow` › success | Mock openBrowser → simulate valid callback → mock token exchange → verify keytar.set called with correct data |
| `startOAuthFlow` › invalid state | Callback arrives with wrong `state` → throws `'Invalid state parameter'` |
| `startOAuthFlow` › OAuth error | Callback has `?error=access_denied` → throws with that error |
| `startOAuthFlow` › timeout | No callback after timeout → rejects with `'OAuth timeout'` |
| `startOAuthFlow` › missing credentials | Empty client_id → rejects with credentials error |
| `startOAuthFlow` › token exchange fails | fetch returns 4xx → throws |
| `getAuthStatus` › authenticated | keytar returns stored tokens → `{ authenticated: true, email }` |
| `getAuthStatus` › not authenticated | keytar returns null → `{ authenticated: false }` |
| `disconnect` | keytar.delete called with correct service/account |
| `getValidAccessToken` › valid token | Not expired → returns access token without refresh |
| `getValidAccessToken` › expired token | expiresAt in past → calls refresh endpoint → updates keytar → returns new token |
| `getValidAccessToken` › refresh fails | Refresh request returns 401 → returns null |
| `getValidAccessToken` › not authenticated | keytar returns null → returns null |
| `extractEmailFromIdToken` | Decodes JWT payload correctly |

### `tests/main/ipc/google-auth-handlers.test.ts`

Tests each handler with mocked `GoogleAuthDeps`:

| Test | Description |
|---|---|
| `handleGetAuthStatus` | Calls `getAuthStatus`, returns result |
| `handleConnect` › success | Calls `startOAuthFlow`, returns `{ success: true, email }` |
| `handleConnect` › error | `startOAuthFlow` throws → returns `{ error: message }` |
| `handleDisconnect` › success | Calls `disconnect`, returns `{ success: true }` |
| `handleDisconnect` › error | `disconnect` throws → returns `{ error: message }` |

**Coverage target**: 100% on both `google-auth.ts` and `google-auth-handlers.ts`.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| OAuth flow | PKCE + client_secret | Google requires client_secret for Desktop apps; PKCE adds security layer |
| Port | Dynamic (port 0) | No risk of port conflict |
| Timeout | 5 minutes | Generous for human interaction, still bounded |
| Credentials source | `import.meta.env` | Consistent with electron-vite; dev uses `.env` file |
| Token storage | keytar JSON blob | Single account per instance; simpler than multi-key storage |
| Token refresh | On `getValidAccessToken` call (lazy) | Avoids unnecessary refresh on startup |
| Refresh buffer | 5 min before expiry | Prevents race condition near expiry boundary |
| `prompt=consent` | Always | Ensures refresh_token is always returned |
| Renderer UI | Extend HomeScreen | No new screen needed; auth is a prerequisite, not a primary flow |
| "Import Google" button | Disabled | Placeholder for TASK-013; avoids dead-end UX |

---

## Out of Scope (TASK-012)

- Fetching media items from Google Photos API (→ TASK-013)
- Google Photos import UI / progress (→ TASK-013)
- Multiple Google accounts per instance
- Token revocation on Google's side (beyond local keytar deletion)

---

## Session Checklist

- [ ] `develop` is up to date before branching
- [ ] Branch: `git checkout -b feature/TASK-012-google-photos-oauth develop`
- [ ] Create `.env.example`
- [ ] Add `GoogleAuthStatus` to `src/shared/types/index.ts`
- [ ] Implement `src/main/google-auth.ts` (OAuth flow + keytar + injectable deps)
- [ ] Implement `src/main/ipc/google-auth-handlers.ts`
- [ ] Register handlers in `src/main/index.ts`
- [ ] Extend `src/preload/index.ts` with `google` namespace
- [ ] Extend `src/preload/index.d.ts` with `google` types
- [ ] Update `src/renderer/src/App.svelte` (googleAuthStatus state)
- [ ] Update `src/renderer/src/screens/HomeScreen.svelte` (Google Photos section)
- [ ] Write `tests/main/google-auth.test.ts` (100% coverage)
- [ ] Write `tests/main/ipc/google-auth-handlers.test.ts` (100% coverage)
- [ ] Verify `npm run lint` passes
- [ ] Verify `npm run typecheck` passes
- [ ] Verify `npm test` passes (206 existing + new tests)
- [ ] Verify `npm run test:coverage` shows 100%
- [ ] Open PR → `develop`
- [ ] Update backlog.md + write session report
