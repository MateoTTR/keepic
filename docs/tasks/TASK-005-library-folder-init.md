# TASK-005 — Implement Library Folder Initialization and First-Launch Config

> **Status**: Completed
> **Phase**: 1 — Core Foundation
> **Session**: [2026-02-21-session-005](../sessions/2026-02-21-session-005.md)

---

## Goal

Allow the user to configure the shared library folder path on first launch and persist the configuration. Wire up the database initialization when the path is set.

## Deliverables

- [x] `src/main/config.ts` — `ConfigManager` (read/write `config.json` in `userData`, merge-with-defaults)
- [x] `src/main/ipc/config-handlers.ts` — `handleGetConfig`, `validateLibraryPath`, `handleSelectLibraryFolder`
- [x] `src/main/index.ts` — `ipcMain.handle` wiring + `KeePicDatabase` init on startup and after folder selection
- [x] `src/preload/index.ts` + `index.d.ts` — `window.keepic.config.{get, selectLibraryFolder}` via `contextBridge`
- [x] `src/shared/types/index.ts` — `SelectLibraryFolderResult` type
- [x] `tests/main/config.test.ts` — 26 tests (ConfigManager + mergeWithDefaults)
- [x] `tests/main/ipc/config-handlers.test.ts` — 13 tests (handler logic)

## IPC Channels

| Channel | Direction | Description |
|---|---|---|
| `config:get` | renderer → main | Returns current `AppConfig` |
| `config:select-library-folder` | renderer → main | Opens OS folder picker, validates, saves path |

## Notes

- Config stored in `userData/config.json` — never in the shared library folder.
- `validateLibraryPath`: checks existence + isDirectory. Does not validate year-folder structure (that's TASK-006).
- Merge-with-defaults: unknown or wrongly-typed fields in config.json fall back to defaults silently.
