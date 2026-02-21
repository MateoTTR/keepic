# TASK-011 — Import UI & Deduplication Review

> **Status**: Ready to implement
> **Session**: —
> **Branch**: `feature/TASK-011-import-ui`
> **Base branch**: `develop`

---

## Goal

Implement the complete import workflow UI in the Electron renderer, covering:

1. **Svelte 5 migration** — replace the React scaffold with Svelte 5 + Tailwind CSS + shadcn-svelte
2. **Preload IPC extension** — expose import channels to the renderer
3. **Import screens** — source selection, planning progress, plan review (with inline duplicate expansion), execution progress, result summary

The backend (main process IPC handlers) is already implemented in TASK-010.

---

## Deliverables

| File | Role |
|---|---|
| `src/renderer/src/App.svelte` | Root component — screen router |
| `src/renderer/src/main.ts` | Renderer entry point (replaces main.tsx) |
| `src/renderer/src/screens/HomeScreen.svelte` | Source folder selection |
| `src/renderer/src/screens/PlanningScreen.svelte` | Phase 1 progress |
| `src/renderer/src/screens/ReviewScreen.svelte` | Import plan review + duplicate inline expansion |
| `src/renderer/src/screens/ExecutionScreen.svelte` | Phase 2 progress |
| `src/renderer/src/screens/ResultScreen.svelte` | Import result summary |
| `src/renderer/src/components/ui/` | shadcn-svelte components (Button, Badge, Progress, Separator) |
| `src/preload/index.ts` | Add import IPC bindings |
| `src/preload/index.d.ts` | Add import TypeScript types |
| `electron.vite.config.ts` | Replace React plugin with Svelte plugin |
| `svelte.config.js` | Svelte preprocessor config |
| `tailwind.config.js` | Tailwind config |
| `src/renderer/src/app.css` | Tailwind base imports |
| `package.json` | Replace React deps with Svelte deps |
| `docs/tasks/TASK-011-deduplication-ui.md` | This file (update status at end of session) |

Files to **delete**:
- `src/renderer/src/App.tsx`
- `src/renderer/src/main.tsx`

---

## Step 0 — Svelte 5 Migration (prerequisite)

### Packages to remove

```
react  react-dom  @types/react  @types/react-dom  @vitejs/plugin-react
```

### Packages to add

```
svelte  @sveltejs/vite-plugin-svelte  svelte-check
tailwindcss  @tailwindcss/vite
bits-ui  clsx  tailwind-variants
```

> `bits-ui` is the accessible headless primitive library used by shadcn-svelte.
> `clsx` + `tailwind-variants` are shadcn-svelte's class merging utilities.

### `electron.vite.config.ts`

Replace `react()` plugin with `svelte()`:

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [svelte()]
  }
})
```

### `svelte.config.js` (at project root)

```javascript
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess()
}
```

### `tailwind.config.js` (at project root)

```javascript
export default {
  content: ['./src/renderer/**/*.{svelte,ts,html}'],
  theme: { extend: {} },
  plugins: []
}
```

### `src/renderer/src/app.css`

```css
@import 'tailwindcss';
```

### `src/renderer/index.html`

Update the script tag to point to `main.ts` (not `main.tsx`).

### ESLint

Add `eslint-plugin-svelte` and update `eslint.config.*` to handle `.svelte` files.
The existing TypeScript ESLint config applies to `<script lang="ts">` blocks inside `.svelte` files.

---

## Step 1 — Preload IPC Extension

### New channels to expose

| Channel | Direction | Description |
|---|---|---|
| `import:select-source-folder` | invoke → reply | Open OS folder picker |
| `import:plan` | invoke → reply | Run Phase 1 (blocking until complete) |
| `import:plan-progress` | push (on) | Progress during Phase 1 |
| `import:execute` | invoke → reply | Start Phase 2 (fire-and-forget; returns `{started}`) |
| `import:progress` | push (on) | Progress during Phase 2 |
| `import:complete` | push (on) | Phase 2 final result |
| `import:cancel` | invoke (one-way) | Cancel Phase 2 |

### `src/preload/index.ts` — additions

```typescript
import type {
  AppConfig,
  ImportPlan,
  ImportProgress,
  ImportResult,
  PlanProgress,
  SelectLibraryFolderResult
} from '../shared/types'

