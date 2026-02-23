# TASK-026 — Fix import execution race condition and cancel no-op

## Goal

Two related bugs found during manual testing (session 018):

- **BUG-026**: After clicking "Import" on the review screen, the UI freezes on
  "Importing…" / "Starting…". The progress bar never moves and no files are copied
  to the library.
- **BUG-027**: Clicking "Cancel" on the execution screen freezes the UI on
  "Cancelling…". The only way out is to restart the application.

---

## Root causes

### BUG-026 — Race condition between `execute()` and `ExecutionScreen` listeners

In `App.svelte`, `handleImport()` calls `execute()` **synchronously**, before Svelte
has had a chance to mount `ExecutionScreen` and run its `onMount`:

```typescript
// App.svelte
function handleImport(modifiedPlan: ImportPlanEntry[]): void {
  plan = modifiedPlan
  currentScreen = 'executing'                                    // schedules DOM update (microtask)
  window.keepic.import.execute({ entries: plan, ... })           // IPC fired immediately
}
```

```typescript
// ExecutionScreen.svelte
onMount(() => {
  window.keepic.import.onProgress(...)    // listener registered AFTER execute() was called
  window.keepic.import.onComplete(...)
})
```

If the worker fails immediately (e.g. a crash on startup, DB error, path issue), the
`import:complete` event is fired before the renderer's `onComplete` listener is
registered → the event is **silently dropped** → the UI freezes forever.

Secondary issue: `onProgress` / `onComplete` use `ipcRenderer.on()` which accumulates
listeners across mounts (never cleaned up via `onDestroy`).

### BUG-027 — `handleCancel` is a no-op when no worker is running

`handleCancel` in `import-handlers.ts` does:
```typescript
activeWorkerRef.value?.postMessage({ type: 'cancel' })
```

If the worker never started (or already crashed — BUG-026 scenario), `activeWorkerRef.value`
is `null` → `postMessage` is never called → no `import:complete` event is ever sent
→ `cancelling` stays `true` → UI frozen on "Cancelling…".

Same issue in `handleCancelDownload` for the Google Photos pipeline.

---

## Fix

### 1. Move `execute()` call into `ExecutionScreen.svelte`

Pass `ImportPlan` as a prop to `ExecutionScreen`. In `onMount`, register `onProgress`
and `onComplete` listeners **first**, then call `execute(plan)`. This guarantees the
listeners are always in place before any worker response can arrive.

Remove the `execute()` call from `App.svelte`'s `handleImport()`.

Add `onDestroy` in `ExecutionScreen` to remove the IPC listeners (prevents accumulation
on repeated imports within the same app session).

### 2. Make `handleCancel` robust when no worker is running

If `activeWorkerRef.value` is `null` when cancel is called, the main process must still
trigger a terminal state in the renderer. Two options — go with the simpler one:

**Option A** (chosen): return `{ noWorker: true }` from `handleCancel`. The preload
relays this flag; `ExecutionScreen` detects it and calls `onComplete` directly with a
synthetic cancelled result → the app navigates to the result screen.

**Option B**: fire `import:complete` from the main process even when no worker exists.
More complex — avoids adding a return value to `handleCancel` but requires `event.sender`
to be passed down to `handleCancel`.

Apply the same fix to `handleCancelDownload`.

---

## Affected files

| File | Change |
|---|---|
| `src/renderer/src/App.svelte` | Remove `execute()` call from `handleImport`; pass `plan` + `livePhotosDiscarded` + `sourceFolder` as props to `ExecutionScreen` |
| `src/renderer/src/screens/ExecutionScreen.svelte` | Accept `ImportPlan` prop; move `execute()` call into `onMount` after listener registration; add `onDestroy` cleanup |
| `src/main/ipc/import-handlers.ts` | `handleCancel`: return `{ cancelled: true } \| { noWorker: true }` instead of `void` |
| `src/preload/index.ts` | Update `cancel()` return type; relay `noWorker` flag to renderer |
| `src/shared/types/index.ts` | Update type if needed |

Same pattern for Google Photos cancel:

| File | Change |
|---|---|
| `src/main/ipc/google-photos-handlers.ts` | `handleCancelDownload`: same robustness fix |

---

## IPC channels

No new channels. Changes are to existing `import:execute`, `import:cancel`, and
`import:complete` semantics only.

---

## Tests

- `handleCancel` with `activeWorkerRef.value = null` → returns `{ noWorker: true }`
- `handleCancel` with a live worker → sends `cancel` message, returns `{ cancelled: true }`
- `handleCancelDownload` same two cases
- Renderer-side changes (ExecutionScreen) excluded from coverage requirement

---

## Checklist

- [ ] `ExecutionScreen` accepts `ImportPlan` prop and calls `execute()` from `onMount`
- [ ] `onDestroy` cleanup added for `import:progress` and `import:complete` listeners
- [ ] `handleCancel` returns `{ noWorker: true }` when no worker running
- [ ] `handleCancelDownload` same fix
- [ ] All existing tests pass at 100% coverage
- [ ] Manual test: import flow reaches result screen normally
- [ ] Manual test: cancel during active import → result screen with cancelled status
- [ ] Manual test: cancel immediately after clicking Import (worker not yet running) → navigates away cleanly
- [ ] PR opened targeting `develop`
