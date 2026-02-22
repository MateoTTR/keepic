/**
 * Worker thread entry point for the Google Photos download phase.
 *
 * Receives { startDate, tokens, downloadDir, dbPath, config } via workerData,
 * runs downloadGooglePhotos, and posts progress/complete/error messages back to
 * the main thread.
 *
 * Supports cooperative cancellation: the worker listens for { type: 'cancel' }
 * messages from the parent and stops processing between items.
 *
 * This file is intentionally thin — all logic lives in
 * src/main/google-photos-downloader.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */

/* v8 ignore file */
import { parentPort, workerData } from 'worker_threads'
import { downloadGooglePhotos, type DownloaderTokens } from '../main/google-photos-downloader'
import type { AppConfig } from '../shared/types'

const { startDate, tokens, downloadDir } = workerData as {
  startDate: string
  tokens: DownloaderTokens
  downloadDir: string
  dbPath: string
  config: AppConfig
}

let cancelled = false
parentPort!.on('message', (msg: { type: string }) => {
  if (msg.type === 'cancel') cancelled = true
})

downloadGooglePhotos(
  startDate,
  tokens,
  downloadDir,
  (progress) => {
    parentPort!.postMessage({ type: 'progress', ...progress })
  },
  { isCancelled: () => cancelled }
)
  .then((result) => {
    parentPort!.postMessage({ type: 'complete', ...result })
  })
  .catch((err: Error) => {
    parentPort!.postMessage({ type: 'error', message: err.message })
  })
