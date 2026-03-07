/**
 * Worker thread entry point for the import executor (Phase 2).
 *
 * Receives { plan, libraryPath, tempDir, dbPath, config } via workerData,
 * runs executeImportPlan, and posts progress/complete/error messages back to
 * the main thread.
 *
 * Creates a HeicDecodePool for parallel HEIC decoding via native libheif.
 * Supports cooperative cancellation: the worker listens for { type: 'cancel' }
 * messages from the parent and stops processing between files.
 *
 * This file is intentionally thin — all logic lives in src/main/importer.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort, workerData } from 'worker_threads'
import { KeePicDatabase } from '../main/db/database'
import { executeImportPlan } from '../main/importer'
import { createHeicConverter } from '../main/heic'
import { HeicDecodePool, getHeicDecodeWorkerPath } from '../main/heic-pool'
import type { AppConfig, ImportPlan, ImportProgress } from '../shared/types'

const { plan, libraryPath, tempDir, dbPath, config } = workerData as {
  plan: ImportPlan
  libraryPath: string
  tempDir: string
  dbPath: string
  config: AppConfig
}

let cancelled = false
parentPort!.on('message', (msg: { type: string }) => {
  if (msg.type === 'cancel') cancelled = true
})

let db: KeePicDatabase
try {
  db = new KeePicDatabase(dbPath)
  db.open()
} catch (err) {
  parentPort!.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
}

async function run(): Promise<void> {
  const pool = await HeicDecodePool.create(getHeicDecodeWorkerPath())

  try {
    const result = await executeImportPlan(
      plan,
      libraryPath,
      tempDir,
      db,
      config,
      (progress: ImportProgress) => {
        parentPort!.postMessage({ type: 'progress', ...progress })
      },
      {
        isCancelled: () => cancelled,
        convertHeic: createHeicConverter((buffer) => pool.decode(buffer))
      }
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
