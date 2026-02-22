import { join } from 'path'
import { rmSync } from 'fs'
import { Worker } from 'worker_threads'
import { getValidAccessToken } from '../google-auth'
import type { KeePicDatabase } from '../db/database'
import type { AppConfig, GoogleDownloadProgress, GoogleDownloadResult } from '../../shared/types'
import type { DownloaderTokens } from '../google-photos-downloader'
import type { StoredTokens } from '../google-auth'

// ---------------------------------------------------------------------------
// Injectable types (same pattern as import-handlers.ts)
// ---------------------------------------------------------------------------

export interface WorkerOptions {
  workerData: Record<string, unknown>
}

export type WorkerFactory = (scriptPath: string, options: WorkerOptions) => Worker

/* v8 ignore next 2 */
export const defaultWorkerFactory: WorkerFactory = (scriptPath, options) =>
  new Worker(scriptPath, options)

export interface ActiveWorkerRef {
  value: Worker | null
}

export type GetValidAccessTokenFn = typeof getValidAccessToken

export type KeytarGetFn = (service: string, account: string) => Promise<string | null>
export type KeytarSetFn = (service: string, account: string, password: string) => Promise<void>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYTAR_SERVICE = 'com.keepic.app'
const KEYTAR_ACCOUNT = 'google-tokens'

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

// ---------------------------------------------------------------------------
// handleStartDownload
// ---------------------------------------------------------------------------

/**
 * Starts the Google Photos download worker (fire-and-forget).
 * Returns { started: true } | { alreadyRunning: true } | { error: string }.
 *
 * On completion, persists updated tokens in keytar (if a refresh occurred)
 * and records a google_photos import_job in the DB.
 */
export async function handleStartDownload(
  startDate: string,
  db: KeePicDatabase,
  dbPath: string,
  userDataPath: string,
  config: AppConfig,
  onProgress: (p: GoogleDownloadProgress) => void,
  onComplete: (r: GoogleDownloadResult) => void,
  activeWorkerRef: ActiveWorkerRef,
  workerPath: string,
  deps?: {
    getToken?: GetValidAccessTokenFn
    keytarGet?: KeytarGetFn
    keytarSet?: KeytarSetFn
    createWorker?: WorkerFactory
  }
): Promise<{ started: true } | { alreadyRunning: true } | { error: string }> {
  if (activeWorkerRef.value !== null) {
    return { alreadyRunning: true }
  }

  /* v8 ignore next */
  const getToken = deps?.getToken ?? getValidAccessToken
  /* v8 ignore next 8 */
  const keytarGet =
    deps?.keytarGet ??
    (async (s: string, a: string) => {
      const keytar = await import('keytar')
      return keytar.default.getPassword(s, a)
    })
  /* v8 ignore next 8 */
  const keytarSet =
    deps?.keytarSet ??
    (async (s: string, a: string, p: string) => {
      const keytar = await import('keytar')
      return keytar.default.setPassword(s, a, p)
    })
  const createWorker = deps?.createWorker ?? defaultWorkerFactory

  // Get a valid access token from the main process (uses keytar)
  const accessToken = await getToken()
  if (!accessToken) {
    return { error: 'Not authenticated with Google Photos' }
  }

  // Read the full stored tokens to get refreshToken + credentials for the worker
  const raw = await keytarGet(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!raw) {
    return { error: 'Could not read stored tokens' }
  }

  const storedTokens = JSON.parse(raw) as StoredTokens

  // Build the credentials object for the worker
  const workerTokens: DownloaderTokens = {
    accessToken,
    refreshToken: storedTokens.refreshToken,
    expiresAt: storedTokens.expiresAt,
    credentials: {
      clientId: (import.meta.env['GOOGLE_CLIENT_ID'] as string) ?? '',
      clientSecret: (import.meta.env['GOOGLE_CLIENT_SECRET'] as string) ?? ''
    }
  }

  const downloadDir = join(userDataPath, 'temp', `google-${Date.now()}`)
  const startedAt = new Date().toISOString()

  const worker = createWorker(workerPath, {
    workerData: { startDate, tokens: workerTokens, downloadDir, dbPath, config }
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

      // Persist updated tokens if the worker refreshed them
      if (result.updatedAccessToken) {
        const updatedTokens: StoredTokens = {
          ...storedTokens,
          accessToken: result.updatedAccessToken,
          expiresAt: result.updatedExpiresAt ?? storedTokens.expiresAt
        }
        void keytarSet(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(updatedTokens))
      }

      // Record the download job in import_jobs (only on success)
      if (result.status === 'completed') {
        const finishedAt = new Date().toISOString()
        const today = new Date().toISOString().slice(0, 10)
        db.db
          .prepare(
            `INSERT INTO import_jobs
                 (source, started_at, finished_at, status, photos_imported, photos_skipped,
                  live_photos_discarded, last_imported_date, last_page_token)
               VALUES ('google_photos', ?, ?, 'completed', ?, 0, 0, ?, NULL)`
          )
          .run(startedAt, finishedAt, result.downloaded, today)
      }

      onComplete({
        status: result.status,
        downloaded: result.downloaded,
        errors: result.errors,
        downloadDir: result.downloadDir
      })
    } else if (msg.type === 'error') {
      activeWorkerRef.value = null
      onComplete({
        status: 'failed',
        downloaded: 0,
        errors: [{ filename: '', error: msg.message as string }],
        downloadDir
      })
    }
  })

  worker.on('error', (err: Error) => {
    activeWorkerRef.value = null
    onComplete({
      status: 'failed',
      downloaded: 0,
      errors: [{ filename: '', error: err.message }],
      downloadDir
    })
  })

  return { started: true }
}

// ---------------------------------------------------------------------------
// handleCancelDownload
// ---------------------------------------------------------------------------

/**
 * Sends a cancel message to the running download worker.
 * No-op if no worker is running.
 */
export function handleCancelDownload(activeWorkerRef: ActiveWorkerRef): void {
  activeWorkerRef.value?.postMessage({ type: 'cancel' })
}
