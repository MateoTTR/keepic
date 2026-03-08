import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isJpegBuffer } from '../../src/main/heic'
import {
  resolveFilenameCollision,
  fixHeicJpegExtension,
  downloadMediaItem,
  refreshAccessToken,
  downloadPickerPhotos,
  type DownloaderTokens,
  type ListMediaItemsFn
} from '../../src/main/google-photos-picker-downloader'
import type { PickerMediaItem } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<PickerMediaItem> = {}): PickerMediaItem {
  return {
    id: 'item-1',
    filename: 'IMG_001.JPG',
    mimeType: 'image/jpeg',
    baseUrl: 'https://photos.example.com/item-1',
    mediaMetadata: { creationTime: '', width: '', height: '' },
    ...overrides
  }
}

const TOKENS: DownloaderTokens = {
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-456',
  expiresAt: Date.now() + 3_600_000,
  credentials: { clientId: 'client-id', clientSecret: 'client-secret' }
}

// ---------------------------------------------------------------------------
// resolveFilenameCollision
// ---------------------------------------------------------------------------

describe('resolveFilenameCollision', () => {
  it('returns the filename unchanged when no collision', () => {
    expect(resolveFilenameCollision('IMG_001.JPG', new Set())).toBe('IMG_001.JPG')
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
// isJpegBuffer
// ---------------------------------------------------------------------------

describe('isJpegBuffer', () => {
  it('returns true for JPEG magic bytes FF D8 FF', () => {
    expect(isJpegBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
  })

  it('returns true for JPEG with different APP marker (FF D8 FF E1)', () => {
    expect(isJpegBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))).toBe(true)
  })

  it('returns false for HEIC magic bytes', () => {
    // HEIC files start with ftypheic at offset 4
    const heicHeader = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    expect(isJpegBuffer(heicHeader)).toBe(false)
  })

  it('returns false for PNG magic bytes', () => {
    expect(isJpegBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
  })

  it('returns false for buffer shorter than 3 bytes', () => {
    expect(isJpegBuffer(Buffer.from([0xff, 0xd8]))).toBe(false)
    expect(isJpegBuffer(Buffer.from([]))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fixHeicJpegExtension
// ---------------------------------------------------------------------------

describe('fixHeicJpegExtension', () => {
  const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
  const heicData = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66])

  it('renames .HEIC to .jpg when content is JPEG', () => {
    expect(fixHeicJpegExtension('IMG_1234.HEIC', jpegData)).toBe('IMG_1234.jpg')
  })

  it('renames .heic to .jpg when content is JPEG', () => {
    expect(fixHeicJpegExtension('photo.heic', jpegData)).toBe('photo.jpg')
  })

  it('renames .HEIF to .jpg when content is JPEG', () => {
    expect(fixHeicJpegExtension('IMG.HEIF', jpegData)).toBe('IMG.jpg')
  })

  it('renames .heif to .jpg when content is JPEG', () => {
    expect(fixHeicJpegExtension('IMG.heif', jpegData)).toBe('IMG.jpg')
  })

  it('does not rename .HEIC when content is actually HEIC', () => {
    expect(fixHeicJpegExtension('IMG_1234.HEIC', heicData)).toBe('IMG_1234.HEIC')
  })

  it('does not rename .jpg files', () => {
    expect(fixHeicJpegExtension('photo.jpg', jpegData)).toBe('photo.jpg')
  })

  it('does not rename .png files even if buffer starts with JPEG bytes', () => {
    expect(fixHeicJpegExtension('photo.png', jpegData)).toBe('photo.png')
  })
})

// ---------------------------------------------------------------------------
// downloadMediaItem
// ---------------------------------------------------------------------------

describe('downloadMediaItem', () => {
  it('fetches baseUrl + =d for photos, writes the response buffer, and returns it', async () => {
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

    const result = await downloadMediaItem(makeItem(), 'my-token', '/tmp/IMG_001.JPG', {
      fetch: mockFetch,
      writeFile: mockWrite,
      setFileTimes: vi.fn()
    })

    expect(capturedPath).toBe('/tmp/IMG_001.JPG')
    expect(capturedData).toEqual(fileData)
    expect(result).toEqual(fileData)
  })

  it('fetches baseUrl + =dv for video mimeTypes', async () => {
    const videoItem = makeItem({ mimeType: 'video/mp4', filename: 'VID_001.mp4' })
    let capturedUrl: string | undefined

    const mockFetch = vi.fn(async (url: string) => {
      capturedUrl = url
      return new Response(Buffer.from('video-data'), { status: 200 })
    })

    await downloadMediaItem(videoItem, 'tok', '/tmp/VID_001.mp4', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: vi.fn()
    })

    expect(capturedUrl).toBe('https://photos.example.com/item-1=dv')
  })

  it('uses =dv for video/quicktime (MOV) mimeType', async () => {
    const movItem = makeItem({ mimeType: 'video/quicktime', filename: 'VID.MOV' })
    let capturedUrl: string | undefined

    const mockFetch = vi.fn(async (url: string) => {
      capturedUrl = url
      return new Response(Buffer.from('mov-data'), { status: 200 })
    })

    await downloadMediaItem(movItem, 'tok', '/tmp/VID.MOV', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: vi.fn()
    })

    expect(capturedUrl).toBe('https://photos.example.com/item-1=dv')
  })

  it('sets file mtime from creationTime when available', async () => {
    const item = makeItem({
      mediaMetadata: { creationTime: '2026-02-15T10:30:00Z', width: '', height: '' }
    })
    const mockSetFileTimes = vi.fn()

    const mockFetch = vi.fn(async () => new Response(Buffer.from('data'), { status: 200 }))

    await downloadMediaItem(item, 'tok', '/tmp/out.jpg', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: mockSetFileTimes
    })

    expect(mockSetFileTimes).toHaveBeenCalledWith(
      '/tmp/out.jpg',
      new Date('2026-02-15T10:30:00Z'),
      new Date('2026-02-15T10:30:00Z')
    )
  })

  it('does not set mtime when creationTime is empty', async () => {
    const item = makeItem({ mediaMetadata: { creationTime: '', width: '', height: '' } })
    const mockSetFileTimes = vi.fn()

    const mockFetch = vi.fn(async () => new Response(Buffer.from('data'), { status: 200 }))

    await downloadMediaItem(item, 'tok', '/tmp/out.jpg', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: mockSetFileTimes
    })

    expect(mockSetFileTimes).not.toHaveBeenCalled()
  })

  it('does not set mtime when creationTime is an invalid date', async () => {
    const item = makeItem({
      mediaMetadata: { creationTime: 'not-a-date', width: '', height: '' }
    })
    const mockSetFileTimes = vi.fn()

    const mockFetch = vi.fn(async () => new Response(Buffer.from('data'), { status: 200 }))

    await downloadMediaItem(item, 'tok', '/tmp/out.jpg', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: mockSetFileTimes
    })

    expect(mockSetFileTimes).not.toHaveBeenCalled()
  })

  it('sends Authorization header', async () => {
    let capturedHeaders: Record<string, string> | undefined

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(Buffer.from('data'), { status: 200 })
    })

    await downloadMediaItem(makeItem(), 'bearer-tok', '/tmp/out.jpg', {
      fetch: mockFetch,
      writeFile: vi.fn(),
      setFileTimes: vi.fn()
    })

    expect(capturedHeaders?.Authorization).toBe('Bearer bearer-tok')
  })

  it('throws on non-ok HTTP response', async () => {
    const mockFetch = vi.fn(async () => new Response('Not Found', { status: 404 }))

    await expect(
      downloadMediaItem(makeItem(), 'tok', '/tmp/out.jpg', {
        fetch: mockFetch,
        writeFile: vi.fn(),
        setFileTimes: vi.fn()
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
    expect(result!.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(result!.expiresAt).toBeLessThanOrEqual(after + 3_600_000)
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
// downloadPickerPhotos
// ---------------------------------------------------------------------------

describe('downloadPickerPhotos', () => {
  let mockMkdirp: ReturnType<typeof vi.fn>
  let mockWriteFile: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockMkdirp = vi.fn()
    mockWriteFile = vi.fn()
  })

  /**
   * Creates a mock listMediaItems that returns pages in sequence.
   * Fetch mock is separate and only used for individual file downloads.
   */
  function makeListMediaItems(pages: Array<{ items: PickerMediaItem[]; nextPageToken?: string }>) {
    let pageIndex = 0
    return vi.fn(async () => {
      const page = pages[pageIndex++]
      return { items: page.items, nextPageToken: page.nextPageToken }
    }) as unknown as ListMediaItemsFn
  }

  function makeDownloadFetch(itemData: Buffer = Buffer.from('img-data')) {
    return vi.fn(async (url: string) => {
      if (url.endsWith('=d') || url.endsWith('=dv')) {
        return new Response(new Uint8Array(itemData), { status: 200 })
      }
      // Refresh token endpoint
      return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }), {
        status: 200
      })
    })
  }

  it('single page, all items downloaded successfully', async () => {
    const items = [makeItem({ filename: 'A.jpg' }), makeItem({ id: 'i2', filename: 'B.jpg' })]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch()

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
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
    const listFn = makeListMediaItems(pages)
    const mockFetch = makeDownloadFetch()
    const onProgress = vi.fn()

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', onProgress, {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(3)
    expect(listFn).toHaveBeenCalledTimes(3)
  })

  it('passes pageToken to listMediaItems for subsequent pages', async () => {
    const pages = [
      { items: [makeItem()], nextPageToken: 'page-token-2' },
      { items: [makeItem({ id: 'i2', filename: 'B.jpg' })] }
    ]
    const capturedPageTokens: Array<string | undefined> = []
    const listFn = vi.fn(async (_sessionId: string, _accessToken: string, pageToken?: string) => {
      capturedPageTokens.push(pageToken)
      const page = pages[capturedPageTokens.length - 1]
      return { items: page.items, nextPageToken: page.nextPageToken }
    })

    await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(capturedPageTokens[0]).toBeUndefined()
    expect(capturedPageTokens[1]).toBe('page-token-2')
  })

  it('resolves filename collisions with _N suffix', async () => {
    const items = [
      makeItem({ filename: 'IMG.jpg' }),
      makeItem({ id: 'i2', filename: 'IMG.jpg' }),
      makeItem({ id: 'i3', filename: 'IMG.jpg' })
    ]
    const listFn = makeListMediaItems([{ items }])
    const writtenPaths: string[] = []

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: vi.fn((p) => writtenPaths.push(p)),
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.downloaded).toBe(3)
    expect(writtenPaths).toContain('/dl/IMG.jpg')
    expect(writtenPaths).toContain('/dl/IMG_1.jpg')
    expect(writtenPaths).toContain('/dl/IMG_2.jpg')
  })

  it('uses =dv suffix for video items in download phase', async () => {
    const items = [
      makeItem({ filename: 'photo.jpg', mimeType: 'image/jpeg' }),
      makeItem({ id: 'i2', filename: 'video.mp4', mimeType: 'video/mp4' })
    ]
    const listFn = makeListMediaItems([{ items }])
    const capturedUrls: string[] = []
    const mockFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(Buffer.from('data'), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(2)
    expect(capturedUrls.some((u) => u.endsWith('=d'))).toBe(true)
    expect(capturedUrls.some((u) => u.endsWith('=dv'))).toBe(true)
  })

  it('sets file mtime from creationTime during download phase', async () => {
    const items = [
      makeItem({
        filename: 'VID.mp4',
        mimeType: 'video/mp4',
        mediaMetadata: { creationTime: '2026-02-15T14:00:00Z', width: '', height: '' }
      })
    ]
    const listFn = makeListMediaItems([{ items }])
    const mockSetFileTimes = vi.fn()

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      setFileTimes: mockSetFileTimes,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(1)
    expect(mockSetFileTimes).toHaveBeenCalledWith(
      '/dl/VID.mp4',
      new Date('2026-02-15T14:00:00Z'),
      new Date('2026-02-15T14:00:00Z')
    )
  })

  it('records error for failed download item and continues', async () => {
    const items = [
      makeItem({ filename: 'A.jpg' }),
      makeItem({ id: 'i2', filename: 'B.jpg' }),
      makeItem({ id: 'i3', filename: 'C.jpg' })
    ]
    const listFn = makeListMediaItems([{ items }])
    let downloadCallCount = 0
    const mockFetch = vi.fn(async (url: string) => {
      if (url.endsWith('=d') || url.endsWith('=dv')) {
        downloadCallCount++
        if (downloadCallCount === 2) return new Response('Server Error', { status: 500 })
        return new Response(Buffer.from('img'), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
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
    const listFn = makeListMediaItems([{ items }])

    let calls = 0
    const isCancelled = vi.fn(() => calls++ >= 2)

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: vi.fn(),
      mkdirp: mockMkdirp,
      isCancelled,
      listMediaItems: listFn
    })

    expect(result.status).toBe('cancelled')
    expect(result.downloaded).toBeLessThan(3)
  })

  it('cancels immediately before downloading first item', async () => {
    const items = [makeItem({ filename: 'A.jpg' })]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch()

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      isCancelled: () => true,
      listMediaItems: listFn
    })

    expect(result.status).toBe('cancelled')
    expect(result.downloaded).toBe(0)
    // fetch should not have been called for downloads
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('refreshes token on "Token expired" during listing and retries successfully', async () => {
    let firstCall = true
    const listFn = vi.fn(async () => {
      if (firstCall) {
        firstCall = false
        throw new Error('Token expired')
      }
      return { items: [makeItem()] }
    }) as unknown as ListMediaItemsFn
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }), {
          status: 200
        })
      }
      return new Response(Buffer.from('img'), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(1)
    expect(result.updatedAccessToken).toBe('refreshed-token')
    expect(result.updatedExpiresAt).toBeDefined()
  })

  it('fails with status=failed when "Token expired" + token refresh also fails', async () => {
    const listFn = vi.fn(async () => {
      throw new Error('Token expired')
    })
    const mockFetch = vi.fn(async () => new Response('Bad Request', { status: 400 }))

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].error).toContain('Token refresh failed')
  })

  it('fails with status=failed when retry after token refresh also throws', async () => {
    let callCount = 0
    const listFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new Error('Token expired')
      throw new Error('Listing failed after refresh')
    })
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'new-tok', expires_in: 3600 }), {
          status: 200
        })
      }
      return new Response(Buffer.from('img'), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].error).toContain('Listing failed after refresh')
  })

  it('fails with status=failed on non-token-expired listing error', async () => {
    const listFn = vi.fn(async () => {
      throw new Error('Network error during listing')
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('failed')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].error).toBe('Network error during listing')
  })

  it('does not include updatedAccessToken when no refresh occurred', async () => {
    const listFn = makeListMediaItems([{ items: [makeItem()] }])

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.updatedAccessToken).toBeUndefined()
    expect(result.updatedExpiresAt).toBeUndefined()
  })

  it('calls onProgress with correct values during download', async () => {
    const items = [makeItem({ filename: 'A.jpg' }), makeItem({ id: 'i2', filename: 'B.jpg' })]
    const listFn = makeListMediaItems([{ items }])
    const progressCalls: Array<{ total: number; downloaded: number; currentFile: string | null }> =
      []

    await downloadPickerPhotos('session-1', TOKENS, '/dl', (p) => progressCalls.push(p), {
      fetch: makeDownloadFetch(),
      writeFile: vi.fn(),
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(progressCalls.length).toBeGreaterThan(0)
    // total should be 2 (known upfront after listing)
    expect(progressCalls[0].total).toBe(2)
    const last = progressCalls[progressCalls.length - 1]
    expect(last.downloaded).toBe(2)
    expect(last.total).toBe(2)
  })

  it('creates the download directory', async () => {
    const listFn = makeListMediaItems([{ items: [] }])

    await downloadPickerPhotos('session-1', TOKENS, '/my/download/dir', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(mockMkdirp).toHaveBeenCalledWith('/my/download/dir')
  })

  it('returns empty result when session has no items', async () => {
    const listFn = makeListMediaItems([{ items: [] }])

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: makeDownloadFetch(),
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('renames .HEIC to .jpg when downloaded content is JPEG (Google Picker API)', async () => {
    // Google Picker API serves JPEG content but preserves the .HEIC filename
    const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    const items = [makeItem({ filename: 'IMG_1234.HEIC' })]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch(jpegData)
    const renamedPaths: [string, string][] = []

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      renameFile: (oldP, newP) => renamedPaths.push([oldP, newP]),
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(1)
    // File was written with original .HEIC name then renamed to .jpg
    expect(mockWriteFile).toHaveBeenCalledWith('/dl/IMG_1234.HEIC', expect.any(Buffer))
    expect(renamedPaths).toHaveLength(1)
    expect(renamedPaths[0]).toEqual(['/dl/IMG_1234.HEIC', '/dl/IMG_1234.jpg'])
  })

  it('does not rename when .HEIC file contains real HEIC data', async () => {
    // Real HEIC data starts with ftyp box
    const heicData = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const items = [makeItem({ filename: 'IMG_5678.HEIC' })]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch(heicData)
    const mockRename = vi.fn()

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      renameFile: mockRename,
      listMediaItems: listFn
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(1)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('does not rename .jpg files even with JPEG content', async () => {
    const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const items = [makeItem({ filename: 'photo.jpg' })]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch(jpegData)
    const mockRename = vi.fn()

    await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      renameFile: mockRename,
      listMediaItems: listFn
    })

    expect(mockRename).not.toHaveBeenCalled()
  })

  it('handles filename collision correctly after HEIC→JPEG rename', async () => {
    const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    // Two HEIC files that will both become .jpg — potential collision
    const items = [
      makeItem({ filename: 'IMG.HEIC' }),
      makeItem({ id: 'i2', filename: 'IMG.HEIC' })
    ]
    const listFn = makeListMediaItems([{ items }])
    const mockFetch = makeDownloadFetch(jpegData)
    const renamedPaths: [string, string][] = []
    const writtenPaths: string[] = []

    await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: vi.fn((p) => writtenPaths.push(p)),
      mkdirp: mockMkdirp,
      renameFile: (oldP, newP) => renamedPaths.push([oldP, newP]),
      listMediaItems: listFn
    })

    // Filenames are pre-assigned before download:
    //   Item 1: IMG.HEIC, Item 2: IMG_1.HEIC (collision resolved)
    // After download, both are JPEG content:
    //   Item 1: IMG.HEIC → IMG.jpg
    //   Item 2: IMG_1.HEIC → IMG_1.jpg
    expect(renamedPaths).toHaveLength(2)
    expect(renamedPaths[0]).toEqual(['/dl/IMG.HEIC', '/dl/IMG.jpg'])
    expect(renamedPaths[1]).toEqual(['/dl/IMG_1.HEIC', '/dl/IMG_1.jpg'])
  })

  it('downloads items concurrently when concurrency > 1', async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `i${i}`, filename: `IMG_${i}.jpg` })
    )
    const listFn = makeListMediaItems([{ items }])
    let maxConcurrent = 0
    let currentConcurrent = 0

    const mockFetch = vi.fn(async (url: string) => {
      if (url.endsWith('=d')) {
        currentConcurrent++
        if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent
        // Simulate async I/O delay to allow interleaving
        await new Promise((r) => setTimeout(r, 10))
        currentConcurrent--
        return new Response(Buffer.from('img'), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn,
      concurrency: 2
    })

    expect(result.status).toBe('completed')
    expect(result.downloaded).toBe(4)
    expect(maxConcurrent).toBe(2)
  })

  it('includes updatedAccessToken in failed result when refresh occurred before failure', async () => {
    let callCount = 0
    const listFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new Error('Token expired')
      // Refresh succeeded, but retry also fails (different error)
      throw new Error('Session expired after refresh')
    })
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'refreshed', expires_in: 3600 }), {
          status: 200
        })
      }
      return new Response(Buffer.from('img'), { status: 200 })
    })

    const result = await downloadPickerPhotos('session-1', TOKENS, '/dl', vi.fn(), {
      fetch: mockFetch,
      writeFile: mockWriteFile,
      mkdirp: mockMkdirp,
      listMediaItems: listFn
    })

    expect(result.status).toBe('failed')
    expect(result.updatedAccessToken).toBe('refreshed')
    expect(result.updatedExpiresAt).toBeDefined()
  })
})
