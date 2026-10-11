# TASK-073-fix — v0.5.9 Windows release fails: native rebuild during packaging

## Context

The first `v0.5.9` release run failed on Windows. macOS built fine, so no GitHub Release was created:

```
• rebuilding native dependencies  dependencies=@keepic/heif-decode@1.0.0, better-sqlite3@11.10.0, keytar@7.9.0
npm error command C:\Windows\system32\cmd.exe /d /s /c node-gyp-build || node-gyp rebuild
npm error gyp info using node-gyp@10.1.0
npm error gyp ERR! find VS unknown version "undefined" found at "C:\Program Files\Microsoft Visual Studio\18\Enterprise"
npm error gyp ERR! stack Error: Could not find any Visual Studio installation to use
```

The HEIF deps cache (TASK-072) worked as intended: both jobs logged a cache hit and skipped the deps build.

## Root Cause

1. **Runner toolchain change**: since June 2026, `windows-latest` is Windows Server 2025 with **Visual Studio 2026 (18.x)**. The node-gyp bundled with Node 20's npm (10.1.0) cannot detect VS 2026.
2. **Unexpected rebuild during packaging**: `release.yml` builds the addon statically first (`node-gyp rebuild --heif_static=true`). electron-builder then runs `npm rebuild @keepic/heif-decode`, which runs the package's install script, `node-gyp-build || node-gyp rebuild`.
   - On macOS, `node-gyp-build` accepts the existing static binary and nothing is rebuilt.
   - On Windows, `node-gyp-build` rejected it and fell back to a source rebuild with npm's node-gyp 10.1.0. That rebuild failed on VS detection. Even if it had found VS, it would have run **without** `--heif_static` (dynamic `-lheif`, no headers on Windows).
   - The exact reason `node-gyp-build` rejected the binary in electron-builder's environment could not be determined: the `node-gyp-build-test` output is only printed in verbose mode. The binary itself is fine. A `build-heif-addon.yml` run on `develop` (VS 2026, Node 20) built it and passed the HEIC smoke test, including the Apple HDR sample.
3. **Not caught earlier**: the release pipeline only runs on tags, so packaging problems show up only when a release is published.

### Related finding: macOS deployment target

`macos-latest` is now macOS 26. Because `build-deps.sh` set no deployment target, libheif/libde265 were compiled for macOS 26.0, while the addon links with `MACOSX_DEPLOYMENT_TARGET=12.0`. The linker warned: `object file … was built for newer 'macOS' version (26.0) than being linked (12.0)`.

The v0.5.9 DMG binary was inspected:
- Load commands: only `libSystem` and `libc++`; the libheif code is embedded.
- Mach-O `minos` is 12.0.
- No obviously newer-only libc++ imports.

So it is probably fine, but it depends on the runner image.

## Fix

| Change | Why |
|---|---|
| `node-gyp@12.4.0` as a root devDependency | Supports VS 2026. `node-gyp-build` resolves it via `require('node-gyp/package.json')`, and the `\|\| node-gyp rebuild` fallback finds it first on `PATH`. Also pins the version used for the explicit addon build, which previously came from whatever `npx` fetched. |
| Root script `build:heif-static` (`node-gyp rebuild --heif_static=true --directory=packages/heif-decode`) | Explicit static build with the pinned node-gyp. |
| `npm_config_heif_static: 'true'` on the packaging steps | node-gyp turns `npm_config_*` env vars into gyp variables. Any rebuild electron-builder triggers is then static too (verified locally: `config.gypi` gets `"heif_static": "true"`). |
| "Verify packaged HEIF addon" step after packaging | Windows: `dumpbin /dependents`. macOS: `otool -L`. Fails if the packaged `heif_decode.node` depends on a libheif/libde265 DLL or dylib. Then runs the HEIC smoke test on the `build/Release` binary that was packaged. |
| `workflow_dispatch` on `release.yml`; `create-release` only for `refs/tags/v*` | Dry-run the whole release pipeline on a branch before tagging. |
| `-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0` in `build-deps.sh` (macOS only) | Static libs target the same minimum macOS as the addon. This changes the cache key, so caches are rebuilt once. |

## Verification

- Local (Linux, Node 22): `npm run build:heif-static` → node-gyp 12.4.0, static binary, smoke test passes. `npm_config_heif_static=true node-gyp rebuild` (no CLI flag) → static binary.
- Lint, typecheck and tests on CI.
- **Dry run of `release.yml` via `workflow_dispatch` on this branch**: both installers are built and both "Verify packaged HEIF addon" steps pass.

## Files Changed

| File | Change |
|---|---|
| `package.json`, `package-lock.json` | `node-gyp` 12.4.0 devDependency, `build:heif-static` script |
| `.github/workflows/release.yml` | Pinned addon build, `npm_config_heif_static`, verification steps, `workflow_dispatch` dry run |
| `packages/heif-decode/scripts/build-deps.sh` | macOS deployment target 12.0 |
| `docs/tasks/TASK-073-fix-release-native-rebuild.md` | This file |
| `docs/tasks/backlog.md` | TASK-071/072 completed, TASK-073 added, Electron upgrade renumbered to TASK-074 |
