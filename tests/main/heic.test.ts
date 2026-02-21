import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import {
  getHeicCandidatePaths,
  isLivePhotoMov,
  convertHeicToJpeg,
  defaultHeicConverter
} from '../../src/main/heic'

// ---------------------------------------------------------------------------
// Test fixtures (real image files created at runtime)
// ---------------------------------------------------------------------------

let tmpDir: string
let sourceJpeg: string
let outputJpeg: string

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'keepic-heic-test-'))
  sourceJpeg = join(tmpDir, 'source.jpg')
  outputJpeg = join(tmpDir, 'output.jpg')

  // Small solid-colour JPEG — exercises the same sharp code path as a real HEIC
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 200 } }
  })
    .jpeg()
    .toFile(sourceJpeg)
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// getHeicCandidatePaths (pure)
// ---------------------------------------------------------------------------

describe('getHeicCandidatePaths', () => {
  it('returns [stem.heic, stem.heif] for a simple filename', () => {
    const candidates = getHeicCandidatePaths('IMG_1234.MOV')
    expect(candidates).toEqual(['IMG_1234.heic', 'IMG_1234.heif'])
  })

  it('preserves the full directory path', () => {
    const candidates = getHeicCandidatePaths('/photos/2025/IMG_1234.MOV')
    expect(candidates).toEqual(['/photos/2025/IMG_1234.heic', '/photos/2025/IMG_1234.heif'])
  })

  it('handles a path whose stem contains dots', () => {
    const candidates = getHeicCandidatePaths('/photos/my.photo.MOV')
    expect(candidates).toEqual(['/photos/my.photo.heic', '/photos/my.photo.heif'])
  })
})

// ---------------------------------------------------------------------------
// isLivePhotoMov
// ---------------------------------------------------------------------------

describe('isLivePhotoMov', () => {
  it('returns false for a non-.mov extension without providing checkExists', () => {
    // Also covers the default parameter (checkExists = existsSync)
    expect(isLivePhotoMov('/photos/IMG_1234.jpg')).toBe(false)
  })

  it('returns false for a .png extension', () => {
    expect(isLivePhotoMov('/photos/IMG_1234.png', () => true)).toBe(false)
  })

  it('returns true when the .heic companion exists', () => {
    const checkExists = (p: string): boolean => p.endsWith('.heic')
    expect(isLivePhotoMov('/photos/IMG_1234.MOV', checkExists)).toBe(true)
  })

  it('returns true when the .heif companion exists but not .heic', () => {
    const checkExists = (p: string): boolean => p.endsWith('.heif')
    expect(isLivePhotoMov('/photos/IMG_1234.mov', checkExists)).toBe(true)
  })

  it('returns false when no HEIC/HEIF companion exists', () => {
    const checkExists = (): boolean => false
    expect(isLivePhotoMov('/photos/IMG_1234.mov', checkExists)).toBe(false)
  })

  it('handles uppercase .MOV extension (normalised with toLowerCase)', () => {
    const checkExists = (p: string): boolean => p.endsWith('.heic')
    expect(isLivePhotoMov('/photos/IMG_5678.MOV', checkExists)).toBe(true)
  })

  it('handles mixed-case .Mov extension', () => {
    const checkExists = (p: string): boolean => p.endsWith('.heic')
    expect(isLivePhotoMov('/photos/IMG_5678.Mov', checkExists)).toBe(true)
  })

  it('checks .heic first and stops early when it exists', () => {
    const calls: string[] = []
    const checkExists = (p: string): boolean => {
      calls.push(p)
      return p.endsWith('.heic') // only the first candidate matches
    }
    const result = isLivePhotoMov('/photos/IMG_1234.mov', checkExists)
    expect(result).toBe(true)
    // .some() short-circuits: only the .heic candidate should have been checked
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/\.heic$/)
  })
})

// ---------------------------------------------------------------------------
// convertHeicToJpeg
// ---------------------------------------------------------------------------

describe('convertHeicToJpeg', () => {
  it('calls the injected converter with (src, dest, quality)', async () => {
    const calls: { src: string; dest: string; quality: number }[] = []
    const mockConverter = async (src: string, dest: string, quality: number): Promise<void> => {
      calls.push({ src, dest, quality })
    }
    await convertHeicToJpeg('/a/photo.heic', '/tmp/photo.jpg', 85, mockConverter)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ src: '/a/photo.heic', dest: '/tmp/photo.jpg', quality: 85 })
  })

  it('uses defaultHeicConverter when no converter is provided', async () => {
    // Calls convertHeicToJpeg without the 4th argument → falls back to defaultHeicConverter
    await convertHeicToJpeg(sourceJpeg, outputJpeg, 80)
    expect(existsSync(outputJpeg)).toBe(true)
    const meta = await sharp(outputJpeg).metadata()
    expect(meta.format).toBe('jpeg')
  })
})

// ---------------------------------------------------------------------------
// defaultHeicConverter
// ---------------------------------------------------------------------------

describe('defaultHeicConverter', () => {
  it('writes a JPEG to the destination path', async () => {
    const destPath = join(tmpDir, 'default-converter-out.jpg')
    await defaultHeicConverter(sourceJpeg, destPath, 75)
    expect(existsSync(destPath)).toBe(true)
    const meta = await sharp(destPath).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('respects the quality parameter (lower quality → smaller file)', async () => {
    const highQualityPath = join(tmpDir, 'high-quality.jpg')
    const lowQualityPath = join(tmpDir, 'low-quality.jpg')

    // Use a slightly larger image so quality difference is measurable
    const bigSource = join(tmpDir, 'big-source.jpg')
    const pixels = Buffer.alloc(200 * 200 * 3)
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256)
    await sharp(pixels, { raw: { width: 200, height: 200, channels: 3 } })
      .jpeg()
      .toFile(bigSource)

    await defaultHeicConverter(bigSource, highQualityPath, 95)
    await defaultHeicConverter(bigSource, lowQualityPath, 1)

    const highSize = statSync(highQualityPath).size
    const lowSize = statSync(lowQualityPath).size
    expect(highSize).toBeGreaterThan(lowSize)
  })

  it('throws when the source file does not exist', async () => {
    await expect(
      defaultHeicConverter('/nonexistent/photo.heic', join(tmpDir, 'out.jpg'), 90)
    ).rejects.toThrow()
  })
})
