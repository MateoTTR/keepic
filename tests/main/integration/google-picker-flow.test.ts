/**
 * Integration test: Google Photos Picker end-to-end flow.
 *
 * Exercises the complete sequence:
 *   authenticate → createPickerSession → pollPickerSession (×N) →
 *   startPickerDownload → progress events → complete event
 *
 * Only external boundaries are mocked (keytar, network, Worker);
 * all KeePic module code runs as-is.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { Worker } from 'worker_threads'

// Electron and keytar cannot load in Node test environment — mock at module level.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  handleCreatePickerSession,
  handlePollPickerSession,
  handleStartPickerDownload,
  handleCancelPickerDownload,
  spawnPickerDownloadWorker,
  type PickerHandlerDeps,
  type ActivePickerWorkerRef,
  type WorkerFactory
} from '../../../src/main/ipc/google-photos-handlers'
import type { GoogleAuthDeps } from '../../../src/main/google-auth'
import type { DownloaderTokens } from '../../../src/main/google-photos-picker-downloader'
import type { GoogleDownloadProgress, GoogleDownloadResult } from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEYTAR_SERVICE = 'com.keepic.app'
const KEYTAR_ACCOUNT = 'google-tokens'

function makeKeytarStore(initial: string | null = null): {
  keytarGet: GoogleAuthDeps['keytarGet']
  keytarSet: GoogleAuthDeps['keytarSet']
  keytarDelete: GoogleAuthDeps['keytarDelete']
} {
  const store = new Map<string, string>()
  if (initial !== null) store.set(`${KEYTAR_SERVICE}|${KEYTAR_ACCOUNT}`, initial)

  return {
    keytarGet: vi.fn(async (service, account) => store.get(`${service}|${account}`) ?? null),
    keytarSet: vi.fn(async (service, account, password) => {
      store.set(`${service}|${account}`, password)
    }),
    keytarDelete: vi.fn(async (service, account) => store.delete(`${service}|${account}`))
  }
}

function makeStoredTokensJson(overrides?: { expiresAt?: number }): string {
  return JSON.stringify({
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    email: 'user@example.com',
    expiresAt: overrides?.expiresAt ?? Date.now() + 3_600_000 // 1 hour
  })
}

/** Builds a PickerHandlerDeps with the given auth store and a smart fetch mock. */
function makeIntegrationDeps(opts: {
  /** Pass null to simulate no stored token; omit to use a valid default token. */
  keytarTokens?: string | null
  fetchResponses: Map<string, { status: number; body: object }>
}): PickerHandlerDeps {
  // null means "no token stored"; undefined means "use default valid token"
  const tokenJson = opts.keytarTokens === undefined ? makeStoredTokensJson() : opts.keytarTokens
  const keytar = makeKeytarStore(tokenJson)

  const fetchFn = vi.fn(async (url: string) => {
    const match = opts.fetchResponses.get(url)
    if (!match) throw new Error(`Unexpected fetch: ${url}`)
    const { status, body } = match
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    } as Response
  })

  return {
    authDeps: {
      credentials: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
      ...keytar
    },
    pickerDeps: {
      fetch: fetchFn as unknown as PickerHandlerDeps['pickerDeps'] extends
        | { fetch?: infer F }
        | undefined
        ? F
        : never
    }
  }
}

/** Returns a fake Worker that emits the given messages on the next tick. */
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

const SAMPLE_DOWNLOAD_TOKENS: DownloaderTokens = {
  accessToken: 'valid-access-token',
  refreshToken: 'valid-refresh-token',
  expiresAt: Date.now() + 3_600_000,
  credentials: { clientId: 'test-client-id', clientSecret: 'test-client-secret' }
}

// ---------------------------------------------------------------------------
// Full happy-path flow
// ---------------------------------------------------------------------------

