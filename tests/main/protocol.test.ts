import { describe, it, expect } from 'vitest'
import { createProtocolHandler, type LibraryPathGetter } from '../../src/main/protocol'
import type { ThumbnailGenerator } from '../../src/main/thumbnail'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockGenerator(returnBuffer?: Buffer): ThumbnailGenerator {
  const buf = returnBuffer ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0]) // JPEG header
  return async () => buf
}

function makeMockGeneratorSpy(): {
  generator: ThumbnailGenerator
  calls: Array<{ path: string; maxDim: number }>
} {
  const calls: Array<{ path: string; maxDim: number }> = []
  const generator: ThumbnailGenerator = async (path, opts) => {
    calls.push({ path, maxDim: opts.maxDim })
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  }
  return { generator, calls }
}

function makeFailingGenerator(message: string): ThumbnailGenerator {
  return async () => {
    throw new Error(message)
  }
}

function makeRequest(url: string): Request {
  return new Request(url)
}

// ---------------------------------------------------------------------------
// createProtocolHandler — URL parsing
// ---------------------------------------------------------------------------

describe('createProtocolHandler', () => {
  describe('absolute path mode', () => {
    it('returns a JPEG response for a valid absolute path', async () => {
      const handler = createProtocolHandler(() => null, makeMockGenerator())
      const response = await handler(makeRequest('keepic-photo://thumbnail?path=/photos/IMG.jpg'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/jpeg')
      expect(response.headers.get('Cache-Control')).toBe('max-age=3600')

      const body = await response.arrayBuffer()
      expect(new Uint8Array(body)[0]).toBe(0xff) // JPEG magic
    })

    it('passes the absolute path to the thumbnail generator', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const handler = createProtocolHandler(() => null, generator)

      await handler(makeRequest('keepic-photo://thumbnail?path=/photos/my%20photo.jpg'))

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('/photos/my photo.jpg')
    })

    it('uses default maxDim of 300 when not specified', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const handler = createProtocolHandler(() => null, generator)

      await handler(makeRequest('keepic-photo://thumbnail?path=/photos/IMG.jpg'))

      expect(calls[0].maxDim).toBe(300)
    })

    it('respects custom maxDim parameter', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const handler = createProtocolHandler(() => null, generator)

      await handler(makeRequest('keepic-photo://thumbnail?path=/photos/IMG.jpg&maxDim=150'))

      expect(calls[0].maxDim).toBe(150)
    })
  })

  describe('library relative path mode', () => {
    it('joins libraryRelPath with library path', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const getLibPath: LibraryPathGetter = () => '/shared/photos'
      const handler = createProtocolHandler(getLibPath, generator)

      await handler(makeRequest('keepic-photo://thumbnail?libraryRelPath=2024/2024.06/IMG.jpg'))

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('/shared/photos/2024/2024.06/IMG.jpg')
    })

    it('returns 500 when library path is not configured', async () => {
      const handler = createProtocolHandler(() => null, makeMockGenerator())
      const response = await handler(
        makeRequest('keepic-photo://thumbnail?libraryRelPath=2024/IMG.jpg')
      )

      expect(response.status).toBe(500)
      const text = await response.text()
      expect(text).toBe('Library path not configured')
    })

    it('handles URL-encoded relative paths', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const handler = createProtocolHandler(() => '/lib', generator)

      await handler(
        makeRequest('keepic-photo://thumbnail?libraryRelPath=2024/2024.04.15-19.Caf%C3%A9/IMG.jpg')
      )

      expect(calls[0].path).toBe('/lib/2024/2024.04.15-19.Café/IMG.jpg')
    })
  })

  describe('error handling', () => {
    it('returns 400 when no path parameter is provided', async () => {
      const handler = createProtocolHandler(() => null, makeMockGenerator())
      const response = await handler(makeRequest('keepic-photo://thumbnail'))

      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).toBe('Missing path or libraryRelPath parameter')
    })

    it('returns 400 for invalid maxDim (non-numeric)', async () => {
      const handler = createProtocolHandler(() => null, makeMockGenerator())
      const response = await handler(
        makeRequest('keepic-photo://thumbnail?path=/img.jpg&maxDim=abc')
      )

      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).toBe('Invalid maxDim parameter')
    })

    it('returns 400 for maxDim <= 0', async () => {
      const handler = createProtocolHandler(() => null, makeMockGenerator())
      const response = await handler(makeRequest('keepic-photo://thumbnail?path=/img.jpg&maxDim=0'))

      expect(response.status).toBe(400)
    })

    it('returns 404 when thumbnail generator throws', async () => {
      const handler = createProtocolHandler(() => null, makeFailingGenerator('File not found'))
      const response = await handler(makeRequest('keepic-photo://thumbnail?path=/nonexistent.jpg'))

      expect(response.status).toBe(404)
      const text = await response.text()
      expect(text).toBe('File not found or unreadable')
    })
  })

  describe('path preference', () => {
    it('prefers absolute path over libraryRelPath when both are provided', async () => {
      const { generator, calls } = makeMockGeneratorSpy()
      const handler = createProtocolHandler(() => '/lib', generator)

      await handler(
        makeRequest('keepic-photo://thumbnail?path=/abs/IMG.jpg&libraryRelPath=rel/IMG.jpg')
      )

      expect(calls[0].path).toBe('/abs/IMG.jpg')
    })
  })
})
