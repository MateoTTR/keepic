import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseDateForApi,
  resolveFilenameCollision,
  fetchMediaPage,
  downloadMediaItem,
  refreshAccessToken,
  downloadGooglePhotos,
  type GoogleMediaItem,
  type DownloaderTokens
} from '../../src/main/google-photos-downloader'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<GoogleMediaItem> = {}): GoogleMediaItem {
  return {
    id: 'item-1',
    filename: 'IMG_001.JPG',
    mimeType: 'image/jpeg',
    baseUrl: 'https://photos.example.com/item-1',
    mediaMetadata: { creationTime: '2025-01-15T10:00:00Z', width: '4032', height: '3024' },
    ...overrides
  }
}

const TOKENS: DownloaderTokens = {
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-456',
  expiresAt: Date.now() + 3600_000,
  credentials: { clientId: 'client-id', clientSecret: 'client-secret' }
}

// ---------------------------------------------------------------------------
// parseDateForApi
// ---------------------------------------------------------------------------

describe('parseDateForApi', () => {
  it('parses YYYY-MM-DD correctly', () => {
    expect(parseDateForApi('2025-03-07')).toEqual({ year: 2025, month: 3, day: 7 })
  })

  it('handles leading zeros', () => {
    expect(parseDateForApi('2025-01-01')).toEqual({ year: 2025, month: 1, day: 1 })
  })
})

// ---------------------------------------------------------------------------
// resolveFilenameCollision
// ---------------------------------------------------------------------------

describe('resolveFilenameCollision', () => {
  it('returns the filename unchanged when no collision', () => {
    const used = new Set<string>()
    expect(resolveFilenameCollision('IMG_001.JPG', used)).toBe('IMG_001.JPG')
  })

  it('appends _1 on first collision', () => {
    const used = new Set(['IMG_001.JPG'])
    expect(resolveFilenameCollision('IMG_001.JPG', used)).toBe('IMG_001_1.JPG')
  })

  it('appends _2 when _1 is also taken', () => {
    const used = new Set(['IMG_001.JPG', 'IMG_001_1.JPG'])
    expect(resolveFilenameCollision('IMG_001.JPG', used)).toBe('IMG_001_2.JPG')
  })

  it('falls back to timestamp suffix after 99 collisions', () => {
    const used = new Set(['IMG_001.JPG'])
    for (let n = 1; n <= 99; n++) used.add(`IMG_001_${n}.JPG`)
    const result = resolveFilenameCollision('IMG_001.JPG', used)
    expect(result).toMatch(/^IMG_001_\d+\.JPG$/)
    expect(result).not.toBe('IMG_001.JPG')
  })

  it('handles filenames without extension', () => {
    const used = new Set(['photo'])
    expect(resolveFilenameCollision('photo', used)).toBe('photo_1')
  })
})

// ---------------------------------------------------------------------------
// fetchMediaPage
// ---------------------------------------------------------------------------