// ... existing keepicAPI ...

import: {
  selectSourceFolder: (): Promise<{ cancelled: boolean; path?: string }> =>
    ipcRenderer.invoke('import:select-source-folder'),

  plan: (
    sourceFolder: string,
    libraryPath: string,
    dbPath: string,
    config: AppConfig,
    onProgress: (p: PlanProgress) => void
  ): Promise<ImportPlan | { error: string }> => {
    const progressHandler = (_event: unknown, data: PlanProgress) => onProgress(data)
    ipcRenderer.on('import:plan-progress', progressHandler)
    return ipcRenderer
      .invoke('import:plan', sourceFolder, libraryPath, dbPath, config)
      .finally(() => ipcRenderer.removeListener('import:plan-progress', progressHandler))
  },

  execute: (
    plan: ImportPlan,
    libraryPath: string,
    dbPath: string,
    userDataPath: string,
    config: AppConfig
  ): Promise<{ started: boolean } | { alreadyRunning: boolean }> =>
    ipcRenderer.invoke('import:execute', plan, libraryPath, dbPath, userDataPath, config),

  onProgress: (callback: (p: ImportProgress) => void) => {
    ipcRenderer.on('import:progress', (_event, data) => callback(data))
  },

  onComplete: (callback: (r: ImportResult) => void) => {
    ipcRenderer.on('import:complete', (_event, data) => callback(data))
  },

  cancel: (): Promise<void> => ipcRenderer.invoke('import:cancel')
}
```

> **Note**: The preload currently invokes `config:get` to get libraryPath and dbPath at startup.
> The import methods need these values — the renderer must call `window.keepic.config.get()`
> on mount and pass the config values through to the import calls.

### `src/preload/index.d.ts` — additions

Add the `import` namespace to `KeePickAPI`:

```typescript
import: {
  selectSourceFolder: () => Promise<{ cancelled: boolean; path?: string }>
  plan: (
    sourceFolder: string,
    libraryPath: string,
    dbPath: string,
    config: AppConfig,
    onProgress: (p: PlanProgress) => void
  ) => Promise<ImportPlan | { error: string }>
  execute: (
    plan: ImportPlan,
    libraryPath: string,
    dbPath: string,
    userDataPath: string,
    config: AppConfig
  ) => Promise<{ started: boolean } | { alreadyRunning: boolean }>
  onProgress: (callback: (p: ImportProgress) => void) => void
  onComplete: (callback: (r: ImportResult) => void) => void
  cancel: () => Promise<void>
}
```

> Also import `ImportPlan`, `ImportProgress`, `ImportResult`, `PlanProgress` from shared types.

---

## Step 2 — Renderer Architecture

### Screen routing

The renderer uses a simple `$state`-based screen router — no external router library.

```typescript
type Screen =
  | 'home'
  | 'planning'
  | 'review'
  | 'executing'
  | 'result'
