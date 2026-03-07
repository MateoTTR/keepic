import { Worker } from 'worker_threads'
import { join } from 'path'
import { cpus } from 'os'
import type { HeicDecodeResult } from './heic'

const DEFAULT_POOL_SIZE = Math.min(cpus().length, 8)

interface PendingDecode {
  resolve: (result: HeicDecodeResult) => void
  reject: (error: Error) => void
}

interface WorkerMessage {
  type: 'ready' | 'result' | 'error'
  id?: number
  width?: number
  height?: number
  data?: Buffer
  message?: string
}

export type HeicDecodeWorkerPath = string

/**
 * Pool of worker threads for parallel HEIC decoding via libheif N-API.
 *
 * Each worker loads `@keepic/heif-decode` and decodes HEIC buffers independently.
 * Output RGBA buffers are returned via transferList (zero-copy).
 *
 * The pool's `decode()` method is compatible with `HeicDecodeFn`:
 *   (buffer: Buffer) => Promise<HeicDecodeResult>
 *
 * Usage:
 *   const pool = await HeicDecodePool.create(workerPath, 4)
 *   const { width, height, data } = await pool.decode(heicBuffer)
 *   await pool.terminate()
 */
export class HeicDecodePool {
  private workers: Worker[]
  private pending = new Map<number, PendingDecode>()
  private nextId = 0
  private nextWorker = 0
  private terminated = false

  private constructor(workers: Worker[]) {
    this.workers = workers

    for (const worker of workers) {
      worker.on('message', (msg: WorkerMessage) => {
        if (msg.type === 'result' && msg.id !== undefined) {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            p.resolve({
              width: msg.width!,
              height: msg.height!,
              data: new Uint8Array(msg.data!.buffer, msg.data!.byteOffset, msg.data!.byteLength)
            })
          }
        } else if (msg.type === 'error' && msg.id !== undefined) {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            p.reject(new Error(msg.message ?? 'HEIC decode failed'))
          }
        }
      })

      worker.on('error', (err: Error) => {
        // Reject all pending decodes for this worker
        for (const [id, p] of this.pending) {
          p.reject(err)
          this.pending.delete(id)
        }
      })
    }
  }

  /**
   * Creates a pool of N HEIC decode workers.
   *
   * @param workerPath - Absolute path to the heic-decode.worker.js file.
   * @param size       - Number of workers (defaults to min(cpus, 8)).
   */
  static async create(
    workerPath: string,
    size: number = DEFAULT_POOL_SIZE
  ): Promise<HeicDecodePool> {
    const workers: Worker[] = []
    const readyPromises: Promise<void>[] = []

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath)
      workers.push(worker)

      readyPromises.push(
        new Promise<void>((resolve, reject) => {
          const onMessage = (msg: WorkerMessage): void => {
            if (msg.type === 'ready') {
              worker.removeListener('message', onMessage)
              worker.removeListener('error', onError)
              resolve()
            }
          }
          const onError = (err: Error): void => {
            worker.removeListener('message', onMessage)
            worker.removeListener('error', onError)
            reject(err)
          }
          worker.on('message', onMessage)
          worker.on('error', onError)
        })
      )
    }

    await Promise.all(readyPromises)
    return new HeicDecodePool(workers)
  }

  /**
   * Decodes a HEIC buffer using the next available worker (round-robin).
   * Compatible with HeicDecodeFn: (buffer: Buffer) => Promise<HeicDecodeResult>.
   *
   * The input buffer (~5 MB) is copied to the worker via structured clone.
   * The output RGBA buffer (~46 MB) is transferred back via transferList (zero-copy).
   *
   * @param buffer - HEIC file contents.
   * @returns Decoded RGBA pixels with dimensions.
   */
  decode(buffer: Buffer): Promise<HeicDecodeResult> {
    if (this.terminated) {
      return Promise.reject(new Error('HeicDecodePool is terminated'))
    }

    const id = this.nextId++
    const workerIndex = this.nextWorker % this.workers.length
    this.nextWorker++

    return new Promise<HeicDecodeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.workers[workerIndex].postMessage({ type: 'decode', id, buffer })
    })
  }

  /**
   * Terminates all workers in the pool.
   */
  async terminate(): Promise<void> {
    this.terminated = true

    // Reject any remaining pending decodes
    for (const [, p] of this.pending) {
      p.reject(new Error('HeicDecodePool terminated'))
    }
    this.pending.clear()

    const terminatePromises = this.workers.map((worker) => {
      worker.postMessage({ type: 'exit' })
      return worker.terminate()
    })

    await Promise.all(terminatePromises)
    this.workers = []
  }

  /** Returns the number of workers in the pool. */
  get size(): number {
    return this.workers.length
  }
}

/**
 * Resolves the default worker path for the HEIC decode worker.
 *
 * Called from inside operation workers (out/main/workers/*.worker.js),
 * so heic-decode.worker.js is in the same directory.
 */
export function getHeicDecodeWorkerPath(): string {
  return join(__dirname, 'heic-decode.worker.js')
}
