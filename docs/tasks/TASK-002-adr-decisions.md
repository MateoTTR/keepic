# TASK-002 — Refine Specifications and Close ADR-001 / ADR-002

> **Status**: Completed
> **Phase**: 0 — Project Setup & Documentation
> **Session**: [2026-02-21-session-002](../sessions/2026-02-21-session-002.md)

---

## Goal

Refine the initial specifications based on owner input and close the two blocking architectural decisions (desktop framework and storage strategy).

## Deliverables

- [x] Update `docs/specs/specifications.md` to v0.2
  - Cross-platform: Windows 10/11 + macOS
  - Library folder = raw photos only (Synology Drive compatible)
  - App data stored in OS standard directory
  - Google Photos: date-based filter for incremental import
  - iPhone Live Photos: HEIC kept, MOV discarded, optional HEIC→JPEG conversion
  - Browse/view feature deferred to a future version
  - WhatsApp/Signal: folder scan confirmed (no API)
- [x] Close ADR-001 → **Electron** chosen (key driver: `sharp` for cross-platform HEIC)
- [x] Close ADR-002 → **Filesystem + SQLite** confirmed; storage layout finalized (library vs OS app data)
- [x] Update `docs/architecture/architecture.md` to v0.2
- [x] Update `docs/tasks/backlog.md` (TASK-008 renamed, Phase 3 deferred)
- [x] Write session report `2026-02-21-session-002.md`

## Notes

- The browse/view deferral significantly simplifies v1 scope
- UI framework (React vs Svelte) remains open — to be decided at start of TASK-003
