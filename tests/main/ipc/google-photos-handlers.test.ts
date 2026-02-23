import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron and keytar — these cannot load in a Node test environment.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  handleGetLastDownloadDate,
  handleCleanupDownloadDir,
  handleStartDownload,
  handleCancelDownload,
  type ActiveWorkerRef
} from '../../../src/main/ipc/google-photos-handlers'
import { KeePicDatabase } from '../../../src/main/db/database'

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

function makeDb(): KeePicDatabase {
  const db = new KeePicDatabase(':memory:')
  db.open()
  return db
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  libraryPath: '/library',
  heicConversion: { enabled: false, jpegQuality: 90 }
}

const STORED_TOKENS = JSON.stringify({
  accessToken: 'at-123',
  refreshToken: 'rt-456',
  expiresAt: Date.now() + 3600_000,
  email: 'user@example.com'
})

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
// handleStartDownload
// ---------------------------------------------------------------------------

describe('handleStartDownload', () => {
  let activeWorkerRef: ActiveWorkerRef
  let onProgress: ReturnType<typeof vi.fn>
  let onComplete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    activeWorkerRef = { value: null }
    onProgress = vi.fn()
    onComplete = vi.fn()
  })

  function makeWorkerMock(messages: Array<{ type: string } & Record<string, unknown>> = []) {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const worker = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      }),
      postMessage: vi.fn(),
      emit(event: string, ...args: unknown[]) {
        for (const cb of listeners[event] ?? []) cb(...args)
      }
    }

    // Schedule messages after creation
    setTimeout(() => {
      for (const msg of messages) {
        worker.emit('message', msg)
      }
    }, 0)

    return worker
  }

  it('returns alreadyRunning when a worker is active', async () => {
    activeWorkerRef.value = {} as never

    const result = await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js'
    )

    expect(result).toEqual({ alreadyRunning: true })
  })

  it('returns error when getToken returns null (not authenticated)', async () => {
    const result = await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      { getToken: async () => null }
    )

    expect(result).toEqual({ error: 'Not authenticated with Google Photos' })
  })

  it('returns error when keytarGet returns null (no stored tokens)', async () => {
    const result = await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => null
      }
    )

    expect(result).toEqual({ error: 'Could not read stored tokens' })
  })

  it('spawns worker and returns started:true', async () => {
    const workerMock = makeWorkerMock()
    const createWorker = vi.fn(() => workerMock as never)

    const result = await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    expect(result).toEqual({ started: true })
    expect(activeWorkerRef.value).toBe(workerMock)
    expect(createWorker).toHaveBeenCalledWith(
      '/worker.js',
      expect.objectContaining({
        workerData: expect.objectContaining({ startDate: '2025-01-01' })
      })
    )
  })

  it('forwards progress messages to onProgress', async () => {
    const progressMsg = { type: 'progress', fetched: 10, downloaded: 5, currentFile: 'IMG.jpg' }
    const workerMock = makeWorkerMock([progressMsg])
    const createWorker = vi.fn(() => workerMock as never)

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    // Wait for async setTimeout in makeWorkerMock
    await new Promise((r) => setTimeout(r, 10))

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ fetched: 10, downloaded: 5 }))
  })

  it('calls onComplete with result and clears activeWorkerRef on complete message', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 42,
      errors: [],
      downloadDir: '/userData/temp/google-123'
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const db = makeDb()

    await handleStartDownload(
      '2025-01-01',
      db,
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    expect(activeWorkerRef.value).toBeNull()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', downloaded: 42 })
    )
  })

  it('records import_job in DB when download completes successfully', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 10,
      errors: [],
      downloadDir: '/userData/temp/google-123'
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const db = makeDb()

    await handleStartDownload(
      '2025-01-01',
      db,
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    const job = db.db.prepare(`SELECT * FROM import_jobs WHERE source = 'google_photos'`).get() as
      | Record<string, unknown>
      | undefined

    expect(job).toBeDefined()
    expect(job!.status).toBe('completed')
    expect(job!.photos_imported).toBe(10)
    expect(job!.last_imported_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('does NOT record import_job when download is cancelled', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'cancelled',
      downloaded: 3,
      errors: [],
      downloadDir: '/userData/temp/google-123'
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const db = makeDb()

    await handleStartDownload(
      '2025-01-01',
      db,
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    const job = db.db.prepare(`SELECT * FROM import_jobs WHERE source = 'google_photos'`).get()

    expect(job).toBeUndefined()
  })

  it('updates keytar when worker reports a refreshed access token (with updatedExpiresAt)', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 5,
      errors: [],
      downloadDir: '/dl',
      updatedAccessToken: 'new-access-token',
      updatedExpiresAt: Date.now() + 7200_000
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const keytarSet = vi.fn()

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        keytarSet,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    expect(keytarSet).toHaveBeenCalledWith(
      'com.keepic.app',
      'google-tokens',
      expect.stringContaining('new-access-token')
    )
  })

  it('updates keytar with storedTokens.expiresAt when updatedExpiresAt is absent', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 5,
      errors: [],
      downloadDir: '/dl',
      updatedAccessToken: 'new-access-token'
      // no updatedExpiresAt → falls back to storedTokens.expiresAt
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const keytarSet = vi.fn()

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        keytarSet,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    expect(keytarSet).toHaveBeenCalledWith(
      'com.keepic.app',
      'google-tokens',
      expect.stringContaining('new-access-token')
    )
  })

  it('does NOT update keytar when no token refresh occurred', async () => {
    const completeMsg = {
      type: 'complete',
      status: 'completed',
      downloaded: 5,
      errors: [],
      downloadDir: '/dl'
      // no updatedAccessToken
    }
    const workerMock = makeWorkerMock([completeMsg])
    const createWorker = vi.fn(() => workerMock as never)
    const keytarSet = vi.fn()

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        keytarSet,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    expect(keytarSet).not.toHaveBeenCalled()
  })

  it('handles worker error message and calls onComplete with failed status', async () => {
    const errorMsg = { type: 'error', message: 'something went wrong' }
    const workerMock = makeWorkerMock([errorMsg])
    const createWorker = vi.fn(() => workerMock as never)

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    await new Promise((r) => setTimeout(r, 10))

    expect(activeWorkerRef.value).toBeNull()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', downloaded: 0 })
    )
  })

  it('handles worker error event and calls onComplete with failed status', async () => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const workerMock = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      }),
      postMessage: vi.fn()
    }

    const createWorker = vi.fn(() => workerMock as never)

    await handleStartDownload(
      '2025-01-01',
      makeDb(),
      '/db.db',
      '/userData',
      BASE_CONFIG,
      onProgress,
      onComplete,
      activeWorkerRef,
      '/worker.js',
      {
        getToken: async () => 'access-token',
        keytarGet: async () => STORED_TOKENS,
        createWorker
      }
    )

    // Emit the worker 'error' event directly
    for (const cb of listeners['error'] ?? []) cb(new Error('worker crashed'))

    expect(activeWorkerRef.value).toBeNull()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', downloaded: 0 })
    )
  })
})

// ---------------------------------------------------------------------------
// handleCancelDownload
// ---------------------------------------------------------------------------

describe('handleCancelDownload', () => {
  it('sends cancel message to the active worker and returns { cancelled: true }', () => {
    const postMessage = vi.fn()
    const activeWorkerRef: ActiveWorkerRef = { value: { postMessage } as never }

    const result = handleCancelDownload(activeWorkerRef)

    expect(postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(result).toEqual({ cancelled: true })
  })

  it('returns { noWorker: true } when no worker is running', () => {
    const activeWorkerRef: ActiveWorkerRef = { value: null }
    const result = handleCancelDownload(activeWorkerRef)
    expect(result).toEqual({ noWorker: true })
  })
})
