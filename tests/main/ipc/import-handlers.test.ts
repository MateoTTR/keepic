import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { Worker } from 'worker_threads'
import {
  handleSelectSourceFolder,
  handlePlan,
  handleExecute,
  handleCancel,
  type ShowOpenDialogFn,
  type WorkerFactory,
  type ActiveWorkerRef
} from '../../../src/main/ipc/import-handlers'
import type { ImportPlan, PlanProgress } from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDialog(result: { canceled: boolean; filePaths: string[] }): ShowOpenDialogFn {
  return () => Promise.resolve(result)
}

/**
 * Creates a fake Worker that emits a sequence of messages.
 * Each message is posted asynchronously (next tick) to mimic real worker behaviour.
 */
function makeFakeWorker(messages: object[]): Worker {
  const emitter = new EventEmitter() as unknown as Worker
  // Attach postMessage so handleCancel can call it
  ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = () => {}

  setImmediate(() => {
    for (const msg of messages) {
      emitter.emit('message', msg)
    }
  })

  return emitter
}

function makeWorkerFactory(messages: object[]): WorkerFactory {
  return () => makeFakeWorker(messages)
}

const samplePlan: ImportPlan = {
  entries: [],
  livePhotosDiscarded: 0,
  sourceFolder: '/source',
  skippedFiles: []
}

// ---------------------------------------------------------------------------
// handleSelectSourceFolder
// ---------------------------------------------------------------------------

describe('handleSelectSourceFolder', () => {
  it('returns cancelled: true when dialog is cancelled', async () => {
    const dialog = makeDialog({ canceled: true, filePaths: [] })
    const result = await handleSelectSourceFolder(dialog)
    expect(result.cancelled).toBe(true)
    expect(result.path).toBeUndefined()
  })

  it('returns cancelled: true when filePaths is empty', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: [] })
    const result = await handleSelectSourceFolder(dialog)
    expect(result.cancelled).toBe(true)
  })

  it('returns the selected path when dialog succeeds', async () => {
    const dialog = makeDialog({ canceled: false, filePaths: ['/my/photos'] })
    const result = await handleSelectSourceFolder(dialog)
    expect(result.cancelled).toBe(false)
    expect(result.path).toBe('/my/photos')
  })
})

// ---------------------------------------------------------------------------
// handlePlan
// ---------------------------------------------------------------------------

describe('handlePlan', () => {
  it('returns the ImportPlan when worker sends complete', async () => {
    const factory = makeWorkerFactory([{ type: 'complete', plan: samplePlan }])

    const result = await handlePlan(
      '/source',
      '/library',
      '/db',
      { libraryPath: null, heic: { mode: 'keep' as const, jpegQuality: 90 }, dedupThreshold: 2 },
      () => {},
      '/fake/planner.worker.js',
      factory
    )

    expect(result).toEqual(samplePlan)
  })

  it('forwards progress messages to onProgress callback', async () => {
    const progress: PlanProgress = { total: 5, processed: 2, currentFile: '/source/a.jpg' }
    const factory = makeWorkerFactory([
      { type: 'progress', ...progress },
      { type: 'complete', plan: samplePlan }
    ])

    const received: PlanProgress[] = []
    await handlePlan(
      '/source',
      '/library',
      '/db',
      { libraryPath: null, heic: { mode: 'keep' as const, jpegQuality: 90 }, dedupThreshold: 2 },
      (p) => received.push(p),
      '/fake/planner.worker.js',
      factory
    )

    expect(received).toHaveLength(1)
    expect(received[0].total).toBe(5)
  })

  it('returns { error } when worker sends error message', async () => {
    const factory = makeWorkerFactory([{ type: 'error', message: 'pHash failed' }])

    const result = await handlePlan(
      '/source',
      '/library',
      '/db',
      { libraryPath: null, heic: { mode: 'keep' as const, jpegQuality: 90 }, dedupThreshold: 2 },
      () => {},
      '/fake/planner.worker.js',
      factory
    )

    expect(result).toEqual({ error: 'pHash failed' })
  })

  it('returns { error } when worker emits an error event', async () => {
    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: () => void }).postMessage = () => {}
    setImmediate(() => emitter.emit('error', new Error('worker crashed')))

    const factory: WorkerFactory = () => emitter

    const result = await handlePlan(
      '/source',
      '/library',
      '/db',
      { libraryPath: null, heic: { mode: 'keep' as const, jpegQuality: 90 }, dedupThreshold: 2 },
      () => {},
      '/fake/planner.worker.js',
      factory
    )

    expect(result).toEqual({ error: 'worker crashed' })
  })
})

// ---------------------------------------------------------------------------
// handleExecute
// ---------------------------------------------------------------------------

