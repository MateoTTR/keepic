import { rmSync } from 'fs'
import { Worker } from 'worker_threads'
import type { KeePicDatabase } from '../db/database'
import {
  getValidAccessToken,
  getStoredTokensForDownload,
  updateStoredAccessToken,
  type GoogleAuthDeps
} from '../google-auth'
import { createPickerSession, pollPickerSession, type PickerDeps } from '../google-photos-picker'
import type { DownloaderTokens } from '../google-photos-picker-downloader'
import type { GoogleDownloadProgress, GoogleDownloadResult } from '../../shared/types'

// ---------------------------------------------------------------------------
// handleGetLastDownloadDate
// ---------------------------------------------------------------------------

/**
 * Returns the last_imported_date of the most recent completed google_photos job,
 * or null if no such job exists.
 */
export function handleGetLastDownloadDate(db: KeePicDatabase): { date: string | null } {
  const row = db.db
    .prepare(
      `SELECT last_imported_date FROM import_jobs
       WHERE source = 'google_photos' AND status = 'completed'
       ORDER BY finished_at DESC
       LIMIT 1`
    )
    .get() as { last_imported_date: string | null } | undefined

  return { date: row?.last_imported_date ?? null }
}

// ---------------------------------------------------------------------------
// handleCreatePickerSession
// ---------------------------------------------------------------------------

export interface PickerHandlerDeps {
  authDeps?: GoogleAuthDeps
  pickerDeps?: PickerDeps
}

/**
 * Maps internal Picker API error messages to user-facing, actionable strings.
 * "Token expired" (401 from the Picker API) is a sentinel used internally by the
 * downloader for token refresh; surface a clearer message to the UI instead.
 */
function toUserFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message === 'Token expired') {
    return 'Your Google session has expired. Please disconnect and reconnect to continue.'
  }
  return message
}

/**
 * Creates a new Picker session. Returns { sessionId, pickerUri } or { error }.
 */
export async function handleCreatePickerSession(
  deps?: PickerHandlerDeps
): Promise<{ sessionId: string; pickerUri: string } | { error: string }> {
  try {
    const accessToken = await getValidAccessToken(deps?.authDeps)
    if (!accessToken) {
      return { error: 'Not authenticated — please connect to Google Photos first' }
    }
    const session = await createPickerSession(accessToken, deps?.pickerDeps)
    return { sessionId: session.id, pickerUri: session.pickerUri }
  } catch (err) {
    return { error: toUserFacingError(err) }
  }
}

// ---------------------------------------------------------------------------
// handlePollPickerSession
// ---------------------------------------------------------------------------

/**
 * Polls a Picker session. Returns { ready: boolean } or { error }.
 */
export async function handlePollPickerSession(
  sessionId: string,
  deps?: PickerHandlerDeps
): Promise<{ ready: boolean } | { error: string }> {
  try {
    const accessToken = await getValidAccessToken(deps?.authDeps)
    if (!accessToken) {
      return { error: 'Not authenticated — please connect to Google Photos first' }
    }
    const result = await pollPickerSession(sessionId, accessToken, deps?.pickerDeps)
    return { ready: result.mediaItemsSet }
  } catch (err) {
    return { error: toUserFacingError(err) }
  }
}

// ---------------------------------------------------------------------------
// handleStartPickerDownload / handleCancelPickerDownload
// ---------------------------------------------------------------------------

export interface ActivePickerWorkerRef {
  value: Worker | null
}

export type WorkerFactory = (
  scriptPath: string,
  options: { workerData: Record<string, unknown> }
) => Worker

/* v8 ignore next 2 */
export const defaultWorkerFactory: WorkerFactory = (scriptPath, options) =>
  new Worker(scriptPath, options)

export interface StartPickerDownloadDeps {
  authDeps?: GoogleAuthDeps
  createWorker?: WorkerFactory
  /** Injectable for testing: returns tokens without hitting keytar */
  getTokens?: () => Promise<DownloaderTokens | null>
}

