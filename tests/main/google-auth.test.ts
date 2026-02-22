import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron and keytar — these cannot load in a Node test environment.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }
}))

import {
  startOAuthFlow,
  getAuthStatus,
  disconnect,
  getValidAccessToken,
  extractEmailFromIdToken,
  startCallbackServer,
  type GoogleAuthDeps,
  type StoredTokens
} from '../../src/main/google-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEYTAR_SERVICE = 'com.keepic.app'
const KEYTAR_ACCOUNT = 'google-tokens'

function makeKeytarStore(initial: string | null = null): {
  store: Map<string, string>
  keytarGet: GoogleAuthDeps['keytarGet']
  keytarSet: GoogleAuthDeps['keytarSet']
  keytarDelete: GoogleAuthDeps['keytarDelete']
} {
  const store = new Map<string, string>()
  if (initial !== null) store.set(`${KEYTAR_SERVICE}|${KEYTAR_ACCOUNT}`, initial)

  return {
    store,
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
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ email, sub: '123' })).toString('base64url')
  return `${header}.${payload}.fakesig`
}

function makeTokenResponse(email: string): object {
  return {
    access_token: 'access-token-123',
    refresh_token: 'refresh-token-456',
    expires_in: 3599,
    id_token: makeIdToken(email)
  }
}

function makeFetchOk(body: object): GoogleAuthDeps['fetch'] {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
  )
}

function makeFetchError(status: number, body: string): GoogleAuthDeps['fetch'] {
  return vi.fn(async () => new Response(body, { status }))
}

const validCredentials = { clientId: 'test-client-id', clientSecret: 'test-client-secret' }

/**
 * Creates an openBrowser mock that triggers the callback URL without awaiting
 * the fetch — this allows startOAuthFlow to attach a handler to callbackPromise
 * before the HTTP response arrives, avoiding "unhandled rejection" warnings.
 */
