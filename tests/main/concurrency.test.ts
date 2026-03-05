import { describe, it, expect } from 'vitest'
import { withConcurrency, DEFAULT_CONCURRENCY } from '../../src/main/concurrency'

describe('DEFAULT_CONCURRENCY', () => {
  it('is a positive integer capped at 8', () => {
    expect(DEFAULT_CONCURRENCY).toBeGreaterThan(0)
    expect(DEFAULT_CONCURRENCY).toBeLessThanOrEqual(8)
    expect(Number.isInteger(DEFAULT_CONCURRENCY)).toBe(true)
  })
})

describe('withConcurrency', () => {
  it('returns results in input order', async () => {
    const items = [10, 20, 30, 40]
    const results = await withConcurrency(items, 2, async (item) => item * 2)
    expect(results).toEqual([20, 40, 60, 80])
  })

  it('passes the correct index to the callback', async () => {
    const indices: number[] = []
    await withConcurrency([100, 200, 300], 2, async (_item, index) => {
      indices.push(index)
    })
    // All indices should have been visited (order may vary due to concurrency)
    expect(indices.sort()).toEqual([0, 1, 2])
  })

  it('returns an empty array for empty input', async () => {
    const results = await withConcurrency([], 4, async () => 'never')
    expect(results).toEqual([])
  })

  it('limits concurrency to the specified level', async () => {
    let active = 0
    let maxActive = 0

    const items = Array.from({ length: 10 }, (_, i) => i)
    await withConcurrency(items, 3, async () => {
      active++
      if (active > maxActive) maxActive = active
      // Yield to allow other workers to start
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    })

    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThan(1) // proves actual concurrency happened
  })

  it('propagates errors from the callback', async () => {
    await expect(
      withConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom')
        return item
      })
    ).rejects.toThrow('boom')
  })

  it('handles concurrency greater than item count', async () => {
    const results = await withConcurrency([1, 2], 100, async (item) => item + 1)
    expect(results).toEqual([2, 3])
  })

  it('processes all items even with concurrency of 1', async () => {
    const results = await withConcurrency([1, 2, 3, 4], 1, async (item) => item * 10)
    expect(results).toEqual([10, 20, 30, 40])
  })
})