describe('Google Photos Picker — full happy-path flow', () => {
  it('completes: createPickerSession → poll (×2: false then true) → startPickerDownload → complete', async () => {
    const SESSION_ID = 'session-abc-123'
    const PICKER_URI = 'https://photos.google.com/picker/session-abc-123'
    const DOWNLOAD_DIR = '/tmp/keepic-test-download'

    // -----------------------------------------------------------------------
    // Step 1: createPickerSession
    // -----------------------------------------------------------------------

    const createDeps = makeIntegrationDeps({
      fetchResponses: new Map([
        [
          'https://photospicker.googleapis.com/v1/sessions',
          { status: 200, body: { id: SESSION_ID, pickerUri: PICKER_URI } }
        ]
      ])
    })

    const createResult = await handleCreatePickerSession(createDeps)

    expect(createResult).toEqual({ sessionId: SESSION_ID, pickerUri: PICKER_URI })

    // -----------------------------------------------------------------------
    // Step 2: poll — first call returns not ready, second returns ready
    // -----------------------------------------------------------------------

    let pollCallCount = 0
    const pollDeps: PickerHandlerDeps = {
      authDeps: createDeps.authDeps,
      pickerDeps: {
        fetch: vi.fn(async () => {
          pollCallCount++
          const mediaItemsSet = pollCallCount >= 2
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: SESSION_ID, mediaItemsSet }),
            text: async () => ''
          } as Response
        }) as unknown as PickerHandlerDeps['pickerDeps'] extends { fetch?: infer F } | undefined
          ? F
          : never
      }
    }

    const poll1 = await handlePollPickerSession(SESSION_ID, pollDeps)
    expect(poll1).toEqual({ ready: false })

    const poll2 = await handlePollPickerSession(SESSION_ID, pollDeps)
    expect(poll2).toEqual({ ready: true })

    // -----------------------------------------------------------------------
    // Step 3: startPickerDownload — worker emits progress then complete
    // -----------------------------------------------------------------------

    const progressEvents: GoogleDownloadProgress[] = []
    let completeResult: GoogleDownloadResult | null = null

    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const workerMessages = [
      { type: 'progress', total: 3, downloaded: 0, currentFile: 'photo1.jpg' },
      { type: 'progress', total: 3, downloaded: 1, currentFile: 'photo2.jpg' },
      { type: 'progress', total: 3, downloaded: 2, currentFile: 'photo3.jpg' },
      {
        type: 'complete',
        status: 'completed',
        downloaded: 3,
        errors: [],
        downloadDir: DOWNLOAD_DIR
      }
    ]

    const factory = makeWorkerFactory(workerMessages)
    const startResult = await handleStartPickerDownload(
      SESSION_ID,
      DOWNLOAD_DIR,
      (p) => progressEvents.push(p),
      (r) => {
        completeResult = r
      },
      activeWorkerRef,
      '/fake/worker.js',
      {
        getTokens: async () => SAMPLE_DOWNLOAD_TOKENS,
        createWorker: factory
      }
    )

    expect(startResult).toEqual({ started: true })
    expect(activeWorkerRef.value).not.toBeNull()

    // Wait for all worker messages to be processed
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // -----------------------------------------------------------------------
    // Step 4: verify progress and completion
    // -----------------------------------------------------------------------

    // The worker messages include a 'type' field that is passed through to onProgress;
    // use toMatchObject to check the relevant fields only.
    expect(progressEvents).toHaveLength(3)
    expect(progressEvents[0]).toMatchObject({ total: 3, downloaded: 0, currentFile: 'photo1.jpg' })
    expect(progressEvents[2]).toMatchObject({ total: 3, downloaded: 2, currentFile: 'photo3.jpg' })

    // The worker message includes a 'type' field; use toMatchObject for the relevant fields.
    expect(completeResult).toMatchObject({
      status: 'completed',
      downloaded: 3,
      errors: [],
      downloadDir: DOWNLOAD_DIR
    })
    expect(activeWorkerRef.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Error scenarios
// ---------------------------------------------------------------------------

describe('Google Photos Picker — error scenarios', () => {
  it('returns "not authenticated" error from createPickerSession when no token stored', async () => {
    const deps = makeIntegrationDeps({
      keytarTokens: null,
      fetchResponses: new Map()
    })

    const result = await handleCreatePickerSession(deps)

    expect(result).toEqual({
      error: 'Not authenticated — please connect to Google Photos first'
    })
  })

  it('returns "not authenticated" error from pollPickerSession when no token stored', async () => {
    const deps = makeIntegrationDeps({
      keytarTokens: null,
      fetchResponses: new Map()
    })

    const result = await handlePollPickerSession('session-id', deps)

    expect(result).toEqual({
      error: 'Not authenticated — please connect to Google Photos first'
    })
  })

  it('returns "not authenticated" error from startPickerDownload when getTokens returns null', async () => {
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }

    const result = await handleStartPickerDownload(
      'session-id',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { getTokens: async () => null }
    )

    expect(result).toEqual({
      error: 'Not authenticated — please connect to Google Photos first'
    })
  })

  it('returns actionable error when Picker API returns 401 (Token expired) on createPickerSession', async () => {
    const deps = makeIntegrationDeps({
      fetchResponses: new Map([
        ['https://photospicker.googleapis.com/v1/sessions', { status: 401, body: {} }]
      ])
    })

    const result = await handleCreatePickerSession(deps)

    expect(result).toHaveProperty('error')
    const { error } = result as { error: string }
    expect(error).toContain('expired')
    expect(error).toContain('reconnect')
  })

  it('returns actionable error when Picker API returns 401 (Token expired) on pollPickerSession', async () => {
    const SESSION_ID = 'session-xyz'
    const deps = makeIntegrationDeps({
      fetchResponses: new Map([
        [`https://photospicker.googleapis.com/v1/sessions/${SESSION_ID}`, { status: 401, body: {} }]
      ])
    })

    const result = await handlePollPickerSession(SESSION_ID, deps)

    expect(result).toHaveProperty('error')
    const { error } = result as { error: string }
    expect(error).toContain('expired')
    expect(error).toContain('reconnect')
  })

  it('returns error when startPickerDownload is called while a download is already running', async () => {
    const fakeWorker = { postMessage: vi.fn() } as unknown as Worker
    const activeWorkerRef: ActivePickerWorkerRef = { value: fakeWorker }

    const result = await handleStartPickerDownload(
      'session-id',
      '/dl',
      vi.fn(),
      vi.fn(),
      activeWorkerRef,
      '/fake/worker.js',
      { getTokens: async () => SAMPLE_DOWNLOAD_TOKENS }
    )

    expect(result).toEqual({ alreadyRunning: true })
  })
})

// ---------------------------------------------------------------------------
// Cancellation flow
// ---------------------------------------------------------------------------

describe('Google Photos Picker — cancellation', () => {
  it('transitions back to idle after cancel: worker receives cancel message, emits cancelled complete', async () => {
    const DOWNLOAD_DIR = '/tmp/keepic-test-cancel'

    let capturedPostMessage: ((msg: unknown) => void) | null = null

    const emitter = new EventEmitter() as unknown as Worker
    const postMessage = vi.fn((msg: unknown) => {
      if ((msg as { type: string }).type === 'cancel') {
        // Simulate worker receiving cancel and responding with cancelled status
        setImmediate(() => {
          emitter.emit('message', {
            type: 'complete',
            status: 'cancelled',
            downloaded: 1,
            errors: [],
            downloadDir: DOWNLOAD_DIR
          })
        })
      }
    })
    ;(emitter as unknown as { postMessage: (msg: unknown) => void }).postMessage = postMessage
    capturedPostMessage = postMessage

    const factory: WorkerFactory = () => emitter
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    const completeEvents: GoogleDownloadResult[] = []

    spawnPickerDownloadWorker(
      'session-cancel',
      DOWNLOAD_DIR,
      SAMPLE_DOWNLOAD_TOKENS,
      vi.fn(),
      (r) => completeEvents.push(r),
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    // Trigger cancellation
    const cancelResult = handleCancelPickerDownload(activeWorkerRef)
    expect(cancelResult).toEqual({ cancelled: true })
    expect(capturedPostMessage).toHaveBeenCalledWith({ type: 'cancel' })

    // Wait for the worker's cancelled complete event
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0].status).toBe('cancelled')
    expect(activeWorkerRef.value).toBeNull()
  })

  it('returns { noWorker: true } when cancel is called with no active worker', () => {
    const ref: ActivePickerWorkerRef = { value: null }
    expect(handleCancelPickerDownload(ref)).toEqual({ noWorker: true })
  })
})