function makeBrowserMock(
  overrides: { code?: string; state?: string | null; error?: string } = {}
): GoogleAuthDeps['openBrowser'] {
  return vi.fn((authUrl: string) => {
    const url = new URL(authUrl)
    const redirectUri = url.searchParams.get('redirect_uri')!
    const state = overrides.state !== undefined ? overrides.state : url.searchParams.get('state')!

    const callbackUrl = new URL(redirectUri)
    if (overrides.error) {
      callbackUrl.searchParams.set('error', overrides.error)
    } else {
      callbackUrl.searchParams.set('code', overrides.code ?? 'auth-code-xyz')
      callbackUrl.searchParams.set('state', state ?? '')
    }

    // Fire the GET without awaiting so callbackPromise is awaited before the
    // HTTP response triggers a rejection (avoids unhandled rejection warnings).
    void fetch(callbackUrl.toString())
    return Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// extractEmailFromIdToken
// ---------------------------------------------------------------------------

describe('extractEmailFromIdToken', () => {
  it('decodes JWT payload and returns email', () => {
    const token = makeIdToken('test@gmail.com')
    expect(extractEmailFromIdToken(token)).toBe('test@gmail.com')
  })

  it('returns empty string when email is absent from payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url')
    const token = `header.${payload}.sig`
    expect(extractEmailFromIdToken(token)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// startCallbackServer
// ---------------------------------------------------------------------------

describe('startCallbackServer', () => {
  it('resolves with code when callback has valid state and code', async () => {
    const state = 'my-state-123'
    const { port, promise } = await startCallbackServer(state)

    // Fire without await so promise is handled before the rejection arrives
    void fetch(`http://127.0.0.1:${port}/callback?code=test-code&state=${state}`)

    const result = await promise
    expect(result.code).toBe('test-code')
  })

  it('rejects with Invalid state parameter when state does not match', async () => {
    const { port, promise } = await startCallbackServer('correct-state')

    // Run fetch and rejection handler in parallel so promise is handled before rejection
    await Promise.all([
      fetch(`http://127.0.0.1:${port}/callback?code=x&state=wrong-state`),
      expect(promise).rejects.toThrow('Invalid state parameter')
    ])
  })

  it('rejects with the error when callback has error param', async () => {
    const state = 'some-state'
    const { port, promise } = await startCallbackServer(state)

    await Promise.all([
      fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=${state}`),
      expect(promise).rejects.toThrow('access_denied')
    ])
  })

  it('rejects with OAuth timeout after timeoutMs elapses', async () => {
    const { promise } = await startCallbackServer('any-state', 50)
    await expect(promise).rejects.toThrow('OAuth timeout')
  })

  it('ignores requests to paths other than /callback', async () => {
    const state = 'my-state'
    const { port, promise } = await startCallbackServer(state, 200)

    // Wrong path — server responds 404 without touching the promise; safe to await
    await fetch(`http://127.0.0.1:${port}/other`)

    // Correct callback — fire without await so promise is handled first
    void fetch(`http://127.0.0.1:${port}/callback?code=correct-code&state=${state}`)

    const result = await promise
    expect(result.code).toBe('correct-code')
  })
})

// ---------------------------------------------------------------------------
// startOAuthFlow
// ---------------------------------------------------------------------------

describe('startOAuthFlow', () => {
  it('completes full flow and stores tokens in keytar', async () => {
    const { keytarGet, keytarSet, keytarDelete } = makeKeytarStore()
    const email = 'user@gmail.com'

    const deps: GoogleAuthDeps = {
      credentials: validCredentials,
      fetch: makeFetchOk(makeTokenResponse(email)),
      openBrowser: makeBrowserMock(),
      keytarGet,
      keytarSet,
      keytarDelete
    }

    const result = await startOAuthFlow(deps)
    expect(result.email).toBe(email)
    expect(keytarSet).toHaveBeenCalledOnce()

    const [svc, acc, raw] = (keytarSet as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      string
    ]
    expect(svc).toBe(KEYTAR_SERVICE)
    expect(acc).toBe(KEYTAR_ACCOUNT)
    const stored = JSON.parse(raw) as StoredTokens
    expect(stored.email).toBe(email)
    expect(stored.accessToken).toBe('access-token-123')
    expect(stored.refreshToken).toBe('refresh-token-456')
    expect(stored.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws when credentials are missing (explicit empty)', async () => {
    const deps: GoogleAuthDeps = {
      credentials: { clientId: '', clientSecret: '' }
    }
    await expect(startOAuthFlow(deps)).rejects.toThrow('Google OAuth credentials not configured')
  })

  it('throws when credentials are missing (uses DEFAULT_CREDENTIALS fallback)', async () => {
    // No credentials in deps → falls back to DEFAULT_CREDENTIALS (empty in test env)
    await expect(startOAuthFlow({})).rejects.toThrow('Google OAuth credentials not configured')
  })

  it('throws when callback returns invalid state', async () => {
    const deps: GoogleAuthDeps = {
      credentials: validCredentials,
      openBrowser: makeBrowserMock({ state: 'wrong-state' })
    }
    await expect(startOAuthFlow(deps)).rejects.toThrow('Invalid state parameter')
  })

  it('throws when callback returns an OAuth error', async () => {
    const deps: GoogleAuthDeps = {
      credentials: validCredentials,
      openBrowser: makeBrowserMock({ error: 'access_denied' })
    }
    await expect(startOAuthFlow(deps)).rejects.toThrow('access_denied')
  })

  it('throws when token exchange returns non-ok response', async () => {
    const deps: GoogleAuthDeps = {
      credentials: validCredentials,
      fetch: makeFetchError(400, 'Bad Request'),
      openBrowser: makeBrowserMock()
    }
    await expect(startOAuthFlow(deps)).rejects.toThrow('Token exchange failed: 400')
  })

  it('throws OAuth timeout when no callback arrives in time', async () => {
    const deps: GoogleAuthDeps = {
      credentials: validCredentials,
      openBrowser: vi.fn(async () => {
        // deliberately do nothing — simulate user not completing auth
      }),
      callbackTimeoutMs: 50
    }
    await expect(startOAuthFlow(deps)).rejects.toThrow('OAuth timeout')
  })
})

// ---------------------------------------------------------------------------
// getAuthStatus
// ---------------------------------------------------------------------------

describe('getAuthStatus', () => {
  it('returns authenticated: true with email when tokens are stored', async () => {
    const tokens: StoredTokens = {
      accessToken: 'at',
      refreshToken: 'rt',
      email: 'user@gmail.com',
      expiresAt: Date.now() + 3600000
    }
    const { keytarGet } = makeKeytarStore(JSON.stringify(tokens))
    const status = await getAuthStatus({ keytarGet })
    expect(status).toEqual({ authenticated: true, email: 'user@gmail.com' })
  })

  it('returns authenticated: false when keytar returns null', async () => {
    const { keytarGet } = makeKeytarStore(null)
    const status = await getAuthStatus({ keytarGet })
    expect(status).toEqual({ authenticated: false })
  })

  it('uses defaultKeytarGet when keytarGet dep is omitted', async () => {
    // keytar is mocked globally; getPassword returns undefined → authenticated: false
    const status = await getAuthStatus({})
    expect(status).toEqual({ authenticated: false })
  })
})

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('disconnect', () => {
  it('calls keytarDelete with correct service and account', async () => {
    const { keytarDelete } = makeKeytarStore()
    await disconnect({ keytarDelete })
    expect(keytarDelete).toHaveBeenCalledWith(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  })

  it('uses defaultKeytarDelete when keytarDelete dep is omitted', async () => {
    // keytar is mocked globally; deletePassword is vi.fn() → resolves without error
    await expect(disconnect({})).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getValidAccessToken
// ---------------------------------------------------------------------------

describe('getValidAccessToken', () => {
  const baseTokens: StoredTokens = {
    accessToken: 'valid-access-token',
    refreshToken: 'refresh-token',
    email: 'user@gmail.com',
    expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour from now
  }

  it('returns access token directly when it is not near expiry', async () => {
    const { keytarGet } = makeKeytarStore(JSON.stringify(baseTokens))
    const token = await getValidAccessToken({
      credentials: validCredentials,
      keytarGet
    })
    expect(token).toBe('valid-access-token')
  })

  it('returns null when keytar has no stored tokens', async () => {
    const { keytarGet } = makeKeytarStore(null)
    const token = await getValidAccessToken({ keytarGet })
    expect(token).toBeNull()
  })

  it('uses defaultKeytarGet when keytarGet dep is omitted', async () => {
    // keytar is mocked globally; getPassword returns undefined → null
    const token = await getValidAccessToken({})
    expect(token).toBeNull()
  })

  it('refreshes the token when it is near expiry and updates keytar', async () => {
    const nearExpiryTokens: StoredTokens = {
      ...baseTokens,
      expiresAt: Date.now() + 2 * 60 * 1000 // 2 min from now (< 5 min buffer)
    }
    const { keytarGet, keytarSet } = makeKeytarStore(JSON.stringify(nearExpiryTokens))

    const fetchMock = makeFetchOk({ access_token: 'new-access-token', expires_in: 3600 })

    const token = await getValidAccessToken({
      credentials: validCredentials,
      fetch: fetchMock,
      keytarGet,
      keytarSet
    })

    expect(token).toBe('new-access-token')
    expect(keytarSet).toHaveBeenCalledOnce()
    const raw = (keytarSet as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    const updated = JSON.parse(raw) as StoredTokens
    expect(updated.accessToken).toBe('new-access-token')
    expect(updated.refreshToken).toBe('refresh-token') // unchanged
  })

  it('returns null when refresh request fails with non-ok response', async () => {
    const nearExpiryTokens: StoredTokens = {
      ...baseTokens,
      expiresAt: Date.now() + 2 * 60 * 1000
    }
    const { keytarGet } = makeKeytarStore(JSON.stringify(nearExpiryTokens))

    const token = await getValidAccessToken({
      credentials: validCredentials,
      fetch: makeFetchError(401, 'Unauthorized'),
      keytarGet
    })

    expect(token).toBeNull()
  })

  it('returns null when refresh request throws a network error', async () => {
    const nearExpiryTokens: StoredTokens = {
      ...baseTokens,
      expiresAt: Date.now() + 2 * 60 * 1000
    }
    const { keytarGet } = makeKeytarStore(JSON.stringify(nearExpiryTokens))

    const fetchMock = vi.fn(async () => {
      throw new Error('Network error')
    })

    const token = await getValidAccessToken({
      credentials: validCredentials,
      fetch: fetchMock as GoogleAuthDeps['fetch'],
      keytarGet
    })

    expect(token).toBeNull()
  })
})

// Silence unused import warning
void beforeEach
