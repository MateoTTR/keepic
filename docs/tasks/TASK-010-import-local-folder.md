# TASK-010 — Implement local folder / SD card import pipeline

> **Status**: Approved — ready to implement
> **Dependencies**: TASK-006 (indexer), TASK-007 (EXIF), TASK-008 (pHash), TASK-009 (HEIC)

---

## Goal

Implement the end-to-end import pipeline for local source folders (local folder, SD card, WhatsApp/Signal media folder). The user selects a source folder; the app scans it, processes each file, detects duplicates against the existing library index, stages files in temp, and moves them to the appropriate monthly folder in the shared library.

---

## Deliverables

| File | Status | Notes |
|---|---|---|
| `src/main/importer.ts` | new | Core pipeline logic — injectable, 100% tested |
| `src/workers/importer.worker.ts` | new | Thin worker wrapper — excluded from coverage |
| `src/main/ipc/import-handlers.ts` | new | IPC handlers — injectable, tested |
| `tests/main/importer.test.ts` | new | Unit tests for the pipeline |
| `tests/main/ipc/import-handlers.test.ts` | new | Unit tests for IPC handlers |
| `src/shared/types/index.ts` | update | Add `ImportResult` type |
| `src/main/index.ts` | update | Register import IPC handlers + worker |

---

## Import Pipeline Flow

Le pipeline est découpé en **deux phases** avec une validation utilisateur entre les deux.

### Phase 1 — Planning (aucune écriture)

```
Source folder (user-selected)
        │
        ▼
1. scanSourceFiles()          ← recursive walk, tous les fichiers
        │
        ▼
2. Filter Live Photo MOVs     ← isLivePhotoMov() → discard, count
        │
        ▼
3. Filter unsupported formats ← extension not in IMPORT_EXTENSIONS → skip
        │
        ▼
4. For each candidate file:
   ├─ a. HEIC renaming        ← if .heic/.heif + conversion enabled: dest extension → .jpg
   ├─ b. EXIF date extraction ← readExifDate() → date + source
   ├─ c. pHash computation    ← computePhash()
   ├─ d. Duplicate check      ← query DB by phash → status = 'duplicate'
   ├─ e. Destination path     ← getDestinationPath(date, filename)
   └─ f. Collision resolution ← if dest exists on disk: add _1, _2, ... → status = 'collision'
        │
        ▼
ImportPlan  ←── returned to renderer; user reviews & confirms
```

### ⏸ User validation

Le renderer affiche la liste complète des entrées du plan :
- chemin source + chemin destination dans la librairie
- statut (`ready` / `duplicate` / `collision`)
- date de capture et source EXIF

L'utilisateur peut confirmer ou annuler avant toute écriture.

### Phase 2 — Execution (après confirmation)

```
ImportPlan (confirmed)
        │
        ▼
5. Create temp dir            ← <userData>/temp/import-<timestamp>/
        │
        ▼
6. For each entry with status = 'ready' | 'collision':
   ├─ a. HEIC conversion      ← if .heic/.heif + enabled: convertHeicToJpeg(src, temp/uuid.jpg)
   │       sinon: copyFile(src, temp/uuid-filename)
   ├─ b. Library write        ← mkdirSync(year/month, {recursive}), rename(temp→lib)
   └─ c. DB upsert            ← INSERT OR REPLACE into photos
        │
        ▼
7. Update import_jobs record  ← status=completed, counts
        │
        ▼
8. Clean temp dir             ← always, even on failure
        │
        ▼
ImportResult
```

> **Note** : la conversion HEIC (step 6a) a lieu en Phase 2 uniquement. En Phase 1, on calcule uniquement le nom de destination (`.jpg`) sans lire le fichier via sharp — c'est le pHash qui lit le fichier image (sharp supporte HEIC pour ça).

---

## Key Design Decisions

### Injectable pattern
Follows the established codebase pattern (`ExifLoader`, `PhashComputer`, `HeicConverter`). The `runImporter` function accepts injectable I/O dependencies:

```typescript
export interface ImporterDeps {
  loadExif?: ExifLoader
  computePhash?: PhashComputer
  convertHeic?: HeicConverter
  copyFile?: (src: string, dest: string) => void
  moveFile?: (src: string, dest: string) => void
  mkdirp?: (path: string) => void
}
```

