# TASK-043 — Display elapsed time in operation reports

## Goal

Show how long each operation took in its completion report, giving users feedback on performance.

## Deliverables

- `formatElapsed(ms)` utility in `src/renderer/src/utils.ts`
- **Re-index**: elapsed time shown inline in "Done" message
- **Import analysis**: elapsed time shown in ReviewScreen header ("analysed in Xs")
- **Import execution**: elapsed time shown in ResultScreen header ("in Xs")

## Design Decisions

- **UI-side tracking** (not worker-side): simpler, fewer files changed, measures wall-clock time from user's perspective
- `Date.now()` captured at operation start, elapsed computed on completion
- Timing state managed in `App.svelte` for multi-screen flows (planning → review, execution → result)
- Timing state managed in `ReindexScreen.svelte` for self-contained flow

## Format

- `< 1s` → `"423ms"`
- `1s – 60s` → `"12.3s"`
- `≥ 60s` → `"2m 15s"`

## Files Changed

- `src/renderer/src/utils.ts` — added `formatElapsed`
- `src/renderer/src/App.svelte` — timing state + props
- `src/renderer/src/screens/ReindexScreen.svelte` — elapsed display
- `src/renderer/src/screens/ReviewScreen.svelte` — `analysisElapsedMs` prop
- `src/renderer/src/screens/ResultScreen.svelte` — `elapsedMs` prop
