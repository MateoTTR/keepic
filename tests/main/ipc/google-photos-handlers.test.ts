import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Worker } from 'worker_threads'

// Mock Electron and keytar — these cannot load in a Node test environment.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  handleGetLastDownloadDate,
  handleCleanupDownloadDir,
  handleCreatePickerSession,
  handlePollPickerSession,
  spawnPickerDownloadWorker,
  handleStartPickerDownload,
  handleCancelPickerDownload,
  type PickerHandlerDeps,
  type ActivePickerWorkerRef,
  type WorkerFactory
} from '../../../src/main/ipc/google-photos-handlers'
import { KeePicDatabase } from '../../../src/main/db/database'
import type { DownloaderTokens } from '../../../src/main/google-photos-picker-downloader'
import type { GoogleDownloadProgress, GoogleDownloadResult } from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

function makeDb(): KeePicDatabase {
  const db = new KeePicDatabase(':memory:')
  db.open()
  return db
}

// ---------------------------------------------------------------------------
// handleGetLastDownloadDate
// ---------------------------------------------------------------------------

describe('handleGetLastDownloadDate', () => {
  it('returns null when no google_photos job exists', () => {
    const db = makeDb()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns null when only non-completed google_photos jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, status, photos_imported,
         photos_skipped, live_photos_discarded)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', 'failed', 0, 0, 0)`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns null when only local jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('local', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 10, 0, 0, '2025-01-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: null })
  })

  it('returns the last_imported_date of the most recent completed google_photos job', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 10, 0, 0, '2025-01-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: '2025-01-01' })
  })

  it('returns the most recent date when multiple completed jobs exist', () => {
    const db = makeDb()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', 'completed', 5, 0, 0, '2025-01-01')`
      )
      .run()
    db.db
      .prepare(
        `INSERT INTO import_jobs (source, started_at, finished_at, status, photos_imported,
         photos_skipped, live_photos_discarded, last_imported_date)
         VALUES ('google_photos', '2025-06-01T00:00:00Z', '2025-06-01T01:00:00Z', 'completed', 20, 0, 0, '2025-06-01')`
      )
      .run()
    expect(handleGetLastDownloadDate(db)).toEqual({ date: '2025-06-01' })
  })
})

// ---------------------------------------------------------------------------
// handleCleanupDownloadDir
// ---------------------------------------------------------------------------

