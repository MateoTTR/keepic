import { startOAuthFlow, getAuthStatus, disconnect, type GoogleAuthDeps } from '../google-auth'
import type { GoogleAuthStatus } from '../../shared/types'

/**
 * Handles google:get-auth-status — returns current authentication state.
 */
export async function handleGetAuthStatus(deps?: GoogleAuthDeps): Promise<GoogleAuthStatus> {
  return getAuthStatus(deps)
}

/**
 * Handles google:connect — starts the full OAuth 2.0 PKCE flow.
 * Returns { success: true, email } on success or { error } on failure.
 */
export async function handleConnect(
  deps?: GoogleAuthDeps
): Promise<{ success: true; email: string } | { error: string }> {
  try {
    const { email } = await startOAuthFlow(deps)
    return { success: true, email }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Handles google:disconnect — removes stored tokens from keychain.
 * Returns { success: true } or { error }.
 */
export async function handleDisconnect(
  deps?: GoogleAuthDeps
): Promise<{ success: true } | { error: string }> {
  try {
    await disconnect(deps)
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
