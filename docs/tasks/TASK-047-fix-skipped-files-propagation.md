# TASK-047-fix: Fix skippedFiles Propagation in Import UI Flow

## Priority

P0 — regression from FEAT-003 (v0.3.0), crashes both local and Google Picker imports.

## Bug Description

After FEAT-003 added `skippedFiles: SkippedFile[]` to `ImportPlan`, the field was correctly populated by the backend (planner worker) but never propagated through the renderer relay chain. When the executor worker iterates `plan.skippedFiles`, it throws `plan.skippedFiles is not iterable` because the field is `undefined`.

**Error**: `TypeError: plan.skippedFiles is not iterable`
**Trigger**: any import execution (local folder or Google Picker download)

## Root Cause

The import plan travels: **planner worker -> main -> renderer (PlanningScreen) -> App.svelte state -> renderer (ExecutionScreen) -> main -> executor worker**.

In the renderer relay, the plan is deconstructed into individual state variables and reconstructed manually. Three points were missing `skippedFiles`:

1. **PlanningScreen.svelte** (`onSuccess` callback): only passed `entries` and `livePhotosDiscarded`, dropped `skippedFiles`
2. **App.svelte** (`handlePlanSuccess`): no `skippedFiles` state variable, not stored
3. **App.svelte** (ExecutionScreen template): reconstructed plan as `{ entries, livePhotosDiscarded, sourceFolder }` without `skippedFiles`

## Changes

- **`PlanningScreen.svelte`**: add `SkippedFile` import, include `skippedFiles` in `onSuccess` callback signature and call
- **`App.svelte`**: add `skippedFiles` state variable, store in `handlePlanSuccess`, include in ExecutionScreen plan prop, reset in `handleReset`
- **`preload/index.ts`**: add `skippedFiles?: SkippedFile[]` to `onIndexComplete` callback type (type-only fix, data already passed at runtime)

## Session

Completed in session 043 (2026-03-07), PR #51.