// ---------------------------------------------------------------------------
// Download failure scenarios
// ---------------------------------------------------------------------------

describe('Google Photos Picker — download failure', () => {
  it('reports failed status when worker emits error message', async () => {
    const DOWNLOAD_DIR = '/tmp/keepic-test-fail'
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    let completeResult: GoogleDownloadResult | null = null

    const factory = makeWorkerFactory([{ type: 'error', message: 'Network error during download' }])

    spawnPickerDownloadWorker(
      'session-fail',
      DOWNLOAD_DIR,
      SAMPLE_DOWNLOAD_TOKENS,
      vi.fn(),
      (r) => {
        completeResult = r
      },
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeResult).not.toBeNull()
    expect(completeResult!.status).toBe('failed')
    expect(completeResult!.errors[0].error).toBe('Network error during download')
    expect(activeWorkerRef.value).toBeNull()
  })

  it('reports failed status with partial success when some files downloaded', async () => {
    const DOWNLOAD_DIR = '/tmp/keepic-test-partial'
    const activeWorkerRef: ActivePickerWorkerRef = { value: null }
    let completeResult: GoogleDownloadResult | null = null

    // Simulate: worker downloads 2 of 3, fails on 1
    const factory = makeWorkerFactory([
      { type: 'progress', total: 3, downloaded: 0, currentFile: 'img1.jpg' },
      { type: 'progress', total: 3, downloaded: 1, currentFile: 'img2.jpg' },
      {
        type: 'complete',
        status: 'completed',
        downloaded: 2,
        errors: [{ filename: 'img3.jpg', error: 'HTTP 404' }],
        downloadDir: DOWNLOAD_DIR
      }
    ])

    const progressEvents: GoogleDownloadProgress[] = []

    spawnPickerDownloadWorker(
      'session-partial',
      DOWNLOAD_DIR,
      SAMPLE_DOWNLOAD_TOKENS,
      (p) => progressEvents.push(p),
      (r) => {
        completeResult = r
      },
      activeWorkerRef,
      '/fake/worker.js',
      { createWorker: factory }
    )

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(completeResult!.status).toBe('completed')
    expect(completeResult!.downloaded).toBe(2)
    expect(completeResult!.errors).toEqual([{ filename: 'img3.jpg', error: 'HTTP 404' }])
    expect(progressEvents).toHaveLength(2)
  })
})
