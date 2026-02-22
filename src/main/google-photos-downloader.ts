import { writeFileSync, mkdirSync } from 'fs'
import { join, extname, basename } from 'path'
import type { GoogleDownloadProgress, GoogleDownloadResult, ImportStatus } from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_PHOTOS_SEARCH_URL = 'https://photoslibrary.googleapis.com/v1/mediaItems:search'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleMediaItem {
  id: string
  filename: string
  mimeType: string
  baseUrl: string
  mediaMetadata: {
    creationTime: string
    width: string
    height: string
  }
}

export interface FetchPageResult {
  items: GoogleMediaItem[]
  nextPageToken?: string
}

export interface DownloaderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp ms
  credentials: {
    clientId: string
    clientSecret: string
  }
}

export interface DownloaderDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  writeFile?: (path: string, data: Buffer) => void
  mkdirp?: (path: string) => void
  isCancelled?: () => boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a 'YYYY-MM-DD' string into { year, month, day } for the Google API.
 */
export function parseDateForApi(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
}

/**
 * Resolves filename collisions by appending _1, _2, ... to the stem.
 * Returns a unique filename that does not exist in the usedFilenames set.
 */
export function resolveFilenameCollision(filename: string, usedFilenames: Set<string>): string {
  if (!usedFilenames.has(filename)) return filename

  const ext = extname(filename)
  const stem = basename(filename, ext)

  for (let n = 1; n <= 99; n++) {
    const candidate = `${stem}_${n}${ext}`
    if (!usedFilenames.has(candidate)) return candidate
  }

  // Fallback: append timestamp (virtually impossible to collide)
  return `${stem}_${Date.now()}${ext}`
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Fetches one page of media items from the Google Photos API, filtered by start date.
 * Only returns PHOTO type items (video items are excluded at the API level).
 *
 * @param accessToken  Valid OAuth 2.0 access token
 * @param startDate    Inclusive start date in 'YYYY-MM-DD' format
 * @param pageToken    Pagination token from the previous page (omit for first page)
 */
export async function fetchMediaPage(
  accessToken: string,
  startDate: string,
  pageToken?: string,
  deps?: Pick<DownloaderDeps, 'fetch'>
): Promise<FetchPageResult> {
  /* v8 ignore next */
  const fetchFn = deps?.fetch ?? globalThis.fetch
  const { year, month, day } = parseDateForApi(startDate)

  const body: Record<string, unknown> = {
    pageSize: PAGE_SIZE,
    filters: {
      dateFilter: {
        ranges: [
          {
            startDate: { year, month, day },
            endDate: { year: 2099, month: 12, day: 31 }
          }
        ]
      },
      mediaTypeFilter: { mediaTypes: ['PHOTO'] }
    }
  }

  if (pageToken) {
    body.pageToken = pageToken
  }

  const response = await fetchFn(GOOGLE_PHOTOS_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Google Photos API error: ${response.status} ${text}`)
  }

  const data = (await response.json()) as {
    mediaItems?: GoogleMediaItem[]
    nextPageToken?: string
  }

  return {
    items: data.mediaItems ?? [],
    nextPageToken: data.nextPageToken
  }
}

/**
 * Downloads the original file for one media item to destPath.
 * Appends '=d' to the baseUrl to request the original quality file.
 */
export async function downloadMediaItem(
  item: GoogleMediaItem,
  accessToken: string,
  destPath: string,
  deps?: Pick<DownloaderDeps, 'fetch' | 'writeFile'>
): Promise<void> {
  /* v8 ignore next */
  const fetchFn = deps?.fetch ?? globalThis.fetch
  /* v8 ignore next */
  const writeFileFn = deps?.writeFile ?? ((p, d) => writeFileSync(p, d))

  const response = await fetchFn(`${item.baseUrl}=d`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!response.ok) {
    throw new Error(`Download failed for ${item.filename}: ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileFn(destPath, buffer)
}

/**
 * Attempts to refresh the access token using the provided refresh token + credentials.
 * Returns the new { accessToken, expiresAt } on success, or null if the refresh fails.
 */
export async function refreshAccessToken(
  refreshToken: string,
  credentials: { clientId: string; clientSecret: string },
  deps?: Pick<DownloaderDeps, 'fetch'>
): Promise<{ accessToken: string; expiresAt: number } | null> {
  /* v8 ignore next */
  const fetchFn = deps?.fetch ?? globalThis.fetch

  let response: Response
  try {
    response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const data = (await response.json()) as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Downloads all Google Photos items created on or after startDate into downloadDir.
 *
 * - Paginates through the API until all pages are fetched or cancellation is requested.
 * - Refreshes the access token automatically on a 401 response.
 * - Resolves filename collisions with _N suffix.
 * - Errors on individual items are recorded and do not abort the download.
 * - Returns the updated access token if a refresh occurred.
 */
export async function downloadGooglePhotos(
  startDate: string,
  tokens: DownloaderTokens,
  downloadDir: string,
  onProgress: (p: GoogleDownloadProgress) => void,
  deps?: DownloaderDeps
): Promise<GoogleDownloadResult & { updatedAccessToken?: string; updatedExpiresAt?: number }> {
  /* v8 ignore next */
  const fetchFn = deps?.fetch ?? globalThis.fetch
  /* v8 ignore next */
  const writeFileFn = deps?.writeFile ?? ((p: string, d: Buffer) => writeFileSync(p, d))
  /* v8 ignore next */
  const mkdirpFn = deps?.mkdirp ?? ((p: string) => mkdirSync(p, { recursive: true }))
  /* v8 ignore next */
  const isCancelled = deps?.isCancelled ?? (() => false)

  mkdirpFn(downloadDir)

  let accessToken = tokens.accessToken
  let updatedAccessToken: string | undefined
  let updatedExpiresAt: number | undefined

  let pageToken: string | undefined
  let fetched = 0
  let downloaded = 0
  const errors: Array<{ filename: string; error: string }> = []
  const usedFilenames = new Set<string>()
  let status: ImportStatus = 'completed'

  const fetchDeps = { fetch: fetchFn }
  const downloadDeps = { fetch: fetchFn, writeFile: writeFileFn }

  outer: do {
    if (isCancelled()) {
      status = 'cancelled'
      break
    }

    let pageResult: FetchPageResult

    // --- Fetch one page, with one token-refresh retry on 401 ---
    try {
      pageResult = await fetchMediaPage(accessToken, startDate, pageToken, fetchDeps)
    } catch (err) {
      /* v8 ignore next */
      const message = err instanceof Error ? err.message : String(err)

      // Detect 401 and attempt a token refresh
      if (message.includes('401')) {
        const refreshed = await refreshAccessToken(
          tokens.refreshToken,
          tokens.credentials,
          fetchDeps
        )
        if (!refreshed) {
          errors.push({ filename: '', error: `Token refresh failed: ${message}` })
          status = 'failed'
          break
        }
        accessToken = refreshed.accessToken
        updatedAccessToken = refreshed.accessToken
        updatedExpiresAt = refreshed.expiresAt

        // Retry the page with the new token
        try {
          pageResult = await fetchMediaPage(accessToken, startDate, pageToken, fetchDeps)
        } catch (retryErr) {
          errors.push({
            filename: '',
            /* v8 ignore next */
            error: retryErr instanceof Error ? retryErr.message : String(retryErr)
          })
          status = 'failed'
          break
        }
      } else {
        errors.push({ filename: '', error: message })
        status = 'failed'
        break
      }
    }

    fetched += pageResult.items.length
    pageToken = pageResult.nextPageToken

    // --- Download each item in the page ---
    for (const item of pageResult.items) {
      if (isCancelled()) {
        status = 'cancelled'
        break outer
      }

      // Defensive guard: skip video items (API filter should already exclude them)
      if (item.mimeType.startsWith('video/')) continue

      const filename = resolveFilenameCollision(item.filename, usedFilenames)
      usedFilenames.add(filename)
      const destPath = join(downloadDir, filename)

      onProgress({ fetched, downloaded, currentFile: item.filename })

      try {
        await downloadMediaItem(item, accessToken, destPath, downloadDeps)
        downloaded++
      } catch (err) {
        errors.push({
          filename: item.filename,
          /* v8 ignore next */
          error: err instanceof Error ? err.message : String(err)
        })
      }

      onProgress({ fetched, downloaded, currentFile: item.filename })
    }
  } while (pageToken)

  return {
    status,
    downloaded,
    errors,
    downloadDir,
    ...(updatedAccessToken !== undefined && {
      updatedAccessToken,
      updatedExpiresAt
    })
  }
}
