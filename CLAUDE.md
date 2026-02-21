# KeePic — Claude Instructions

## Project Overview

**KeePic** is a desktop application (Electron or Tauri — see ADR-001) that allows the user to import, deduplicate, organize, and browse their personal photo library. All photos and metadata are stored locally. There is no cloud backend.

## How to Use This File

At the start of each session, read this file entirely, then follow the "Session Checklist" below before starting any work. Navigate to relevant documentation sections based on the task at hand.

---

## Documentation Index

| Document | Path | Purpose |
|---|---|---|
| Specifications | [docs/specs/specifications.md](docs/specs/specifications.md) | Functional & non-functional requirements |
| Architecture overview | [docs/architecture/architecture.md](docs/architecture/architecture.md) | System design, components, ADR list |
| ADR template | [docs/architecture/adr/ADR-000-template.md](docs/architecture/adr/ADR-000-template.md) | Template for new ADRs |
| Task backlog | [docs/tasks/backlog.md](docs/tasks/backlog.md) | Numbered task list with status |
| Session reports | [docs/sessions/](docs/sessions/) | One file per session, sorted by date |

### Architecture Decision Records (ADRs)

| ID | Title | Status |
|---|---|---|
| [ADR-001](docs/architecture/adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | Proposed |
| [ADR-002](docs/architecture/adr/ADR-002-local-storage-strategy.md) | Local storage strategy | Proposed |
| [ADR-003](docs/architecture/adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed |

---

## Session Checklist

Before starting any implementation work in a session:

1. Read this file (`CLAUDE.md`)
2. Read [docs/tasks/backlog.md](docs/tasks/backlog.md) — identify the current in-progress or next task
3. Read the relevant ADRs if the task involves an architectural decision
4. Read [docs/specs/specifications.md](docs/specs/specifications.md) if the task involves a feature
5. Check the latest session report in [docs/sessions/](docs/sessions/) for context carried over from the previous session
6. At the end of the session, create a session report and update the backlog

---

## General Conventions

### Language
- All code, comments, variable names, and documentation must be in **English**.
- Communication with the user is in **French**.

### Code style
- To be defined once the tech stack is finalized (see ADR-001).

### File naming
- ADRs: `ADR-NNN-short-title.md` (zero-padded 3-digit number)
- Tasks: `TASK-NNN-short-title.md` (zero-padded 3-digit number)
- Sessions: `YYYY-MM-DD-session-NNN.md`

### Git
- Commit messages in English, imperative mood (`Add`, `Fix`, `Update`...)
- One logical change per commit

---

## Key Constraints

- **Privacy first**: no telemetry, no external network calls except for Google Photos import (explicit user action)
- **Offline first**: the app must be fully functional without internet
- **Local storage only**: all photos and metadata stay on the user's machine
- **Non-destructive**: the app never deletes or modifies original photos without explicit user confirmation

---

## Open Questions / Decisions Pending

- [ ] Confirm WhatsApp / Signal import scope (folder scan only, or deeper integration?)
- [ ] Desktop framework choice: Electron vs Tauri (see ADR-001)
- [ ] UI framework (React, Vue, Svelte...)
- [ ] Target OS: Windows only, or also macOS / Linux?
