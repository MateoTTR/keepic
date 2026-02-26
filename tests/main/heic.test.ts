import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import {
  getHeicCandidatePaths,
  isLivePhotoMov,
  convertHeicToJpeg,
  createHeicConverter,
  createHeicPhashComputer,
  type HeicPixelDecoder
} from '../../src/main/heic'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

/** Creates a mock HeicPixelDecoder that returns RGBA pixels of the given size. */
function createMockDecoder(width = 8, height = 8): HeicPixelDecoder {
  return async () => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120 // R
      data[i + 1] = 80 // G
      data[i + 2] = 200 // B
      data[i + 3] = 255 // A
    }
    return { data, width, height }
  }
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'keepic-heic-test-'))
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
    // Write a fake "HEIC" file — defaultHeicConverter uses the real heic-decode
    // which validates HEIC magic bytes, so this will throw TypeError.
    // This test verifies the default parameter wiring (falls back to defaultHeicConverter).
    const fakeHeic = join(tmpDir, 'not-a-real.heic')
    const outputJpeg = join(tmpDir, 'output-default.jpg')
    // Write some non-HEIC bytes to trigger heic-decode's type check
    const { writeFileSync } = await import('fs')
    writeFileSync(fakeHeic, Buffer.alloc(32, 0))
    await expect(convertHeicToJpeg(fakeHeic, outputJpeg, 80)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// createHeicConverter
// ---------------------------------------------------------------------------

describe('createHeicConverter', () => {
  it('decodes HEIC pixels then encodes a valid JPEG file', async () => {
    const destPath = join(tmpDir, 'converter-out.jpg')
    const srcPath = join(tmpDir, 'fake-source.heic')
    const fakeContent = Buffer.from('fake-heic-content')
    const { writeFileSync } = await import('fs')
    writeFileSync(srcPath, fakeContent)

    const converter = createHeicConverter(createMockDecoder(8, 8))
    await converter(srcPath, destPath, 75)

    expect(existsSync(destPath)).toBe(true)
    const meta = await sharp(destPath).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(8)
    expect(meta.height).toBe(8)
  })

  it('passes the file buffer to the decoder', async () => {
    const srcPath = join(tmpDir, 'pass-buffer.heic')
    const destPath = join(tmpDir, 'pass-buffer-out.jpg')
    const content = Buffer.from('test-heic-bytes-123')
    const { writeFileSync } = await import('fs')
    writeFileSync(srcPath, content)

    let receivedBuffer: Buffer | ArrayBuffer | Uint8Array | undefined
    const trackingDecoder: HeicPixelDecoder = async (opts) => {
      receivedBuffer = opts.buffer
      const data = new Uint8ClampedArray(4 * 4 * 4).fill(128)
      return { data, width: 4, height: 4 }
    }

    const converter = createHeicConverter(trackingDecoder)
    await converter(srcPath, destPath, 80)

    expect(Buffer.isBuffer(receivedBuffer)).toBe(true)
    expect((receivedBuffer as Buffer).toString()).toBe('test-heic-bytes-123')
  })

  it('respects the quality parameter (lower quality → smaller file)', async () => {
    const highQualityPath = join(tmpDir, 'high-quality.jpg')
    const lowQualityPath = join(tmpDir, 'low-quality.jpg')
    const srcPath = join(tmpDir, 'quality-source.heic')
    const { writeFileSync } = await import('fs')
    writeFileSync(srcPath, Buffer.from('dummy'))

    // Use a larger image so quality difference is measurable
    const converter = createHeicConverter(createMockDecoder(200, 200))
    await converter(srcPath, highQualityPath, 95)
    await converter(srcPath, lowQualityPath, 1)

    const highSize = statSync(highQualityPath).size
    const lowSize = statSync(lowQualityPath).size
    expect(highSize).toBeGreaterThan(lowSize)
  })

  it('throws when the source file does not exist', async () => {
    const converter = createHeicConverter(createMockDecoder())
    await expect(
      converter('/nonexistent/photo.heic', join(tmpDir, 'out.jpg'), 90)
    ).rejects.toThrow()
  })

  it('throws when the decoder rejects', async () => {
    const srcPath = join(tmpDir, 'decode-fail.heic')
    const { writeFileSync } = await import('fs')
    writeFileSync(srcPath, Buffer.from('bad'))

    const failingDecoder: HeicPixelDecoder = async () => {
      throw new Error('HEIF processing error')
    }
    const converter = createHeicConverter(failingDecoder)
    await expect(converter(srcPath, join(tmpDir, 'fail-out.jpg'), 80)).rejects.toThrow(
      'HEIF processing error'
    )
  })

  it('uses the injected readFile function', async () => {
    const destPath = join(tmpDir, 'custom-read-out.jpg')
    const fakeBuffer = Buffer.from('custom-read-content')
    const mockReadFile = (): Buffer => fakeBuffer

    let receivedBuffer: Buffer | ArrayBuffer | Uint8Array | undefined
    const trackingDecoder: HeicPixelDecoder = async (opts) => {
      receivedBuffer = opts.buffer
      const data = new Uint8ClampedArray(4 * 4 * 4).fill(200)
      return { data, width: 4, height: 4 }
    }

    const converter = createHeicConverter(trackingDecoder, mockReadFile)
    await converter('/any/path.heic', destPath, 80)

    expect(receivedBuffer).toBe(fakeBuffer)
    expect(existsSync(destPath)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createHeicPhashComputer
// ---------------------------------------------------------------------------

describe('createHeicPhashComputer', () => {
  it('returns a PhashResult with correct width/height and a non-empty hash', async () => {
    const computer = createHeicPhashComputer(createMockDecoder(64, 48), () => Buffer.from('fake'))
    const result = await computer('/any/photo.heic')

    expect(result).not.toBeNull()
    expect(result!.width).toBe(64)
    expect(result!.height).toBe(48)
    expect(result!.phash).toHaveLength(16) // 64-bit DCT hash → 16 hex chars
  })

  it('passes the file buffer to the decoder via the injected readFile', async () => {
    const fakeBuffer = Buffer.from('fake-heic-bytes')
    const mockReadFile = (): Buffer => fakeBuffer

    let receivedBuffer: Buffer | ArrayBuffer | Uint8Array | undefined
    const trackingDecoder: HeicPixelDecoder = async (opts) => {
      receivedBuffer = opts.buffer
      const data = new Uint8ClampedArray(8 * 8 * 4).fill(100)
      return { data, width: 8, height: 8 }
    }

    const computer = createHeicPhashComputer(trackingDecoder, mockReadFile)
    await computer('/any/photo.heic')

    expect(receivedBuffer).toBe(fakeBuffer)
  })

  it('returns null when the decoder throws', async () => {
    const failingDecoder: HeicPixelDecoder = async () => {
      throw new Error('HEIF decode error')
    }
    const computer = createHeicPhashComputer(failingDecoder)
    const result = await computer('/any/photo.heic')
    expect(result).toBeNull()
  })

  it('returns null when readFile throws', async () => {
    const throwingReadFile = (): Buffer => {
      throw new Error('file not found')
    }
    const computer = createHeicPhashComputer(createMockDecoder(), throwingReadFile)
    const result = await computer('/nonexistent/photo.heic')
    expect(result).toBeNull()
  })

  it('returns null when sharp rejects due to invalid pixel dimensions', async () => {
    // width=0, height=0 causes sharp to throw on raw input
    const zeroSizeDecoder: HeicPixelDecoder = async () => ({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0
    })
    const computer = createHeicPhashComputer(zeroSizeDecoder)
    const result = await computer('/any/photo.heic')
    expect(result).toBeNull()
  })

  it('produces the same hash for identical pixel data regardless of file path', async () => {
    const computer = createHeicPhashComputer(createMockDecoder(32, 32), () => Buffer.from('fake'))
    const result1 = await computer('/path/a.heic')
    const result2 = await computer('/path/b.heic')
    expect(result1!.phash).toBe(result2!.phash)
  })
})
