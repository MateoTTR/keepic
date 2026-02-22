/**
 * Worker thread entry point for the library indexer.
 *
 * Receives { libraryPath, dbPath } via workerData, runs the indexer, and
 * posts progress/complete/error messages back to the main thread.
 *
 * This file is intentionally thin — all logic lives in src/main/indexer.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort, workerData } from 'worker_threads'
import { KeePicDatabase } from '../main/db/database'
import { runIndexer } from '../main/indexer'
import type { IndexProgress } from '../shared/types'

const { libraryPath, dbPath } = workerData as { libraryPath: string; dbPath: string }

const db = new KeePicDatabase(dbPath)
db.open()

runIndexer(libraryPath, db, (progress: IndexProgress) => {
  parentPort!.postMessage({ type: 'progress', ...progress })
})
  .then((result) => {
    db.close()
    parentPort!.postMessage({ type: 'complete', ...result })
  })
  .catch((err: Error) => {
    db.close()
    parentPort!.postMessage({ type: 'error', message: err.message })
  })
