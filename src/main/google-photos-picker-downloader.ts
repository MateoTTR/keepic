import { writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, extname, basename } from 'path'
import type {
  GoogleDownloadProgress,
  GoogleDownloadResult,
  ImportStatus,
  PickerMediaItem
} from '../shared/types'
import { listPickerMediaItems } from './google-photos-picker'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloaderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  credentials: {
    clientId: string
    clientSecret: string
  }
}

export type ListMediaItemsFn = (
  sessionId: string,
  accessToken: string,
  pageToken?: string
) => Promise<{ items: PickerMediaItem[]; nextPageToken?: string }>

export interface DownloaderDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  writeFile?: (path: string, data: Buffer) => void
  mkdirp?: (path: string) => void
  renameFile?: (oldPath: string, newPath: string) => void
  isCancelled?: () => boolean
  listMediaItems?: ListMediaItemsFn
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Returns true if the buffer starts with JPEG magic bytes (FF D8 FF).
 */
export function isJpegBuffer(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
}

/**
 * If the filename has a HEIC/HEIF extension but the content is actually JPEG
 * (detected via magic bytes), returns the filename with .jpg extension.
 * Otherwise returns the filename unchanged.
 *
 * This handles the Google Picker API serving JPEG content with .HEIC filenames.
 */
export function fixHeicJpegExtension(filename: string, data: Buffer): string {
  const ext = extname(filename).toLowerCase()
  if ((ext === '.heic' || ext === '.heif') && isJpegBuffer(data)) {
    return filename.slice(0, -ext.length) + '.jpg'
  }
  return filename
}

/**
 * Downloads the original file for one media item to destPath.
 * Appends '=d' to the baseUrl to request the original quality file.
 * Returns the downloaded buffer for post-processing (e.g. magic bytes check).
 */
export async function downloadMediaItem(
  item: PickerMediaItem,
  accessToken: string,
  destPath: string,
  deps?: Pick<DownloaderDeps, 'fetch' | 'writeFile'>
): Promise<Buffer> {
  /* v8 ignore next */
  const fetchFn = deps?.fetch ?? globalThis.fetch
  /* v8 ignore next */
  const writeFileFn = deps?.writeFile ?? ((p: string, d: Buffer) => writeFileSync(p, d))

  const response = await fetchFn(`${item.baseUrl}=d`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!response.ok) {
    throw new Error(`Download failed for ${item.filename}: ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileFn(destPath, buffer)
  return buffer
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
 * Downloads all media items selected in a Picker session into downloadDir.
 *
 * Phase 1: lists all items via paginated `listMediaItems` calls.
 * Phase 2: downloads each item's original file (baseUrl + '=d').
 *
 * - Refreshes the access token automatically on a "Token expired" error during listing.
 * - Resolves filename collisions with _N suffix.
 * - Errors on individual items are recorded and do not abort the download.
 * - Supports cooperative cancellation via deps.isCancelled().
 * - Returns the updated access token if a refresh occurred.
 */
export async function downloadPickerPhotos(
  sessionId: string,
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
  const renameFileFn = deps?.renameFile ?? ((o: string, n: string) => renameSync(o, n))
  /* v8 ignore next */
  const isCancelled = deps?.isCancelled ?? (() => false)
  /* v8 ignore next */
  const listMediaItemsFn = deps?.listMediaItems ?? listPickerMediaItems

  let accessToken = tokens.accessToken
  let updatedAccessToken: string | undefined
  let updatedExpiresAt: number | undefined

  const errors: Array<{ filename: string; error: string }> = []
  let status: ImportStatus = 'completed'

  // ---------------------------------------------------------------------------
  // Phase 1: collect all media items (pagination)
  // ---------------------------------------------------------------------------

  const allItems: PickerMediaItem[] = []
  let pageToken: string | undefined
  const fetchDeps = { fetch: fetchFn }

  do {
    let pageResult: { items: PickerMediaItem[]; nextPageToken?: string }

    try {
      pageResult = await listMediaItemsFn(sessionId, accessToken, pageToken)
    } catch (err) {
      /* v8 ignore next */
      const message = err instanceof Error ? err.message : String(err)

      // Detect "Token expired" and attempt a token refresh
      if (message === 'Token expired') {
        const refreshed = await refreshAccessToken(
          tokens.refreshToken,
          tokens.credentials,
          fetchDeps
        )
        if (!refreshed) {
          errors.push({ filename: '', error: `Token refresh failed: ${message}` })
          status = 'failed'
          // updatedAccessToken is still undefined here (refresh failed before we set it)
          return { status, downloaded: 0, errors, downloadDir }
        }
        accessToken = refreshed.accessToken
        updatedAccessToken = refreshed.accessToken
        updatedExpiresAt = refreshed.expiresAt

        // Retry the page with the new token
        try {
          pageResult = await listMediaItemsFn(sessionId, accessToken, pageToken)
        } catch (retryErr) {
          /* v8 ignore next 4 */
          errors.push({
            filename: '',
            error: retryErr instanceof Error ? retryErr.message : String(retryErr)
          })
          status = 'failed'
          return {
            status,
            downloaded: 0,
            errors,
            downloadDir,
            ...(updatedAccessToken !== undefined && { updatedAccessToken, updatedExpiresAt })
          }
        }
      } else {
        errors.push({ filename: '', error: message })
        status = 'failed'
        return { status, downloaded: 0, errors, downloadDir }
      }
    }

    allItems.push(...pageResult.items)
    pageToken = pageResult.nextPageToken
  } while (pageToken)

  // ---------------------------------------------------------------------------
  // Phase 2: download each item
  // ---------------------------------------------------------------------------

  mkdirpFn(downloadDir)

  const total = allItems.length
  let downloaded = 0
  const usedFilenames = new Set<string>()
  const downloadDeps = { fetch: fetchFn, writeFile: writeFileFn }

  for (const item of allItems) {
    if (isCancelled()) {
      status = 'cancelled'
      break
    }

    const filename = resolveFilenameCollision(item.filename, usedFilenames)
    usedFilenames.add(filename)
    const destPath = join(downloadDir, filename)

    onProgress({ total, downloaded, currentFile: item.filename })

    try {
      const buffer = await downloadMediaItem(item, accessToken, destPath, downloadDeps)

      // Fix HEIC extension if Google served JPEG content with .HEIC filename
      const correctedFilename = fixHeicJpegExtension(filename, buffer)
      if (correctedFilename !== filename) {
        const finalFilename = resolveFilenameCollision(correctedFilename, usedFilenames)
        const correctedPath = join(downloadDir, finalFilename)
        renameFileFn(destPath, correctedPath)
        usedFilenames.delete(filename)
        usedFilenames.add(finalFilename)
      }

      downloaded++
    } catch (err) {
      /* v8 ignore next 4 */
      errors.push({
        filename: item.filename,
        error: err instanceof Error ? err.message : String(err)
      })
    }

    onProgress({ total, downloaded, currentFile: item.filename })
  }

  return {
    status,
    downloaded,
    errors,
    downloadDir,
    ...(updatedAccessToken !== undefined && { updatedAccessToken, updatedExpiresAt })
  }
}
