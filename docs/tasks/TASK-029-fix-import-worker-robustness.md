# TASK-029 — Fix import worker robustness (frozen "Starting…" after TASK-026)

## Status
Pending

## Priority
P0

## Session
2026-02-24-session-019

---

## Problem

**Symptom**: after the TASK-026 fix, the import sometimes remains frozen on "Starting…"
(progress bar at 0). The Cancel button is also unresponsive.

**Root cause analysis**: three vulnerabilities identified by code review, which may
combine or act independently:

### Cause A — Synchronous `db.open()` without try-catch in the worker

In `src/workers/importer.worker.ts`:
```typescript
const db = new KeePicDatabase(dbPath)
db.open()   // ← may throw a SYNCHRONOUS exception (locked DB, native module, etc.)

executeImportPlan(...)
  .catch(...)  // ← only catches ASYNC errors
```
If `db.open()` throws a synchronous exception at the worker top-level, the `.catch()` on
the Promise chain will not catch it. Node.js normally emits `worker.on('error', ...)` for
unhandled exceptions in worker threads, but this behaviour depends on the Node.js/Electron
version and is not guaranteed in all cases.

Result: the worker may crash silently without sending `{ type: 'error' }` → the main
process receives nothing → the UI freezes.

### Cause B — No `worker.on('exit', ...)` handler in `handleExecute`

In `src/main/ipc/import-handlers.ts`, only `worker.on('message', ...)` and
`worker.on('error', ...)` are registered. If the worker terminates without sending a
message AND without emitting 'error' (rare but possible: `process.exit()` called by an
imported module, SIGKILL, etc.), `activeWorkerRef.value` remains non-null indefinitely.

Result: the **next** import attempt calls `handleExecute` which finds a non-null ref →
returns `{ alreadyRunning: true }` → the UI freezes (see Cause C).

### Cause C — Return value of `execute()` silently ignored in ExecutionScreen

In `src/renderer/src/screens/ExecutionScreen.svelte`:
```typescript
void window.keepic.import.execute(plan)  // result silently discarded
```
If `execute()` returns `{ alreadyRunning: true }` or `{ error: '...' }`, or if the IPC
invoke rejects, no `import:complete` event will ever be received → UI frozen indefinitely.

---

## Goal

Make the import pipeline robust against all worker failure cases, eliminating any
"frozen with no way out" UI state.

---

## Deliverables

### 1. `src/workers/importer.worker.ts` — Wrap `db.open()` in a try-catch

```typescript
let db: KeePicDatabase
try {
  db = new KeePicDatabase(dbPath)
  db.open()
} catch (err) {
  parentPort!.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
}
```
This ensures any DB initialisation error is reported cleanly via the message channel
before exiting.

### 2. `src/main/ipc/import-handlers.ts` — Add `worker.on('exit', ...)`

In `handleExecute`, after `worker.on('error', ...)`:
```typescript
worker.on('exit', (code) => {
  if (activeWorkerRef.value === worker) {
    // Worker exited without sending 'complete' or 'error'
    activeWorkerRef.value = null
    onComplete({
      imported: 0,
      skipped: 0,
      livePhotosDiscarded: plan.livePhotosDiscarded,
      errors: [{ sourcePath: '', error: `Worker exited unexpectedly (code ${code})` }],
      status: 'failed'
    })
  }
})
```
The `activeWorkerRef.value === worker` check prevents a double `onComplete` call if the
worker terminated normally (ref already null) or if 'error' was already received.

### 3. `src/renderer/src/screens/ExecutionScreen.svelte` — Handle the `execute()` return value

Replace `void window.keepic.import.execute(plan)` with explicit handling of
non-`{ started: true }` cases:
```typescript
const result = await window.keepic.import.execute(plan)
if ('alreadyRunning' in result || 'error' in result) {
  const msg = 'error' in result ? result.error : 'An import is already in progress.'
  onComplete({
    imported: 0,
    skipped: 0,
    livePhotosDiscarded: plan.livePhotosDiscarded,
    errors: [{ sourcePath: '', error: msg }],
    status: 'failed'
  })
}
```
Add a `.catch()` to handle IPC invoke rejections (main process error, etc.).

---

## Tests

- `handleExecute` with a worker that exits without sending any message → `onComplete` called with `status: 'failed'`
- `handleExecute` with a worker that exits AFTER sending 'complete' → `onComplete` **not** called twice
- `handleExecute` with `alreadyRunning` (non-null ref) → returns `{ alreadyRunning: true }`
- Worker exit handler: verify the ref is reset to null
- `importer.worker.ts` unit tests not affected (bootstrap excluded from coverage)
- 100% coverage maintained on main-process modules

## Notes

- The same `worker.on('exit', ...)` handler should be added in `google-photos-handlers.ts`
  for `handleStartDownload` (same risk).
- The Google Photos download worker has no synchronous `db.open()` → Cause A does not apply.
- Cause C (ignored return value) does not affect Google Photos because `GoogleDownloadScreen`
  already handles the return value of `startDownload`.
