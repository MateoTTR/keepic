import { describe, it, expect, vi } from 'vitest'
import { cleanupStaleTempDirs, type CleanupDeps } from '../../src/main/temp-cleanup'

const ONE_DAY = 24 * 60 * 60 * 1000
const NOW = 1700000000000

function makeDeps(overrides: Partial<CleanupDeps> = {}): CleanupDeps {
  return {
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ mtimeMs: NOW }),
    rm: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides
  }
}

describe('cleanupStaleTempDirs', () => {
  it('removes old import-* dirs from temp/', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-1699900000000'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - ONE_DAY - 1 })
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(deps.rm).toHaveBeenCalledWith('/userData/temp/import-1699900000000')
    expect(result.removed).toEqual(['/userData/temp/import-1699900000000'])
    expect(result.errors).toEqual([])
  })

  it('removes old picker-staging dirs', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/picker-staging')) return Promise.resolve(['1699800000000'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - ONE_DAY - 1 })
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(deps.rm).toHaveBeenCalledWith('/userData/picker-staging/1699800000000')
    expect(result.removed).toEqual(['/userData/picker-staging/1699800000000'])
  })

  it('preserves recent dirs (less than maxAge)', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-recent'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - 1000 }) // 1 second old
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(deps.rm).not.toHaveBeenCalled()
    expect(result.removed).toEqual([])
  })

  it('skips non-import entries in temp/', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['other-dir', 'import-old'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - ONE_DAY - 1 })
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(deps.rm).toHaveBeenCalledTimes(1)
    expect(deps.rm).toHaveBeenCalledWith('/userData/temp/import-old')
  })

  it('handles missing parent dirs gracefully (first launch)', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT'))
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(result.removed).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('handles individual rm failures without stopping', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-a', 'import-b'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - ONE_DAY - 1 }),
      rm: vi
        .fn()
        .mockRejectedValueOnce(new Error('EPERM'))
        .mockResolvedValueOnce(undefined)
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(result.errors).toEqual(['/userData/temp/import-a: EPERM'])
    expect(result.removed).toEqual(['/userData/temp/import-b'])
  })

  it('handles stat failures without stopping', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-broken', 'import-ok'])
        return Promise.resolve([])
      }),
      stat: vi
        .fn()
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce({ mtimeMs: NOW - ONE_DAY - 1 })
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(result.errors).toEqual(['/userData/temp/import-broken: EACCES'])
    expect(result.removed).toEqual(['/userData/temp/import-ok'])
  })

  it('handles non-Error rejection values', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-bad'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockRejectedValue('string error')
    })

    const result = await cleanupStaleTempDirs('/userData', ONE_DAY, deps)

    expect(result.errors).toEqual(['/userData/temp/import-bad: string error'])
  })

  it('uses default maxAge of 24 hours', async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith('/temp')) return Promise.resolve(['import-edge'])
        return Promise.resolve([])
      }),
      stat: vi.fn().mockResolvedValue({ mtimeMs: NOW - ONE_DAY + 1000 }) // just under 24h
    })

    const result = await cleanupStaleTempDirs('/userData', undefined, deps)

    expect(deps.rm).not.toHaveBeenCalled()
    expect(result.removed).toEqual([])
  })
})
