# TASK-063-feat — Enrich import history with source and date range

## Context

The StatsPanel shows recent imports but only displays the source label ("Local folder" / "Google Photos"), the date of the import, and the count of imported photos. Users want to see:

1. **Import source**: already shown, but could be more prominent
2. **Date range of imported media**: oldest and newest `date_taken` among photos imported in that job (e.g. "Jan 15 – Mar 22, 2025")

## Goal

Enrich the `recentImports` data in `LibraryStats` to include the date range of the media that was imported in each job.

## Design

### Option A — Join via `job_id` foreign key (recommended)

Add a `job_id` column to `photos` (nullable, for backward compat with existing rows). Set it during `executeImportPlan` when upserting each photo. Then the stats query can simply:

```sql
SELECT
  j.id, j.source, j.finished_at, j.photos_imported, j.photos_skipped,
  MIN(p.date_taken) AS oldest_media_date,
  MAX(p.date_taken) AS newest_media_date
FROM import_jobs j
LEFT JOIN photos p ON p.job_id = j.id AND p.deleted_at IS NULL
WHERE j.status = 'completed'
GROUP BY j.id
ORDER BY j.finished_at DESC
LIMIT 5
```

**Migration**: `ALTER TABLE photos ADD COLUMN job_id INTEGER REFERENCES import_jobs(id);`

### Option B — Join via time window (no migration)

Match photos to jobs by `imported_at` BETWEEN `started_at` AND `finished_at`. Less reliable (overlapping jobs, clock drift) and slower. Not recommended.

### Type changes

```typescript
// In LibraryStats.recentImports
recentImports: Array<{
  source: ImportSource
  finishedAt: string
  photosImported: number
  photosSkipped: number
  oldestMediaDate: string | null  // NEW — ISO date of oldest photo in this job
  newestMediaDate: string | null  // NEW — ISO date of newest photo in this job
}>
```

### UI changes (StatsPanel.svelte)

Each import row currently shows:
```
Local folder    15/03/2026    +12 photos
```

Should become:
```
Local folder    15/03/2026    +12 photos    Jan 2025 – Mar 2025
```

If oldest and newest are in the same month, show just the month. If null (all imported photos have no date), omit.

## Deliverables

- [x] DB migration: add `job_id` column to `photos`
- [x] Set `job_id` in `executeImportPlan` and indexer upserts
- [x] Update stats query to join and compute min/max `date_taken` per job
- [x] Update `LibraryStats` type with `oldestMediaDate` / `newestMediaDate`
- [x] Update `StatsPanel.svelte` to display date range
- [x] Tests for the new query and updated executor

## Files to change

| File | Change |
|------|--------|
| `src/main/db/migrations.ts` | Add migration for `job_id` column |
| `src/main/importer.ts` | Pass `jobId` when upserting photos |
| `src/main/db/database.ts` | Update upsert to accept `job_id` |
| `src/main/ipc/library-stats-handler.ts` | Join query for date range |
| `src/shared/types/index.ts` | Add `oldestMediaDate` / `newestMediaDate` to `LibraryStats` |
| `src/renderer/src/components/StatsPanel.svelte` | Display date range |
| `tests/main/ipc/library-stats-handler.test.ts` | Test date range in stats |
| `tests/main/importer.test.ts` | Verify `job_id` is set on imported photos |