/**
 * Spawns the Picker download worker (synchronous inner logic, takes pre-fetched tokens).
 * Exported for unit testing. Use handleStartPickerDownload for the full async flow.
 */
export function spawnPickerDownloadWorker(
  sessionId: string,
  downloadDir: string,
  tokens: DownloaderTokens,
  onProgress: (p: GoogleDownloadProgress) => void,
  onComplete: (r: GoogleDownloadResult) => void,
  activeWorkerRef: ActivePickerWorkerRef,
  workerPath: string,
  deps?: StartPickerDownloadDeps
): { started: true } {
  /* v8 ignore next */
  const createWorker = deps?.createWorker ?? defaultWorkerFactory

  const worker = createWorker(workerPath, {
    workerData: { sessionId, tokens, downloadDir }
  })

  activeWorkerRef.value = worker

  worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
    if (msg.type === 'progress') {
      onProgress(msg as unknown as GoogleDownloadProgress)
    } else if (msg.type === 'complete') {
      activeWorkerRef.value = null
      const result = msg as unknown as GoogleDownloadResult & {
        updatedAccessToken?: string
        updatedExpiresAt?: number
      }
      if (result.updatedAccessToken && result.updatedExpiresAt) {
        void updateStoredAccessToken(
          result.updatedAccessToken,
          result.updatedExpiresAt,
          deps?.authDeps
        )
      }
      onComplete(result)
    } else if (msg.type === 'error') {
      activeWorkerRef.value = null
      onComplete({
        downloaded: 0,
        errors: [{ filename: '', error: msg.message as string }],
        status: 'failed',
        downloadDir
      })
    }
  })

  worker.on('error', (err: Error) => {
    activeWorkerRef.value = null
    onComplete({
      downloaded: 0,
      errors: [{ filename: '', error: err.message }],
      status: 'failed',
      downloadDir
    })
  })

  worker.on('exit', (code) => {
    if (activeWorkerRef.value === worker) {
      activeWorkerRef.value = null
      onComplete({
        downloaded: 0,
        errors: [{ filename: '', error: `Worker exited unexpectedly (code ${code})` }],
        status: 'failed',
        downloadDir
      })
    }
  })

  return { started: true }
}

/**
 * Fetches stored tokens, then spawns the Picker download worker.
 * Returns { started: true }, { alreadyRunning: true }, or { error }.
 */
export async function handleStartPickerDownload(
  sessionId: string,
  downloadDir: string,
  onProgress: (p: GoogleDownloadProgress) => void,
  onComplete: (r: GoogleDownloadResult) => void,
  activeWorkerRef: ActivePickerWorkerRef,
  workerPath: string,
  deps?: StartPickerDownloadDeps
): Promise<{ started: true } | { alreadyRunning: true } | { error: string }> {
  if (activeWorkerRef.value !== null) {
    return { alreadyRunning: true }
  }

  const getTokensFn = deps?.getTokens ?? (() => getStoredTokensForDownload(deps?.authDeps))
  const tokens = await getTokensFn()

  if (!tokens) {
    return { error: 'Not authenticated — please connect to Google Photos first' }
  }

  return spawnPickerDownloadWorker(
    sessionId,
    downloadDir,
    tokens,
    onProgress,
    onComplete,
    activeWorkerRef,
    workerPath,
    deps
  )
}

/**
 * Requests cancellation of the running Picker download worker.
 */
export function handleCancelPickerDownload(
  activeWorkerRef: ActivePickerWorkerRef
): { cancelled: true } | { noWorker: true } {
  if (activeWorkerRef.value === null) {
    return { noWorker: true }
  }
  activeWorkerRef.value.postMessage({ type: 'cancel' })
  return { cancelled: true }
}

// ---------------------------------------------------------------------------
// handleCleanupDownloadDir
// ---------------------------------------------------------------------------

/**
 * Deletes the Google Photos download staging directory.
 * Called from the renderer when the user dismisses the result screen.
 */
export function handleCleanupDownloadDir(
  dirPath: string,
  rmDir: (p: string) => void = (p) => rmSync(p, { recursive: true, force: true })
): void {
  rmDir(dirPath)
}