This makes the pipeline fully testable without real I/O.

### Source file safety
Source files are **never moved or modified**. The pipeline uses `copyFile` (source → temp), then `rename`/`moveFile` (temp → library). If anything fails mid-import, no library file is partially written and no source file is touched.

### HEIC conversion
- Only applies to `.heic` and `.heif` files when `config.heicConversion.enabled` is `true`
- Conversion destination: `<tempDir>/<uuid>.jpg`
- The JPEG (not the HEIC) is moved to the library; filename changes to `<stem>.jpg`
- If `enabled` is `false`, the HEIC is copied as-is

### Live Photo MOV filtering
- `.MOV` files whose stem has a sibling `.heic`/`.heif` in the **source folder** are discarded
- Uses `isLivePhotoMov()` from `src/main/heic.ts`
- Count is tracked in `ImportResult.livePhotosDiscarded`

### Supported formats
Same set as the indexer, plus `.mov` (scanned to detect Live Photo companions, then discarded):

```typescript
const IMPORT_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.heic', '.heif',
  '.png', '.tiff', '.tif',
  '.cr2', '.nef', '.arw'
])
// .mov is scanned separately for Live Photo detection only
```

### Duplicate detection
A file is a **duplicate** when its pHash matches an existing entry in the `photos` table (excluding `deleted_at IS NOT NULL` rows).

- **In TASK-010**: duplicates are **skipped** and accumulated in `ImportResult.duplicates` (list of `{ sourcePath, matchingLibraryPath }`)
- **In TASK-011**: the interactive review UI (side-by-side comparison, skip/import-both) will be layered on top using this result

