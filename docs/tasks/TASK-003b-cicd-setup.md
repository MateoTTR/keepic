# TASK-003b — Set Up GitHub Actions CI/CD

> **Status**: Completed
> **Phase**: 0 — Project Setup & Documentation
> **Session**: [2026-02-21-session-004](../sessions/2026-02-21-session-004.md)

---

## Goal

Configure GitHub Actions to enforce code quality on every PR and push to `develop` / `main`, and produce release builds on `main` tags.

## Deliverables

- [x] CI workflow: lint → type-check → tests → coverage gate (100%)
- [x] Triggers: push to `develop`, push to `main`, pull requests
- [x] Release workflow: `electron-builder` on `main` tags → Windows (NSIS) + macOS (DMG) artifacts

## Notes

- Coverage gate enforced via Vitest `thresholds` in `vitest.config.ts` (fails if below 100%).
- Release workflow uploads installers as GitHub Release assets.
