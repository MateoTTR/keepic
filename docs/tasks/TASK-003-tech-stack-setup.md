# TASK-003 — Set Up Electron Project Scaffold

> **Status**: Completed
> **Phase**: 0 — Project Setup & Documentation
> **Session**: [2026-02-21-session-004](../sessions/2026-02-21-session-004.md)

---

## Goal

Bootstrap the Electron application with all tooling required for development, testing, and CI.

## Deliverables

- [x] Scaffold project with `electron-vite` + TypeScript
- [x] Configure renderer framework: **React** (chosen over Svelte)
- [x] Configure test framework: **Vitest** with `@vitest/coverage-v8`
- [x] Set up ESLint (flat config, `@electron-toolkit/eslint-config-ts` via `FlatCompat` bridge)
- [x] Set up Prettier
- [x] Configure `vitest.config.ts` with coverage thresholds (100% non-frontend code)
- [x] Configure `tsconfig.json` / `tsconfig.node.json`
- [x] Add `better-sqlite3` and `sharp` as runtime dependencies
- [x] Set up `.nvmrc` (Node 22)

## Notes

- ESLint `@electron-toolkit/eslint-config-ts` is a legacy-style config; required `FlatCompat` wrapper.
- `better-sqlite3` is a native addon; must be rebuilt with `npm rebuild better-sqlite3` after any Node.js version change.
- `sharp` ships prebuilt binaries; no rebuild needed.
