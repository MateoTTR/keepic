import { join } from 'path'
import { Worker } from 'worker_threads'
import type {
  AppConfig,
  ImportPlan,
  ImportProgress,
  ImportResult,
  PlanProgress
} from '../../shared/types'

// ---------------------------------------------------------------------------
// Injectable types
// ---------------------------------------------------------------------------

export interface ShowOpenDialogOptions {
  properties: Array<'openDirectory'>
  title: string
}

export interface ShowOpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export type ShowOpenDialogFn = (options: ShowOpenDialogOptions) => Promise<ShowOpenDialogResult>

export interface WorkerOptions {
  workerData: Record<string, unknown>
}

export type WorkerFactory = (scriptPath: string, options: WorkerOptions) => Worker

/* v8 ignore next 2 */
export const defaultWorkerFactory: WorkerFactory = (scriptPath, options) =>
  new Worker(scriptPath, options)

// ---------------------------------------------------------------------------
// import:select-source-folder
// ---------------------------------------------------------------------------

/**
 * Opens an OS folder picker and returns the selected path.
 */
export async function handleSelectSourceFolder(
  showOpenDialog: ShowOpenDialogFn
): Promise<{ cancelled: boolean; path?: string }> {
  const result = await showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select source folder to import'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true }
  }

  return { cancelled: false, path: result.filePaths[0] }
}

// ---------------------------------------------------------------------------
// import:plan (Phase 1 — blocking invoke)
// ---------------------------------------------------------------------------

/**
 * Starts the planner worker and waits for it to complete.
 * Progress updates are forwarded via onProgress.
 * Returns the ImportPlan or an error object.
 */
export async function handlePlan(
  sourceFolder: string,
  libraryPath: string,
  dbPath: string,
  config: AppConfig,
  onProgress: (progress: PlanProgress) => void,
  plannerWorkerPath: string,
  createWorker: WorkerFactory = defaultWorkerFactory
): Promise<ImportPlan | { error: string }> {
  return new Promise((resolve) => {
    const worker = createWorker(plannerWorkerPath, {
      workerData: { sourceFolder, libraryPath, dbPath, config }
    })

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'progress') {
        onProgress(msg as unknown as PlanProgress)
      } else if (msg.type === 'complete') {
        resolve(msg.plan as ImportPlan)
      } else if (msg.type === 'error') {
        resolve({ error: msg.message as string })
      }
    })

    worker.on('error', (err: Error) => {
      resolve({ error: err.message })
    })
  })
}

// ---------------------------------------------------------------------------
// import:execute (Phase 2 — fire and forget)
// ---------------------------------------------------------------------------

export interface ActiveWorkerRef {
  value: Worker | null
}

/**
 * Starts the importer worker (Phase 2) and returns immediately.
 * Progress and completion are pushed via onProgress / onComplete.
 */
export function handleExecute(
  plan: ImportPlan,
  libraryPath: string,
  dbPath: string,
  userDataPath: string,
  config: AppConfig,
  onProgress: (progress: ImportProgress) => void,
  onComplete: (result: ImportResult) => void,
  activeWorkerRef: ActiveWorkerRef,
  importerWorkerPath: string,
  createWorker: WorkerFactory = defaultWorkerFactory
): { started: true } | { alreadyRunning: true } | { error: string } {
  if (activeWorkerRef.value !== null) {
    return { alreadyRunning: true }
  }

  const tempDir = join(userDataPath, 'temp', `import-${Date.now()}`)

  const worker = createWorker(importerWorkerPath, {
    workerData: { plan, libraryPath, tempDir, dbPath, config }
  })

  activeWorkerRef.value = worker

  worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
    if (msg.type === 'progress') {
      onProgress(msg as unknown as ImportProgress)
    } else if (msg.type === 'complete') {
      activeWorkerRef.value = null
      onComplete(msg as unknown as ImportResult)
    } else if (msg.type === 'error') {
      activeWorkerRef.value = null
      onComplete({
        imported: 0,
        skipped: 0,
        livePhotosDiscarded: plan.livePhotosDiscarded,
        errors: [{ sourcePath: '', error: msg.message as string }],
        status: 'failed'
      })
    }
  })

  worker.on('error', (err: Error) => {
    activeWorkerRef.value = null
    onComplete({
      imported: 0,
      skipped: 0,
      livePhotosDiscarded: plan.livePhotosDiscarded,
      errors: [{ sourcePath: '', error: err.message }],
      status: 'failed'
    })
  })

  return { started: true }
}

// ---------------------------------------------------------------------------
// import:cancel
// ---------------------------------------------------------------------------

/**
 * Requests cancellation of the running importer worker.
 * The worker checks the cancellation flag between files (cooperative).
 * Returns { noWorker: true } if no worker is currently running, so the caller
 * can synthesize a terminal state without waiting for a worker message.
 */
export function handleCancel(
  activeWorkerRef: ActiveWorkerRef
): { cancelled: true } | { noWorker: true } {
  if (activeWorkerRef.value === null) {
    return { noWorker: true }
  }
  activeWorkerRef.value.postMessage({ type: 'cancel' })
  return { cancelled: true }
}
