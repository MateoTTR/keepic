# TASK-030 — Fix structured clone error on import execution

## Priority

P0 — Import is completely broken (0 files copied).

## Problem

`ExecutionScreen.svelte` passes the `plan` prop (a Svelte 5 reactive Proxy) directly to `window.keepic.import.execute(plan)`. Electron's IPC uses the Structured Clone algorithm, which cannot serialize Proxy objects. This causes:

```
Uncaught (in promise) Error: An object could not be cloned.
```

The `.catch()` handler converts this to `{ error: "An object could not be cloned." }` and calls `onComplete` with `status: 'failed'`, but the user sees 0 files copied.

## Root Cause

Svelte 5 `$props()` wraps incoming props in deep reactive Proxies. These Proxies are not compatible with the Structured Clone algorithm used by `ipcRenderer.invoke`.

## Fix

1. **ExecutionScreen.svelte** — Wrap `plan` with `$state.snapshot(plan)` before passing to IPC. This unwraps the Proxy into a plain object.

2. **google-photos-downloader.ts** — Forward Google's actual error message in the 403 handler instead of a hardcoded string, to aid future debugging.

## Deliverables

1. `$state.snapshot(plan)` in `ExecutionScreen.svelte` line 27
2. Improved 403 error message in `google-photos-downloader.ts`
3. Updated test for the improved error message
