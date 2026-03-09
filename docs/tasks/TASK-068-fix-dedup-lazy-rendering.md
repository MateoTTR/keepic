# TASK-068-fix — Fix dedup lazy rendering (IntersectionObserver not working)

## Context

TASK-067 added `LazyGroup` (IntersectionObserver wrapper) to DeduplicationScreen to
virtualize off-screen duplicate groups. Two attempts were made:

1. **v0.5.3**: initial implementation — `$state(estimatedHeight)` triggered a Svelte
   warning, so it was changed to `$state(0)` + `$effect`.
2. **v0.5.4**: fixed the placeholder height race (`$state(0)` → `$derived`) so
   placeholders start at 280px instead of 0px.

**Neither version works in practice.** The UI still freezes at ~320 groups. The user
reports that images load immediately on "Show more" (no lazy behavior), and that
native `<img loading="lazy">` which worked before v0.5 (tabbed UI refactoring) no
longer seems to have any effect.

## Investigation needed

Before writing any fix, a **deep code review** of the rendering pipeline is needed:

1. **LazyGroup IntersectionObserver**: is the observer actually firing? Does
   `root: null` (viewport) work correctly in the Electron renderer context?
   Could the Svelte 5 reactivity cycle (`$state`, `$derived`, `$effect`) interfere
   with the observer callbacks?

2. **Tabbed UI impact (TASK-059)**: did the refactoring to tabs change the scroll
   context? Is there a hidden `overflow` container between the viewport root and
   the groups that would prevent IntersectionObserver from detecting visibility?

3. **Native `loading="lazy"` regression**: the user says `<img loading="lazy">`
   worked before v0.5 but stopped working after the tabbed UI refactoring. This
   suggests a layout/scroll container change, not a LazyGroup bug.

4. **Electron-specific behavior**: does Chromium's IntersectionObserver behave
   differently in Electron's renderer process? Any known quirks?

5. **Alternative approaches** if IntersectionObserver proves unreliable:
   - Virtual scroll library (e.g., `svelte-virtual-scroll`)
   - Manual scroll-position-based windowing
   - Hard cap on rendered groups + scroll-triggered loading
   - Simply removing all thumbnails and showing only text until user clicks "expand"

## Deliverables

- [ ] Root cause analysis: why IntersectionObserver virtualization doesn't work
- [ ] Determine if the tabbed UI (TASK-059) broke the scroll/viewport context
- [ ] Implement a working solution that handles 600+ groups without freezing
- [ ] Verify `loading="lazy"` still works on `<img>` elements

## Files likely involved

| File | Relevance |
|------|-----------|
| `src/renderer/src/components/LazyGroup.svelte` | IntersectionObserver wrapper |
| `src/renderer/src/screens/DeduplicationScreen.svelte` | Uses LazyGroup |
| `src/renderer/src/App.svelte` | Tab layout, scroll container? |
| `src/renderer/src/screens/LibraryTab.svelte` | Parent of DeduplicationScreen |
| `src/renderer/src/components/ui/TabBar.svelte` | Tab navigation |
| `src/renderer/src/components/PhotoThumbnail.svelte` | `loading="lazy"` on `<img>` |
