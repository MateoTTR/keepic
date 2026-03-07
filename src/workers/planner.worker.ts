/**
 * Worker thread entry point for the import planner (Phase 1).
 *
 * Receives { sourceFolder, libraryPath, dbPath, config } via workerData,
 * runs buildImportPlan, and posts progress/complete/error messages back to
 * the main thread.
 *
 * Creates a HeicDecodePool for parallel HEIC decoding via native libheif.
 *
 * This file is intentionally thin — all logic lives in src/main/importer.ts.
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort, workerData } from 'worker_threads'
import { KeePicDatabase } from '../main/db/database'
import { buildImportPlan } from '../main/importer'
import { createHeicConverter, createUniversalPhashComputer } from '../main/heic'
import { HeicDecodePool, getHeicDecodeWorkerPath } from '../main/heic-pool'
import type { AppConfig, PlanProgress } from '../shared/types'

const { sourceFolder, libraryPath, dbPath, config } = workerData as {
  sourceFolder: string
  libraryPath: string
  dbPath: string
  config: AppConfig
}

const db = new KeePicDatabase(dbPath)
db.open()

async function run(): Promise<void> {
  const pool = await HeicDecodePool.create(getHeicDecodeWorkerPath())
  const decodeFn = (buffer: Buffer): Promise<import('../main/heic').HeicDecodeResult> =>
    pool.decode(buffer)

  try {
    const plan = await buildImportPlan(
      sourceFolder,
      libraryPath,
      db,
      config,
      (progress: PlanProgress) => {
        parentPort!.postMessage({ type: 'progress', ...progress })
      },
      {
        computePhash: createUniversalPhashComputer({ decodeFn }),
        convertHeic: createHeicConverter(decodeFn)
      }
    )

    db.close()
    parentPort!.postMessage({ type: 'complete', plan })
  } catch (err) {
    db.close()
    parentPort!.postMessage({ type: 'error', message: (err as Error).message })
  } finally {
    await pool.terminate()
  }
}

run()
