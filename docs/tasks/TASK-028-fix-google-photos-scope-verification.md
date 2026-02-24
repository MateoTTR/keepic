# TASK-028 — Fix Google Photos scope verification at connect time

## Status
Pending

## Priority
P1

## Session
2026-02-24-session-019

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

1. **`src/main/google-auth.ts`** — in `startOAuthFlow`, extend the `tokenData` type
   with `scope?: string` and verify its presence after the token exchange:
   ```typescript
   if (!tokenData.scope?.includes('photoslibrary.readonly')) {
     throw new Error(
       'Google Photos Library access was not granted. ' +
       'Please disconnect and reconnect, ensuring you approve the ' +
       '"Access your Google Photos Library" permission when prompted.'
     )
   }
   ```
2. **Unit tests** — new cases in the `startOAuthFlow` test suite:
   - Successful token exchange **with** `photoslibrary.readonly` in `scope` → success (nominal case, already tested)
   - Successful token exchange **without** `photoslibrary.readonly` in `scope` → "not granted" error
   - Successful token exchange **with no `scope` field** at all → "not granted" error
3. **100% coverage** maintained

---

## Implementation notes

- No code modified yet — implementation to be done.
- The error propagates through `handleConnect` → `{ error: string }` → the UI already displays it.
- No new IPC channel needed.
- If Google Cloud Console does not have `photoslibrary.readonly` configured on the consent
  screen, the error will persist even after the fix — that is a Google-side configuration
  issue, not a code bug. However, the error will now be detected at connect time with a
  clear message.