describe('handleExecute', () => {
  const baseArgs = {
    plan: samplePlan,
    libraryPath: '/library',
    dbPath: '/db',
    userDataPath: '/userData',
    config: { libraryPath: '/library', heic: { mode: 'keep' as const, jpegQuality: 90 }, dedupThreshold: 2 },
    importerWorkerPath: '/fake/importer.worker.js'
  } as const

  it('returns { alreadyRunning: true } when a worker is already active', () => {
    const ref: ActiveWorkerRef = { value: {} as Worker }

    const result = handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      () => {},
      ref,
      baseArgs.importerWorkerPath,
      makeWorkerFactory([])
    )

    expect(result).toEqual({ alreadyRunning: true })
  })

  it('returns { started: true } and sets the active worker', () => {
    const ref: ActiveWorkerRef = { value: null }

    const result = handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      () => {},
      ref,
      baseArgs.importerWorkerPath,
      makeWorkerFactory([])
    )

    expect(result).toEqual({ started: true })
    expect(ref.value).not.toBeNull()
  })

  it('calls onProgress when worker sends progress', async () => {
    const progress = {
      type: 'progress',
      total: 3,
      processed: 1,
      imported: 0,
      skipped: 0,
      duplicates: 0,
      livePhotosDiscarded: 0,
      currentFile: '/a.jpg'
    }
    const factory = makeWorkerFactory([
      progress,
      {
        type: 'complete',
        imported: 0,
        skipped: 0,
        livePhotosDiscarded: 0,
        errors: [],
        status: 'completed'
      }
    ])

    const received: object[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      (p) => received.push(p),
      () => {},
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
  })

  it('calls onComplete and clears activeWorker when worker sends complete', async () => {
    const factory = makeWorkerFactory([
      {
        type: 'complete',
        imported: 2,
        skipped: 1,
        livePhotosDiscarded: 0,
        errors: [],
        status: 'completed'
      }
    ])

    const completed: object[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed).toHaveLength(1)
    expect(ref.value).toBeNull()
  })

  it('calls onComplete with failed status and clears worker on error message', async () => {
    const factory = makeWorkerFactory([{ type: 'error', message: 'crash' }])

    const completed: { status: string }[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r as { status: string }),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed[0].status).toBe('failed')
    expect(ref.value).toBeNull()
  })

  it('calls onComplete with failed status and clears worker on error event', async () => {
    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: () => void }).postMessage = () => {}
    setImmediate(() => emitter.emit('error', new Error('worker error event')))

    const factory: WorkerFactory = () => emitter
    const completed: { status: string }[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r as { status: string }),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed[0].status).toBe('failed')
    expect(ref.value).toBeNull()
  })

  it('calls onComplete with failed status when worker exits without sending any message', async () => {
    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: () => void }).postMessage = () => {}
    // Worker exits without sending any message or error
    setImmediate(() => emitter.emit('exit', 1))

    const factory: WorkerFactory = () => emitter
    const completed: { status: string; errors: { error: string }[] }[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r as { status: string; errors: { error: string }[] }),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed).toHaveLength(1)
    expect(completed[0].status).toBe('failed')
    expect(completed[0].errors[0].error).toContain('Worker exited unexpectedly')
    expect(ref.value).toBeNull()
  })

  it('does NOT call onComplete twice when exit fires after complete', async () => {
    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: () => void }).postMessage = () => {}
    setImmediate(() => {
      emitter.emit('message', {
        type: 'complete',
        imported: 1,
        skipped: 0,
        livePhotosDiscarded: 0,
        errors: [],
        status: 'completed'
      })
      emitter.emit('exit', 0)
    })

    const factory: WorkerFactory = () => emitter
    const completed: object[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed).toHaveLength(1)
  })

  it('does NOT call onComplete twice when exit fires after error event', async () => {
    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: () => void }).postMessage = () => {}
    setImmediate(() => {
      emitter.emit('error', new Error('worker crashed'))
      emitter.emit('exit', 1)
    })

    const factory: WorkerFactory = () => emitter
    const completed: object[] = []
    const ref: ActiveWorkerRef = { value: null }

    handleExecute(
      baseArgs.plan,
      baseArgs.libraryPath,
      baseArgs.dbPath,
      baseArgs.userDataPath,
      baseArgs.config,
      () => {},
      (r) => completed.push(r),
      ref,
      baseArgs.importerWorkerPath,
      factory
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(completed).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// handleCancel
// ---------------------------------------------------------------------------

describe('handleCancel', () => {
  it('sends cancel message to the active worker and returns { cancelled: true }', () => {
    const messages: unknown[] = []
    const fakeWorker = {
      postMessage: (msg: unknown) => messages.push(msg)
    } as unknown as Worker

    const ref: ActiveWorkerRef = { value: fakeWorker }
    const result = handleCancel(ref)

    expect(messages).toEqual([{ type: 'cancel' }])
    expect(result).toEqual({ cancelled: true })
  })

  it('returns { noWorker: true } when no worker is active', () => {
    const ref: ActiveWorkerRef = { value: null }
    const result = handleCancel(ref)
    expect(result).toEqual({ noWorker: true })
  })
})
