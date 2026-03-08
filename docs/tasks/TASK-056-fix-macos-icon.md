# TASK-056-fix — Fix macOS icon (invalid ICNS file)

## Context

GitHub issue #66: KeePic v0.3.4 does not run on macOS. Two problems reported:

1. **App won't launch** — macOS Gatekeeper blocks unsigned apps with "damaged" error message. This is expected since the app is not code-signed. Workarounds provided in issue comment (right-click > Open, System Settings, or `xattr -cr`).
2. **Blurry icon** — `resources/icon.icns` was a 16x16 PNG file (973 bytes) instead of a proper macOS ICNS icon bundle. Introduced in commit `774a882` (TASK-055).

## Goal

Regenerate `resources/icon.icns` as a proper macOS icon file from the 512x512 PNG source.

## Deliverables

- [x] Replace `resources/icon.icns` with a valid ICNS file (multi-resolution, `ic07` type)
- [x] Regenerate `resources/icon.ico` for consistency (same source)
- [x] Verify all icon files are correct format

## Files Changed

| File | Change |
|------|--------|
| `resources/icon.icns` | Regenerated as proper ICNS (387 KB, `ic07` type) |
| `resources/icon.ico` | Regenerated for consistency |

## Notes

- Generated using `electron-icon-builder --flatten` from `resources/icon.png` (512x512)
- No Apple Developer certificate planned — app will remain unsigned. Workarounds documented in issue #66.
