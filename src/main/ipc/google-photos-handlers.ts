import { rmSync } from 'fs'
import type { KeePicDatabase } from '../db/database'
import { getValidAccessToken, type GoogleAuthDeps } from '../google-auth'
import { createPickerSession, pollPickerSession, type PickerDeps } from '../google-photos-picker'

// ---------------------------------------------------------------------------
// handleGetLastDownloadDate
// ---------------------------------------------------------------------------

/**
 * Returns the last_imported_date of the most recent completed google_photos job,
 * or null if no such job exists.
 */
export function handleGetLastDownloadDate(db: KeePicDatabase): { date: string | null } {
  const row = db.db
    .prepare(
      `SELECT last_imported_date FROM import_jobs
       WHERE source = 'google_photos' AND status = 'completed'
       ORDER BY finished_at DESC
       LIMIT 1`
    )
    .get() as { last_imported_date: string | null } | undefined

  return { date: row?.last_imported_date ?? null }
}

// ---------------------------------------------------------------------------
// handleCreatePickerSession
// ---------------------------------------------------------------------------

export interface PickerHandlerDeps {
  authDeps?: GoogleAuthDeps
  pickerDeps?: PickerDeps
}

/**
 * Creates a new Picker session. Returns { sessionId, pickerUri } or { error }.
 */
export async function handleCreatePickerSession(
  deps?: PickerHandlerDeps
): Promise<{ sessionId: string; pickerUri: string } | { error: string }> {
  try {
    const accessToken = await getValidAccessToken(deps?.authDeps)
    if (!accessToken) {
      return { error: 'Not authenticated — please connect to Google Photos first' }
    }
    const session = await createPickerSession(accessToken, deps?.pickerDeps)
    return { sessionId: session.id, pickerUri: session.pickerUri }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// handlePollPickerSession
// ---------------------------------------------------------------------------

/**
 * Polls a Picker session. Returns { ready: boolean } or { error }.
 */
export async function handlePollPickerSession(
  sessionId: string,
  deps?: PickerHandlerDeps
): Promise<{ ready: boolean } | { error: string }> {
  try {
    const accessToken = await getValidAccessToken(deps?.authDeps)
    if (!accessToken) {
      return { error: 'Not authenticated — please connect to Google Photos first' }
    }
    const result = await pollPickerSession(sessionId, accessToken, deps?.pickerDeps)
    return { ready: result.mediaItemsSet }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// handleCleanupDownloadDir
// ---------------------------------------------------------------------------

/**
 * Deletes the Google Photos download staging directory.
 * Called from the renderer when the user dismisses the result screen.
 */
export function handleCleanupDownloadDir(
  dirPath: string,
  rmDir: (p: string) => void = (p) => rmSync(p, { recursive: true, force: true })
): void {
  rmDir(dirPath)
}
