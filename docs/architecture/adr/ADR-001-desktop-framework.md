# ADR-001 — Desktop Framework: Electron vs Tauri

> **Status**: Proposed
> **Date**: 2026-02-21
> **Deciders**: Project owner

---

## Context

KeePic is a desktop application that needs to:
- Render a rich web-based UI (photo grid, import wizard, full-screen viewer)
- Access the local filesystem (read/write photos, manage a folder structure)
- Execute CPU-intensive background tasks (pHash computation, thumbnail generation, EXIF reading)
- Store and query a local SQLite database
- Make HTTP requests to the Google Photos API (OAuth + media download)

The two main frameworks for building cross-platform desktop apps with a web UI are **Electron** and **Tauri**.

---

## Decision Drivers

- Developer familiarity and ecosystem maturity
- Performance for background image processing tasks
- Binary size and memory footprint
- Security model (filesystem access, native APIs)
- Long-term maintenance and community support

---

## Considered Options

### Option A — Electron

**Description**: Electron bundles a full Chromium browser and a Node.js runtime. The main process runs Node.js (full filesystem access, native modules), and the renderer process runs the web UI. IPC bridges the two.

**Pros**:
- Very mature ecosystem (VS Code, Slack, Discord all use it)
- Rich npm ecosystem for image processing: `sharp`, `exif-js`, `pHash`, SQLite bindings
- Easy to onboard any JavaScript developer
- Excellent tooling (`electron-builder`, `electron-vite`)
- Straightforward filesystem access from Node.js main process
- Large community, abundant documentation and examples

**Cons**:
- Large binary size (150–300 MB) because Chromium is bundled
- High memory usage at runtime (~150 MB baseline)
- Chromium updates are the app developer's responsibility (security patches)
- Node.js is single-threaded by default; worker threads needed for CPU work

---

### Option B — Tauri

**Description**: Tauri uses the OS's native web renderer (WebView2 on Windows, WebKit on macOS/Linux). The backend is written in Rust; the frontend is any web framework. IPC bridges frontend and Rust backend.

**Pros**:
- Very small binary size (~5–10 MB) — no bundled browser
- Low memory footprint at runtime
- Rust backend: excellent performance and safety for CPU-intensive tasks (pHash, thumbnail generation)
- Modern security model: fine-grained capability permissions
- Active and growing community

**Cons**:
- Backend logic must be written in **Rust** — steeper learning curve if the team is not familiar with Rust
- Native web renderer behavior can vary across OS (WebKit on Linux vs WebView2 on Windows): potential rendering inconsistencies
- Smaller ecosystem than Electron for desktop-specific Node.js modules; Rust crates must be evaluated per use case
- Less battle-tested than Electron for complex apps
- Rust compilation times can slow down development iteration

---

## Decision

> **To be decided** — this ADR is in Proposed status pending discussion with the project owner.

**Key trade-off**: The main decision driver is whether the project owner (or future contributors) are comfortable writing Rust for the backend. If yes, Tauri offers a better long-term foundation (performance, security, binary size). If the team is JavaScript-only, Electron is the safer, faster path.

**Recommended default**: **Electron** — it reduces risk, allows faster iteration with a JS/TS-only stack, and the performance trade-offs (size, memory) are acceptable for a local desktop app used by a single user.

---

## Consequences

### If Electron is chosen
- Tech stack: TypeScript throughout (main + renderer)
- Use `electron-vite` for the build toolchain
- Use `sharp` for thumbnail generation and image processing
- Use `better-sqlite3` for SQLite access
- Worker threads (`worker_threads`) for background jobs

### If Tauri is chosen
- Frontend: TypeScript + web framework (e.g. React or Svelte)
- Backend: Rust — image crates (`image`, `kamadak-exif`, `img_hash`), SQLite via `rusqlite`
- More performant background processing out of the box
- Smaller distributable

---

## References

- [Electron documentation](https://www.electronjs.org/docs)
- [Tauri documentation](https://tauri.app/v2/guide/)
- [Tauri vs Electron comparison (2024)](https://tauri.app/v2/concept/inter-process-communication/)
- [sharp — Node.js image processing](https://sharp.pixelplumbing.com/)
