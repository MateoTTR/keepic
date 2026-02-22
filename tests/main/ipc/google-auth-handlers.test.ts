import { describe, it, expect, vi } from 'vitest'

// Mock Electron and keytar — these cannot load in a Node test environment.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  handleGetAuthStatus,
  handleConnect,
  handleDisconnect
} from '../../../src/main/ipc/google-auth-handlers'
import type { GoogleAuthDeps, StoredTokens } from '../../../src/main/google-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeytarStore(initial: string | null = null): {
  keytarGet: GoogleAuthDeps['keytarGet']
  keytarSet: GoogleAuthDeps['keytarSet']
  keytarDelete: GoogleAuthDeps['keytarDelete']
} {
  const store = new Map<string, string>()
  if (initial !== null) store.set('com.keepic.app|google-tokens', initial)

  return {
    keytarGet: vi.fn(async (service, account) => store.get(`${service}|${account}`) ?? null),
    keytarSet: vi.fn(async (service, account, password) => {
      store.set(`${service}|${account}`, password)
    }),
    keytarDelete: vi.fn(async (service, account) => {
      return store.delete(`${service}|${account}`)
    })
  }
}

function makeIdToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url')
  return `header.${payload}.sig`
}

function makeStoredTokens(email: string): StoredTokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    email,
    expiresAt: Date.now() + 3600000
  }
}

// ---------------------------------------------------------------------------
// handleGetAuthStatus
// ---------------------------------------------------------------------------

describe('handleGetAuthStatus', () => {
  it('returns authenticated: true with email when tokens are stored', async () => {
    const tokens = makeStoredTokens('user@gmail.com')
    const { keytarGet } = makeKeytarStore(JSON.stringify(tokens))

    const result = await handleGetAuthStatus({ keytarGet })

    expect(result).toEqual({ authenticated: true, email: 'user@gmail.com' })
  })

  it('returns authenticated: false when no tokens are stored', async () => {
    const { keytarGet } = makeKeytarStore(null)

    const result = await handleGetAuthStatus({ keytarGet })

    expect(result).toEqual({ authenticated: false })
  })
})

// ---------------------------------------------------------------------------
// handleConnect
// ---------------------------------------------------------------------------

describe('handleConnect', () => {
  it('returns success with email when OAuth flow completes', async () => {
    const { keytarGet, keytarSet, keytarDelete } = makeKeytarStore()

    const tokenResponse = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      id_token: makeIdToken('connected@gmail.com')
    }

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(tokenResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    )

    const openBrowser = vi.fn(async (authUrl: string) => {
      const url = new URL(authUrl)
      const redirectUri = url.searchParams.get('redirect_uri')!
      const state = url.searchParams.get('state')!
      const callbackUrl = new URL(redirectUri)
      callbackUrl.searchParams.set('code', 'auth-code')
      callbackUrl.searchParams.set('state', state)
      await fetch(callbackUrl.toString())
    })

    const result = await handleConnect({
      credentials: { clientId: 'client-id', clientSecret: 'client-secret' },
      fetch: fetchMock as GoogleAuthDeps['fetch'],
      openBrowser,
      keytarGet,
      keytarSet,
      keytarDelete
    })

    expect(result).toEqual({ success: true, email: 'connected@gmail.com' })
  })

  it('returns error object when OAuth flow throws', async () => {
    const result = await handleConnect({
      credentials: { clientId: '', clientSecret: '' }
    })

    expect(result).toEqual({ error: 'Google OAuth credentials not configured' })
  })

  it('returns error with string representation for non-Error throws', async () => {
    const openBrowser = vi.fn(async () => {
      throw 'unexpected string error'
    })

    const result = await handleConnect({
      credentials: { clientId: 'id', clientSecret: 'secret' },
      openBrowser
    })

    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toBe('unexpected string error')
  })
})

// ---------------------------------------------------------------------------
// handleDisconnect
// ---------------------------------------------------------------------------

describe('handleDisconnect', () => {
  it('calls disconnect and returns success: true', async () => {
    const { keytarDelete } = makeKeytarStore()

    const result = await handleDisconnect({ keytarDelete })

    expect(result).toEqual({ success: true })
    expect(keytarDelete).toHaveBeenCalledWith('com.keepic.app', 'google-tokens')
  })

  it('returns error object when disconnect throws', async () => {
    const keytarDelete = vi.fn(async () => {
      throw new Error('Keychain unavailable')
    })

    const result = await handleDisconnect({ keytarDelete })

    expect(result).toEqual({ error: 'Keychain unavailable' })
  })

  it('returns error with string representation for non-Error throws', async () => {
    const keytarDelete = vi.fn(async () => {
      throw 'unexpected'
    })

    const result = await handleDisconnect({ keytarDelete })

    expect('error' in result).toBe(true)
    expect((result as { error: string }).error).toBe('unexpected')
  })
})
