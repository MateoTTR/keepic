# TASK-027 — Fix Google Photos 403 "insufficient authentication scopes"

## Goal

After authenticating with Google and launching a download, the app returns:

```
Google Photos API error: 403 {
  "error": {
    "code": 403,
    "message": "Request had insufficient authentication scopes.",
    "status": "PERMISSION_DENIED"
  }
}
```

No photos are downloaded.

---

## Root cause

The OAuth scope `https://www.googleapis.com/auth/photoslibrary.readonly` is correctly
declared in `google-auth.ts`:

```typescript
const GOOGLE_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/photoslibrary.readonly'
].join(' ')
```

However, the stored token (in keychain) was issued **before** this scope was properly
configured in the Google Cloud Console OAuth consent screen. Google only embeds the
approved scopes into the access token at authorisation time — a previously issued token
will not have the scope even if it is added later to the consent screen.

Two possible root causes (not mutually exclusive):

1. **Configuration**: `photoslibrary.readonly` was not listed under "Scopes" in the
   OAuth consent screen at the time the user first authenticated → token was issued
   without it.
2. **Stale token**: The stored access/refresh token predates the scope being added.
   Even a token refresh will not add new scopes — a full re-authorisation is required.

---

## Fix

### Immediate (user action)

1. In KeePic, open Settings → Google Photos → **Disconnect**
2. Click **Connect** to re-authorise → Google issues a new token that includes
   `photoslibrary.readonly`
3. Verify the scope is listed in the Google Cloud Console OAuth consent screen
   (APIs & Services → OAuth consent screen → Scopes)

### Code fix — better error message on 403

Currently the raw API error is surfaced to the user. Improve the error handling in the
Google Photos downloader to detect a 403 `PERMISSION_DENIED` response and display a
user-friendly message:

> "Google Photos access was denied. Please disconnect your account and reconnect to
> grant the required permissions."

This guides the user to the correct resolution without requiring them to understand
OAuth scopes.

---

## Affected files

| File | Change |
|---|---|
| `src/main/google-photos-downloader.ts` | Detect 403 `PERMISSION_DENIED` on `mediaItems:search` call; throw a descriptive error message instead of the raw API response |
| `src/renderer/src/screens/GoogleDownloadScreen.svelte` | (Optional) display the improved error message with a "Disconnect & Reconnect" shortcut button |

---

## Tests

- Unit test: `fetchPage` receives a 403 response → throws with the user-friendly message
- Existing tests must continue to pass at 100% coverage

---

## Checklist

- [ ] User disconnects and reconnects Google account → download succeeds
- [ ] Verify `photoslibrary.readonly` scope is enabled in Google Cloud Console
- [ ] 403 error surfaces a human-readable message in the UI
- [ ] Unit test for 403 handling added
- [ ] PR opened targeting `develop`
