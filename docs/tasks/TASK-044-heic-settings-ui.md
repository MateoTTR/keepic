# TASK-044 — Add HEIC keep/convert option to settings UI

## Goal

Allow users to toggle HEIC handling mode (keep original vs convert to JPEG) from the home screen.

## Deliverables

- `setHeicConfig()` method on `ConfigManager`
- `handleSetHeicConfig` IPC handler
- `config:set-heic-config` IPC channel + preload binding
- HEIC mode toggle in HomeScreen (segmented button: "Keep original" / "Convert to JPEG")
- Contextual help text explaining each mode

## Design Decisions

- **Inline settings** in HomeScreen (not a separate settings screen) — keeps UI simple for a single toggle
- **Immediate persistence** — change is saved to `config.json` as soon as the user clicks
- **Segmented button** UI pattern — clearer than a checkbox for a binary choice with labels
- JPEG quality fixed at 90% (not exposed in UI) — avoids complexity for a rarely-changed setting

## IPC

| Channel | Direction | Payload | Response |
|---|---|---|---|
| `config:set-heic-config` | renderer → main | `{ heic: { mode, jpegQuality } }` | `AppConfig` |

## Files Changed

- `src/main/config.ts` — `setHeicConfig()` method
- `src/main/ipc/config-handlers.ts` — `handleSetHeicConfig`
- `src/main/index.ts` — IPC registration
- `src/preload/index.ts` — `config.setHeicConfig` binding
- `src/renderer/src/screens/HomeScreen.svelte` — settings section with toggle
- `src/renderer/src/App.svelte` — pass `heicMode` + `onHeicModeChange` to HomeScreen
- `tests/main/config.test.ts` — 3 new tests
- `tests/main/ipc/config-handlers.test.ts` — 3 new tests
