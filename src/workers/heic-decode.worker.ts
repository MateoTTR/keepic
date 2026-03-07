/**
 * Worker thread for native HEIC decoding via @keepic/heif-decode.
 *
 * Receives HEIC file buffers, decodes them using the native libheif N-API
 * addon, and returns raw RGBA pixels via transferList (zero-copy).
 *
 * This worker is spawned by HeicDecodePool (src/main/heic-pool.ts) and runs
 * inside operation workers (indexer, planner, executor) as a nested worker thread.
 *
 * It is excluded from test coverage (worker_threads bootstrap is not unit-testable).
 */
import { parentPort } from 'worker_threads'

// @keepic/heif-decode is a CommonJS N-API addon; use createRequire for ESM compat
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

interface LibheifModule {
  decode(buffer: Buffer): Buffer
  getInfo(buffer: Buffer): { width: number; height: number }
}

const libheif: LibheifModule = require('@keepic/heif-decode')

parentPort!.postMessage({ type: 'ready' })

parentPort!.on('message', (msg: { type: string; id?: number; buffer?: Buffer }) => {
  if (msg.type === 'decode' && msg.id !== undefined && msg.buffer) {
    try {
      const info = libheif.getInfo(msg.buffer)
      const data = libheif.decode(msg.buffer)

      parentPort!.postMessage(
        {
          type: 'result',
          id: msg.id,
          width: info.width,
          height: info.height,
          data
        },
        [data.buffer as ArrayBuffer]
      )
    } catch (err) {
      parentPort!.postMessage({
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  } else if (msg.type === 'exit') {
    process.exit(0)
  }
})
