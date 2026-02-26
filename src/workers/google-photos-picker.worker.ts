/**
 * Worker thread entry point for the Google Photos Picker download phase.
 *
 * Receives { sessionId, tokens, downloadDir } via workerData,
 * runs downloadPickerPhotos, and posts progress/complete/error messages back to
 * the main thread.
 *
 * Supports cooperative cancellation: the worker listens for { type: 'cancel' }
 * messages from the parent and stops processing between items.
 *
 * This file is intentionally thin — all logic lives in
 * src/main/google-photos-picker-downloader.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */

/* v8 ignore file */
import { parentPort, workerData } from 'worker_threads'
import {
  downloadPickerPhotos,
  type DownloaderTokens
} from '../main/google-photos-picker-downloader'

const { sessionId, tokens, downloadDir } = workerData as {
  sessionId: string
  tokens: DownloaderTokens
  downloadDir: string
}

let cancelled = false
parentPort!.on('message', (msg: { type: string }) => {
  if (msg.type === 'cancel') cancelled = true
})

downloadPickerPhotos(
  sessionId,
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
