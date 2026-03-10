/**
 * Worker thread for duplicate scanning.
 *
 * Receives photo rows via parentPort message, runs Multi-Index Hashing
 * + dual-hash matching, and posts progress/complete messages back.
 *
 * This file is intentionally thin — all logic lives in dedup-scan-handler.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort } from 'worker_threads'
import { findDuplicateGroups, type PhotoRow } from '../main/ipc/dedup-scan-handler'

parentPort!.on('message', (msg: { type: string; photoRows: PhotoRow[]; threshold?: number }) => {
  if (msg.type !== 'scan') return

  const groups = findDuplicateGroups(msg.photoRows, msg.threshold ?? 0, (processed, total) => {
    // Throttle progress to avoid flooding the main thread — every 5%
    if (processed % Math.max(1, Math.floor(total / 20)) === 0 || processed === total) {
      parentPort!.postMessage({ type: 'progress', processed, total })
    }
  })

  parentPort!.postMessage({ type: 'complete', groups })
})
