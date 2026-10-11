# TASK-071-fix — macOS XProtect blocks KeePic as malware (Electron 31.7.7)

## Context

On macOS, launching KeePic v0.5.8 now shows:

> **Malware Blocked and Moved to Trash** — "KeePic.app" was not opened because it contains malware. Your Mac was not harmed.

The app is moved to the Trash. The usual workaround for the unsigned build (`xattr -cr /Applications/KeePic.app`) no longer helps.

This is a different failure from the "app is damaged" Gatekeeper message (TASK-056/057). That message is a quarantine/signature check. This one is an **XProtect content match**.

## Root Cause

An Apple XProtect signature update (definitions ~5358, around 2026-05-29) falsely flags the **Electron 31.7.7** binary as malware. Every unsigned app built on that exact Electron prebuilt is killed on launch and moved to the Trash.

- KeePic declares `"electron": "^31.0.0"`. That range resolves to **31.7.7**, the last 31.x release, so v0.5.8 ships the flagged binary.
- The detection matches file contents, not the code signature. Re-signing ad hoc (`codesign --sign - --force --deep`) changes the cdhash, but the app is still trashed on the next launch.
- Other projects hit the same false positive:
  - [asivery/ElectronWMD#61](https://github.com/asivery/ElectronWMD/issues/61) — fixed by moving to Electron 44; the reporter confirmed it works on macOS 27.
  - [a-ch3n/holobooth@63917d2](https://github.com/a-ch3n/holobooth/commit/63917d2) — moved from 31.7.7 to 32.3.3.

## Fix

Bump Electron from `^31.0.0` (31.7.7) to `^32.0.0` (resolves to 32.3.3). This ships a different binary that the XProtect rule does not match.

This is a deliberately minimal hotfix so a release can go out quickly. Moving to a supported Electron major (44.x, plus electron-builder 26 and better-sqlite3 13) is tracked as a separate follow-up task.

### Electron 32 breaking changes review

All three items in Electron's [32.0 breaking changes](https://github.com/electron/electron/blob/main/docs/breaking-changes.md) were checked against the codebase:

| Change | Impact on KeePic |
|---|---|
| Removed `File.path` | None. KeePic has no drag-and-drop or `<input type=file>`; all paths come from `dialog.showOpenDialog` via IPC. |
| Deprecated `WebContents` navigation methods (`goBack`, `canGoBack`, …) | None. Not used. |
| `userData/databases` directory deleted on first run | None. The SQLite index lives at `userData/index.db`, not in `databases/`. |

### Native modules

- `better-sqlite3` 11.10.0 supports Electron 32. electron-builder rebuilds it for the Electron ABI during packaging (`npmRebuild: true`).
- `sharp`, `keytar` and `@keepic/heif-decode` are N-API addons, so they are ABI-stable across Electron versions.

## Verification

- Lint, typecheck and the full test suite with coverage pass. The tests run under Node, not Electron, so they cannot catch a runtime problem specific to Electron.
- Manual check: run the v0.5.9 release build on macOS (the machine that currently blocks v0.5.8) and on Windows.

## Files Changed

| File | Change |
|---|---|
| `package.json` | `electron` `^31.0.0` → `^32.0.0` |
| `package-lock.json` | `electron` 31.7.7 → 32.3.3 (edited by hand, see note below) |
| `.github/workflows/ci.yml` | `apt-get update` before installing system deps (same change as TASK-072, so CI can run on this PR) |
| `docs/tasks/TASK-071-fix-electron-xprotect.md` | This file |
| `docs/tasks/backlog.md` | Add TASK-071 |

> **Lockfile note**: running `npm install` with npm 11 (Node 24) pruned an optional peer entry (`svelte-check/node_modules/picomatch`) and re-sorted dependencies. npm 10 in CI (Node 20) then rejected the lockfile as out of sync (`npm ci` EUSAGE). The lockfile was rebuilt from `develop` with only the `electron` spec and resolved entry changed (integrity checked against the registry). The new entry declares the same dependencies as 31.7.7.
