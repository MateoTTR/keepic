# TASK-023 — Fix workers build configuration

## Goal

All four worker threads (`indexer`, `planner`, `importer`, `google-photos-download`) are never
compiled because they are not declared as entry points in the electron-vite configuration.
At runtime Electron throws `Cannot find module '...out/workers/*.worker.js'`, making every
core feature of the app non-functional (re-index, local import, Google Photos import).

---

## Root cause

`electron.vite.config.ts` declares only `src/main/index.ts` as the main process entry.
Worker files in `src/workers/` are referenced in `src/main/index.ts` by path string
(not by `import`), so Vite/Rollup never discovers them and they are not compiled.

This affects both **dev mode** (`npm run dev`) and **production builds** (`npm run build` /
packaged installers).

---

## Fix

### 1. `electron.vite.config.ts` — add workers as additional Rollup inputs

Workers are added under the `main` build config with path-prefixed keys so Rollup
outputs them as `out/main/workers/*.worker.js`.

```typescript
main: {
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/main/index.ts'),
        'workers/indexer.worker': resolve('src/workers/indexer.worker.ts'),
        'workers/planner.worker': resolve('src/workers/planner.worker.ts'),
        'workers/importer.worker': resolve('src/workers/importer.worker.ts'),
        'workers/google-photos-download.worker': resolve(
          'src/workers/google-photos-download.worker.ts'
        )
      }
    }
  },
  // ...rest of existing main config unchanged
}
```

### 2. `src/main/index.ts` — update worker paths

Workers now live at `out/main/workers/` (sibling of `index.js`) instead of the
previously assumed `out/workers/` (parent sibling). Change all four paths from
`join(__dirname, '../workers/...')` to `join(__dirname, 'workers/...')`.

```typescript
// Before
const plannerWorkerPath = join(__dirname, '../workers/planner.worker.js')
const importerWorkerPath = join(__dirname, '../workers/importer.worker.js')
const googleDownloadWorkerPath = join(__dirname, '../workers/google-photos-download.worker.js')
// (inside library:start-index handler)
const indexerWorkerPath = join(__dirname, '../workers/indexer.worker.js')

// After
const plannerWorkerPath = join(__dirname, 'workers/planner.worker.js')
const importerWorkerPath = join(__dirname, 'workers/importer.worker.js')
const googleDownloadWorkerPath = join(__dirname, 'workers/google-photos-download.worker.js')
const indexerWorkerPath = join(__dirname, 'workers/indexer.worker.js')
```

---

## Affected files

| File | Change |
|---|---|
| `electron.vite.config.ts` | Add `build.rollupOptions.input` with 4 worker entries |
| `src/main/index.ts` | Change `'../workers/'` → `'workers/'` in 4 paths |

No logic changes. No new tests needed (build config and path strings only).

---

## Verification

```bash
npm run build
# Verify out/main/workers/ contains the 4 compiled .js files

npm run dev
# Re-index library → should run without "Cannot find module" error
# Local import → Analyse → should produce a plan
# Google Photos import → should start download
```

---

## Checklist

- [ ] `electron.vite.config.ts` updated with worker inputs
- [ ] `src/main/index.ts` worker paths updated (4 occurrences)
- [ ] `npm run build` succeeds, `out/main/workers/` contains 4 files
- [ ] `npm run dev`: re-index works end-to-end
- [ ] `npm run dev`: local import Analyse → Review works
- [ ] `npm run dev`: Google Photos import starts
- [ ] Tests pass (`npm test`)
- [ ] PR opened targeting `develop`
