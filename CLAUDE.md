# KeePic — Claude Instructions

## Project Overview

**KeePic** is a cross-platform desktop application (Electron, Windows + macOS) that allows multiple users to import, deduplicate, and organize their **photos and videos** into a shared local library folder. The shared folder is synchronized via a Synology NAS. All media files and metadata are stored locally. There is no cloud backend.

The app is **append-only**: it never modifies or deletes files already in the shared library.

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
| [ADR-001](docs/architecture/adr/ADR-001-desktop-framework.md) | Desktop framework: Electron vs Tauri | **Accepted** — Electron |
| [ADR-002](docs/architecture/adr/ADR-002-local-storage-strategy.md) | Local storage strategy | **Accepted** — Filesystem + SQLite |
| [ADR-003](docs/architecture/adr/ADR-003-google-photos-integration.md) | Google Photos API integration | Proposed |
| [ADR-004](docs/architecture/adr/ADR-004-ui-framework.md) | UI framework: Svelte 5 + Tailwind + shadcn-svelte | **Accepted** |
| [ADR-005](docs/architecture/adr/ADR-005-heic-decoding-strategy.md) | HEIC decoding strategy | **Accepted** — heic-decode (WASM) |

---

## Session Checklist

Before starting any implementation work in a session:

1. Read this file (`CLAUDE.md`)
2. Read [docs/tasks/backlog.md](docs/tasks/backlog.md) — identify the current in-progress or next task
3. Read the relevant ADRs if the task involves an architectural decision
4. Read [docs/specs/specifications.md](docs/specs/specifications.md) if the task involves a feature
5. Check the latest session report in [docs/sessions/](docs/sessions/) for context carried over from the previous session
6. **Before writing any code**: create or update the `docs/tasks/TASK-NNN-*.md` file for the task — define the goal, deliverables, key design decisions, and IPC channels (if any). If the file already exists, read it first.
7. At the end of the session, create a session report and update the backlog (mark task `[x]` and fill in the session column)

---

## General Conventions

### Language
- All code, comments, variable names, and documentation must be in **English**.
- This includes: commit messages, PR titles, PR descriptions, code review comments, and session reports.
- Communication with the user is in **French**.

### Code Style
- TypeScript throughout (main process, renderer, workers)
- To be fully defined during TASK-003 (ESLint + Prettier config)

### File Naming
- ADRs: `ADR-NNN-short-title.md` (zero-padded 3-digit number)
- Tasks: `TASK-NNN-short-title.md` (zero-padded 3-digit number)
- Sessions: `YYYY-MM-DD-session-NNN.md`

### Git — Git Flow

The project follows the **Git Flow** branching model:

| Branch | Purpose |
|---|---|
| `main` | Production-ready code only. Never commit directly. |
| `develop` | Integration branch. All features merge here first. |
| `feature/TASK-NNN-short-desc` | One branch per task, branched from `develop` |
| `release/vX.Y.Z` | Release preparation, branched from `develop` |
| `hotfix/short-desc` | Critical fixes on `main`, merged back to `main` + `develop` |

**Workflow for a task**:
1. Branch from `develop`: `git checkout -b feature/TASK-NNN-short-desc develop`
2. Implement + write tests
3. Once tests pass and coverage is at 100%, **open a Pull Request targeting `develop`** directly — no need to wait for explicit instruction
4. The user reviews and merges the PR themselves; they will inform Claude once merged
5. Squash-merge into `develop`

> ⚠ **PRs must always target `develop`**, never `main`. Double-check the base branch in the `gh pr create` command. `main` is reserved for releases only.

**Commit message format**: English, imperative mood (`Add`, `Fix`, `Update`...)

### Testing

- **Coverage target**: 100% for all non-frontend code (main process, workers, shared utilities)
- **Philosophy**: tests must exercise the code that runs in production — no mocks of internal modules; only mock external boundaries (filesystem, network, OS APIs)
- **Framework**: to be confirmed during TASK-003 (Jest or Vitest)
- Frontend (renderer) is excluded from the 100% coverage requirement

### CI/CD (GitHub Actions)

Every pull request and push to `develop` / `main` triggers:
1. **Lint** — ESLint + TypeScript type check
2. **Tests** — full test suite with coverage report
3. **Coverage gate** — PR fails if non-frontend coverage drops below 100%

Release builds (Windows installer + macOS DMG) are triggered on `main` tags.

---

## Key Constraints

- **Append-only**: the app never modifies or deletes files already in the shared library folder
- **Multi-user safe**: multiple users can point the app at the same shared folder; each has their own local index
- **Privacy first**: no telemetry, no external network calls except Google Photos import (explicit user action)
- **Offline first**: the app must be fully functional without internet
- **Local storage only**: all photos and metadata stay on the user's machine
- **Non-destructive**: source files are never modified; staging via temp folder before library write

---

## Library Folder Naming Convention

Only folders matching `\d{4}` at the root of the library are considered (e.g., `2025`, `2026`). All other folders are ignored.

Inside a year folder, two sub-folder types are valid:
- **Monthly**: `YYYY.MM` (e.g., `2025.04`)
- **Event**: `YYYY.MM.DD[-[MM.]DD].Name` (e.g., `2025.04.15-19.Londres`)

New imports are always placed in the **monthly folder** for the photo's capture date. Event folders are created and populated manually by users in V1.

---

## Open Questions / Decisions Pending

- [ ] UI framework: React vs Svelte (decide during TASK-003)
- [ ] HEIC conversion: user-configurable JPEG quality or fixed?
- [ ] Re-index trigger: on startup automatically, or manual only?
- [x] Google Photos date filter: **N/A** — Picker API replaces date-based filtering; the user selects photos directly in Google's UI (no programmatic date filter needed).
- [ ] If two users import the same photo: detected on re-index and reported?
