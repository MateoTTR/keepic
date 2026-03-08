# TASK-057-fix — Fix sharp native module loading on macOS

## Context

GitHub issue #66: after resolving the Gatekeeper block (`xattr -cr`), the app crashes on launch with:

```
Error: Could not load the "sharp" module using the darwin-arm64 runtime
ERR_DLOPEN_FAILED: dlopen(...): Library not loaded: @rpath/libvips-cpp.42.dylib
```

## Root Cause

Sharp 0.33.x splits its native binaries into separate optional packages under the `@img` scope:
- `@img/sharp-darwin-arm64` — the `.node` native binding
- `@img/sharp-libvips-darwin-arm64` — the `libvips-cpp.42.dylib` shared library

The electron-builder `asarUnpack` config included `node_modules/sharp/**` but NOT `node_modules/@img/**`. As a result:
- The `.node` file was packed inside the asar archive
- Electron extracted it to a temp directory at runtime
- From the temp directory, `@rpath/libvips-cpp.42.dylib` could not be resolved because `@img/sharp-libvips-darwin-arm64` was also inside the asar

On Windows this wasn't an issue because sharp's Windows `.node` binding uses a different mechanism for loading libvips (DLL in same directory, standard Windows DLL search path).

## Fix

Add `node_modules/@img/**` to `asarUnpack` in `package.json`. This ensures both the native binding and the libvips shared library are unpacked alongside the asar, preserving the relative path structure that `@rpath` expects.

## Deliverables

- [x] Add `node_modules/@img/**` to `asarUnpack` in `package.json`

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `node_modules/@img/**` to `asarUnpack` |
