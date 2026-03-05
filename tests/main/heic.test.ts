import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getHeicCandidatePaths,
  isLivePhotoMov,
  isHeicFile,
  createHeicConverter,
  createUniversalPhashComputer,
  defaultHeicDecode,
  type HeicDecodeFn,
  type HeicDecodeResult
} from '../../src/main/heic'
import type { PhashComputer, PhashResult } from '../../src/main/phash'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock HeicDecodeFn that returns fake RGBA data at the given dimensions. */
function makeMockDecode(width = 3024, height = 4032): HeicDecodeFn {
  return async (): Promise<HeicDecodeResult> => ({
    data: new Uint8Array(width * height * 4),
    width,
    height
  })
}

/** Creates a mock HeicDecodeFn that throws. */
function makeMockDecodeError(message: string): HeicDecodeFn {
  return async (): Promise<HeicDecodeResult> => {
    throw new Error(message)
  }
}

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
// isHeicFile
// ---------------------------------------------------------------------------

describe('isHeicFile', () => {
  it('returns true for .heic', () => expect(isHeicFile('/a/b.heic')).toBe(true))
  it('returns true for .HEIC', () => expect(isHeicFile('/a/b.HEIC')).toBe(true))
  it('returns true for .heif', () => expect(isHeicFile('/a/b.heif')).toBe(true))
  it('returns true for .HEIF', () => expect(isHeicFile('/a/b.HEIF')).toBe(true))
  it('returns false for .jpg', () => expect(isHeicFile('/a/b.jpg')).toBe(false))
  it('returns false for .png', () => expect(isHeicFile('/a/b.png')).toBe(false))
})

// ---------------------------------------------------------------------------
// isLivePhotoMov
// ---------------------------------------------------------------------------

describe('isLivePhotoMov', () => {
  it('returns false for a non-.mov extension without providing checkExists', () => {
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
      return p.endsWith('.heic')
    }
    const result = isLivePhotoMov('/photos/IMG_1234.mov', checkExists)
    expect(result).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/\.heic$/)
  })
})

// ---------------------------------------------------------------------------
// defaultHeicDecode
// ---------------------------------------------------------------------------

describe('defaultHeicDecode', () => {
  it('rejects with a meaningful error for non-HEIC input', async () => {
    await expect(defaultHeicDecode(Buffer.from('not a heic file'))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// createHeicConverter
// ---------------------------------------------------------------------------

describe('createHeicConverter', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'keepic-heic-conv-'))
  })
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('decodes HEIC and writes JPEG to dest', async () => {
    const w = 4,
      h = 4
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) % 256
    const mockDecode: HeicDecodeFn = async () => ({ data: rgba, width: w, height: h })

    const dest = join(tmpDir, 'converter-out.jpg')
    const converter = createHeicConverter(mockDecode, () => Buffer.from('fake'))
    await converter('/src/photo.heic', dest, 85)

    // Verify the file was created
    const sharp = (await import('sharp')).default
    const meta = await sharp(dest).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(w)
    expect(meta.height).toBe(h)
  })

  it('reads the source file with the injected readFile', async () => {
    let readPath: string | null = null
    const mockDecode = makeMockDecode(2, 2)
    const dest = join(tmpDir, 'readfile-out.jpg')

    const converter = createHeicConverter(mockDecode, (p) => {
      readPath = p
      return Buffer.from('fake')
    })
    await converter('/my/photo.heic', dest, 90)
    expect(readPath).toBe('/my/photo.heic')
  })

  it('propagates decode errors', async () => {
    const mockDecode = makeMockDecodeError('corrupt HEIC')
    const converter = createHeicConverter(mockDecode, () => Buffer.from('fake'))
    await expect(converter('/src/bad.heic', '/dest/out.jpg', 90)).rejects.toThrow('corrupt HEIC')
  })

  it('uses defaultHeicDecode and readFileSync when not injected', () => {
    const converter = createHeicConverter()
    expect(typeof converter).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// createUniversalPhashComputer
// ---------------------------------------------------------------------------

describe('createUniversalPhashComputer', () => {
  const mockSharpPhash: PhashComputer = async (filePath: string): Promise<PhashResult> => ({
    phash: Buffer.from(filePath).toString('hex').slice(0, 16).padEnd(16, '0'),
    width: 100,
    height: 80
  })

  it('routes non-HEIC files directly through computeSharpPhash', async () => {
    let decodeCalled = false
    const mockDecode: HeicDecodeFn = async () => {
      decodeCalled = true
      return { data: new Uint8Array(4), width: 1, height: 1 }
    }

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      computeSharpPhash: mockSharpPhash
    })

    const result = await computer('/photos/photo.jpg')

    expect(decodeCalled).toBe(false)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(100)
  })

  it('routes .heic files through heic-decode and computes full-image pHash', async () => {
    const w = 4,
      h = 4
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) % 256

    const mockDecode: HeicDecodeFn = async () => ({ data: rgba, width: w, height: h })
    let readPath: string | null = null

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      readFile: (p) => {
        readPath = p
        return Buffer.from('fake')
      }
    })

    const result = await computer('/photos/IMG_1234.heic')

    expect(readPath).toBe('/photos/IMG_1234.heic')
    expect(result).not.toBeNull()
    expect(result!.phash).toMatch(/^[0-9a-f]{16}$/)
    expect(result!.width).toBe(w)
    expect(result!.height).toBe(h)
  })

  it('routes .heif files through heic-decode (same as .heic)', async () => {
    let decodeCalled = false
    const mockDecode: HeicDecodeFn = async () => {
      decodeCalled = true
      return { data: new Uint8Array(64), width: 4, height: 4 }
    }

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      readFile: () => Buffer.from('fake')
    })

    await computer('/photos/IMG.heif')
    expect(decodeCalled).toBe(true)
  })

  it('extension check is case-insensitive for .HEIC and .HEIF', async () => {
    let decodeCount = 0
    const mockDecode: HeicDecodeFn = async () => {
      decodeCount++
      return { data: new Uint8Array(64), width: 4, height: 4 }
    }

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      readFile: () => Buffer.from('fake')
    })

    await computer('/photos/IMG.HEIC')
    await computer('/photos/IMG.HEIF')
    expect(decodeCount).toBe(2)
  })

  it('throws when heic-decode fails (error propagates)', async () => {
    const mockDecode = makeMockDecodeError('HEIF processing error')

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      readFile: () => Buffer.from('fake')
    })

    await expect(computer('/photos/IMG.heic')).rejects.toThrow('HEIF processing error')
  })

  it('returns the full native dimensions (not 512x512 tile)', async () => {
    const mockDecode = makeMockDecode(3024, 4032)

    const computer = createUniversalPhashComputer({
      decodeFn: mockDecode,
      readFile: () => Buffer.from('fake')
    })

    const result = await computer('/photos/IMG.heic')
    expect(result!.width).toBe(3024)
    expect(result!.height).toBe(4032)
  })

  it('uses default dependencies when no options provided', () => {
    const computer = createUniversalPhashComputer()
    expect(typeof computer).toBe('function')
  })
})
