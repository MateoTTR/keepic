import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'

export interface CleanupResult {
  removed: string[]
  errors: string[]
}

export interface CleanupDeps {
  readdir: (path: string) => Promise<string[]>
  stat: (path: string) => Promise<{ mtimeMs: number }>
  rm: (path: string) => Promise<void>
  now: () => number
}

/* v8 ignore next 6 */
const defaultDeps: CleanupDeps = {
  readdir: (p) => readdir(p),
  stat: (p) => stat(p),
  rm: (p) => rm(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 }),
  now: () => Date.now()
}

export async function cleanupStaleTempDirs(
  userDataPath: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  deps: CleanupDeps = defaultDeps
): Promise<CleanupResult> {
  const result: CleanupResult = { removed: [], errors: [] }

  await cleanupDir(join(userDataPath, 'temp'), 'import-', result, maxAgeMs, deps)
  await cleanupDir(join(userDataPath, 'picker-staging'), '', result, maxAgeMs, deps)

  return result
}

async function cleanupDir(
  parentDir: string,
  prefix: string,
  result: CleanupResult,
  maxAgeMs: number,
  deps: CleanupDeps
): Promise<void> {
  let entries: string[]
  try {
    entries = await deps.readdir(parentDir)
  } catch {
    return // Parent dir doesn't exist (first launch) — nothing to clean
  }

  const now = deps.now()

  for (const entry of entries) {
    if (prefix && !entry.startsWith(prefix)) continue

    const fullPath = join(parentDir, entry)
    try {
      const s = await deps.stat(fullPath)
      if (now - s.mtimeMs > maxAgeMs) {
        await deps.rm(fullPath)
        result.removed.push(fullPath)
      }
    } catch (err) {
      result.errors.push(`${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
