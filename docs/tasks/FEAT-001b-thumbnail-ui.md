# FEAT-001b: Thumbnail UI Components + Screen Updates

## Goal

Add visual thumbnail previews to the duplicate review UI (import review and standalone dedup scan), using the `keepic-photo://` protocol from FEAT-001a.

## Deliverables

1. **`src/renderer/src/components/ui/PhotoThumbnail.svelte`** — Reusable thumbnail component
   - Props: `src` (keepic-photo:// URL), `alt`, optional `class`
   - Loading state with gray placeholder
   - Error state with fallback icon

2. **`src/renderer/src/screens/ReviewScreen.svelte`** — Side-by-side import review
   - Expandable duplicate rows show source photo and library match thumbnails (300px max)
   - Metadata displayed alongside each thumbnail (filename, size, date, dimensions)
   - "Reveal in Folder" button for library matches via `shell:reveal-library-file` IPC

3. **`src/renderer/src/screens/DeduplicationScreen.svelte`** — Grid-based dedup scan
   - Each duplicate group displayed as a grid of thumbnail cards (2-3 per row)
   - Each card: thumbnail, relative path, file size, capture date
   - "Reveal in Folder" button per card

## Key Design Decisions

- **Standard `<img>` tags**: renderer loads thumbnails via `keepic-photo://thumbnail?path=...` — no base64 or IPC round-trips
- **Browser caching**: `Cache-Control: max-age=3600` from protocol handler avoids re-fetches within session
- **Video placeholder**: videos show a generic icon instead of a thumbnail (no video frame extraction in V1)

## Session

Completed in session 039 (2026-03-07), together with FEAT-001a in PR #46.