describe('fetchMediaPage', () => {
  it('sends correct request body for first page (no pageToken)', async () => {
    let capturedBody: string | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ mediaItems: [makeItem()], nextPageToken: 'tok-2' }), {
        status: 200
      })
    })

    const result = await fetchMediaPage('my-token', '2025-03-01', undefined, {
      fetch: mockFetch
    })

    const body = JSON.parse(capturedBody!)
    expect(body.filters.dateFilter.ranges[0].startDate).toEqual({
      year: 2025,
      month: 3,
      day: 1
    })
    expect(body.filters.mediaTypeFilter).toEqual({ mediaTypes: ['PHOTO'] })
    expect(body.pageToken).toBeUndefined()
    expect(result.items).toHaveLength(1)
    expect(result.nextPageToken).toBe('tok-2')
  })

  it('includes pageToken in body when provided', async () => {
    let capturedBody: string | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ mediaItems: [] }), { status: 200 })
    })

    await fetchMediaPage('my-token', '2025-01-01', 'page-token-abc', { fetch: mockFetch })

    const body = JSON.parse(capturedBody!)
    expect(body.pageToken).toBe('page-token-abc')
  })

  it('returns empty items array when mediaItems is absent', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))

    const result = await fetchMediaPage('tok', '2025-01-01', undefined, { fetch: mockFetch })
    expect(result.items).toEqual([])
    expect(result.nextPageToken).toBeUndefined()
  })

  it('sends Authorization header', async () => {
    let capturedHeaders: Record<string, string> | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({ mediaItems: [] }), { status: 200 })
    })

    await fetchMediaPage('bearer-xyz', '2025-01-01', undefined, { fetch: mockFetch })
    expect(capturedHeaders?.Authorization).toBe('Bearer bearer-xyz')
  })

  it('throws on 401 response', async () => {
    const mockFetch = vi.fn(async () => new Response('Unauthorized', { status: 401 }))

    await expect(
      fetchMediaPage('bad-tok', '2025-01-01', undefined, { fetch: mockFetch })
    ).rejects.toThrow('401')
  })

  it('throws on 500 response', async () => {
    const mockFetch = vi.fn(async () => new Response('Internal Server Error', { status: 500 }))

    await expect(
      fetchMediaPage('tok', '2025-01-01', undefined, { fetch: mockFetch })
    ).rejects.toThrow('500')
  })

  it('throws user-friendly message on 403 PERMISSION_DENIED', async () => {
    const body = JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } })
    const mockFetch = vi.fn(async () => new Response(body, { status: 403 }))

    await expect(
      fetchMediaPage('tok', '2025-01-01', undefined, { fetch: mockFetch })
    ).rejects.toThrow('Google Photos access was denied (Request had insufficient authentication scopes.). Please disconnect your account and reconnect to grant the required permissions.')
  })

  it('throws message without detail when 403 PERMISSION_DENIED has no message field', async () => {
    const body = JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } })
    const mockFetch = vi.fn(async () => new Response(body, { status: 403 }))

    await expect(
      fetchMediaPage('tok', '2025-01-01', undefined, { fetch: mockFetch })
    ).rejects.toThrow('Google Photos access was denied. Please disconnect your account and reconnect to grant the required permissions.')
  })

  it('throws generic error message on 403 with non-PERMISSION_DENIED status', async () => {
    const body = JSON.stringify({ error: { code: 403, status: 'FORBIDDEN' } })
    const mockFetch = vi.fn(async () => new Response(body, { status: 403 }))

    await expect(
      fetchMediaPage('tok', '2025-01-01', undefined, { fetch: mockFetch })
    ).rejects.toThrow('Google Photos API error: 403')
  })
})

// ---------------------------------------------------------------------------
// downloadMediaItem
// ---------------------------------------------------------------------------

describe('downloadMediaItem', () => {
  it('fetches baseUrl + =d and writes the response buffer', async () => {
    const fileData = Buffer.from('fake-image-bytes')
    let capturedPath: string | undefined
    let capturedData: Buffer | undefined

    const mockFetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://photos.example.com/item-1=d')
      return new Response(fileData, { status: 200 })
    })

    const mockWrite = vi.fn((p: string, d: Buffer) => {
      capturedPath = p
      capturedData = d
    })

    const item = makeItem()
    await downloadMediaItem(item, 'my-token', '/tmp/IMG_001.JPG', {
      fetch: mockFetch,
      writeFile: mockWrite
    })

    expect(capturedPath).toBe('/tmp/IMG_001.JPG')
    expect(capturedData).toEqual(fileData)
  })

  it('sends Authorization header', async () => {
    let capturedHeaders: Record<string, string> | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(Buffer.from('data'), { status: 200 })
    })

    await downloadMediaItem(makeItem(), 'bearer-tok', '/tmp/out.jpg', {
      fetch: mockFetch,
      writeFile: vi.fn()
    })

    expect(capturedHeaders?.Authorization).toBe('Bearer bearer-tok')
  })

  it('throws on non-ok HTTP response', async () => {
    const mockFetch = vi.fn(async () => new Response('Not Found', { status: 404 }))

    await expect(
      downloadMediaItem(makeItem(), 'tok', '/tmp/out.jpg', {
        fetch: mockFetch,
        writeFile: vi.fn()
      })
    ).rejects.toThrow('404')
  })
})

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe('refreshAccessToken', () => {
  it('returns new accessToken and expiresAt on success', async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), {
          status: 200
        })
    )

    const before = Date.now()
    const result = await refreshAccessToken(
      'refresh-tok',
      { clientId: 'id', clientSecret: 'secret' },
      { fetch: mockFetch }
    )
    const after = Date.now()

    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe('new-access-token')
    expect(result!.expiresAt).toBeGreaterThanOrEqual(before + 3600_000)
    expect(result!.expiresAt).toBeLessThanOrEqual(after + 3600_000)
  })

  it('returns null on non-ok HTTP response', async () => {
    const mockFetch = vi.fn(async () => new Response('Bad Request', { status: 400 }))
    const result = await refreshAccessToken(
      'tok',
      { clientId: 'id', clientSecret: 'sec' },
      { fetch: mockFetch }
    )
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('network error')
    })
    const result = await refreshAccessToken(
      'tok',
      { clientId: 'id', clientSecret: 'sec' },
      { fetch: mockFetch }
    )
    expect(result).toBeNull()
  })

  it('sends correct grant_type and refresh_token in body', async () => {
    let capturedBody: string | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200
      })
    })

    await refreshAccessToken(
      'my-refresh',
      { clientId: 'cid', clientSecret: 'csec' },
      { fetch: mockFetch }
    )

    const params = new URLSearchParams(capturedBody)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('my-refresh')
    expect(params.get('client_id')).toBe('cid')
    expect(params.get('client_secret')).toBe('csec')
  })
})

