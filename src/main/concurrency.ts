import { cpus } from 'os'

/**
 * Sensible default: use all CPU cores, cap at 8 to avoid overwhelming
 * slow NAS storage or filesystem.
 */
export const DEFAULT_CONCURRENCY = Math.min(cpus().length, 8)

/**
 * Runs an async function over an array of items with bounded concurrency.
 * Results are returned in input order regardless of completion order.
 *
 * @param items       - Items to process.
 * @param concurrency - Maximum number of concurrent operations.
 * @param fn          - Async function applied to each item.
 * @returns           - Results in the same order as the input items.
 */
export async function withConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i], i)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers: Promise<void>[] = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker())
  }
  await Promise.all(workers)

  return results
}
