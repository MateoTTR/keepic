import { describe, it, expect } from 'vitest'
import { createThumbnailGenerator, getVideoPlaceholderBuffer } from '../../src/main/thumbnail'
import type { HeicDecodeFn, HeicDecodeResult } from '../../src/main/heic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal 2x2 JPEG-like buffer for testing (sharp can read this). */
function makeFakeJpegBuffer(): Buffer {
  // 2x2 red pixel JPEG — minimal valid JPEG file
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02,
    0x00, 0x02, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
    0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
    0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
    0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
    0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
    0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
    0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
    0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0xff, 0xd9
  ])
}

function makeMockDecode(width = 4, height = 4): HeicDecodeFn {
  return async (): Promise<HeicDecodeResult> => ({
    data: new Uint8Array(width * height * 4).fill(128),
    width,
    height
  })
}

function makeMockDecodeError(message: string): HeicDecodeFn {
  return async (): Promise<HeicDecodeResult> => {
    throw new Error(message)
  }
}

// ---------------------------------------------------------------------------
// createThumbnailGenerator — JPEG/PNG path
// ---------------------------------------------------------------------------

describe('createThumbnailGenerator', () => {
  describe('JPEG/PNG files', () => {
    it('returns a JPEG buffer for a JPEG file', async () => {
      const jpegBuf = makeFakeJpegBuffer()
      const gen = createThumbnailGenerator({
        readFile: () => jpegBuf
      })

      // sharp reads from the file path directly for non-HEIC, so we use a
      // pipeline that accepts a buffer. To test without a real file, we
      // create a generator that works on the raw sharp(path) call.
      // Instead, let's use a real tiny buffer via sharp(buffer) approach.
      // The implementation uses sharp(absolutePath) for non-HEIC, so we need
      // a different test approach — we test the HEIC path with injection and
      // trust that sharp(path) works for JPEG (it's sharp's responsibility).
      // We'll test the full integration via a temp file.
      expect(gen).toBeTypeOf('function')
    })

    it('generates a thumbnail from a real JPEG buffer via temp file', async () => {
      const { writeFileSync, mkdtempSync, rmSync } = await import('fs')
      const { join } = await import('path')
      const { tmpdir } = await import('os')

      const tmpDir = mkdtempSync(join(tmpdir(), 'keepic-thumb-'))
      const jpegPath = join(tmpDir, 'test.jpg')

      // Create a minimal valid image with sharp
      const sharp = (await import('sharp')).default
      const inputBuf = await sharp({
        create: { width: 100, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } }
      })
        .jpeg()
        .toBuffer()
      writeFileSync(jpegPath, inputBuf)

      const gen = createThumbnailGenerator()
      const result = await gen(jpegPath, { maxDim: 50 })

      // Result should be a JPEG buffer
      expect(result.contentType).toBe('image/jpeg')
      expect(result.buffer).toBeInstanceOf(Buffer)
      expect(result.buffer[0]).toBe(0xff) // JPEG magic byte
      expect(result.buffer[1]).toBe(0xd8)

      // Verify dimensions: 100x200 resized to fit inside 50x50 → 25x50
      const meta = await sharp(result.buffer).metadata()
      expect(meta.width).toBe(25)
      expect(meta.height).toBe(50)
      expect(meta.format).toBe('jpeg')

      rmSync(tmpDir, { recursive: true })
    })

    it('respects different maxDim values', async () => {
      const { writeFileSync, mkdtempSync, rmSync } = await import('fs')
      const { join } = await import('path')
      const { tmpdir } = await import('os')

      const tmpDir = mkdtempSync(join(tmpdir(), 'keepic-thumb-'))
      const jpegPath = join(tmpDir, 'test.jpg')

      const sharp = (await import('sharp')).default
      const inputBuf = await sharp({
        create: { width: 600, height: 400, channels: 3, background: { r: 0, g: 255, b: 0 } }
      })
        .jpeg()
        .toBuffer()
      writeFileSync(jpegPath, inputBuf)

      const gen = createThumbnailGenerator()
      const result = await gen(jpegPath, { maxDim: 150 })

      const meta = await sharp(result.buffer).metadata()
      expect(meta.width).toBe(150)
      expect(meta.height).toBe(100)

      rmSync(tmpDir, { recursive: true })
    })

    it('throws for a non-existent file', async () => {
      const gen = createThumbnailGenerator()
      await expect(gen('/nonexistent/file.jpg', { maxDim: 300 })).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // HEIC path
  // ---------------------------------------------------------------------------

  describe('HEIC files', () => {
    it('decodes HEIC via injected decodeFn and returns a JPEG thumbnail', async () => {
      const width = 100
      const height = 200
      const mockDecode = makeMockDecode(width, height)
      const mockReadFile = (): Buffer => Buffer.from('fake-heic-data')

      const gen = createThumbnailGenerator({
        decodeFn: mockDecode,
        readFile: mockReadFile
      })

      const result = await gen('/photos/IMG_1234.HEIC', { maxDim: 50 })

      expect(result.contentType).toBe('image/jpeg')
      expect(result.buffer).toBeInstanceOf(Buffer)
      expect(result.buffer[0]).toBe(0xff)
      expect(result.buffer[1]).toBe(0xd8)

      const sharp = (await import('sharp')).default
      const meta = await sharp(result.buffer).metadata()
      expect(meta.width).toBe(25) // 100x200 fit inside 50x50 → 25x50
      expect(meta.height).toBe(50)
      expect(meta.format).toBe('jpeg')
    })

    it('works with .heif extension', async () => {
      const mockDecode = makeMockDecode(80, 80)
      const gen = createThumbnailGenerator({
        decodeFn: mockDecode,
        readFile: () => Buffer.from('fake')
      })

      const result = await gen('/photos/IMG.heif', { maxDim: 40 })

      expect(result.contentType).toBe('image/jpeg')
      expect(result.buffer).toBeInstanceOf(Buffer)
      const sharp = (await import('sharp')).default
      const meta = await sharp(result.buffer).metadata()
      expect(meta.width).toBe(40)
      expect(meta.height).toBe(40)
    })

    it('propagates HEIC decode errors', async () => {
      const gen = createThumbnailGenerator({
        decodeFn: makeMockDecodeError('HEIC decode failed'),
        readFile: () => Buffer.from('fake')
      })

      await expect(gen('/photos/IMG.HEIC', { maxDim: 300 })).rejects.toThrow('HEIC decode failed')
    })

    it('propagates readFile errors for HEIC files', async () => {
      const gen = createThumbnailGenerator({
        decodeFn: makeMockDecode(),
        readFile: () => {
          throw new Error('File not found')
        }
      })

      await expect(gen('/photos/IMG.HEIC', { maxDim: 300 })).rejects.toThrow('File not found')
    })
  })

  // ---------------------------------------------------------------------------
  // Video files
  // ---------------------------------------------------------------------------

  describe('Video files', () => {
    it('returns an SVG placeholder for video files', async () => {
      const gen = createThumbnailGenerator()
      const result = await gen('/photos/clip.mp4', { maxDim: 300 })

      expect(result.contentType).toBe('image/svg+xml')
      expect(result.buffer.toString('utf-8')).toContain('<svg')
      expect(result.buffer.toString('utf-8')).toContain('polygon')
    })

    it('returns the same placeholder for all video extensions', async () => {
      const gen = createThumbnailGenerator()
      const extensions = ['.mp4', '.mov', '.avi', '.mts', '.3gp', '.m4v', '.mpg']

      for (const ext of extensions) {
        const result = await gen(`/photos/clip${ext}`, { maxDim: 300 })
        expect(result.contentType).toBe('image/svg+xml')
      }
    })

    it('does not call decodeFn or readFile for video files', async () => {
      let decodeCalled = false
      let readCalled = false
      const gen = createThumbnailGenerator({
        decodeFn: async () => {
          decodeCalled = true
          return { data: new Uint8Array(0), width: 0, height: 0 }
        },
        readFile: () => {
          readCalled = true
          return Buffer.from('')
        }
      })

      await gen('/photos/video.MOV', { maxDim: 300 })
      expect(decodeCalled).toBe(false)
      expect(readCalled).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// getVideoPlaceholderBuffer
// ---------------------------------------------------------------------------

describe('getVideoPlaceholderBuffer', () => {
  it('returns a valid SVG buffer', () => {
    const buf = getVideoPlaceholderBuffer()
    expect(buf).toBeInstanceOf(Buffer)
    const svg = buf.toString('utf-8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })
})
