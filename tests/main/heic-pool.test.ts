import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { HeicDecodePool, getHeicDecodeWorkerPath } from '../../src/main/heic-pool'

// ---------------------------------------------------------------------------
// Mock worker script
// ---------------------------------------------------------------------------

/**
 * Creates a temporary worker JS file that simulates heic-decode.worker.ts
 * without requiring libheif-node-dy. Returns the absolute path.
 */
function createMockWorkerScript(tmpDir: string): string {
  const workerPath = join(tmpDir, 'mock-heic-worker.js')
  writeFileSync(
    workerPath,
    `
const { parentPort } = require('worker_threads')

parentPort.postMessage({ type: 'ready' })

parentPort.on('message', (msg) => {
  if (msg.type === 'decode') {
    if (!msg.buffer || msg.buffer.length === 0) {
      parentPort.postMessage({
        type: 'error',
        id: msg.id,
        message: 'Empty buffer'
      })
      return
    }

    // Simulate decode: return a small RGBA buffer
    const width = 2
    const height = 2
    const data = Buffer.alloc(width * height * 4, 128)

    parentPort.postMessage(
      { type: 'result', id: msg.id, width, height, data },
      [data.buffer]
    )
  } else if (msg.type === 'exit') {
    process.exit(0)
  }
})
`
  )
  return workerPath
}

/**
 * Creates a mock worker that signals ready then immediately crashes on decode.
 */
function createErrorWorkerScript(tmpDir: string): string {
  const workerPath = join(tmpDir, 'error-heic-worker.js')
  writeFileSync(
    workerPath,
    `
const { parentPort } = require('worker_threads')

parentPort.postMessage({ type: 'ready' })

parentPort.on('message', (msg) => {
  if (msg.type === 'decode') {
    parentPort.postMessage({
      type: 'error',
      id: msg.id,
      message: 'Simulated decode failure'
    })
  } else if (msg.type === 'exit') {
    process.exit(0)
  }
})
`
  )
  return workerPath
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string
let pool: HeicDecodePool | null = null

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'keepic-heic-pool-test-'))
  return tmpDir
}

afterEach(async () => {
  if (pool) {
    await pool.terminate()
    pool = null
  }
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('HeicDecodePool', () => {
  it('creates a pool with the specified number of workers', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 2)
    expect(pool.size).toBe(2)
  })

  it('decodes a buffer and returns RGBA result', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 1)

    const result = await pool.decode(Buffer.from('fake-heic-data'))

    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(result.data.length).toBe(2 * 2 * 4)
  })

  it('handles multiple concurrent decodes via round-robin', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 2)

    const results = await Promise.all([
      pool.decode(Buffer.from('file1')),
      pool.decode(Buffer.from('file2')),
      pool.decode(Buffer.from('file3')),
      pool.decode(Buffer.from('file4'))
    ])

    expect(results).toHaveLength(4)
    for (const r of results) {
      expect(r.width).toBe(2)
      expect(r.height).toBe(2)
    }
  })

  it('rejects with error message from worker', async () => {
    const dir = setup()
    const workerPath = createErrorWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 1)

    await expect(pool.decode(Buffer.from('data'))).rejects.toThrow('Simulated decode failure')
  })

  it('rejects with default message when worker sends error without message', async () => {
    const dir = setup()
    const workerPath = join(dir, 'no-msg-worker.js')
    writeFileSync(
      workerPath,
      `
const { parentPort } = require('worker_threads')
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', (msg) => {
  if (msg.type === 'decode') {
    parentPort.postMessage({ type: 'error', id: msg.id })
  } else if (msg.type === 'exit') {
    process.exit(0)
  }
})
`
    )
    pool = await HeicDecodePool.create(workerPath, 1)

    await expect(pool.decode(Buffer.from('data'))).rejects.toThrow('HEIC decode failed')
  })

  it('rejects all pending when a worker emits an error event', async () => {
    const dir = setup()
    const workerPath = join(dir, 'crash-worker.js')
    writeFileSync(
      workerPath,
      `
const { parentPort } = require('worker_threads')
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', (msg) => {
  if (msg.type === 'decode') {
    // Crash the worker by throwing an unhandled error
    throw new Error('worker crashed')
  } else if (msg.type === 'exit') {
    process.exit(0)
  }
})
`
    )
    pool = await HeicDecodePool.create(workerPath, 1)

    await expect(pool.decode(Buffer.from('data'))).rejects.toThrow()
  })

  it('rejects decode after terminate', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 1)
    await pool.terminate()

    await expect(pool.decode(Buffer.from('data'))).rejects.toThrow('HeicDecodePool is terminated')
    pool = null // Already terminated
  })

  it('terminate rejects pending decodes', async () => {
    const dir = setup()
    // Worker that never responds to decode
    const workerPath = join(dir, 'silent-worker.js')
    writeFileSync(
      workerPath,
      `
const { parentPort } = require('worker_threads')
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', (msg) => {
  if (msg.type === 'exit') {
    process.exit(0)
  }
  // Deliberately ignore 'decode' messages
})
`
    )
    pool = await HeicDecodePool.create(workerPath, 1)

    // Start a decode that will never complete, then catch the rejection
    const decodePromise = pool.decode(Buffer.from('data')).catch((err) => err)
    // Terminate while decode is pending
    await pool.terminate()

    const err = await decodePromise
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('HeicDecodePool terminated')
    pool = null // Already terminated
  })

  it('terminate is idempotent (no error on double terminate)', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 1)
    await pool.terminate()
    // Second terminate should not throw
    await pool.terminate()
    pool = null
  })

  it('rejects create when worker fails to start', async () => {
    const dir = setup()
    const workerPath = join(dir, 'bad-worker.js')
    writeFileSync(workerPath, 'throw new Error("startup crash")')

    await expect(HeicDecodePool.create(workerPath, 1)).rejects.toThrow('startup crash')
  })

  it('size returns 0 after terminate', async () => {
    const dir = setup()
    const workerPath = createMockWorkerScript(dir)
    pool = await HeicDecodePool.create(workerPath, 1)
    expect(pool.size).toBe(1)
    await pool.terminate()
    expect(pool.size).toBe(0)
    pool = null
  })
})

describe('getHeicDecodeWorkerPath', () => {
  it('returns a path ending with workers/heic-decode.worker.js', () => {
    const path = getHeicDecodeWorkerPath()
    expect(path).toMatch(/workers[/\\]heic-decode\.worker\.js$/)
  })
})
