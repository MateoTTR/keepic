# TASK-075-fix — Windows addon built with VS 2026 fails DLL initialization on some machines

## Context

After TASK-073, a second `release.yml` dry run (on `release/v0.5.9`) failed at the new "Verify packaged HEIF addon" step on Windows:

```
Error: A dynamic link library (DLL) initialization routine failed.
\\?\D:\a\keepic\keepic\packages\heif-decode\build\Release\heif_decode.node
```

The first dry run (TASK-073 branch) had passed with the same code. The binary was the same too: identical section sizes and dependencies (`KERNEL32.dll` plus delay-loaded `node.exe`). The failure therefore depends on the machine that loads the binary. This also explains the original v0.5.9 failure. `node-gyp-build`'s load test rejected the static addon, so electron-builder fell back to a source rebuild.

## Investigation

A temporary workflow (branch `diag/heif-windows-load`, deleted afterwards) did the following:

1. Built `heif_decode.node` twice from the same sources:
   - on `windows-latest` (VS 2026, MSVC 14.51)
   - on `windows-2022` (VS 2022, MSVC 14.44)
2. Loaded both binaries 3 times each on 8 separate `windows-latest` runners, decoding the Apple HDR sample each time.

| Binary | Successful loads |
|---|---|
| VS 2022 (MSVC 14.44) | **24 / 24** (all 8 machines) |
| VS 2026 (MSVC 14.51) | 18 / 24: **2 of 8 machines fail on every attempt** |

The failing machines could not be told apart from passing ones. They had the same CPU (AMD EPYC 7763), the same Windows Server 2025 build (10.0.26100), the same runner image version (20260901.588) and the same system mitigation defaults.

The failure happens during DLL initialization, i.e. static CRT (`/MT`) and C++ static initializers. A VS 2026 build could therefore fail the same way on some end-user machines.

## Fix

Build the Windows release with **VS 2022** by pinning the runner to `windows-2022`. This is the toolchain v0.5.8 shipped with. GitHub keeps this image and recommends it for projects that still need VS 2022.

| File | Change |
|---|---|
| `.github/workflows/release.yml` | `build-windows` runs on `windows-2022`. Cache key `heif-deps-windows-2022-<hash>`. |
| `.github/workflows/cache-heif-deps.yml` | `cache-windows` runs on `windows-2022`, same key. |
| `.github/workflows/build-heif-addon.yml` | Windows matrix entry on `windows-2022`. Cache key now includes `matrix.os`. |

The toolchain is part of the cache key. Static libs built by MSVC 14.51 must not be linked by MSVC 14.44, because an older linker cannot consume newer objects.

The TASK-073 safeguards stay in place:
- pinned node-gyp 12.4.0
- `npm_config_heif_static` on packaging
- verification of the packaged addon (dumpbin + HEIC smoke test)

## Follow-up

- `windows-2022` will eventually be retired. Before then, find the root cause of the VS 2026 DLL init failure. Leads: dynamic CRT (`/MD`), a newer MSVC 14.5x update, or bisecting which static initializer fails (libheif / libde265 / CRT). This should fold into TASK-074 (Electron/toolchain upgrade).
- The smoke test only samples the machine it runs on. A VS 2026 build passed it on 6 of 8 machines in the experiment, so a single green run does not prove a toolchain is safe.

## Verification

- Diagnostic matrix above.
- `release.yml` dry run on this branch: Windows job on `windows-2022`, packaged-addon verification and HEIC smoke test pass.

## Files Changed

| File | Change |
|---|---|
| `.github/workflows/release.yml` | `windows-2022` + toolchain-specific cache key |
| `.github/workflows/cache-heif-deps.yml` | `windows-2022` + toolchain-specific cache key |
| `.github/workflows/build-heif-addon.yml` | `windows-2022` + `matrix.os` in cache key |
| `docs/tasks/TASK-075-fix-windows-vs2022-toolchain.md` | This file |
| `docs/tasks/backlog.md` | TASK-073 completed, TASK-075 added |
