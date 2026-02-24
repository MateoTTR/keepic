# TASK-028 — Fix Google Photos scope verification at connect time

## Status
Complete

## Priority
P1

## Session
2026-02-24-session-020

---

## Problem

**Symptom**: after connecting to Google Photos and launching a download, the user receives
the error "Google Photos access was denied (insufficient scopes). Please disconnect and
reconnect…". Even after disconnecting and reconnecting, the error comes back.

**Root cause**: the OAuth token exchange response contains a `scope` field listing the
scopes *actually granted* by Google. If `photoslibrary.readonly` is absent (Google Cloud
Console consent screen misconfigured, or the user dismissed the Photos permission during
consent), the token is still stored in the keychain and the app incorrectly shows
"connected". The 403 only surfaces on the first API call, during download.

**Consequence**: the user believes that disconnect/reconnect will fix the problem, but
the same token without the scope is stored again.

---

## Goal

Verify the granted scopes **immediately after the token exchange**, before storing the
token. If `photoslibrary.readonly` is missing, throw a clear error *at connect time* —
not at download time.

---

## Deliverables

### 1. `src/main/google-auth.ts` — Verify scopes after token exchange in `startOAuthFlow`

Extend the `tokenData` type with `scope?: string` and verify using **full scope URL
matching** (not substring) to avoid false positives:

```typescript
const grantedScopes = (tokenData.scope ?? '').split(' ')
if (!grantedScopes.includes('https://www.googleapis.com/auth/photoslibrary.readonly')) {
  throw new Error(
    'Google Photos Library access was not granted. ' +
    'Please disconnect and reconnect, ensuring you approve the ' +
    '"Access your Google Photos Library" permission when prompted.'
  )
}
```

> **Why full URL instead of `includes('photoslibrary.readonly')`**: `String.includes()`
> does substring matching on the space-separated scope string. If Google ever added a
> scope like `photoslibrary.readonly.limited`, it would match incorrectly. Splitting on
> spaces and using array `includes()` with the full URL is exact.

### 2. `src/main/google-auth.ts` — Verify scopes on token refresh

In the token refresh function (`refreshAccessToken` or equivalent), add the same scope
check. Google can revoke individual scopes on a refresh token (user goes to Google Account
→ Security → Third-party apps → removes Photos access). If the refresh response has a
`scope` field and `photoslibrary.readonly` is absent:

- Delete the stored tokens from keychain
- Return an error that surfaces in the UI as "Google Photos access was revoked. Please
  reconnect your account."

This prevents the scenario where the initial connect succeeds but a later refresh silently
loses the Photos scope, causing the same 403 at download time.

### 3. Verify HTTP callback server cleanup on scope error

When `startOAuthFlow` throws after the token exchange (scope missing), ensure the local
HTTP callback server is properly closed and the browser is not left on a broken callback
page. Check that the existing `finally` block (or equivalent cleanup) covers this path.

### 4. Unit tests

New cases in the `startOAuthFlow` test suite:
- Successful token exchange **with** `photoslibrary.readonly` in `scope` → success (nominal, already tested — update to include `scope` in mock response)
- Successful token exchange **without** `photoslibrary.readonly` in `scope` → "not granted" error
- Successful token exchange **with no `scope` field** at all → "not granted" error
- Scope field with a similar but different scope (e.g. `photoslibrary.readonly.limited`) → "not granted" error

New cases in the token refresh test suite:
- Refresh response with valid scope → success
- Refresh response with missing `photoslibrary.readonly` → tokens deleted, error returned

### 5. 100% coverage maintained

---

## Implementation notes

- No code modified yet — implementation to be done.
- The error propagates through `handleConnect` → `{ error: string }` → the UI already displays it.
- No new IPC channel needed.
- If Google Cloud Console does not have `photoslibrary.readonly` configured on the consent
  screen, the error will persist even after the fix — that is a Google-side configuration
  issue, not a code bug. However, the error will now be detected at connect time with a
  clear message.
