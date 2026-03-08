# TASK-052-fix — Fix EPERM on picker-staging cleanup (Windows)

## Context

On Windows, the Google Picker download flow creates a staging directory at `{userData}/picker-staging/{timestamp}/`. After the download completes and the user dismisses the result screen, the renderer calls `google:cleanup-download-dir` which invokes `rmSync(path, { recursive: true, force: true })`.

On Windows, files downloaded via HTTP may still be held by the OS (antivirus scan, indexing, or delayed handle release). This causes `EPERM` errors on `unlink`/`rmSync`, and the cleanup silently fails — leaving orphaned directories that accumulate.

**Current cleanup code** (`src/main/ipc/google-photos-handlers.ts:255–260`):
```typescript
export function handleCleanupDownloadDir(
  dirPath: string,
  rmDir: (p: string) => void = (p) => rmSync(p, { recursive: true, force: true })
): void {
  rmDir(dirPath)
}
```

The `force: true` flag only ignores `ENOENT` (missing files), **not** `EPERM` or `EBUSY`.

## Goal

Make picker-staging cleanup resilient to Windows file locks by using async `fs.rm` with `maxRetries` and `retryDelay` options.

## Key Changes

### 1. `src/main/ipc/google-photos-handlers.ts`

- Replace `handleCleanupDownloadDir` with an async version using `fs.promises.rm`:
  ```typescript
  export async function handleCleanupDownloadDir(
    dirPath: string,
    rmDir: (p: string) => Promise<void> = (p) =>
      rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 })
  ): Promise<void> {
    try {
      await rmDir(dirPath)
    } catch {
      // Best-effort cleanup — stale dirs handled by TASK-049
    }
  }
  ```
- `maxRetries: 3` + `retryDelay: 1000` gives Windows up to 3 seconds to release file handles
- Silent catch — if cleanup fails after retries, the directory is left for TASK-049 startup cleanup

### 2. `src/main/index.ts`

- Update the IPC handler registration from `ipcMain.on` to `ipcMain.handle` (since the function is now async), or keep `ipcMain.on` with fire-and-forget (cleanup doesn't need a response)

### 3. `tests/main/ipc/google-photos-handlers.test.ts`

- Update existing cleanup tests to handle async
- Add test: cleanup succeeds after retry (mock throws EPERM once, then succeeds)
- Add test: cleanup fails after max retries (mock always throws EPERM) — should not throw

## Risks

| Risk | Mitigation |
|------|-----------|
| Changing sync → async breaks callers | The IPC handler is fire-and-forget from renderer — no response awaited |
| Retry delay slows down UX | Cleanup is background work after user dismisses screen — invisible |
| Stale dirs accumulate if retries fail | TASK-049 (startup cleanup) handles this case |

## Validation

- [ ] Existing cleanup tests pass (adapted for async)
- [ ] New retry tests pass
- [ ] Full test suite passes with 100% coverage
- [ ] Manual test on Windows: download via Picker, dismiss result, verify staging dir is removed

## Files Changed

| File | Change |
|------|--------|
| `src/main/ipc/google-photos-handlers.ts` | **Modified** — async cleanup with retries |
| `src/main/index.ts` | **Modified** — adapt IPC handler if needed |
| `tests/main/ipc/google-photos-handlers.test.ts` | **Modified** — async tests + retry scenarios |
