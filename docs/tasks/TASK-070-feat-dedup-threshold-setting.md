# TASK-070-feat — Configurable dedup Hamming distance threshold

## Goal

Make the Hamming distance threshold used for duplicate detection a user-configurable
setting instead of a hardcoded constant (`HAMMING_THRESHOLD = 0` in `phash.ts`).

## Context

The threshold was set to 0 (exact match) in TASK-066 after threshold 4 caused
massive false positives. However, different libraries may benefit from different
thresholds. Exposing it in Settings lets the user experiment.

The threshold applies to **both** pHash and dHash Hamming distance checks.
Range: 0–4 (limited by Multi-Index Hashing with 5 chunks — pigeonhole principle
requires NUM_CHUNKS > threshold).

## Design

### Config

Add `dedupThreshold: number` to `AppConfig` (default: 0).

### Data flow

1. User changes threshold in Settings → IPC `config:set-dedup-threshold` → `ConfigManager`
2. User launches dedup scan → `index.ts` reads `configManager.get().dedupThreshold`
3. Threshold passed to worker via `postMessage({ type: 'scan', photoRows, threshold })`
4. Worker passes threshold to `findDuplicateGroups(rows, threshold, onProgress)`
5. `findDuplicateGroups` passes threshold to `isDualHashMatch(…, threshold)`

### Key change: parameterize `isDualHashMatch`

Currently `isDualHashMatch` imports `HAMMING_THRESHOLD` constant. Change to accept
threshold as a parameter. Keep `HAMMING_THRESHOLD` as the default export for
backward compatibility with import dedup (planner/importer use threshold 0).

## Files to change

| File | Change |
|------|--------|
| `src/shared/types/index.ts` | Add `dedupThreshold: number` to `AppConfig` |
| `src/main/config.ts` | Add to DEFAULT_CONFIG + mergeWithDefaults |
| `src/main/ipc/config-handlers.ts` | Add `handleSetDedupThreshold` |
| `src/main/index.ts` | Add IPC handler, pass threshold to worker |
| `src/preload/index.ts` | Add `setDedupThreshold` binding |
| `src/main/multi-index-hash.ts` | `isDualHashMatch` takes threshold param |
| `src/main/ipc/dedup-scan-handler.ts` | `findDuplicateGroups` takes threshold param |
| `src/workers/dedup-scanner.worker.ts` | Read threshold from message |
| `src/renderer/src/screens/SettingsTab.svelte` | Add threshold slider/input |
| `src/renderer/src/App.svelte` | Pass threshold prop + handler |
| Tests | Update all affected test files |

## IPC channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `config:set-dedup-threshold` | renderer → main | `{ threshold: number }` |
