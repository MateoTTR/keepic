# TASK-069-fix — Fix dedup scan results not rendering

## Context

After TASK-068 (v0.5.5), the dedup scan completes (progress bar reaches 100%, 51316/51316
photos analyzed) but the UI **never transitions** to showing the results. The screen stays
frozen on "Scanning for duplicates… 100%".

This is a regression from TASK-068 or a pre-existing issue masked by the previous freeze.

## Investigation needed

1. **IPC payload size**: The `onDedupComplete` callback sends the full `groups` array via
   IPC. With 320+ groups x ~3 photos each, this could be a very large structured-clone
   payload that freezes the renderer. Check if `$state.snapshot` is needed, or if the
   payload is simply too large.

2. **Worker completion**: Does the dedup worker actually send the `complete` message?
   Could it crash or hang after sending the last progress update?

3. **Renderer callback**: Is `onDedupComplete` actually registered and firing? Could the
   Svelte reactivity (`groups = result.groups`) trigger a massive re-render that hangs?

4. **Console errors**: Check DevTools console (Ctrl+Shift+I) for errors during the
   transition — could be a type error, structured clone failure, or out-of-memory.

## Likely root causes (ordered by probability)

1. IPC payload too large — structured clone of 320 groups with photo metadata freezes
   the renderer process during deserialization
2. Worker sends progress but crashes before sending complete
3. Svelte reactivity storm when setting 320 groups at once

## Files to investigate

| File | Relevance |
|------|-----------|
| `src/main/ipc/dedup-scan-handler.ts` | IPC handler, sends results to renderer |
| `src/main/workers/dedup-scan.worker.ts` | Worker that computes duplicates |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Receives and renders results |
| `src/shared/types.ts` | `DuplicateGroup` type definition |

## Deliverables

- [ ] Identify why the UI doesn't transition after 100%
- [ ] Fix the issue — results must display for 320+ groups on a 51k photo library
- [ ] Verify expand/collapse still works after fix
