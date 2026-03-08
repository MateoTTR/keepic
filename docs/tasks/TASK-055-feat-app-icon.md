# TASK-055-feat — Add application icon

## Context

KeePic currently uses the default Electron icon. The app needs a custom icon visible in:
- Windows taskbar and Start menu shortcut
- macOS Dock and app switcher
- Window title bar (Windows)

## Goal

Design and integrate a simple, recognizable icon for KeePic.

## Design

Generate a minimal icon that conveys "photo library / keeper". Candidate concepts:
- A camera or lens shape
- A photo frame with a shield/lock (privacy/keeper)
- Stylized "K" with a photo element

Requirements:
- Works well at small sizes (16x16 to 256x256)
- Recognizable on both light and dark taskbars
- Simple enough to not be blurry at 16x16

## Key Changes

### 1. Icon files

Create the required icon files:
- `build/icon.ico` — Windows icon (multi-resolution: 16, 32, 48, 64, 128, 256)
- `build/icon.icns` — macOS icon
- `build/icon.png` — 512x512 PNG (used as source and for Linux)

### 2. `electron-builder` config

electron-builder already looks for `build/icon.*` by default. Verify the config in `package.json` or `electron-builder.yml` points to the correct paths.

### 3. Development — `BrowserWindow` icon

Set the `icon` property in the `BrowserWindow` constructor for dev mode (production uses the packaged icon automatically):

```typescript
const mainWindow = new BrowserWindow({
  icon: join(__dirname, '../../build/icon.png'),
  // ...
})
```

## Validation

- [ ] Icon visible in Windows taskbar when app is running
- [ ] Icon visible on Windows Start menu shortcut
- [ ] Icon visible in macOS Dock (if testable)
- [ ] Icon visible in window title bar (Windows)

## Files Changed

| File | Change |
|------|--------|
| `build/icon.ico` | **New** — Windows multi-resolution icon |
| `build/icon.icns` | **New** — macOS icon |
| `build/icon.png` | **New** — 512x512 PNG source |
| `src/main/index.ts` | **Modified** — set BrowserWindow icon for dev mode |
