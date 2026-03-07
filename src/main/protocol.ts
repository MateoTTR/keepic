import { join } from 'path'
import { createThumbnailGenerator, type ThumbnailGenerator } from './thumbnail'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LibraryPathGetter = () => string | null

// ---------------------------------------------------------------------------
// Protocol handler
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DIM = 300

/**
 * Creates the request handler for the `keepic-photo://` custom protocol.
 *
 * Exported separately from `registerKeepicProtocol` so it can be unit-tested
 * without requiring Electron's `protocol` module.
 *
 * URL format:
 *   keepic-photo://thumbnail?path=<absolute>&maxDim=300
 *   keepic-photo://thumbnail?libraryRelPath=<relative>&maxDim=300
 */
export function createProtocolHandler(
  getLibraryPath: LibraryPathGetter,
  thumbnailGenerator: ThumbnailGenerator = createThumbnailGenerator()
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const absolutePath = url.searchParams.get('path')
    const libraryRelPath = url.searchParams.get('libraryRelPath')
    const maxDimParam = url.searchParams.get('maxDim')
    const maxDim = maxDimParam ? parseInt(maxDimParam, 10) : DEFAULT_MAX_DIM

    let resolvedPath: string | null = null

    if (absolutePath) {
      resolvedPath = absolutePath
    } else if (libraryRelPath) {
      const libraryPath = getLibraryPath()
      if (!libraryPath) {
        return new Response('Library path not configured', { status: 500 })
      }
      resolvedPath = join(libraryPath, libraryRelPath)
    }

    if (!resolvedPath) {
      return new Response('Missing path or libraryRelPath parameter', { status: 400 })
    }

    if (isNaN(maxDim) || maxDim <= 0) {
      return new Response('Invalid maxDim parameter', { status: 400 })
    }

    try {
      const buffer = await thumbnailGenerator(resolvedPath, { maxDim })
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'max-age=3600'
        }
      })
    } catch {
      return new Response('File not found or unreadable', { status: 404 })
    }
  }
}