describe('handleCleanupDownloadDir', () => {
  it('calls rmDir with the provided path', () => {
    const rmDir = vi.fn()
    handleCleanupDownloadDir('/some/download/dir', rmDir)
    expect(rmDir).toHaveBeenCalledWith('/some/download/dir')
  })

  it('uses default rmSync when no rmDir dep provided', () => {
    // We can't easily test the real rmSync without a real directory,
    // but we verify the function is callable and doesn't throw for a non-existent path
    // (rmSync with force:true is safe for non-existent paths)
    expect(() => handleCleanupDownloadDir('/tmp/keepic-test-nonexistent-dir-xyz')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Helpers for Picker handler tests
// ---------------------------------------------------------------------------

function makeStoredTokens(overrides?: Partial<{ expiresAt: number }>): string {
  return JSON.stringify({
    accessToken: 'valid-access-token',
    refreshToken: 'refresh-token',
    email: 'user@test.com',
    expiresAt: overrides?.expiresAt ?? Date.now() + 60 * 60 * 1000 // 1 hour from now
  })
}

function makePickerHandlerDeps(opts: {
  authenticated?: boolean
  fetchStatus?: number
  fetchBody?: object
}): PickerHandlerDeps {
  const { authenticated = true, fetchStatus = 200, fetchBody = {} } = opts

  const tokenJson = authenticated ? makeStoredTokens() : null

  return {
    authDeps: {
      credentials: { clientId: 'test-id', clientSecret: 'test-secret' },
      keytarGet: vi.fn(async () => tokenJson),
      keytarSet: vi.fn(),
      keytarDelete: vi.fn()
    },
    pickerDeps: {
      fetch: vi.fn(async () => ({
        ok: fetchStatus >= 200 && fetchStatus < 300,
        status: fetchStatus,
        json: async () => fetchBody,
        text: async () => JSON.stringify(fetchBody)
      })) as unknown as PickerHandlerDeps['pickerDeps'] extends { fetch?: infer F } ? F : never
    }
  }
}

// ---------------------------------------------------------------------------
// handleCreatePickerSession
// ---------------------------------------------------------------------------

describe('handleCreatePickerSession', () => {
  it('returns sessionId and pickerUri on success', async () => {
    const deps = makePickerHandlerDeps({
      fetchBody: {
        id: 'session-123',
        pickerUri: 'https://photos.google.com/picker/session-123'
      }
    })

    const result = await handleCreatePickerSession(deps)

    expect(result).toEqual({
      sessionId: 'session-123',
      pickerUri: 'https://photos.google.com/picker/session-123'
    })
  })

  it('returns error when not authenticated', async () => {
    const deps = makePickerHandlerDeps({ authenticated: false })

    const result = await handleCreatePickerSession(deps)

    expect(result).toEqual({
      error: 'Not authenticated — please connect to Google Photos first'
    })
  })

  it('returns error when API returns 401', async () => {
    const deps = makePickerHandlerDeps({ fetchStatus: 401, fetchBody: {} })

    const result = await handleCreatePickerSession(deps)

    expect(result).toEqual({ error: 'Token expired' })
  })

  it('returns error when API returns 500', async () => {
    const deps = makePickerHandlerDeps({ fetchStatus: 500, fetchBody: { error: 'Internal' } })

    const result = await handleCreatePickerSession(deps)

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('500')
  })
})

// ---------------------------------------------------------------------------
// handlePollPickerSession
// ---------------------------------------------------------------------------

describe('handlePollPickerSession', () => {
  it('returns ready: true when mediaItemsSet is true', async () => {
    const deps = makePickerHandlerDeps({
      fetchBody: { id: 'session-123', mediaItemsSet: true }
    })

    const result = await handlePollPickerSession('session-123', deps)

    expect(result).toEqual({ ready: true })
  })

  it('returns ready: false when mediaItemsSet is false', async () => {
    const deps = makePickerHandlerDeps({
      fetchBody: { id: 'session-123', mediaItemsSet: false }
    })

    const result = await handlePollPickerSession('session-123', deps)

    expect(result).toEqual({ ready: false })
  })

  it('returns error when not authenticated', async () => {
    const deps = makePickerHandlerDeps({ authenticated: false })

    const result = await handlePollPickerSession('session-123', deps)

    expect(result).toEqual({
      error: 'Not authenticated — please connect to Google Photos first'
    })
  })

  it('returns error when API returns 401', async () => {
    const deps = makePickerHandlerDeps({ fetchStatus: 401, fetchBody: {} })

    const result = await handlePollPickerSession('session-123', deps)

    expect(result).toEqual({ error: 'Token expired' })
  })

  it('returns error as string when non-Error is thrown', async () => {
    const deps: PickerHandlerDeps = {
      authDeps: {
        credentials: { clientId: 'test-id', clientSecret: 'test-secret' },
        keytarGet: vi.fn(async () => makeStoredTokens()),
        keytarSet: vi.fn(),
        keytarDelete: vi.fn()
      },
      pickerDeps: {
        fetch: vi.fn(async () => {
          throw 'string-error' // eslint-disable-line no-throw-literal
        }) as unknown as PickerHandlerDeps['pickerDeps'] extends { fetch?: infer F } ? F : never
      }
    }

    const result = await handlePollPickerSession('session-123', deps)

    expect(result).toEqual({ error: 'string-error' })
  })
})

// ---------------------------------------------------------------------------
// handleCreatePickerSession — non-Error throw
// ---------------------------------------------------------------------------

describe('handleCreatePickerSession — non-Error throw', () => {
  it('returns error as string when non-Error is thrown', async () => {
    const deps: PickerHandlerDeps = {
      authDeps: {
        credentials: { clientId: 'test-id', clientSecret: 'test-secret' },
        keytarGet: vi.fn(async () => makeStoredTokens()),
        keytarSet: vi.fn(),
        keytarDelete: vi.fn()
      },
      pickerDeps: {
        fetch: vi.fn(async () => {
          throw 42 // eslint-disable-line no-throw-literal
        }) as unknown as PickerHandlerDeps['pickerDeps'] extends { fetch?: infer F } ? F : never
      }
    }

    const result = await handleCreatePickerSession(deps)

    expect(result).toEqual({ error: '42' })
  })
})

// ---------------------------------------------------------------------------
// Helpers for worker-based handler tests
// ---------------------------------------------------------------------------

const SAMPLE_TOKENS: DownloaderTokens = {
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  expiresAt: Date.now() + 3_600_000,
  credentials: { clientId: 'cid', clientSecret: 'csec' }
}

function makeFakeWorker(messages: object[]): Worker {
  const emitter = new EventEmitter() as unknown as Worker
  ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = vi.fn()
  setImmediate(() => {
    for (const msg of messages) emitter.emit('message', msg)
  })
  return emitter
}

function makeWorkerFactory(messages: object[]): WorkerFactory {
  return () => makeFakeWorker(messages)
}

// ---------------------------------------------------------------------------
// spawnPickerDownloadWorker
// ---------------------------------------------------------------------------

describe('spawnPickerDownloadWorker', () => {
  it('returns { started: true } and spawns the worker', () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const factory = makeWorkerFactory([])

    const result = spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    expect(result).toEqual({ started: true })
    expect(activeWorkerRef.value).not.toBeNull()
  })

  it('forwards progress messages to onProgress callback', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const progressCb = vi.fn()
    const completeCb = vi.fn()
    const progress: GoogleDownloadProgress = { total: 5, downloaded: 2, currentFile: 'a.jpg' }
    const factory = makeWorkerFactory([
      { type: 'progress', ...progress },
      { type: 'complete', status: 'completed', downloaded: 5, errors: [], downloadDir: '/dl' }
    ])

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      progressCb,
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(progressCb).toHaveBeenCalledWith(expect.objectContaining(progress))
  })

  it('calls onComplete and clears worker on complete message', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()
    const completeResult: GoogleDownloadResult = {
      status: 'completed',
      downloaded: 3,
      errors: [],
      downloadDir: '/dl'
    }
    const factory = makeWorkerFactory([{ type: 'complete', ...completeResult }])

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeCb).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', downloaded: 3 })
    )
    expect(activeWorkerRef.value).toBeNull()
  })

  it('calls updateStoredAccessToken when complete message includes updatedAccessToken', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 2,
      errors: [],
      downloadDir: '/dl',
      updatedAccessToken: 'new-access-tok',
      updatedExpiresAt: Date.now() + 3_600_000
    }
    const factory = makeWorkerFactory([completeMsg])

    // Provide authDeps with a keytarGet that returns stored tokens
    // so updateStoredAccessToken can update them
    const storedTokensJson = JSON.stringify({
      accessToken: 'old-tok',
      refreshToken: 'ref-tok',
      email: 'u@t.com',
      expiresAt: Date.now()
    })
    const mockKeytarGet = vi.fn(async () => storedTokensJson)
    const mockKeytarSet = vi.fn()

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      {
        createWorker: factory,
        authDeps: {
          credentials: { clientId: 'id', clientSecret: 'sec' },
          keytarGet: mockKeytarGet,
          keytarSet: mockKeytarSet,
          keytarDelete: vi.fn()
        }
      }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    // updateStoredAccessToken is called with void, so we wait a bit for the promise to resolve
    await new Promise((r) => setImmediate(r))

    expect(completeCb).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(mockKeytarSet).toHaveBeenCalled()
  })

  it('calls onComplete with failed status on error message', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()
    const factory = makeWorkerFactory([{ type: 'error', message: 'Worker crashed' }])

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeCb).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errors: [{ filename: '', error: 'Worker crashed' }]
      })
    )
    expect(activeWorkerRef.value).toBeNull()
  })

  it('calls onComplete on worker error event', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()

    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = vi.fn()
    const factory: WorkerFactory = () => emitter

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    setImmediate(() => emitter.emit('error', new Error('Fatal error')))
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeCb).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errors: [{ filename: '', error: 'Fatal error' }]
      })
    )
    expect(activeWorkerRef.value).toBeNull()
  })

  it('calls onComplete on worker exit event with non-zero code', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()

    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = vi.fn()
    const factory: WorkerFactory = () => emitter

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    // Store the reference before it gets cleared
    const workerRef = activeWorkerRef.value

    setImmediate(() => emitter.emit('exit', 1))
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeCb).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errors: [{ filename: '', error: 'Worker exited unexpectedly (code 1)' }]
      })
    )
    expect(workerRef).toBe(emitter) // was correctly the same worker
    expect(activeWorkerRef.value).toBeNull()
  })

  it('does not call onComplete on exit if worker ref already cleared', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeCb = vi.fn()

    const emitter = new EventEmitter() as unknown as Worker
    ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = vi.fn()
    const factory: WorkerFactory = () => emitter

    spawnPickerDownloadWorker(
      'session-1',
      '/dl',
      SAMPLE_TOKENS,
      vi.fn(),
      completeCb,
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    // Simulate that the worker was already cleared (e.g. 'complete' message arrived first)
    activeWorkerRef.value = null

    setImmediate(() => emitter.emit('exit', 0))
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeCb).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleStartPickerDownload
// ---------------------------------------------------------------------------

describe('handleStartPickerDownload', () => {
  it('returns alreadyRunning when a worker is already active', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: {} as Worker }

    const result = await handleStartPickerDownload(
      'session-1',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { getTokens: async () => SAMPLE_TOKENS }
    )

    expect(result).toEqual({ alreadyRunning: true })
  })

  it('returns error when getTokens returns null (not authenticated)', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }

    const result = await handleStartPickerDownload(
      'session-1',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { getTokens: async () => null }
    )

    expect(result).toEqual({ error: 'Not authenticated — please connect to Google Photos first' })
  })

  it('returns { started: true } and spawns worker when authenticated', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const factory = makeWorkerFactory([])

    const result = await handleStartPickerDownload(
      'session-1',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { getTokens: async () => SAMPLE_TOKENS, createWorker: factory }
    )

    expect(result).toEqual({ started: true })
    expect(activeWorkerRef.value).not.toBeNull()
  })

  it('uses getStoredTokensForDownload by default when getTokens dep is not provided', async () => {
    // keytar returns null → not authenticated → returns error
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }

    const result = await handleStartPickerDownload(
      'session-1',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      {
        authDeps: {
          credentials: { clientId: 'id', clientSecret: 'secret' },
          keytarGet: vi.fn(async () => null),
          keytarSet: vi.fn(),
          keytarDelete: vi.fn()
        }
      }
    )

    expect(result).toEqual({ error: 'Not authenticated — please connect to Google Photos first' })
  })
})

// ---------------------------------------------------------------------------
// handleCancelPickerDownload
// ---------------------------------------------------------------------------

describe('handleCancelPickerDownload', () => {
  it('returns { noWorker: true } when no active worker', () => {
    const ref: ActivePickerWorkerRef = { value: null }
    expect(handleCancelPickerDownload(ref)).toEqual({ noWorker: true })
  })

  it('sends cancel message and returns { cancelled: true }', () => {
    const mockPostMessage = vi.fn()
    const fakeWorker = { postMessage: mockPostMessage } as unknown as Worker
    const ref: ActivePickerWorkerRef = { value: fakeWorker }

    const result = handleCancelPickerDownload(ref)

    expect(result).toEqual({ cancelled: true })
    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'cancel' })
  })
})
