# TASK-069-fix — Fix dedup results not rendering after scan completes

## Context

After TASK-068 (v0.5.5), the dedup scan reaches 100% (51316/51316 photos) but the UI
**never transitions** to the results view. Stays frozen on "Scanning for duplicates… 100%".

User cannot run DevTools (testing on Windows release build, not dev mode).

## Root cause analysis (session 061)

### Confirmed bug: duplicate `{#each}` key

In `DeduplicationScreen.svelte`:
```svelte
{#each groups as group, i (group.phash)}   ← KEY CAN BE DUPLICATED
```

`findDuplicateGroups` (line 192 of `dedup-scan-handler.ts`) sets `phash: photoRows[indices[0]].phash`.
With HAMMING_THRESHOLD=0 and dHash filtering (TASK-064), two photos can have the **same pHash**
but **different dHash** → they end up in **separate groups** that share the same `group.phash`.

Before TASK-068, pagination showed only 20 groups at a time → collision was rare.
Now ALL 669 groups render at once → collision is near-certain → Svelte 5 may silently
drop elements or error on duplicate keys, preventing the `{:else}` block from rendering.

### Other possible causes (need logging to confirm)

1. **Worker crash** between last progress and `complete` message — would trigger
   `on('error')` which sends empty groups, but still sets `loading = false`
2. **IPC payload serialization** — double structured clone (worker→main + main→renderer)
   for ~300 KB payload — unlikely but possible on slow machines
3. **`event.sender` stale** — if BrowserWindow webContents becomes invalid before
   the worker finishes

## Fix plan

### 1. Fix duplicate key (certain bug)

**Backend**: Add unique `id` field to `DuplicateGroup` type (composite of pHash + dHash
of first member, or sequential counter).

```typescript
// In dedup-scan-handler.ts findDuplicateGroups():
photoGroups.push({
  id: `photo-${photoGroups.length}`,   // ← unique sequential ID
  phash: photoRows[indices[0]].phash,
  mediaType: 'photo',
  photos
})

// In handleScanDuplicates() for video groups:
videoGroups.push({
  id: `video-${videoGroups.length}`,
  phash: key,
  mediaType: 'video',
  photos
})
```

**Frontend**: Use `group.id` as key:
```svelte
{#each groups as group, i (group.id)}
```

**Types**: Add `id: string` to `DuplicateGroup` in `shared/types.ts`.

### 2. Add diagnostic logging (for Windows release testing)

Since the user tests on Windows release (no DevTools), add **visible on-screen logging**
that shows the state of each IPC step. This will be removed once the bug is confirmed fixed.

**Main process** (`index.ts`):
- Log when worker sends `complete` message: add `console.log` (visible in Electron's
  main process output, but NOT visible on release build)
- Guard `event.sender.isDestroyed()` before sending to renderer

**Renderer** (`DeduplicationScreen.svelte`):
- Add a visible `debugInfo` state variable displayed at the bottom of the screen
- Log each IPC event as it arrives:
  - `onDedupProgress` → update debugInfo with timestamp + count
  - `onDedupComplete` → update debugInfo with "Complete received: N groups"
  - `scanDuplicates()` return → update debugInfo with "Scan started: {result}"
- Show `loading` state and `groups.length` on screen at all times

This gives the user a visible trace without needing DevTools.

### 3. Defensive IPC guard

In `index.ts` line 236-238:
```typescript
if (msg.type === 'complete') {
  const allGroups = [...(msg.groups ?? []), ...videoGroups]
  if (!event.sender.isDestroyed()) {
    event.sender.send('library:dedup-complete', { groups: allGroups })
  }
  dedupWorker = null
}
```

## Files to change

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `id: string` to `DuplicateGroup` |
| `src/main/ipc/dedup-scan-handler.ts` | Generate unique `id` per group |
| `src/main/index.ts` | Guard `event.sender.isDestroyed()` |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Use `group.id` as key + add debug info |
| `tests/main/ipc/dedup-scan-handler.test.ts` | Assert `id` field on groups |

## Deliverables

- [ ] Fix duplicate `{#each}` key with unique group ID
- [ ] Add visible debug info to DeduplicationScreen (temporary, for Windows testing)
- [ ] Guard `event.sender.isDestroyed()` in main process
- [ ] Update tests (assert `id` field)
- [ ] Release v0.5.6 for user testing
- [ ] If debug info confirms fix works → remove debug info in follow-up commit

## IPC channels

No new channels. Existing channels unchanged.
