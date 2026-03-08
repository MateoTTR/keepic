# TASK-049-fix — Cleanup stale temp directories on app startup

## Context

KeePic creates temporary directories during import and Google Picker downloads:

- **Import staging**: `{userData}/temp/import-{timestamp}/` — created by `import-handlers.ts:126`
- **Picker staging**: `{userData}/picker-staging/{timestamp}/` — created by `index.ts:187`

If the app crashes, the user force-quits, or cleanup fails (TASK-052 Windows EPERM), these directories are never cleaned up and accumulate over time. Each can contain large media files (HEIC, JPEG, video).

There is currently **no startup cleanup logic** in the codebase.

## Goal

On app startup (after `app.ready`), scan and remove stale temporary directories from both locations.

## Key Changes

### 1. `src/main/temp-cleanup.ts` (new)

Create a utility function:
```typescript
export async function cleanupStaleTempDirs(
  userDataPath: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000  // 24 hours
): Promise<{ removed: string[]; errors: string[] }>
```

- Scan `{userDataPath}/temp/` for directories matching `import-*`
- Scan `{userDataPath}/picker-staging/` for any subdirectories
- For each directory: check `mtime` (or directory name timestamp) — if older than `maxAgeMs`, remove with `fs.promises.rm({ recursive: true, force: true, maxRetries: 2, retryDelay: 500 })`
- Log removed directories and errors
- Return summary for potential future UI notification

### 2. `src/main/index.ts`

- Call `cleanupStaleTempDirs(app.getPath('userData'))` after `app.whenReady()`, fire-and-forget (don't block startup)

### 3. `tests/main/temp-cleanup.test.ts` (new)

- Test: removes old import-* dirs (older than 24h)
- Test: removes old picker-staging dirs
- Test: preserves recent dirs (less than 24h old — could be an active import)
- Test: handles missing temp/picker-staging parent dirs gracefully (first launch)
- Test: handles individual rm failures without stopping

## Design Decisions

- **24-hour threshold**: avoids deleting a directory from a currently running import. The timestamp in the directory name can be parsed to determine age.
- **Fire-and-forget**: cleanup runs in the background, doesn't block startup
- **No UI notification**: silent cleanup — just log to console. If needed later, the return value can be surfaced.

## Risks

| Risk | Mitigation |
|------|-----------|
| Deleting an active import's temp dir | 24h age threshold makes this virtually impossible |
| First launch: parent dirs don't exist | Check existence before scanning, create nothing |
| Windows file locks on stale dirs | `maxRetries: 2` + `retryDelay: 500ms`; silently skip on failure |

## Validation

- [ ] Unit tests pass for all scenarios
- [ ] Full test suite passes with 100% coverage
- [ ] Manual test: create fake stale dirs, restart app, verify removal

## Files Changed

| File | Change |
|------|--------|
| `src/main/temp-cleanup.ts` | **New** — cleanup utility function |
| `src/main/index.ts` | **Modified** — call cleanup on startup |
| `tests/main/temp-cleanup.test.ts` | **New** — unit tests |
