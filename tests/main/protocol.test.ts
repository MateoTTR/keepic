import { describe, it, expect } from 'vitest'
import {
  createProtocolHandler,
  createThrottle,
  type LibraryPathGetter
} from '../../src/main/protocol'
import type { ThumbnailGenerator } from '../../src/main/thumbnail'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockGenerator(returnBuffer?: Buffer): ThumbnailGenerator {
  const buf = returnBuffer ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0]) // JPEG header
  return async () => ({ buffer: buf, contentType: 'image/jpeg' })
}

function makeMockGeneratorSpy(): {
  generator: ThumbnailGenerator
  calls: Array<{ path: string; maxDim: number }>
} {
  const calls: Array<{ path: string; maxDim: number }> = []
  const generator: ThumbnailGenerator = async (path, opts) => {
    calls.push({ path, maxDim: opts.maxDim })
    return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg' }
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

  describe('video content type', () => {
    it('returns the content type from the thumbnail generator result', async () => {
      const videoGen: ThumbnailGenerator = async () => ({
        buffer: Buffer.from('<svg></svg>'),
        contentType: 'image/svg+xml'
      })
      const handler = createProtocolHandler(() => null, videoGen)
      const response = await handler(makeRequest('keepic-photo://thumbnail?path=/photos/clip.mp4'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
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

  describe('concurrency throttle', () => {
    it('limits concurrent thumbnail generation', async () => {
      let active = 0
      let maxSeen = 0
      const resolvers: Array<() => void> = []

      const slowGenerator: ThumbnailGenerator = async () => {
        active++
        maxSeen = Math.max(maxSeen, active)
        await new Promise<void>((resolve) => resolvers.push(resolve))
        active--
        return { buffer: Buffer.from([0xff]), contentType: 'image/jpeg' }
      }

      const handler = createProtocolHandler(() => null, slowGenerator, 2)

      // Fire 4 concurrent requests
      const p1 = handler(makeRequest('keepic-photo://thumbnail?path=/a.jpg'))
      const p2 = handler(makeRequest('keepic-photo://thumbnail?path=/b.jpg'))
      const p3 = handler(makeRequest('keepic-photo://thumbnail?path=/c.jpg'))
      const p4 = handler(makeRequest('keepic-photo://thumbnail?path=/d.jpg'))

      // Allow microtasks to run
      await new Promise((r) => setTimeout(r, 10))

      // Only 2 should be active
      expect(active).toBe(2)
      expect(resolvers).toHaveLength(2)

      // Complete first two → next two start
      resolvers[0]()
      resolvers[1]()
      await new Promise((r) => setTimeout(r, 10))

      expect(active).toBe(2)
      expect(resolvers).toHaveLength(4)

      // Complete remaining
      resolvers[2]()
      resolvers[3]()

      const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4])
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      expect(r3.status).toBe(200)
      expect(r4.status).toBe(200)
      expect(maxSeen).toBe(2)
    })
  })
})

describe('createThrottle', () => {
  it('runs tasks immediately when under limit', async () => {
    const throttle = createThrottle(3)
    const results: number[] = []

    await Promise.all([
      throttle(async () => {
        results.push(1)
      }),
      throttle(async () => {
        results.push(2)
      }),
      throttle(async () => {
        results.push(3)
      })
    ])

    expect(results).toHaveLength(3)
  })

  it('queues and dequeues tasks beyond the limit', async () => {
    const throttle = createThrottle(1)
    const order: number[] = []
    const resolvers: Array<() => void> = []

    const makeTask = (id: number) =>
      throttle(async () => {
        await new Promise<void>((r) => resolvers.push(r))
        order.push(id)
      })

    const p1 = makeTask(1)
    const p2 = makeTask(2)
    const p3 = makeTask(3)

    await new Promise((r) => setTimeout(r, 10))
    expect(resolvers).toHaveLength(1) // only first running

    resolvers[0]() // complete first → second starts
    await new Promise((r) => setTimeout(r, 10))
    expect(resolvers).toHaveLength(2)

    resolvers[1]() // complete second → third starts
    await new Promise((r) => setTimeout(r, 10))
    expect(resolvers).toHaveLength(3)

    resolvers[2]() // complete third
    await Promise.all([p1, p2, p3])

    expect(order).toEqual([1, 2, 3])
  })

  it('propagates errors without blocking the queue', async () => {
    const throttle = createThrottle(1)
    const resolvers: Array<() => void> = []

    const p1 = throttle(async () => {
      throw new Error('fail')
    })
    const p2 = throttle(async () => {
      await new Promise<void>((r) => resolvers.push(r))
      return 'ok'
    })

    await expect(p1).rejects.toThrow('fail')
    await new Promise((r) => setTimeout(r, 10))

    expect(resolvers).toHaveLength(1)
    resolvers[0]()
    const result = await p2
    expect(result).toBe('ok')
  })
})
