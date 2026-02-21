import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { dctHash, defaultPhashComputer } from '../../src/main/phash'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a 32×32 grayscale pixel array filled with a constant value. */
function uniformPixels(value: number, size = 32): Uint8Array {
  return new Uint8Array(size * size).fill(value)
}

/** Creates a 32×32 checkerboard pattern (alternating 0 and 255). */
function checkerboardPixels(size = 32): Uint8Array {
  const pixels = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels[y * size + x] = (x + y) % 2 === 0 ? 255 : 0
    }
  }
  return pixels
}

// ---------------------------------------------------------------------------
// dctHash (pure function)
// ---------------------------------------------------------------------------

describe('dctHash', () => {
  it('returns a 16-character lowercase hex string', () => {
    const hash = dctHash(uniformPixels(128), 32)
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns the same hash for identical pixel arrays', () => {
    const pixels = uniformPixels(200)
    expect(dctHash(pixels, 32)).toBe(dctHash(pixels, 32))
  })

  it('returns different hashes for different pixel arrays', () => {
    const h1 = dctHash(uniformPixels(0), 32)
    const h2 = dctHash(uniformPixels(255), 32)
    const h3 = dctHash(checkerboardPixels(), 32)
    // At least two of the three should differ (in practice all three differ)
    const distinct = new Set([h1, h2, h3])
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('returns all-zeros hash for an all-black image (DC=0, no bits strictly > mean)', () => {
    // All pixels = 0 → all DCT coefficients = 0 → no value strictly > mean(0) → all bits 0.
    expect(dctHash(uniformPixels(0), 32)).toBe('0000000000000000')
  })

  it('returns a stable hash for a known pattern', () => {
    const h1 = dctHash(checkerboardPixels(), 32)
    const h2 = dctHash(checkerboardPixels(), 32)
    expect(h1).toBe(h2)
  })
})

// ---------------------------------------------------------------------------
// defaultPhashComputer (file I/O)
// ---------------------------------------------------------------------------

describe('defaultPhashComputer', () => {
  let tmpDir: string
  /** JPEG with a horizontal gradient (structurally rich → non-trivial pHash). */
  let gradientJpeg: string
  /** JPEG with a checkerboard pattern (visually very different from gradient). */
  let checkerJpeg: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'keepic-phash-test-'))

    gradientJpeg = join(tmpDir, 'gradient.jpg')
    checkerJpeg = join(tmpDir, 'checker.jpg')

    // Horizontal gradient: left=0, right=255
    const gradientPixels = Buffer.alloc(64 * 64 * 3)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = Math.round((x / 63) * 255)
        const i = (y * 64 + x) * 3
        gradientPixels[i] = v
        gradientPixels[i + 1] = v
        gradientPixels[i + 2] = v
      }
    }
    await sharp(gradientPixels, { raw: { width: 64, height: 64, channels: 3 } })
      .jpeg()
      .toFile(gradientJpeg)

    // Checkerboard: 8×8 dark/bright squares
    const checkerPixels = Buffer.alloc(64 * 64 * 3)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = ((x >> 3) + (y >> 3)) % 2 === 0 ? 255 : 0
        const i = (y * 64 + x) * 3
        checkerPixels[i] = v
        checkerPixels[i + 1] = v
        checkerPixels[i + 2] = v
      }
    }
    await sharp(checkerPixels, { raw: { width: 64, height: 64, channels: 3 } })
      .jpeg()
      .toFile(checkerJpeg)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns a PhashResult with a 16-char hex phash for a valid image', async () => {
    const result = await defaultPhashComputer(gradientJpeg)
    expect(result).not.toBeNull()
    expect(result!.phash).toHaveLength(16)
    expect(result!.phash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns correct width and height', async () => {
    const result = await defaultPhashComputer(gradientJpeg)
    expect(result!.width).toBe(64)
    expect(result!.height).toBe(64)
  })

  it('returns different hashes for visually different images', async () => {
    const g = await defaultPhashComputer(gradientJpeg)
    const c = await defaultPhashComputer(checkerJpeg)
    expect(g!.phash).not.toBe(c!.phash)
  })

  it('returns the same hash on repeated calls (deterministic)', async () => {
    const r1 = await defaultPhashComputer(gradientJpeg)
    const r2 = await defaultPhashComputer(gradientJpeg)
    expect(r1!.phash).toBe(r2!.phash)
  })

  it('returns null for a non-existent file', async () => {
    const result = await defaultPhashComputer('/nonexistent/image.jpg')
    expect(result).toBeNull()
  })

  it('returns null for an unsupported format (text file)', async () => {
    const { writeFileSync } = await import('fs')
    const fakePath = join(tmpDir, 'fake.jpg')
    writeFileSync(fakePath, 'not an image', 'utf-8')
    const result = await defaultPhashComputer(fakePath)
    expect(result).toBeNull()
  })
})
