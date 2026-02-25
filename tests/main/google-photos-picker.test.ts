import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  createPickerSession,
  pollPickerSession,
  listPickerMediaItems,
  type PickerDeps
} from '../../src/main/google-photos-picker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: object): PickerDeps {
  return {
    fetch: vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    })) as unknown as PickerDeps['fetch']
  }
}

// ---------------------------------------------------------------------------
// createPickerSession
// ---------------------------------------------------------------------------

describe('createPickerSession', () => {
  it('creates a session and returns id + pickerUri', async () => {
    const deps = mockFetch(200, {
      id: 'session-abc',
      pickerUri: 'https://photos.google.com/picker/session-abc'
    })

    const result = await createPickerSession('token-123', deps)

    expect(result).toEqual({
      id: 'session-abc',
      pickerUri: 'https://photos.google.com/picker/session-abc'
    })

    const fetchFn = deps.fetch as ReturnType<typeof vi.fn>
    expect(fetchFn).toHaveBeenCalledWith('https://photospicker.googleapis.com/v1/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
  })

  it('throws "Token expired" on 401', async () => {
    const deps = mockFetch(401, { error: { message: 'Unauthorized' } })

    await expect(createPickerSession('bad-token', deps)).rejects.toThrow('Token expired')
  })

  it('throws with status on other errors', async () => {
    const deps = mockFetch(500, { error: { message: 'Internal' } })

    await expect(createPickerSession('token', deps)).rejects.toThrow(
      'Failed to create picker session: 500'
    )
  })
})

// ---------------------------------------------------------------------------
// pollPickerSession
// ---------------------------------------------------------------------------

describe('pollPickerSession', () => {
  it('returns mediaItemsSet: false when user has not finished', async () => {
    const deps = mockFetch(200, { id: 'session-abc', mediaItemsSet: false })

    const result = await pollPickerSession('session-abc', 'token-123', deps)

    expect(result).toEqual({ mediaItemsSet: false })

    const fetchFn = deps.fetch as ReturnType<typeof vi.fn>
    expect(fetchFn).toHaveBeenCalledWith(
      'https://photospicker.googleapis.com/v1/sessions/session-abc',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json'
        }
      }
    )
  })

  it('returns mediaItemsSet: true when user has finished selecting', async () => {
    const deps = mockFetch(200, { id: 'session-abc', mediaItemsSet: true })

    const result = await pollPickerSession('session-abc', 'token-123', deps)

    expect(result).toEqual({ mediaItemsSet: true })
  })

  it('treats missing mediaItemsSet as false', async () => {
    const deps = mockFetch(200, { id: 'session-abc' })

    const result = await pollPickerSession('session-abc', 'token-123', deps)

    expect(result).toEqual({ mediaItemsSet: false })
  })

  it('throws "Token expired" on 401', async () => {
    const deps = mockFetch(401, {})

    await expect(pollPickerSession('session-abc', 'bad-token', deps)).rejects.toThrow(
      'Token expired'
    )
  })

  it('throws with status on other errors', async () => {
    const deps = mockFetch(403, { error: { message: 'Forbidden' } })

    await expect(pollPickerSession('session-abc', 'token', deps)).rejects.toThrow(
      'Failed to poll picker session: 403'
    )
  })
})

// ---------------------------------------------------------------------------
// listPickerMediaItems
// ---------------------------------------------------------------------------

describe('listPickerMediaItems', () => {
  it('returns items from mediaFile structure', async () => {
    const deps = mockFetch(200, {
      mediaItems: [
        {
          id: 'item-1',
          baseUrl: 'https://base/1',
          mimeType: 'image/jpeg',
          type: 'PHOTO',
          mediaFile: {
            filename: 'photo1.jpg',
            baseUrl: 'https://mediafile/1',
            mimeType: 'image/jpeg'
          }
        }
      ],
      nextPageToken: 'page2'
    })

    const result = await listPickerMediaItems('session-abc', 'token-123', undefined, deps)

    expect(result.items).toEqual([
      {
        id: 'item-1',
        baseUrl: 'https://mediafile/1',
        mimeType: 'image/jpeg',
        filename: 'photo1.jpg',
        mediaMetadata: { creationTime: '', width: '', height: '' }
      }
    ])
    expect(result.nextPageToken).toBe('page2')
  })

  it('falls back to top-level fields when mediaFile is absent', async () => {
    const deps = mockFetch(200, {
      mediaItems: [
        {
          id: 'item-2',
          baseUrl: 'https://base/2',
          mimeType: 'video/mp4'
        }
      ]
    })

    const result = await listPickerMediaItems('session-abc', 'token-123', undefined, deps)

    expect(result.items).toEqual([
      {
        id: 'item-2',
        baseUrl: 'https://base/2',
        mimeType: 'video/mp4',
        filename: 'item-2.jpg',
        mediaMetadata: { creationTime: '', width: '', height: '' }
      }
    ])
    expect(result.nextPageToken).toBeUndefined()
  })

  it('returns empty array when mediaItems is missing', async () => {
    const deps = mockFetch(200, {})

    const result = await listPickerMediaItems('session-abc', 'token-123', undefined, deps)

    expect(result.items).toEqual([])
  })

  it('passes pageSize=100 and pageToken as query params', async () => {
    const deps = mockFetch(200, { mediaItems: [] })

    await listPickerMediaItems('session-abc', 'token-123', 'next-page-token', deps)

    const fetchFn = deps.fetch as ReturnType<typeof vi.fn>
    const calledUrl = fetchFn.mock.calls[0][0] as string
    expect(calledUrl).toContain('pageSize=100')
    expect(calledUrl).toContain('pageToken=next-page-token')
  })

  it('does not include pageToken param when not provided', async () => {
    const deps = mockFetch(200, { mediaItems: [] })

    await listPickerMediaItems('session-abc', 'token-123', undefined, deps)

    const fetchFn = deps.fetch as ReturnType<typeof vi.fn>
    const calledUrl = fetchFn.mock.calls[0][0] as string
    expect(calledUrl).toContain('pageSize=100')
    expect(calledUrl).not.toContain('pageToken')
  })

  it('throws "Token expired" on 401', async () => {
    const deps = mockFetch(401, {})

    await expect(listPickerMediaItems('session-abc', 'bad-token', undefined, deps)).rejects.toThrow(
      'Token expired'
    )
  })

  it('throws with status on other errors', async () => {
    const deps = mockFetch(404, { error: { message: 'Not found' } })

    await expect(listPickerMediaItems('session-abc', 'token', undefined, deps)).rejects.toThrow(
      'Failed to list picker media items: 404'
    )
  })
})
