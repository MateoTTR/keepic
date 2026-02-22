# TASK-022 — Configure electron-builder for Windows (NSIS) + macOS (DMG)

## Goal

Produce working installers for Windows (`.exe` via NSIS) and macOS (`.dmg`) by completing the electron-builder configuration: add proper icon assets, fix native module handling, and verify the build pipeline end-to-end.

---

## What is already implemented (do not re-implement)

| Element | Location | Status |
|---|---|---|
| Basic `build` config (appId, productName, win/mac targets) | `package.json` | Done |
| `package:win` + `package:mac` npm scripts | `package.json` | Done |
| CI/CD release workflow (triggered on `v*.*.*` tags, parallel Win + macOS builds, GitHub Release) | `.github/workflows/release.yml` | Done |

---

## Key problem: native modules

The app uses three native Node.js addons that are compiled for the system Node binary at `npm install` time. They **must be rebuilt for the packaged Electron binary** before `electron-builder` can bundle them:

| Package | Why native |
|---|---|
| `better-sqlite3` | C++ SQLite binding |
| `keytar` | OS keychain (libsecret / Keychain / Credential Manager) |
| `sharp` | libvips image processing |

Without this step, the packaged app crashes on startup with `NODE_MODULE_VERSION` mismatch errors.

### Fix: `postinstall` script

Add to `package.json` `scripts`:
```json
"postinstall": "electron-builder install-app-deps"
```

This runs `electron-builder install-app-deps` after every `npm install`, which rebuilds native modules for the Electron version declared in `devDependencies`. It is the standard solution documented by electron-builder.

### Fix: `asarUnpack` for native `.node` files

Native addons (`.node` files) cannot be loaded from inside an asar archive. electron-builder must unpack them alongside the archive. Add to the `build` section in `package.json`:

```json
"asarUnpack": [
  "node_modules/better-sqlite3/**",
  "node_modules/keytar/**",
  "node_modules/sharp/**"
]
```

---

## Icon assets

The existing `build` config references icons that do not exist yet:
- `resources/icon.ico` (Windows)
- `resources/icon.icns` (macOS)

### Requirements

| File | Format | Minimum size | Notes |
|---|---|---|---|
| `resources/icon.png` | PNG | 512×512 | Source file — used to generate the two below |
| `resources/icon.ico` | ICO | 256×256 embedded | Multi-size ICO (16, 32, 48, 64, 128, 256 px) |
| `resources/icon.icns` | ICNS | 512×512 embedded | Multi-size ICNS |

### Generation approach

For v1, a simple placeholder is sufficient. Use `sharp` (already installed) to generate placeholder icons from a solid colour PNG.

**Script** — run once, commit the outputs:

```typescript
// scripts/generate-icons.ts
import sharp from 'sharp'
import { mkdirSync } from 'fs'

mkdirSync('resources', { recursive: true })

// Base PNG: 512×512, navy background, white "K" letter
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 30, g: 58, b: 138, alpha: 1 } // tailwind indigo-900
  }
})
  .png()
  .toFile('resources/icon.png')

console.log('Generated resources/icon.png')
console.log('→ Convert to .ico and .icns with an online tool or electron-icon-builder')
```

**Practical note for .ico and .icns:**
`sharp` does not natively output ICO or ICNS. Use one of:
- **Online**: [icoconvert.com](https://icoconvert.com) / [cloudconvert.com](https://cloudconvert.com) — upload `icon.png`, download `icon.ico` / `icon.icns`
- **CLI**: `electron-icon-builder` npm package (`npx electron-icon-builder --input=resources/icon.png --output=resources`)
- **macOS only**: `iconutil` to build ICNS from an `.iconset` folder

For CI (Linux runners), `electron-icon-builder` is the most portable option. Add it as a dev dependency if automated generation is needed.

---

## `package.json` — complete `build` section after changes

```json
"scripts": {
  "postinstall": "electron-builder install-app-deps",
  ...existing scripts...
},
"build": {
  "appId": "com.keepic.app",
  "productName": "KeePic",
  "directories": {
    "output": "dist-electron"
  },
  "asarUnpack": [
    "node_modules/better-sqlite3/**",
    "node_modules/keytar/**",
    "node_modules/sharp/**"
  ],
  "win": {
    "target": "nsis",
    "icon": "resources/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "resources/icon.icns",
    "category": "public.app-category.photography"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

---

## `author` field in `package.json`

Currently empty. Fill in before releasing:
```json
"author": "MateoTTR"
```

---

## Deliverables

| File | Action |
|---|---|
| `resources/icon.png` | New — 512×512 source PNG |
| `resources/icon.ico` | New — Windows multi-size ICO |
| `resources/icon.icns` | New — macOS multi-size ICNS |
| `package.json` | Update — `postinstall` script + `asarUnpack` + `author` field |

No new source code. No tests (packaging config only — excluded from coverage).

---

## Verification

### Local build test (run on the target OS)

```bash
# Windows (run on a Windows machine or windows-latest runner)
npm install          # triggers postinstall → electron-builder install-app-deps
npm run package:win  # → dist-electron/KeePic Setup 0.1.0.exe

# macOS (run on a macOS machine or macos-latest runner)
npm install
npm run package:mac  # → dist-electron/KeePic-0.1.0.dmg
```

### Smoke test checklist (manual)

- [ ] Installer launches without OS errors (SmartScreen warning is expected on unsigned Windows builds)
- [ ] App window opens and shows the home screen
- [ ] Library folder can be configured (config.json written to userData)
- [ ] Database opens without `NODE_MODULE_VERSION` crash (validates `better-sqlite3` rebuild)
- [ ] Google Photos "Connect" button triggers OAuth flow (validates `keytar` rebuild)
- [ ] Import pipeline processes a HEIC file (validates `sharp` rebuild)

---

## Release workflow (already implemented)

The `.github/workflows/release.yml` is already fully functional. To trigger a release:

```bash
git checkout main
git tag v0.1.0
git push origin v0.1.0
```

This triggers parallel Windows + macOS builds and creates a GitHub Release with both installers attached.

---

## Out of scope (v1)

| Feature | Reason |
|---|---|
| Code signing (Windows Authenticode) | Requires EV certificate (~$300/yr); SmartScreen warning acceptable for v1 |
| macOS notarization | Requires Apple Developer Program ($99/yr); GateKeeper warning acceptable for v1 |
| Auto-update integration | `electron-updater` is installed but not wired; defer to post-v1 |

---

## Checklist

- [ ] `resources/icon.png` created (512×512)
- [ ] `resources/icon.ico` created (multi-size ICO)
- [ ] `resources/icon.icns` created (multi-size ICNS)
- [ ] `postinstall` script added to `package.json`
- [ ] `asarUnpack` added to `package.json` `build` section
- [ ] `author` field filled in `package.json`
- [ ] `npm run build` succeeds (Vite build, no type errors)
- [ ] `npm run package:win` produces a working NSIS installer (tested on Windows)
- [ ] `npm run package:mac` produces a working DMG (tested on macOS)
- [ ] Smoke test checklist passed on both platforms
- [ ] PR opened targeting `develop`
