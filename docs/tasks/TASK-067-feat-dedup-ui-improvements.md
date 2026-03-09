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

## Files likely to change

| File | Change |
|------|--------|
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Viewport observer + path display |
| `src/renderer/src/components/LazyGroup.svelte` | New — IntersectionObserver wrapper (optional) |
