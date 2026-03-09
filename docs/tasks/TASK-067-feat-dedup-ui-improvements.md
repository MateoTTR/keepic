# TASK-067-feat — Dedup scan UI improvements (virtualization + path display)

## Context

Manual testing of v0.5.2 on a 51k photo library (669 duplicate groups) revealed
two UX issues on the DeduplicationScreen:

### Issue 1 — UI freeze after loading ~320 groups

Clicking "Show more" repeatedly works up to ~320 groups (~640 thumbnails), then
the renderer stops responding. Even though `<img loading="lazy">` is already set,
the DOM accumulates thousands of nodes (group divs, text elements, buttons,
thumbnail wrappers) which saturates the renderer.

### Issue 2 — File path truncation hides filename

The library-relative path (e.g., `2005/2005.05/Vacances_Italie_IMG_3879.JPG`) is
shown in a single `truncate` line. When the path is long, the **filename** (the most
useful part) gets cut off. The full path is only visible on hover via `title`.

## Fix

### 1. Viewport-aware group rendering

Use `IntersectionObserver` to only mount `PhotoThumbnail` components for groups
that are near the viewport. Groups scrolled far off-screen have their thumbnails
replaced with lightweight placeholders, reducing active DOM nodes.

Alternative simpler approach: keep the "Show more" pagination but limit the
maximum visible count, or replace "Show more" with true virtual scrolling.

**Simplest approach chosen**: wrap each group in a component that uses
`IntersectionObserver` to track visibility. When a group is off-screen, render
a minimal placeholder div with fixed height instead of the full group with
thumbnails. This keeps DOM node count bounded regardless of how many groups
are loaded.

### 2. Better path display

Replace the single truncated path line with:
- **Filename** displayed prominently (not truncated, or truncated from the left)
- **Folder path** shown below in smaller/lighter text

Implementation: split `photo.path` into directory and filename parts. Show
filename first, folder second.

## Deliverables

- [x] Add viewport-aware rendering to DeduplicationScreen (IntersectionObserver)
- [x] Improve path display: show filename prominently, folder path secondary
- [x] Test that pagination + viewport-awareness work together
- [x] 100% coverage maintained

## Bug fix (v0.5.4)

**Race condition in LazyGroup placeholder height**: `lastHeight` was initialized to
`$state(0)` with a `$effect` setting it to `estimatedHeight` (280px). But `$effect`
runs AFTER `onMount`, so when IntersectionObserver fired its initial callback, all
placeholders were 0px tall — they all fit in the viewport — all groups were mounted
simultaneously, causing the same freeze.

**Fix**: replaced `$state(0)` + `$effect` with a `$derived` that returns
`estimatedHeight` immediately until the real height is measured. This ensures
placeholders have the correct height from the first render, before the observer starts.

Also reduced CI artifact retention (releases 30→5d, prebuilds 90→14d, coverage 7→3d)
and added `cleanup-caches.yml` to auto-purge caches when branches are deleted.

## Files changed

| File | Change |
|------|--------|
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Viewport observer + path display |
| `src/renderer/src/components/LazyGroup.svelte` | New — IntersectionObserver wrapper; fix placeholder height race |
| `.github/workflows/ci.yml` | Reduce coverage artifact retention to 3d |
| `.github/workflows/release.yml` | Reduce build artifact retention to 5d |
| `.github/workflows/build-heif-addon.yml` | Reduce prebuild artifact retention to 14d |
| `.github/workflows/cleanup-caches.yml` | New — auto-purge caches on branch deletion |
