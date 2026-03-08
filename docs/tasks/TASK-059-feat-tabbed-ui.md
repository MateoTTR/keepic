# TASK-059-feat — Refactor UI with tabbed navigation

## Context

The current UI is a single-page layout driven by a `currentScreen` state machine in `App.svelte`. All features (library management, import, settings) are stacked vertically in a monolithic `HomeScreen.svelte` (186 lines). As the app grows, this flat layout becomes hard to navigate.

## Goal

Replace the flat HomeScreen with a **3-tab layout** (Library, Import, Settings) for clearer separation of concerns.

## Design

### Tab structure

| Tab | Content | Sub-screens |
|-----|---------|-------------|
| **Library** | Library path config (select/change), StatsPanel, Re-index button, Scan duplicates button, Purge button | ReindexScreen, DeduplicationScreen |
| **Import** | Local folder import, Google Photos auth + Picker import | GoogleDownloadScreen → PlanningScreen → ReviewScreen → ExecutionScreen → ResultScreen |
| **Settings** | HEIC mode (keep/convert to JPEG) | None (inline) |

### Architecture

#### New components

- `TabBar.svelte` — persistent horizontal tab bar at the top of the window
  - Props: `tabs: { id, label }[]`, `activeTab`, `disabled` (boolean, to lock during operations)
  - Emits: `onTabChange(tabId)`

- `LibraryTab.svelte` — replaces the library-related sections of HomeScreen
  - Library path display + change button
  - StatsPanel
  - Action buttons: Re-index, Scan duplicates
  - Inline sub-screens: ReindexScreen, DeduplicationScreen (shown in-tab, replacing the tab content)

- `ImportTab.svelte` — replaces the import-related sections of HomeScreen
  - Local folder selection + "Analyse" button
  - Google Photos section (connect/disconnect + import)
  - Manages the import workflow sub-screens within the tab

- `SettingsTab.svelte` — replaces the settings section of HomeScreen
  - HEIC mode toggle (keep / convert to JPEG, quality slider)

#### Navigation state (App.svelte)

Two levels of state:

```typescript
type Tab = 'library' | 'import' | 'settings'
type LibraryScreen = 'main' | 'reindex' | 'dedup-scan'
type ImportScreen = 'main' | 'google-download' | 'planning' | 'review' | 'executing' | 'result'

let activeTab: Tab = $state('library')
let libraryScreen: LibraryScreen = $state('main')
let importScreen: ImportScreen = $state('main')
```

- Tab switching resets the sub-screen to `'main'` (unless an operation is in progress)
- Tabs are **disabled** (not clickable) while a long-running operation is active (import execution, re-index, Google download) to prevent accidental interruption

#### What happens to HomeScreen

- `HomeScreen.svelte` is **deleted** — its content is split across the 3 tab components
- First-launch flow (no library configured): show a full-screen setup wizard *before* showing tabs, same as today

### Visual layout

```
┌──────────────────────────────────────────┐
│  [Library]  [Import]  [Settings]         │  ← TabBar (persistent)
├──────────────────────────────────────────┤
│                                          │
│  (active tab content)                    │  ← Fills remaining space
│                                          │
│  Sub-screens render here when active     │
│                                          │
└──────────────────────────────────────────┘
```

### Points of attention

- The import workflow (planning → review → execution → result) stays entirely within the Import tab
- "Import more" from ResultScreen returns to the Import tab main view
- Google Photos download → planning → review → ... also stays in Import tab
- The StatsPanel refreshes when switching to the Library tab (re-fetch stats)
- First-launch (no library path) should still show the library setup prompt before tabs are accessible
- No backend changes needed — this is purely a renderer refactor
- No new IPC channels

## Deliverables

- [ ] Create `TabBar.svelte` component
- [ ] Create `LibraryTab.svelte` (extract from HomeScreen)
- [ ] Create `ImportTab.svelte` (extract from HomeScreen)
- [ ] Create `SettingsTab.svelte` (extract from HomeScreen)
- [ ] Refactor `App.svelte` — two-level navigation (activeTab + sub-screen)
- [ ] Delete `HomeScreen.svelte`
- [ ] Verify all existing workflows still work (local import, Google import, re-index, dedup scan)

## Files to change

| File | Change |
|------|--------|
| `src/renderer/src/App.svelte` | Two-level navigation state, render TabBar + active tab |
| `src/renderer/src/screens/HomeScreen.svelte` | **Delete** — content distributed to tabs |
| `src/renderer/src/components/ui/TabBar.svelte` | **New** — tab bar component |
| `src/renderer/src/screens/LibraryTab.svelte` | **New** — library config, stats, reindex, dedup |
| `src/renderer/src/screens/ImportTab.svelte` | **New** — local + Google import workflows |
| `src/renderer/src/screens/SettingsTab.svelte` | **New** — HEIC settings |

## Notes

- This is a frontend-only refactor — no backend, no tests to update (frontend is excluded from 100% coverage requirement)
- Existing sub-screens (PlanningScreen, ReviewScreen, etc.) are reused as-is, just rendered within their parent tab instead of at the App level