// ---------------------------------------------------------------------------
// downloadGooglePhotos
// ---------------------------------------------------------------------------

describe('downloadGooglePhotos', () => {
  let mockMkdirp: ReturnType<typeof vi.fn>
  let mockWriteFile: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockMkdirp = vi.fn()
    mockWriteFile = vi.fn()
  })

  function makeFetch(pages: Array<{ items: GoogleMediaItem[]; nextPageToken?: string }>) {
    let pageIndex = 0
    return vi.fn(async (url: string) => {
      // Token endpoint
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }), {
          status: 200
        })
      }
      // Download endpoint (baseUrl=d)
      if (url.endsWith('=d')) {
        return new Response(Buffer.from('img-data'), { status: 200 })
      }
      // Search endpoint (body unused but parsed to verify format is valid JSON)
      const page = pages[pageIndex++]
      return new Response(
        JSON.stringify({
          mediaItems: page.items,
          ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {})
        }),
        { status: 200 }
      )
    })
  }

  it('single page, all items downloaded successfully', async () => {
    const items = [makeItem({ filename: 'A.jpg' }), makeItem({ id: 'item-2', filename: 'B.jpg' })]
    const mockFetch = makeFetch([{ items }])

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(2)
    expect(result.errors).toHaveLength(0)
    expect(result.downloadDir).toBe('/dl')
    expect(mockMkdirp).toHaveBeenCalledWith('/dl')
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
  })

  it('multi-page pagination: follows nextPageToken until exhausted', async () => {
    const pages = [
      { items: [makeItem({ filename: 'P1.jpg' })], nextPageToken: 'tok-2' },
      { items: [makeItem({ id: 'i2', filename: 'P2.jpg' })], nextPageToken: 'tok-3' },
      { items: [makeItem({ id: 'i3', filename: 'P3.jpg' })] }
    ]
    const mockFetch = makeFetch(pages)
    const onProgress = vi.fn()

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', onProgress, {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(3)
  })

  it('resolves filename collisions with _N suffix', async () => {
    const items = [
      makeItem({ filename: 'IMG.jpg' }),
      makeItem({ id: 'i2', filename: 'IMG.jpg' }),
      makeItem({ id: 'i3', filename: 'IMG.jpg' })
    ]
    const mockFetch = makeFetch([{ items }])
    const writtenPaths: string[] = []

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: vi.fn((p) => {
        writtenPaths.push(p)
      }),
      mkdirp: mockMkdirp
    })

    expect(result.downloaded).toBe(3)
    expect(writtenPaths).toContain('/dl/IMG.jpg')
    expect(writtenPaths).toContain('/dl/IMG_1.jpg')
    expect(writtenPaths).toContain('/dl/IMG_2.jpg')
  })

  it('skips video/* items (defensive guard)', async () => {
    const items = [
      makeItem({ filename: 'photo.jpg', mimeType: 'image/jpeg' }),
      makeItem({ id: 'v1', filename: 'video.mp4', mimeType: 'video/mp4' })
    ]
    const mockFetch = makeFetch([{ items }])

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.downloaded).toBe(1)
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('records error for failed download item and continues', async () => {
    const items = [
      makeItem({ filename: 'A.jpg' }),
      makeItem({ id: 'i2', filename: 'B.jpg' }),
      makeItem({ id: 'i3', filename: 'C.jpg' })
    ]

    let callCount = 0
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/v1')) {
        // Search page
        return new Response(JSON.stringify({ mediaItems: items }), { status: 200 })
      }
      // Download: fail on second item
      callCount++
      if (callCount === 2) {
        return new Response('Server Error', { status: 500 })
      }
      return new Response(Buffer.from('img'), { status: 200 })
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].filename).toBe('B.jpg')
  })

  it('cancels between items and returns status=cancelled', async () => {
    const items = [
      makeItem({ filename: 'A.jpg' }),
      makeItem({ id: 'i2', filename: 'B.jpg' }),
      makeItem({ id: 'i3', filename: 'C.jpg' })
    ]
    const mockFetch = makeFetch([{ items }])

    let calls = 0
    const isCancelled = vi.fn(() => {
      // Cancel after the first item is processed
      return calls++ >= 3
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: vi.fn(),
      mkdirp: mockMkdirp,
      isCancelled
    })

    expect(result.status).toBe('cancelled')
    expect(result.downloaded).toBeLessThan(3)
  })

  it('cancels at page boundary and returns status=cancelled', async () => {
    const pages = [
      { items: [makeItem()], nextPageToken: 'tok-2' },
      { items: [makeItem({ id: 'i2', filename: 'B.jpg' })] }
    ]
    const mockFetch = makeFetch(pages)

    let pagesFetched = 0
    const mockFetchWrapped = vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/v1')) pagesFetched++
      return mockFetch(url)
    })

    // Cancel before the second page is processed
    const isCancelled = vi.fn(() => pagesFetched >= 1)

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetchWrapped,
      writeFile: vi.fn(),
      mkdirp: mockMkdirp,
      isCancelled
    })

    expect(result.status).toBe('cancelled')
  })

  it('refreshes token on 401 page fetch and retries successfully', async () => {
    let firstSearchCall = true

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }), {
          status: 200
        })
      }
      if (url.endsWith('=d')) {
        return new Response(Buffer.from('img'), { status: 200 })
      }
      // First search call → 401; second (after refresh) → success
      if (firstSearchCall) {
        firstSearchCall = false
        return new Response('Unauthorized', { status: 401 })
      }
      return new Response(JSON.stringify({ mediaItems: [makeItem()] }), { status: 200 })
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(1)
    expect(result.updatedAccessToken).toBe('refreshed-token')
    expect(result.updatedExpiresAt).toBeDefined()
  })

  it('fails with status=failed when 401 + token refresh also fails', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response('Bad Request', { status: 400 })
      }
      return new Response('Unauthorized', { status: 401 })
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails with status=failed on non-401 page fetch error', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/v1')) {
        return new Response('Server Error', { status: 500 })
      }
      return new Response(Buffer.from('img'), { status: 200 })
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('does not include updatedAccessToken when no refresh occurred', async () => {
    const mockFetch = makeFetch([{ items: [makeItem()] }])

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.updatedAccessToken).toBeUndefined()
    expect(result.updatedExpiresAt).toBeUndefined()
  })

  it('calls onProgress with correct values during download', async () => {
    const items = [makeItem({ filename: 'A.jpg' }), makeItem({ id: 'i2', filename: 'B.jpg' })]
    const mockFetch = makeFetch([{ items }])
    const progressCalls: Array<{
      fetched: number
      downloaded: number
      currentFile: string | null
    }> = []

    await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', (p) => progressCalls.push(p), {
      fetch: mockFetch,
      writeFile: vi.fn(),
      mkdirp: mockMkdirp
    })

    // Should have progress calls with increasing downloaded count
    expect(progressCalls.length).toBeGreaterThan(0)
    const last = progressCalls[progressCalls.length - 1]
    expect(last.downloaded).toBe(2)
    expect(last.fetched).toBe(2)
  })

  it('creates the download directory', async () => {
    const mockFetch = makeFetch([{ items: [] }])

    await downloadGooglePhotos('2025-01-01', TOKENS, '/my/download/dir', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(mockMkdirp).toHaveBeenCalledWith('/my/download/dir')
  })

  it('returns empty result when API returns no items', async () => {
    const mockFetch = makeFetch([{ items: [] }])

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('cancels immediately before fetching first page', async () => {
    const mockFetch = makeFetch([{ items: [makeItem()] }])

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      isCancelled: () => true
    })

    expect(result.status).toBe('cancelled')
    expect(result.downloaded).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails when retry after token refresh also throws', async () => {
    let searchCallCount = 0

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'new-tok', expires_in: 3600 }), {
          status: 200
        })
      }
      // First search call → 401; second call (retry after refresh) → 500
      searchCallCount++
      if (searchCallCount === 1) return new Response('Unauthorized', { status: 401 })
      return new Response('Internal Server Error', { status: 500 })
    })

    const result = await downloadGooglePhotos('2025-01-01', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
