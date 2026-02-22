# ADR-004 — UI Framework: Svelte 5 + Tailwind CSS + shadcn-svelte

> **Status**: Accepted
> **Date**: 2026-02-21
> **Deciders**: Project owner

---

## Context

KeePic's renderer process needs a UI framework to implement the application's screens:
- Import wizard (source folder selection, planning review, execution progress, result summary)
- Deduplication review (inline expansion with source vs. library comparison)
- First-launch configuration (library folder path, HEIC conversion settings)
- Library statistics view

The UI is intentionally minimal in v1 — there is no in-app photo browser or gallery. The renderer is a single Electron window running a small number of screens. The electron-vite build toolchain is already in place (see ADR-001).

The candidate UI approaches are: **React**, **Svelte**, **Vue**, or **vanilla TypeScript**.

---

## Decision Drivers

1. **Minimal bundle footprint** — the renderer ships inside the Electron distributable; no need for a heavy runtime
2. **Simple, readable component syntax** — a single developer must maintain the codebase long-term
3. **TypeScript support** — full type safety in templates and component props
4. **Integration with electron-vite** — official first-class plugin support
5. **Accessible UI components** — need ready-made Button, Dialog, Table, Badge, Progress without building from scratch
6. **No over-engineering** — a desktop utility with ~5 screens does not warrant a complex state management solution

---

## Considered Options

### Option A — React 19 + Tailwind CSS + shadcn/ui

**Description**: The electron-vite scaffold ships with `@vitejs/plugin-react`. shadcn/ui provides accessible, composable components. State is managed with React hooks or a lightweight store (Zustand).

**Pros**:
- Largest ecosystem; most examples and community resources
- `@vitejs/plugin-react` already in the scaffold (no setup cost)
- shadcn/ui is mature and feature-complete

**Cons**:
- React runtime (~45 KB gzipped) is overhead for a minimal UI
- More boilerplate: `useState`, `useEffect`, `useCallback`, prop drilling vs. reactive stores
- JSX syntax adds noise compared to single-file components

---

### Option B — Svelte 5 + Tailwind CSS + shadcn-svelte

**Description**: Svelte compiles components to vanilla JavaScript at build time — no runtime framework ships to the browser. Svelte 5 introduces runes (`$state`, `$derived`, `$effect`) for reactive state. shadcn-svelte is a faithful port of shadcn/ui to Svelte, using the same accessible primitives (bits-ui / melt-ui).

**Pros**:
- Zero runtime overhead — compiled output is plain JavaScript
- Minimal boilerplate: single-file components (`.svelte`) with `<script>`, `<markup>`, `<style>` in one file
- Svelte 5 runes are intuitive for developers coming from other reactive frameworks
- `@sveltejs/vite-plugin-svelte` is a first-class electron-vite integration
- shadcn-svelte components are copied into the project — no version lock-in, full control

**Cons**:
- Smaller community than React; fewer Electron-specific examples
- Svelte 5 is relatively recent (stable since late 2024); patterns still maturing
- Migration required from the React scaffold (App.tsx → App.svelte, `main.tsx` → `main.ts`)

---

### Option C — Vue 3 + Tailwind CSS + shadcn-vue

**Description**: Vue 3 with the Composition API and single-file components.

**Pros**:
- Single-file components similar to Svelte
- Large ecosystem

**Cons**:
- Less commonly used in Electron projects
- Vue runtime is smaller than React but still heavier than Svelte's compiled output
- No prior familiarity with Vue in this project; adds onboarding cost

---

### Option D — Vanilla TypeScript (no framework)

**Description**: Write the renderer UI with plain DOM manipulation and TypeScript.

**Pros**:
- Zero dependencies
- Maximum control

**Cons**:
- Requires building all UI primitives from scratch (dialogs, progress bars, tables)
- Not maintainable as the UI grows beyond a few static pages
- No component model — hard to share and reuse UI logic

---

## Decision

**Chosen option: Option B — Svelte 5 + Tailwind CSS + shadcn-svelte**

**Rationale**:

For a desktop utility with ~5 screens, Svelte's compile-time approach produces the leanest possible renderer output with the simplest component authoring experience. The single-file component model (`.svelte`) keeps markup, logic, and scoped styles co-located without JSX overhead.

Svelte 5 runes (`$state`, `$derived`, `$effect`) provide a clear, readable reactive model that maps directly to KeePic's UI needs: a few reactive stores tracking current screen, import plan, and progress — no complex state management required.

shadcn-svelte provides production-ready accessible components (Button, Dialog, Table, Badge, Progress, Separator) that are copied directly into the project, giving full control without a package dependency on a component library.

| Factor | React 19 | Svelte 5 | Vue 3 |
|---|---|---|---|
| Runtime size | ~45 KB | ~0 (compiled) | ~22 KB |
| Boilerplate | High | Low | Medium |
| TS in templates | Good (JSX) | Excellent (`lang="ts"`) | Good |
| electron-vite plugin | Official | Official | Official |
| Component library | shadcn/ui (mature) | shadcn-svelte (active) | shadcn-vue (active) |
| Ecosystem size | ✅ Very large | ⚠️ Smaller | Medium |

The smaller Svelte ecosystem is an acceptable trade-off given the limited scope of the UI. All IPC communication is handled by the TypeScript main process; the renderer is a thin presentation layer.

---

## Consequences

### Setup changes

- Replace `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react` with `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check`
- Replace `App.tsx` + `main.tsx` with `App.svelte` + `main.ts`
- Update `electron.vite.config.ts` to use the Svelte plugin
- Add `tailwindcss` and `postcss` to the renderer build pipeline
- Add `svelte.config.js` for the Svelte preprocessor configuration

### Component library

shadcn-svelte components are not installed as a package. They are initialized via CLI (`npx shadcn-svelte@next init`) and copied into `src/renderer/src/components/ui/`. Each component is a `.svelte` file under the project's control.

### Styling

Tailwind CSS v4 utility classes are used directly in `.svelte` templates. No global CSS framework (Bootstrap, Material) is introduced.

### Coverage

The 100% coverage requirement applies to main process, workers, and shared utilities only. Renderer (`.svelte`) components are excluded from coverage (consistent with the existing policy).

### Positive
- Lightest possible renderer bundle for an Electron app
- Single-file components keep UI code concise and co-located
- shadcn-svelte's accessible primitives eliminate the need to implement dialogs, badges, and progress indicators from scratch

### Negative / Trade-offs
- Migration from the React scaffold is required before starting TASK-011
- Svelte 5 runes (`$state`) differ from Svelte 4 stores — community examples may target Svelte 4

### Neutral
- ESLint configuration is extended with `eslint-plugin-svelte` for `.svelte` file linting
- The `tsconfig` for the renderer is updated to include Svelte type checking via `svelte-check`

---

## References

- [Svelte 5 documentation](https://svelte.dev/docs)
- [electron-vite + Svelte template](https://electron-vite.org/guide/getting-started.html)
- [@sveltejs/vite-plugin-svelte](https://github.com/sveltejs/vite-plugin-svelte)
- [shadcn-svelte](https://www.shadcn-svelte.com/)
- [Tailwind CSS](https://tailwindcss.com/)
