import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import {
  dctHash,
  dHash,
  hammingDistance,
  defaultPhashComputer,
  HAMMING_THRESHOLD
} from '../../src/main/phash'

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

  it('uses median threshold — all-black image produces all-zero hash', () => {
    // All pixels = 0: all DCT = 0, median(AC) = 0, nothing > 0 → all bits 0
    expect(dctHash(uniformPixels(0), 32)).toBe('0000000000000000')
  })
})

// ---------------------------------------------------------------------------
// dHash (pure function)
// ---------------------------------------------------------------------------

describe('dHash', () => {
  it('returns a 16-character lowercase hex string', () => {
    const hash = dHash(checkerboardPixels(), 32)
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns the same hash for identical pixel arrays', () => {
    const pixels = checkerboardPixels()
    expect(dHash(pixels, 32)).toBe(dHash(pixels, 32))
  })

  it('returns all-zeros for a uniform image (no gradient)', () => {
    // All pixels identical → no pixel is > its neighbor → all bits 0
    expect(dHash(uniformPixels(128), 32)).toBe('0000000000000000')
  })

  it('returns a non-zero hash for a half-bright/half-dark image', () => {
    // Left half = 255, right half = 0 — clear gradient transition
    const pixels = new Uint8Array(32 * 32)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        pixels[y * 32 + x] = x < 16 ? 255 : 0
      }
    }
    const hash = dHash(pixels, 32)
    expect(hash).not.toBe('0000000000000000')
  })

  it('produces different hashes for horizontally opposite patterns', () => {
    const leftBright = new Uint8Array(32 * 32)
    const rightBright = new Uint8Array(32 * 32)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        leftBright[y * 32 + x] = x < 16 ? 255 : 0
        rightBright[y * 32 + x] = x >= 16 ? 255 : 0
      }
    }
    expect(dHash(leftBright, 32)).not.toBe(dHash(rightBright, 32))
  })
})

// ---------------------------------------------------------------------------
// hammingDistance
// ---------------------------------------------------------------------------

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0)
  })

  it('returns 1 for a single-bit difference', () => {
    // 8 = 1000, 0 = 0000 → 1 bit difference
    expect(hammingDistance('8000000000000000', '0000000000000000')).toBe(1)
  })

  it('returns 4 for a 4-bit difference', () => {
    // f = 1111, 0 = 0000 → 4 bits
    expect(hammingDistance('f000000000000000', '0000000000000000')).toBe(4)
  })

  it('returns 64 for maximally different 16-char hashes', () => {
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64)
  })

  it('HAMMING_THRESHOLD is 4', () => {
    expect(HAMMING_THRESHOLD).toBe(4)
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

  it('returns a PhashResult with 16-char hex phash and dhash for a valid image', async () => {
    const result = await defaultPhashComputer(gradientJpeg)
    expect(result).not.toBeNull()
    expect(result!.phash).toHaveLength(16)
    expect(result!.phash).toMatch(/^[0-9a-f]{16}$/)
    expect(result!.dhash).toHaveLength(16)
    expect(result!.dhash).toMatch(/^[0-9a-f]{16}$/)
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
