import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'
import keytar from 'keytar'
import type { GoogleAuthStatus } from '../shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYTAR_SERVICE = 'com.keepic.app'
const KEYTAR_ACCOUNT = 'google-tokens'
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh if less than 5 min remaining

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
].join(' ')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleCredentials {
  clientId: string
  clientSecret: string
}

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  email: string
  expiresAt: number // Unix timestamp in ms
}

export interface GoogleAuthDeps {
  credentials?: GoogleCredentials
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  openBrowser?: (url: string) => Promise<void>
  keytarGet?: (service: string, account: string) => Promise<string | null>
  keytarSet?: (service: string, account: string, password: string) => Promise<void>
  keytarDelete?: (service: string, account: string) => Promise<boolean>
  callbackTimeoutMs?: number
}

// ---------------------------------------------------------------------------
// Default credentials (loaded from build-time env)
// ---------------------------------------------------------------------------

/* v8 ignore next 4 */
const DEFAULT_CREDENTIALS: GoogleCredentials = {
  clientId: (import.meta.env['GOOGLE_CLIENT_ID'] as string) ?? '',
  clientSecret: (import.meta.env['GOOGLE_CLIENT_SECRET'] as string) ?? ''
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

/* v8 ignore next 1 */
const defaultOpenBrowser = (url: string): Promise<void> => shell.openExternal(url)
/* v8 ignore next 3 */
const defaultKeytarGet = (service: string, account: string): Promise<string | null> =>
  keytar.getPassword(service, account)
/* v8 ignore next 4 */
const defaultKeytarSet = (service: string, account: string, password: string): Promise<void> =>
  keytar.setPassword(service, account, password)
/* v8 ignore next 2 */
const defaultKeytarDelete = (service: string, account: string): Promise<boolean> =>
  keytar.deletePassword(service, account)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractEmailFromIdToken(idToken: string): string {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf-8')) as {
    email?: string
  }
  return payload.email ?? ''
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Local HTTP server for OAuth callback
// ---------------------------------------------------------------------------

interface CallbackResult {
  code: string
}

/**
 * Starts a local HTTP server on a random port, waits for /callback,
 * then resolves or rejects based on the query parameters.
 * The port is available immediately after the returned promise resolves.
 */
export async function startCallbackServer(
  expectedState: string,
  timeoutMs: number = OAUTH_TIMEOUT_MS
): Promise<{ port: number; promise: Promise<CallbackResult> }> {
  let resolveCallback: (result: CallbackResult) => void
  let rejectCallback: (err: Error) => void

  const callbackPromise = new Promise<CallbackResult>((res, rej) => {
    resolveCallback = res
    rejectCallback = rej
  })

  const server = createServer((req, res) => {
    const serverPort = req.socket.localPort!
    /* v8 ignore next */
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${serverPort}`)

    if (url.pathname !== '/callback') {
      res.writeHead(404)
      res.end()
      return
    }

    const error = url.searchParams.get('error')
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      '<html><body><h2>Authentication successful — you can close this tab.</h2></body></html>'
    )
    server.close()
    clearTimeout(timeoutHandle)

    if (error) {
      rejectCallback!(new Error(error))
    } else if (state !== expectedState) {
      rejectCallback!(new Error('Invalid state parameter'))
    } else {
      resolveCallback!({ code: code! })
    }
  })

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const port = (server.address() as { port: number }).port

  const timeoutHandle = setTimeout(() => {
    server.close()
    rejectCallback!(new Error('OAuth timeout'))
  }, timeoutMs)

  return { port, promise: callbackPromise }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the full OAuth 2.0 + PKCE flow. Opens browser, waits for callback.
 * Returns { email } on success, throws on error.
 */
export async function startOAuthFlow(deps?: GoogleAuthDeps): Promise<{ email: string }> {
  const credentials = deps?.credentials ?? DEFAULT_CREDENTIALS
  const fetchFn = deps?.fetch ?? globalThis.fetch
  const openBrowser = deps?.openBrowser ?? defaultOpenBrowser
  const keytarSet = deps?.keytarSet ?? defaultKeytarSet
  const timeoutMs = deps?.callbackTimeoutMs ?? OAUTH_TIMEOUT_MS

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }

  const { codeVerifier, codeChallenge } = generatePkce()
  const state = randomBytes(16).toString('hex')

  const { port, promise: callbackPromise } = await startCallbackServer(state, timeoutMs)

  const redirectUri = `http://127.0.0.1:${port}/callback`
  const authUrl = buildAuthUrl(credentials.clientId, redirectUri, state, codeChallenge)

  await openBrowser(authUrl)
  const { code } = await callbackPromise

  // Exchange authorization code for tokens
  const tokenBody = new URLSearchParams({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  })

  const tokenResponse = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString()
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text()
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${text}`)
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    id_token: string
    scope?: string
  }

  const grantedScopes = (tokenData.scope ?? '').split(' ')
  if (!grantedScopes.includes('https://www.googleapis.com/auth/photospicker.mediaitems.readonly')) {
    throw new Error(
      'Google Photos Picker access was not granted. ' +
        'Please disconnect and reconnect, ensuring you approve the ' +
        '"Access items in your Google Photos library" permission when prompted.'
    )
  }

  const email = extractEmailFromIdToken(tokenData.id_token)
  const tokens: StoredTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    email,
    expiresAt: Date.now() + tokenData.expires_in * 1000
  }

  await keytarSet(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(tokens))
  return { email }
}

/**
 * Returns current auth status (reads from keytar, no network call).
 */
export async function getAuthStatus(deps?: GoogleAuthDeps): Promise<GoogleAuthStatus> {
  const keytarGet = deps?.keytarGet ?? defaultKeytarGet
  const raw = await keytarGet(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!raw) return { authenticated: false }
  const tokens = JSON.parse(raw) as StoredTokens
  return { authenticated: true, email: tokens.email }
}

/**
 * Removes stored tokens from keytar.
 */
export async function disconnect(deps?: GoogleAuthDeps): Promise<void> {
  const keytarDelete = deps?.keytarDelete ?? defaultKeytarDelete
  await keytarDelete(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
}

/**
 * Tokens returned to the download worker: includes the refresh token and
 * credentials so the worker can refresh on its own if the access token expires.
 */
export interface StoredTokensForDownload {
  accessToken: string
  refreshToken: string
  expiresAt: number
  credentials: GoogleCredentials
}

/**
 * Returns the stored tokens (refreshed if needed) for use by the download worker.
 * Returns null if not authenticated or if a refresh fails.
 */
export async function getStoredTokensForDownload(
  deps?: GoogleAuthDeps
): Promise<StoredTokensForDownload | null> {
  const credentials = deps?.credentials ?? DEFAULT_CREDENTIALS
  const accessToken = await getValidAccessToken(deps)
  if (!accessToken) return null

  // keytarGet is intentionally the same dep as used inside getValidAccessToken above:
  // when getValidAccessToken succeeds the stored token is always readable here.
  /* v8 ignore next */
  const keytarGet = deps?.keytarGet ?? defaultKeytarGet
  const raw = await keytarGet(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  /* v8 ignore next */
  if (!raw) return null

  const stored = JSON.parse(raw) as StoredTokens
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    expiresAt: stored.expiresAt,
    credentials
  }
}

/**
 * Persists an updated access token (and its expiry) back to the keychain.
 * Called after the download worker refreshes its token during a long download.
 */
export async function updateStoredAccessToken(
  updatedAccessToken: string,
  updatedExpiresAt: number,
  deps?: GoogleAuthDeps
): Promise<void> {
  const keytarGet = deps?.keytarGet ?? defaultKeytarGet
  const keytarSet = deps?.keytarSet ?? defaultKeytarSet

  const raw = await keytarGet(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!raw) return

  const stored = JSON.parse(raw) as StoredTokens
  const updated: StoredTokens = {
    ...stored,
    accessToken: updatedAccessToken,
    expiresAt: updatedExpiresAt
  }
  await keytarSet(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(updated))
}

/**
 * Returns a valid access token, refreshing if needed.
 * Returns null if not authenticated or refresh fails.
 */
export async function getValidAccessToken(deps?: GoogleAuthDeps): Promise<string | null> {
  const credentials = deps?.credentials ?? DEFAULT_CREDENTIALS
  const fetchFn = deps?.fetch ?? globalThis.fetch
  const keytarGet = deps?.keytarGet ?? defaultKeytarGet
  const keytarSet = deps?.keytarSet ?? defaultKeytarSet
  const keytarDelete = deps?.keytarDelete ?? defaultKeytarDelete

  const raw = await keytarGet(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!raw) return null

  const tokens = JSON.parse(raw) as StoredTokens

  // Token still valid (with buffer)
  if (tokens.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return tokens.accessToken
  }

  // Refresh the token
  const refreshBody = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token'
  })

  let refreshResponse: Response
  try {
    refreshResponse = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody.toString()
    })
  } catch {
    return null
  }

  if (!refreshResponse.ok) {
    return null
  }

  const refreshData = (await refreshResponse.json()) as {
    access_token: string
    expires_in: number
    scope?: string
  }

  // If the refresh response includes a scope field, verify Photos access is still granted
  if (refreshData.scope !== undefined) {
    const grantedScopes = refreshData.scope.split(' ')
    if (
      !grantedScopes.includes('https://www.googleapis.com/auth/photospicker.mediaitems.readonly')
    ) {
      await keytarDelete(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      return null
    }
  }

  const updatedTokens: StoredTokens = {
    ...tokens,
    accessToken: refreshData.access_token,
    expiresAt: Date.now() + refreshData.expires_in * 1000
  }

  await keytarSet(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(updatedTokens))
  return updatedTokens.accessToken
}
