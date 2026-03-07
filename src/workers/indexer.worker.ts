/**
 * Worker thread entry point for the library indexer.
 *
 * Receives { libraryPath, dbPath } via workerData, runs the indexer, and
 * posts progress/complete/error messages back to the main thread.
 *
 * Creates a HeicDecodePool for parallel HEIC decoding via native libheif.
 *
 * This file is intentionally thin — all logic lives in src/main/indexer.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort, workerData } from 'worker_threads'
import { KeePicDatabase } from '../main/db/database'
import { runIndexer } from '../main/indexer'
import { createUniversalPhashComputer } from '../main/heic'
import { HeicDecodePool, getHeicDecodeWorkerPath } from '../main/heic-pool'
import type { IndexProgress } from '../shared/types'

const { libraryPath, dbPath } = workerData as { libraryPath: string; dbPath: string }

const db = new KeePicDatabase(dbPath)
db.open()

async function run(): Promise<void> {
  const pool = await HeicDecodePool.create(getHeicDecodeWorkerPath())

  try {
    const computePhash = createUniversalPhashComputer({
      decodeFn: (buffer) => pool.decode(buffer)
    })

    const result = await runIndexer(
      libraryPath,
      db,
      (progress: IndexProgress) => {
        parentPort!.postMessage({ type: 'progress', ...progress })
      },
      { computePhash }
    )

    db.close()
    parentPort!.postMessage({ type: 'complete', ...result })
  } catch (err) {
    db.close()
    parentPort!.postMessage({ type: 'error', message: (err as Error).message })
  } finally {
    await pool.terminate()
  }
}

run()
