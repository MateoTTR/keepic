# TASK-024 — Fix OAuth callback server crash on second browser request

## Goal

After a successful Google OAuth redirect, Electron shows an uncaught exception dialog
(`TypeError: Cannot read properties of null (reading 'port')`). This crash dialog is
synchronous and blocks the Node.js event loop long enough to cause the subsequent token
exchange `fetch` to fail with "fetch failed", preventing authentication from completing.

---

## Root cause

In `src/main/google-auth.ts`, the HTTP request handler calls `server.address()` on the
first line to retrieve the listening port:

```typescript
// src/main/google-auth.ts:139
const serverPort = (server.address() as { port: number }).port
```

The first request (the actual OAuth callback) works correctly: `server.address()` returns
the port, the auth code is extracted, `server.close()` is called, and `resolveCallback`
is queued.

However, browsers systematically send a second request immediately after (typically
`/favicon.ico`). By this point `server.close()` has already been called, which sets the
internal handle to `null`. `server.address()` therefore returns `null`, and reading `.port`
on `null` throws an uncaught `TypeError` in the HTTP request handler callback.

**Cascading effect**: Electron surfaces uncaught main-process exceptions as a synchronous
modal dialog (`dialog.showErrorBox`). While this dialog is open, the Node.js event loop is
fully blocked. The `fetch` to `https://oauth2.googleapis.com/token` (which was started in
a pending microtask) cannot complete its I/O and fails with "fetch failed" once the event
loop resumes.

---

## Fix

Replace `server.address()` inside the request handler with `req.socket.localPort`, which
reads the local port directly from the incoming TCP socket. It is always available
regardless of the server's state, and never returns `null`.

```typescript
// Before (line 139)
const serverPort = (server.address() as { port: number }).port

// After
const serverPort = req.socket.localPort!
```

Single-line change. No behaviour change for the happy path. The second request
(`/favicon.ico` etc.) no longer throws, the server simply responds with 404 and closes
gracefully.

---

## Affected files

| File | Change |
|---|---|
| `src/main/google-auth.ts` | Line 139: `server.address()` → `req.socket.localPort!` |

---

## Tests

The existing test suite for `google-auth.ts` already covers the OAuth flow. Check that
all tests still pass. No new test needed (the fix is a one-liner with no new branching).

---

## Verification

```bash
npm run dev
# Click "Connect Google Photos" → authenticate in browser
# No crash dialog should appear
# UI should show "Connected as: user@gmail.com"
```

---

## Checklist

- [ ] `src/main/google-auth.ts` line 139 updated
- [ ] Tests pass (`npm test`)
- [ ] Manual test: Google OAuth completes without crash dialog
- [ ] Manual test: "Connected as:" shown correctly after auth
- [ ] PR opened targeting `develop`