```

`App.svelte` holds the current screen as `$state` and renders the matching screen component.
Screen transitions are triggered by emitting events upward (via Svelte's event model or a simple store).

### Shared state (simple module-level stores)

These are plain `$state` runes in `App.svelte` props drilled to children, **not** a global store:

```typescript
let currentScreen: Screen = $state('home')
let sourceFolder: string = $state('')
let config: AppConfig | null = $state(null)
let planProgress: PlanProgress | null = $state(null)
let plan: ImportPlanEntry[] = $state([])  // mutable local copy
let livePhotosDiscarded: number = $state(0)
let execProgress: ImportProgress | null = $state(null)
let importResult: ImportResult | null = $state(null)
```

`plan` is the **mutable local copy** — the renderer can change entry `status` from `'duplicate'` to `'ready'` when the user chooses "Import anyway".

---

## Step 3 — Screen Specs

### 3.1 HomeScreen

**Purpose**: Select the source folder.

**Layout**:
```
┌─────────────────────────────────────────┐
│  KeePic                                 │
│                                         │
│  Import photos from a local folder      │
│                                         │
│  [Select folder…]                       │
│                                         │
│  Selected: /Volumes/SD/DCIM   (or none) │
│                                         │
│  [Analyse →]   (disabled if no folder)  │
└─────────────────────────────────────────┘
```

**Behaviour**:
- "Select folder" button → calls `window.keepic.import.selectSourceFolder()`
- If result is not cancelled → update `sourceFolder` state, enable "Analyse" button
- "Analyse" → transition to `planning` screen, start Phase 1

---

### 3.2 PlanningScreen

**Purpose**: Show Phase 1 progress while the plan is being built.

**Layout**:
```
┌─────────────────────────────────────────┐
│  Analysing /Volumes/SD/DCIM…            │
│                                         │
│  [████████████░░░░░░░░] 23 / 47         │
│  Current: IMG_1234.HEIC                 │
│                                         │
│  [Cancel]                               │
└─────────────────────────────────────────┘
```

**Behaviour**:
- On mount: call `window.keepic.import.plan(sourceFolder, ...)` with progress callback
- Update `planProgress` on each progress event
- On resolve: if `{ error }` → show error toast and go back to `home`; else transition to `review`
- "Cancel": not possible during Phase 1 (planning is blocking invoke); hide or disable the button

---

### 3.3 ReviewScreen

**Purpose**: Show the full import plan; let user review duplicates before confirming.

**Layout**:
```
┌─────────────────────────────────────────────────────────────────────┐
│  Import plan — 47 files                                             │
│                                                                     │
│  ● 38 ready     ◆ 3 duplicates     ▲ 2 collisions     ✕ 0 errors  │
│  ⊘ 4 Live Photo videos discarded                                   │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  Name              Destination                    Status   Action   │
│  ─────────────────────────────────────────────────────────────────  │
│  IMG_0001.jpg    2026/2026.01/IMG_0001.jpg       [Ready]           │
│  IMG_0002.heic   2026/2026.01/IMG_0002.jpg       [Ready]           │
│  IMG_0055.jpg    2026/2026.01/IMG_0055.jpg       [Collision] ▼     │
│  ┌ collision detail ──────────────────────────────────────────── ┐  │
│  │ Renamed to: 2026/2026.01/IMG_0055_1.jpg                       │  │
│  └────────────────────────────────────────────────────────────── ┘  │
│  IMG_0102.heic   (duplicate)                     [Duplicate] ▼     │
│  ┌ duplicate detail ──────────────────────────────────────────── ┐  │
│  │ Source: IMG_0102.heic  •  2.4 MB  •  2026-01-15               │  │
│  │ Matches: 2025/2025.12/IMG_0102.jpg  •  2.1 MB                 │  │
│  │                          [Skip ✓]  [Import anyway]            │  │
│  └────────────────────────────────────────────────────────────── ┘  │
│  IMG_0103.heic   (duplicate — skipped)           [Duplicate]       │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                          [Cancel]  [Import N files →]               │
└─────────────────────────────────────────────────────────────────────┘
```

**Behaviour**:

- Summary bar: counts of each status (using `$derived`)
- Entry list: all `ImportPlanEntry` items, sorted: ready/collision first, then duplicates, then errors
- **Ready entries**: filename, destination, badge "Ready" — no expansion
- **Collision entries**: filename, badge "Collision", expandable → shows the renamed destination
- **Duplicate entries**: filename, badge "Duplicate", expandable inline:
  - Source info: filename, fileSize (formatted), dateTaken
  - Library match: `duplicateOf` path
  - Buttons: "Skip" (default — `status = 'duplicate'`) / "Import anyway" (sets `status = 'ready'` in local copy)
  - When "Import anyway" is chosen, the badge changes to "Ready" and the row loses expandability
- **Error entries**: filename, badge "Error", errorMessage shown inline — cannot be fixed
- "Import N files" button: N = count of entries with `status === 'ready' || status === 'collision'`
  - Disabled if N === 0
  - On click: transition to `executing`, call `window.keepic.import.execute(modifiedPlan, ...)`
- "Cancel" button: go back to `home`

---

### 3.4 ExecutionScreen

**Purpose**: Show Phase 2 progress.

**Layout**:
```
┌─────────────────────────────────────────┐
│  Importing…                             │
│                                         │
│  [██████████████░░░░░░] 14 / 35         │
│  Imported: 12   Skipped: 2              │
│  Current: IMG_0102.jpg                  │
│                                         │
│  [Cancel]                               │
└─────────────────────────────────────────┘
```

**Behaviour**:
- On mount: attach `window.keepic.import.onProgress` and `window.keepic.import.onComplete` listeners
- On `onComplete`: transition to `result` screen
- "Cancel": call `window.keepic.import.cancel()` — display "Cancelling…" while waiting for `onComplete`

---

### 3.5 ResultScreen

**Purpose**: Show import summary.

**Layout**:
```
┌─────────────────────────────────────────┐
│  Import complete ✓                      │
│                                         │
│  38 photos imported                     │
│  5  duplicates skipped                  │
│  4  Live Photo videos discarded         │
│                                         │
│  Errors (1):                            │
│  • IMG_0099.jpg — No free filename slot │
│                                         │
│  [Import more]  [Done]                  │
└─────────────────────────────────────────┘
```

**Behaviour**:
- Shows `importResult` data
- Status: "Import complete ✓" or "Import cancelled" or "Import failed"
- Errors list: only shown if `errors.length > 0`
- "Import more" → reset state and go to `home`
- "Done" → go to `home` (for now; in future, could show library stats)

---

## Step 4 — shadcn-svelte Components Needed

These components should be initialized via the shadcn-svelte CLI or copied manually:

| Component | Usage |
|---|---|
| `Button` | All action buttons |
| `Badge` | Entry status (Ready / Duplicate / Collision / Error) — use variant colors |
| `Progress` | Phase 1 and Phase 2 progress bars |
| `Separator` | Between header and entry list in ReviewScreen |

Badge variant mapping:
| Status | Variant / color |
|---|---|
| `ready` | `default` (green or neutral) |
| `duplicate` | `secondary` (yellow/amber) |
| `collision` | `outline` (blue) |
| `error` | `destructive` (red) |

---

## Step 5 — IPC main process changes (minor)

The existing `import:plan` handler in `src/main/index.ts` currently receives arguments via `event.sender`. Check that the IPC handler signature matches the preload `invoke` call (positional args: `sourceFolder, libraryPath, dbPath, config`). Adjust if needed — no logic change.

The `import:execute` IPC handler needs `userDataPath` — it's available in the main process via `app.getPath('userData')`. Verify the handler uses it correctly (it should already, from TASK-010 implementation).

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Screen routing | `$state` enum in App.svelte | Simple enough for 5 screens; no router dependency |
| Duplicate action | Mutate local plan copy | Phase 2 already handles status-based filtering |
| Duplicate UI | Inline expansion (no modal) | User choice made in session; keeps context visible |
| Plan modification | Renderer-side only | Backend is stateless; renderer sends modified plan to execute |
| IPC event cleanup | `removeListener` in `.finally()` for plan | Prevents memory leaks on re-import |
| Coverage | Renderer excluded | Policy unchanged from TASK-003 |

---

## Session Checklist

- [ ] `develop` is up to date before branching
- [ ] Branch: `git checkout -b feature/TASK-011-import-ui develop`
- [ ] Step 0: Svelte migration (packages, config, entry point)
- [ ] Step 1: Preload IPC extension
- [ ] Step 2: App.svelte screen router + shared state
- [ ] Step 3: All 5 screen components
- [ ] Step 4: shadcn-svelte components (Button, Badge, Progress, Separator)
- [ ] Verify `npm run dev` launches and screens are navigable
- [ ] Verify `npm run lint` and `npm run typecheck` pass
- [ ] Verify `npm test` still passes (backend tests unaffected)
- [ ] Open PR → develop
- [ ] Update backlog.md (mark `[x]`) and write session report

---

## Notes for Implementation

- The `config` object (libraryPath, dbPath, heicConversion) must be loaded once at App mount via `window.keepic.config.get()` and passed to all import calls.
- `userDataPath` is not in the shared config — the main process must retrieve it via `app.getPath('userData')` internally in the execute handler (already the case in TASK-010).
- The renderer does not need to know about `dbPath` directly — the main process IPC handler resolves it internally. Double-check whether the preload passes it or the main handler derives it.
- `importResult.status` can be `'completed'`, `'cancelled'`, or `'failed'` — handle all three in ResultScreen.
- File sizes should be formatted as "2.4 MB" or "340 KB" — implement a simple `formatBytes(n)` helper.
