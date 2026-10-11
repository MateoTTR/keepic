# TASK-072-fix — HEIF deps cache never available to release builds

## Context

Release builds (`release.yml`) compile libde265 + libheif from source when the cache is missing. That takes about 10 minutes on the Windows runner. Session 062 tried to cache these static libraries for releases, but no release has ever restored them:

- **Tag scoping**: releases run on tag refs (`v*.*.*`). A tag workflow can only restore caches saved on its own ref or on the default branch (`main`). Caches saved on `develop` or on a previous tag are invisible to it.
- **Warm-up workflow never reached `main`**: `cache-heif-deps.yml` (added in session 062) exists only on `develop`, so it never ran on `main` and never populated a cache that releases could see.
- **7-day eviction**: GitHub deletes caches that have not been accessed for 7 days. The warm-up workflow only ran on `workflow_dispatch` or when `build-deps.sh` changed. Even on `main`, its cache would have been evicted long before the next release (v0.5.8 → v0.5.9 is 7 months). As of 2026-10-11, the repository has no caches at all.
- **Stale-deps risk in `release.yml`**: the restore step had `restore-keys: heif-deps-<os>-` as a prefix fallback, and the build step was skipped when `deps/lib/libheif.*` existed. If `build-deps.sh` changes (e.g. a libheif version bump), a release could restore libraries built by the *old* script and silently ship the old libheif.

The repository is public, so Actions minutes are free. The cache only affects release speed, not quota.

## Fix

### `cache-heif-deps.yml` — keep a `main`-scoped cache alive

- Triggers:
  - `push` to `main` (any change). Merging a release PR into `main` warms the cache right before the release tag is pushed.
  - `schedule` twice a week (Monday + Thursday, 06:00 UTC). This keeps the gap between accesses under the 7-day eviction window.
  - `workflow_dispatch`, for manual runs.
- Use `actions/cache@v4` (restore + automatic save on miss) instead of `lookup-only` + `actions/cache/save`. A full restore refreshes the cache's last-access time; a `lookup-only` check is not guaranteed to.
- MSVC setup and the deps build run only on a cache miss.
- A `concurrency` group prevents overlapping warm-up runs (e.g. a push and a scheduled run at the same time).

### `release.yml` — exact key only

- Remove the `restore-keys` prefix fallback. Only an exact key (same `build-deps.sh` hash) is restored.
- Gate the deps build on `steps.heif-cache.outputs.cache-hit != 'true'` instead of testing for a file.
- A cache miss still falls back to building from source, so releases never depend on the cache being present.

## Release procedure change

After merging a release PR into `main`:

1. Wait for the **Warm HEIF deps cache** run triggered by the merge to finish.
2. Then push the release tag.

If the tag is pushed earlier, the release still works; it just rebuilds the deps.

## Known limitations

- GitHub disables scheduled workflows in public repositories after 60 days without repository activity. After a long pause, the schedule must be re-enabled from the Actions tab. The push-to-`main` trigger still warms the cache on the next release.
- The cache key includes only the hash of `build-deps.sh`, not the runner image version (`windows-latest`, `macos-latest`). This is the same as before.

## Verification

- Workflow YAML validated locally (structure and expressions).
- End-to-end check during the v0.5.9 release: the warm-up run triggered by the release merge on `main` saves the cache, and the `v0.5.9` release run logs a cache hit and skips the deps build.

## Files Changed

| File | Change |
|---|---|
| `.github/workflows/cache-heif-deps.yml` | Push/schedule triggers, full restore via `actions/cache@v4`, concurrency group |
| `.github/workflows/release.yml` | Exact-key restore, build gated on `cache-hit` |
| `docs/tasks/TASK-072-fix-ci-heif-cache.md` | This file |
