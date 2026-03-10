# TASK-068-fix — Fix dedup lazy rendering (complete rewrite)

## Context

TASK-067 added `LazyGroup` (IntersectionObserver wrapper) to DeduplicationScreen to
virtualize off-screen duplicate groups. Two attempts were made (v0.5.3, v0.5.4) but
neither works — the UI still freezes at ~320 groups.

## Root cause analysis (session review)

Five interacting issues identified:

1. **Thumbnail flood**: 320 groups x ~3 photos = ~960 `keepic-photo://thumbnail`
   requests hit the main process simultaneously. Each triggers `sharp().resize()` on
   the libuv thread pool (4 threads). The 956 queued requests cause multi-second
   main-process freeze.

2. **320 IntersectionObservers**: Each `LazyGroup` creates its own observer. Best
   practice is one observer for all elements.

3. **Layout cascade**: When a LazyGroup switches from 280px placeholder to real
   content, the reflow triggers observer callbacks on adjacent groups, causing a
   chain reaction of renders and thumbnail requests.

4. **`loading="lazy"` broken**: The tabbed UI (TASK-059) changed the layout structure.
   `flex-1` on the intermediate container may prevent Chromium from correctly
   calculating off-screen positions for lazy loading.

5. **No thumbnail cache**: Every screen open regenerates all thumbnails via sharp.

## Solution: collapsed-by-default groups

| Aspect | Before | After |
|--------|--------|-------|
| Initial render | Thumbnails visible immediately | **Collapsed groups** (text: filename, size, date) |
| Expansion | Automatic (IntersectionObserver) | **Click to expand** per group |
| Expand all | N/A | **"Expand all" button** |
| LazyGroup | 1 observer per group (320x) | **Removed** — not needed |
| Pagination | "Show more" adds 20 groups | **All groups shown** in compact text rows |
| Thumbnail throttle | None | **Concurrency limit** (max 6 simultaneous via protocol) |

## Deliverables

- [x] Root cause analysis documented
- [x] Rewrite `DeduplicationScreen.svelte` — collapsed-by-default, expand/collapse per group, expand all
- [x] Remove `LazyGroup.svelte` (no longer used)
- [x] Add concurrency throttle to `protocol.ts` thumbnail handler
- [x] Tests: 584 passed, 100% coverage

## Files changed

| File | Change |
|------|--------|
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Complete rewrite |
| `src/renderer/src/components/LazyGroup.svelte` | **Deleted** |
| `src/main/protocol.ts` | Add concurrency throttle |

## IPC channels

No new IPC channels. Existing channels unchanged.
