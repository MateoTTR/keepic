import type { PickerMediaItem, PickerSession } from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickerDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}

async function handleErrorResponse(response: Response, context: string): Promise<never> {
  const text = await response.text()
  if (response.status === 401) {
    throw new Error('Token expired')
  }
  throw new Error(`${context}: ${response.status} ${text}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new Picker session.
 * The user must open `pickerUri` in a browser to select photos.
 */
export async function createPickerSession(
  accessToken: string,
  deps?: PickerDeps
): Promise<Pick<PickerSession, 'id' | 'pickerUri'>> {
  /* v8 ignore next 1 */
  const fetchFn = deps?.fetch ?? globalThis.fetch

  const response = await fetchFn(`${PICKER_API_BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: '{}'
  })

  if (!response.ok) {
    return handleErrorResponse(response, 'Failed to create picker session')
  }

  const data = (await response.json()) as { id: string; pickerUri: string }
  return { id: data.id, pickerUri: data.pickerUri }
}

/**
 * Polls a Picker session to check whether the user has finished selecting photos.
 * Returns `{ mediaItemsSet: true }` once the user clicks "Done" in the picker UI.
 */
export async function pollPickerSession(
  sessionId: string,
  accessToken: string,
  deps?: PickerDeps
): Promise<Pick<PickerSession, 'mediaItemsSet'>> {
  /* v8 ignore next 1 */
  const fetchFn = deps?.fetch ?? globalThis.fetch

  const response = await fetchFn(`${PICKER_API_BASE}/sessions/${sessionId}`, {
    method: 'GET',
    headers: authHeaders(accessToken)
  })

  if (!response.ok) {
    return handleErrorResponse(response, 'Failed to poll picker session')
  }

  const data = (await response.json()) as { mediaItemsSet?: boolean }
  return { mediaItemsSet: data.mediaItemsSet === true }
}

/**
 * Lists media items from a completed Picker session (paginated).
 * Call repeatedly with `nextPageToken` until it is undefined.
 */
export async function listPickerMediaItems(
  sessionId: string,
  accessToken: string,
  pageToken?: string,
  deps?: PickerDeps
): Promise<{ items: PickerMediaItem[]; nextPageToken?: string }> {
  /* v8 ignore next 1 */
  const fetchFn = deps?.fetch ?? globalThis.fetch

  const params = new URLSearchParams({ sessionId, pageSize: '100' })
  if (pageToken) {
    params.set('pageToken', pageToken)
  }

  const response = await fetchFn(`${PICKER_API_BASE}/mediaItems?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(accessToken)
  })

  if (!response.ok) {
    return handleErrorResponse(response, 'Failed to list picker media items')
  }

  const data = (await response.json()) as {
    mediaItems?: Array<{
      id: string
      baseUrl: string
      mimeType: string
      mediaFile?: {
        filename: string
        baseUrl: string
        mimeType: string
        mediaFileMetadata?: {
          cameraMake?: string
          cameraModel?: string
          photoMetadata?: Record<string, unknown>
          videoMetadata?: Record<string, unknown>
        }
      }
      type?: string
      createTime?: string
    }>
    nextPageToken?: string
  }

  const items: PickerMediaItem[] = (data.mediaItems ?? []).map((item) => ({
    id: item.id,
    baseUrl: item.mediaFile?.baseUrl ?? item.baseUrl,
    mimeType: item.mediaFile?.mimeType ?? item.mimeType,
    filename: item.mediaFile?.filename ?? `${item.id}.jpg`,
    mediaMetadata: {
      creationTime: item.createTime ?? '',
      width: '',
      height: ''
    }
  }))

  return {
    items,
    nextPageToken: data.nextPageToken
  }
}
