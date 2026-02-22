# ADR-001 — Desktop Framework: Electron vs Tauri

> **Status**: Accepted
> **Date**: 2026-02-21
> **Deciders**: Project owner

---

## Context

KeePic is a cross-platform desktop application (Windows 10/11 + macOS) that must:
- Be **self-contained**: no external runtime required by the user
- Run on **Windows and macOS** (Apple Silicon + Intel)
- Process images in the background: EXIF reading, pHash computation, HEIC → JPEG conversion
- Provide a **minimal UI** focused on import workflows and settings (no in-app photo browser in v1)
- Store app data (DB, cache, temp) in the OS application data directory — outside the library folder
- Access the OS keychain for secure OAuth token storage

The two candidate frameworks are **Electron** (Node.js + bundled Chromium) and **Tauri** (Rust backend + OS native WebView).

The key context that shapes this decision:
- **UI complexity is low**: no photo grid, no fullscreen viewer in v1 — primarily an import wizard and settings screen
- **Processing is the core**: HEIC conversion, pHash, EXIF extraction, file I/O are the heavy work
- **Cross-platform is mandatory**: Windows + macOS, both must be first-class
- **HEIC/image processing** is a non-trivial cross-platform challenge

---

## Decision Drivers

1. Self-contained distributable on both Windows and macOS
2. Cross-platform image processing (HEIC reading/conversion, pHash, EXIF)
3. Binary size and memory footprint (it's a personal utility, not a commercial app)
4. Developer experience and ecosystem maturity
5. Long-term maintainability with a single developer

---

## Considered Options

### Option A — Electron (Node.js + bundled Chromium)

**Description**: Main process in Node.js/TypeScript with full filesystem access. Renderer process is a standard web app. Chromium is bundled in the distributable.

**Cross-platform image processing**:
- `sharp` (libvips-based): mature library, bundles native binaries per platform, supports HEIC reading and writing on Windows and macOS out of the box. Handles JPEG conversion with EXIF preservation.
- `exif-reader` or `exifreader`: pure JS EXIF parsing
- `@cartographer-biz/phash` or `imghash`: pHash libraries for Node.js
- `better-sqlite3`: synchronous SQLite, works great in main process

**Pros**:
- `sharp` is the gold standard for cross-platform image processing in JS — HEIC support on both Windows and macOS with zero configuration
- Entire stack in TypeScript — single language, no context switching
- Very mature ecosystem, abundant examples for desktop apps
- `electron-builder` handles cross-platform packaging (Windows NSIS installer, macOS DMG) with code signing support
- Well-tested keychain access via `keytar`

**Cons**:
- Binary size: ~150–200 MB installer (Chromium included)
- Memory baseline: ~100–150 MB at runtime
- Chromium updates are the developer's responsibility

---

### Option B — Tauri (Rust backend + OS native WebView)

**Description**: Frontend is any web framework; backend is Rust. Uses WebView2 (Windows) or WebKit (macOS) — no bundled browser.

**Cross-platform image processing**:
- `image` crate: general-purpose image processing, but **HEIC/HEIF support requires `libheif`**, which is not trivially bundled on Windows
- `kamadak-exif`: pure Rust EXIF reader
- `img_hash`: perceptual hashing in Rust
- `rusqlite`: SQLite in Rust
- HEIC conversion complexity: `libheif-rs` bindings exist but Windows cross-compilation and bundling is non-trivial; requires shipping a native DLL

**Pros**:
- Very small binary: ~10–20 MB installer
- Low memory footprint: ~30–50 MB at runtime
- Rust backend: excellent performance for CPU-intensive tasks
- Strong security model

**Cons**:
- **HEIC/HEIF on Windows**: requires bundling `libheif` (a C library), which significantly complicates the build pipeline. Not a solved problem in the Rust/Tauri ecosystem as of 2026.
- WebView rendering differences between platforms (WebView2 on Windows vs WebKit on macOS) can cause subtle UI bugs
- Rust is a steeper learning curve — slower iteration for a solo developer
- Smaller ecosystem for desktop-specific tasks compared to Node.js

---

## Decision

**Chosen option: Option A — Electron**

**Rationale**:

The decisive factor is **HEIC conversion cross-platform support**. HEIC handling is a core requirement (iPhone Live Photos), and `sharp` solves this cleanly on both Windows and macOS with a single npm dependency. Reproducing this in Tauri/Rust requires bundling `libheif` on Windows, which is a significant build complexity with limited community support.

Additionally, the UI complexity in v1 is low (import wizard + settings), which was Tauri's main advantage in rich UI scenarios. The binary size trade-off (~150 MB vs ~15 MB) is acceptable for a personal desktop utility.

The entire stack will be TypeScript, enabling faster iteration for a solo developer.

| Factor | Electron | Tauri |
|---|---|---|
| HEIC conversion (Windows) | ✅ `sharp`, zero config | ⚠️ Complex, requires libheif |
| HEIC conversion (macOS) | ✅ Native via libvips | ⚠️ Complex |
| Binary size | ⚠️ ~150 MB | ✅ ~15 MB |
| Memory footprint | ⚠️ ~120 MB | ✅ ~40 MB |
| Dev experience (TypeScript) | ✅ Full stack TS | ⚠️ Split TS + Rust |
| Cross-platform packaging | ✅ Mature | ✅ Mature |
| pHash / EXIF | ✅ npm ecosystem | ✅ Rust crates |
| Keychain access | ✅ `keytar` | ✅ Native Tauri |

---

## Consequences

### Tech Stack

| Layer | Choice |
|---|---|
| Framework | Electron (latest stable) |
| Build toolchain | `electron-vite` |
| Language | TypeScript throughout |
| UI framework | Svelte 5 + Tailwind CSS + shadcn-svelte (see ADR-004) |
| Image processing | `sharp` (HEIC, JPEG conversion, thumbnails) |
| EXIF reading | `exifreader` or `sharp` metadata |
| Perceptual hashing | `imghash` or `blockhash` |
| SQLite | `better-sqlite3` |
| OAuth / keychain | `keytar` |
| Packaging | `electron-builder` (NSIS for Windows, DMG for macOS) |
| Background workers | Node.js `worker_threads` |

### Positive
- HEIC conversion works identically on Windows and macOS
- Single language (TypeScript) for the full codebase
- `electron-builder` handles code signing for both platforms

### Negative / Trade-offs
- Distributable is ~150 MB — acceptable for a personal utility
- Memory usage is higher than Tauri — acceptable for single-user desktop app
- Must keep Electron updated for security patches

### Neutral
- The UI framework was decided separately: Svelte 5 + Tailwind CSS + shadcn-svelte (see ADR-004)

---

## References

- [Electron documentation](https://www.electronjs.org/docs)
- [electron-vite](https://electron-vite.org/)
- [sharp — HEIC support](https://sharp.pixelplumbing.com/api-input#heif)
- [electron-builder — cross-platform packaging](https://www.electron.build/)
- [keytar — OS keychain](https://github.com/atom/node-keytar)
- [Tauri HEIF/HEIC issue tracking](https://github.com/tauri-apps/tauri/discussions)