> **Open question (Q-A)**: Should TASK-010 skip duplicates entirely, or should the pipeline pause and let the renderer decide per-file? Proposal above (skip + report) assumes TASK-011 adds review flow. An alternative would be to implement interactive review here. See [Open Questions](#open-questions).

### Filename collision
A **collision** occurs when the computed destination path already exists on disk (different from a pHash duplicate — two photos with same name, same month, different content).

Resolution: append `_N` suffix to the stem, incrementing N from 1 to 99.
- `IMG_1234.jpg` → `IMG_1234_1.jpg` → `IMG_1234_2.jpg` ...
- If no free slot found after 99 attempts: file is added to `ImportResult.errors`

### Temp folder
- Path: `<userData>/temp/import-<ISO-timestamp>/`
- Created at start of import job
- **Always deleted** at end of import (success or failure) — no partial files remain in temp

### Import job tracking
An `import_jobs` record is created at job start (`status='running'`) and updated at completion:
- `source = 'local'`
- `photos_imported`, `photos_skipped`, `live_photos_discarded`
- `status = 'completed'` | `'failed'` | `'cancelled'`
- `finished_at`

### Progress reporting
Same approach as the indexer: callback `(progress: ImportProgress) => void` called after each file processed. `ImportProgress` already exists in shared types.

### Cancellation
The worker supports cancellation via `parentPort.on('message', { type: 'cancel' })`. The pipeline checks a `cancelled` flag between each file. The IPC handler sends `{ type: 'cancel' }` to the worker, then waits for `{ type: 'complete' | 'error' }` (with `status = 'cancelled'` in the result).

---

## Public API (`src/main/importer.ts`)

```typescript
// ── Phase 1 ────────────────────────────────────────────────────────────────

export function scanSourceFiles(sourceFolder: string): {
  candidates: string[]      // absolute paths of supported image files
  livePhotoMovs: string[]   // absolute paths of .MOV files discarded as Live Photo
}

export interface PlannerOptions {
  loadExif?: ExifLoader
  computePhash?: PhashComputer
}

export async function buildImportPlan(
  sourceFolder: string,
  libraryPath: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: PlanProgress) => void,
  options?: PlannerOptions
): Promise<ImportPlan>

// ── Phase 2 ────────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  convertHeic?: HeicConverter
  copyFile?: (src: string, dest: string) => void
  moveFile?: (src: string, dest: string) => void
  mkdirp?: (path: string) => void
  isCancelled?: () => boolean
}

export async function executeImportPlan(
  plan: ImportPlan,
  libraryPath: string,
  tempDir: string,
  db: KeePicDatabase,
  config: AppConfig,
  onProgress: (progress: ImportProgress) => void,
  options?: ExecutorOptions
): Promise<ImportResult>
```

Nouveaux types dans `src/shared/types/index.ts` :

```typescript
export type ImportEntryStatus = 'ready' | 'duplicate' | 'collision'

export interface ImportPlanEntry {
  sourcePath: string                  // chemin absolu dans le dossier source
  destinationRelativePath: string     // "YYYY/YYYY.MM/filename" dans la librairie
  dateTaken: string                   // ISO string
  dateTakenSource: DateSource
  phash: string | null
  fileSize: number
  status: ImportEntryStatus
  duplicateOf?: string                // lib relative path si status === 'duplicate'
  originalDestination?: string        // destination avant suffix si status === 'collision'
}

export interface ImportPlan {
  entries: ImportPlanEntry[]
  livePhotosDiscarded: number
  sourceFolder: string
}

export interface PlanProgress {
  total: number
  processed: number
  currentFile: string | null
}

export interface ImportResult {
  imported: number
  skipped: number                     // duplicates + user-excluded
  livePhotosDiscarded: number
  errors: Array<{ sourcePath: string; error: string }>
  status: ImportStatus                // 'completed' | 'failed' | 'cancelled'
}
```

---

## IPC Channels

Le pipeline à deux phases se traduit par deux séquences IPC distinctes.

### Phase 1 — Planning

| Channel | Direction | Type | Payload |
|---|---|---|---|
| `import:select-source-folder` | renderer → main (invoke) | request | — |
| `import:select-source-folder` | main → renderer (reply) | response | `{ cancelled: boolean; path?: string }` |
| `import:plan` | renderer → main (invoke) | request | `{ sourcePath: string }` |
| `import:plan` | main → renderer (reply) | response | `ImportPlan` \| `{ error: string }` |
| `import:plan-progress` | main → renderer (send) | push | `PlanProgress` |

`import:plan` est synchrone du point de vue du renderer (invoke/reply). La Phase 1 tourne dans un worker dédié pour ne pas bloquer le main thread pendant le calcul des pHash.

### Phase 2 — Execution (après confirmation utilisateur)

| Channel | Direction | Type | Payload |
|---|---|---|---|
| `import:execute` | renderer → main (invoke) | request | `{ plan: ImportPlan }` |
| `import:execute` | main → renderer (reply) | response | `{ started: true }` \| `{ alreadyRunning: true }` \| `{ error: string }` |
| `import:progress` | main → renderer (send) | push | `ImportProgress` |
| `import:complete` | main → renderer (send) | push | `ImportResult` |
| `import:cancel` | renderer → main (invoke) | request | — |

`import:select-source-folder` ouvre un dialog OS (injectable `showOpenDialog`, même pattern que `config:select-library-folder`).

---

## Decisions Log

| ID | Question | Decision |
|---|---|---|
| **Q-A** | Duplicates pendant l'import : skip silencieux ou pause interactive ? | **Skip + report dans `ImportResult`** — TASK-011 ajoute l'UI de review |
| **Q-B** | Rollback des fichiers partiellement importés en cas d'échec ? | **Pas de rollback** — append-only, les partiels seront indexés au prochain scan |
| **Q-C** | Collision de nom : suffixe `_N` ou `_<hash>` ? | **`_N`** (simple, prévisible) |
| **Q-D** | Annulation : coopérative (entre fichiers) ou immédiate ? | **Coopérative** — suffisant en pratique |
| **Q-E** | Fallback "import date" (priorité 5 §2.6) à implémenter ici ? | **Différé** — fallback mtime suffisant pour V1 |
| **Q-F** | HEIC sur Windows : sharp a besoin du codec Windows ? | **Non** — sharp embarque libvips+libheif. Q3 specs = problème de visualisation uniquement, hors scope |

---

## Out of Scope (TASK-010)

- Interactive deduplication review UI (→ TASK-011)
- Google Photos import (→ TASK-012/013)
- WhatsApp/Signal-specific logic (→ TASK-014, uses same local folder flow)
- Renderer UI for import (progress bar, source selection screen) — IPC channels are defined but no UI
- Windows HEIC codec warning dialog (Q-F above)
- Import date fallback (priority 5 in §2.6 date chain)
- RAW file (CR2/NEF/ARW) pHash — sharp may not support them; behavior: compute EXIF date only, pHash=null, import as-is
