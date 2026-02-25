import { describe, it, expect, vi } from 'vitest'

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
  type PickerHandlerDeps
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
