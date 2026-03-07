# FEAT-001a: Thumbnail Protocol + Shell IPC

## Goal

Implement the backend infrastructure to serve photo thumbnails to the Electron renderer via a custom protocol (`keepic-photo://`), and add "Reveal in Folder" IPC handlers.

## Deliverables

1. **`src/main/thumbnail.ts`** — `createThumbnailGenerator(options?)` factory
   - Injectable `HeicDecodeFn` (defaults to `defaultHeicDecode` from `heic.ts`)
   - Injectable `readFile` (defaults to `readFileSync`)
   - JPEG/PNG: `sharp(path).resize(maxDim).jpeg({ quality: 80 }).toBuffer()`
   - HEIC: `decodeFn(buffer) -> sharp(raw).resize(maxDim).jpeg({ quality: 80 }).toBuffer()`
   - Returns `Promise<Buffer>` (JPEG thumbnail)

2. **`src/main/protocol.ts`** — `registerKeepicProtocol(getLibraryPath, thumbnailGenerator?)`
   - Registers `keepic-photo://` via `protocol.handle()`
   - URL params: `path` (absolute) or `libraryRelPath` (relative, joined with libraryPath)
   - `maxDim` param (default 300)
   - Response: JPEG buffer with `Content-Type: image/jpeg`, `Cache-Control: max-age=3600`
   - 404 on missing file, 400 on missing params

3. **`src/main/ipc/shell-handlers.ts`** — Reveal in folder handlers
   - `handleRevealInFolder(absolutePath)` -> `shell.showItemInFolder()`
   - `handleRevealLibraryFile(relativePath, libraryPath)` -> joins path + reveals

4. **Wire-up in `src/main/index.ts`** and **`src/preload/index.ts`**

## IPC Channels

| Channel | Signature |
|---|---|
| `shell:reveal-in-folder` | `(absolutePath: string) => Promise<void>` |
| `shell:reveal-library-file` | `(relativePath: string) => Promise<void>` |

## Key Design Decisions

- **Injectable HEIC decoder**: same `HeicDecodeFn` type from `heic.ts`, ready for POC-001 native decoder swap
- **On-the-fly resize, no disk cache**: JPEG ~5ms, HEIC ~400ms — acceptable for 2-4 photo comparisons
- **`protocol.registerSchemesAsPrivileged`**: must be called before `app.ready` (top-level side-effect)

## Testing

- 100% coverage on `thumbnail.ts`, `protocol.ts`, `shell-handlers.ts`
- Mock sharp and heic-decode at injection boundaries
- Test URL parsing, error cases, cache headers
