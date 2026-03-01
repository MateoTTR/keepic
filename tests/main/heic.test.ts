import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'
import {
  getHeicCandidatePaths,
  isLivePhotoMov,
  convertHeicToJpeg,
  createHeicConverter,
  getFfmpegPath,
  createUniversalPhashComputer,
  type SpawnFn
} from '../../src/main/heic'
import type { PhashComputer, PhashResult } from '../../src/main/phash'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'keepic-heic-test-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers: spawn mocks
// ---------------------------------------------------------------------------

/**
 * Creates a SpawnFn that exits with `exitCode` (pass `null` to simulate a null close code)
 * and optionally writes `fileContent` to the destination path (last argument in the args array).
 */
function makeSpawnMock(
  exitCode: number | null,
  fileContent?: Buffer,
  capturedArgs?: { cmd: string; args: string[] }[]
): SpawnFn {
  return (cmd: string, args: string[]): EventEmitter => {
    if (capturedArgs) capturedArgs.push({ cmd, args })
    const emitter = new EventEmitter()
    setImmediate(() => {
      if (fileContent !== undefined) {
        // Write content to the destination (last arg, before any trailing flags)
        // For converter: args = ['-i', src, '-q:v', quality, dest, '-y']  → dest = args[4]
        // For phash computer: args = ['-i', src, '-frames:v', '1', dest, '-y'] → dest = args[4]
        const destIndex = args.indexOf('-y') - 1
        if (destIndex >= 0) {
          writeFileSync(args[destIndex], fileContent)
        }
      }
      emitter.emit('close', exitCode)
    })
    return emitter
  }
}

/** SpawnFn that emits an 'error' event instead of 'close'. */
function makeSpawnErrorMock(err: Error): SpawnFn {
  return (): EventEmitter => {
    const emitter = new EventEmitter()
    setImmediate(() => emitter.emit('error', err))
    return emitter
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
// getFfmpegPath
// ---------------------------------------------------------------------------

describe('getFfmpegPath', () => {
  it('returns a non-empty string using the real ffmpeg-static', () => {
    const path = getFfmpegPath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })

  it('rewrites app.asar to app.asar.unpacked in the path', () => {
    const asarPath = '/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
    const result = getFfmpegPath(() => asarPath)
    expect(result).toBe('/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
  })

  it('is a no-op for paths that do not contain app.asar (dev mode)', () => {
    const devPath = '/home/user/project/node_modules/ffmpeg-static/ffmpeg'
    const result = getFfmpegPath(() => devPath)
    expect(result).toBe(devPath)
  })

  it('throws when ffmpeg-static returns null (platform not supported)', () => {
    expect(() => getFfmpegPath(() => null)).toThrow(
      'ffmpeg-static: no binary found for the current platform'
    )
  })
})

// ---------------------------------------------------------------------------
// createHeicConverter
// ---------------------------------------------------------------------------

describe('createHeicConverter', () => {
  it('calls ffmpeg with the correct arguments', async () => {
    const captured: { cmd: string; args: string[] }[] = []
    const spawnMock = makeSpawnMock(0, Buffer.from('jpeg'), captured)
    const converter = createHeicConverter('/path/to/ffmpeg', spawnMock)
    const dest = join(tmpDir, 'converter-args-out.jpg')

    await converter('/source/photo.heic', dest, 90)

    expect(captured).toHaveLength(1)
    expect(captured[0].cmd).toBe('/path/to/ffmpeg')
    expect(captured[0].args).toContain('-i')
    expect(captured[0].args).toContain('/source/photo.heic')
    expect(captured[0].args).toContain('-q:v')
    expect(captured[0].args).toContain(dest)
    expect(captured[0].args).toContain('-y')
  })

  it('passes quality as a string argument to -q:v', async () => {
    const captured: { cmd: string; args: string[] }[] = []
    const spawnMock = makeSpawnMock(0, Buffer.from('jpeg'), captured)
    const converter = createHeicConverter('/ffmpeg', spawnMock)
    const dest = join(tmpDir, 'quality-arg-out.jpg')

    await converter('/source/photo.heic', dest, 75)

    const qvIndex = captured[0].args.indexOf('-q:v')
    expect(qvIndex).toBeGreaterThanOrEqual(0)
    expect(captured[0].args[qvIndex + 1]).toBe('75')
  })

  it('resolves when ffmpeg exits with code 0', async () => {
    const dest = join(tmpDir, 'resolve-out.jpg')
    const converter = createHeicConverter('/ffmpeg', makeSpawnMock(0, Buffer.from('ok')))
    await expect(converter('/source/photo.heic', dest, 90)).resolves.toBeUndefined()
  })

  it('rejects when ffmpeg exits with a non-zero exit code', async () => {
    const dest = join(tmpDir, 'nonzero-out.jpg')
    const converter = createHeicConverter('/ffmpeg', makeSpawnMock(1))
    await expect(converter('/source/photo.heic', dest, 90)).rejects.toThrow(/ffmpeg exited/)
  })

  it('rejects with "null" code label when close event fires with null code', async () => {
    const dest = join(tmpDir, 'null-code-out.jpg')
    const converter = createHeicConverter('/ffmpeg', makeSpawnMock(null))
    await expect(converter('/source/photo.heic', dest, 90)).rejects.toThrow('code null')
  })

  it('rejects when the spawn emits an error event', async () => {
    const dest = join(tmpDir, 'spawn-error-out.jpg')
    const converter = createHeicConverter('/ffmpeg', makeSpawnErrorMock(new Error('spawn failed')))
    await expect(converter('/source/photo.heic', dest, 90)).rejects.toThrow('spawn failed')
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
    // defaultHeicConverter uses real ffmpeg; passing a non-HEIC file should cause ffmpeg
    // to exit non-zero → the promise rejects. This verifies the default parameter wiring.
    const fakeHeic = join(tmpDir, 'not-a-real.heic')
    const outputJpeg = join(tmpDir, 'output-default.jpg')
    writeFileSync(fakeHeic, Buffer.alloc(32, 0))
    await expect(convertHeicToJpeg(fakeHeic, outputJpeg, 80)).rejects.toThrow()
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

  it('routes non-HEIC files directly through computeSharpPhash (no ffmpeg)', async () => {
    let spawnCalled = false
    const spawnMock: SpawnFn = (): EventEmitter => {
      spawnCalled = true
      const e = new EventEmitter()
      setImmediate(() => e.emit('close', 0))
      return e
    }
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: mockSharpPhash
    })

    const result = await computer('/photos/photo.jpg')

    expect(spawnCalled).toBe(false)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(100)
  })

  it('routes .heic files through ffmpeg → temp JPEG → pHash', async () => {
    const tempFile = join(tmpDir, 'phash-heic-out.jpg')
    let sharpCalledWith: string | null = null

    const spawnMock = makeSpawnMock(0, Buffer.from('fake-jpeg'))
    const trackingSharpPhash: PhashComputer = async (fp) => {
      sharpCalledWith = fp
      return { phash: 'aabbccdd11223344', width: 4032, height: 3024 }
    }

    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: trackingSharpPhash,
      generateTempPath: () => tempFile
    })

    const result = await computer('/photos/IMG_1234.heic')

    expect(sharpCalledWith).toBe(tempFile)
    expect(result).not.toBeNull()
    expect(result!.phash).toBe('aabbccdd11223344')
    expect(result!.width).toBe(4032)
  })

  it('routes .heif files through ffmpeg (same as .heic)', async () => {
    let spawnCalled = false
    const spawnMock: SpawnFn = (): EventEmitter => {
      spawnCalled = true
      const e = new EventEmitter()
      setImmediate(() => e.emit('close', 0))
      return e
    }
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'heif-temp.jpg')
    })

    await computer('/photos/IMG.heif')
    expect(spawnCalled).toBe(true)
  })

  it('deletes the temp file after computing pHash for a HEIC file', async () => {
    const tempFile = join(tmpDir, 'phash-cleanup-test.jpg')
    let deleteCalledWith: string | null = null

    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(0, Buffer.from('jpeg')),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => tempFile,
      deleteFile: (p) => {
        deleteCalledWith = p
      }
    })

    await computer('/photos/IMG.heic')

    expect(deleteCalledWith).toBe(tempFile)
  })

  it('returns null when ffmpeg exits with a non-zero code', async () => {
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(1),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-fail.jpg')
    })

    const result = await computer('/photos/IMG.heic')
    expect(result).toBeNull()
  })

  it('returns null when spawn emits an error event', async () => {
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnErrorMock(new Error('spawn error')),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-spawn-err.jpg')
    })

    const result = await computer('/photos/IMG.heic')
    expect(result).toBeNull()
  })

  it('still attempts temp file deletion even when ffmpeg fails', async () => {
    let deleteAttempted = false
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(1),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-fail-cleanup.jpg'),
      deleteFile: () => {
        deleteAttempted = true
      }
    })

    await computer('/photos/IMG.heic')
    expect(deleteAttempted).toBe(true)
  })

  it('returns null when computeSharpPhash throws on the temp JPEG', async () => {
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(0, Buffer.from('jpeg')),
      computeSharpPhash: async () => {
        throw new Error('sharp decode error')
      },
      generateTempPath: () => join(tmpDir, 'phash-sharp-fail.jpg'),
      deleteFile: () => {}
    })

    const result = await computer('/photos/IMG.heic')
    expect(result).toBeNull()
  })

  it('tolerates deleteFile throwing (ignores cleanup errors)', async () => {
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(0, Buffer.from('jpeg')),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-delete-throw.jpg'),
      deleteFile: () => {
        throw new Error('delete failed')
      }
    })

    // Should not throw even if deleteFile throws
    await expect(computer('/photos/IMG.heic')).resolves.not.toBeNull()
  })

  it('passes the correct ffmpeg arguments for HEIC pHash computation', async () => {
    const captured: { cmd: string; args: string[] }[] = []
    const spawnMock = makeSpawnMock(0, Buffer.from('jpeg'), captured)
    const tempFile = join(tmpDir, 'phash-args.jpg')

    const computer = createUniversalPhashComputer('/path/to/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => tempFile
    })

    await computer('/photos/IMG.heic')

    expect(captured).toHaveLength(1)
    expect(captured[0].cmd).toBe('/path/to/ffmpeg')
    expect(captured[0].args).toContain('-i')
    expect(captured[0].args).toContain('/photos/IMG.heic')
    expect(captured[0].args).toContain('-frames:v')
    expect(captured[0].args).toContain('1')
    expect(captured[0].args).toContain(tempFile)
  })

  it('passes HEIC file path to ffmpeg -i argument', async () => {
    const captured: { cmd: string; args: string[] }[] = []
    const spawnMock = makeSpawnMock(0, Buffer.from('jpeg'), captured)

    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-input.jpg')
    })

    await computer('/albums/holiday/IMG_9999.heic')

    const iIndex = captured[0].args.indexOf('-i')
    expect(captured[0].args[iIndex + 1]).toBe('/albums/holiday/IMG_9999.heic')
  })

  it('extension check is case-insensitive for .HEIC and .HEIF', async () => {
    let spawnCallCount = 0
    const spawnMock: SpawnFn = (): EventEmitter => {
      spawnCallCount++
      const e = new EventEmitter()
      setImmediate(() => e.emit('close', 0))
      return e
    }

    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: spawnMock,
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-case.jpg')
    })

    // Both uppercase variants should trigger ffmpeg
    await computer('/photos/IMG.HEIC')
    await computer('/photos/IMG.HEIF')

    // Sharp is called for non-HEIC extensions
    expect(spawnCallCount).toBe(2)
  })

  it('returns null when ffmpeg close event fires with null exit code', async () => {
    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(null),
      computeSharpPhash: mockSharpPhash,
      generateTempPath: () => join(tmpDir, 'phash-null-code.jpg'),
      deleteFile: () => {}
    })

    const result = await computer('/photos/IMG.heic')
    expect(result).toBeNull()
  })

  it('uses default generateTempPath and deleteFile when not injected', async () => {
    // Default generateTempPath creates a UUID-based temp file in os.tmpdir().
    // The spawn mock writes to args[4] (the temp path), which the default
    // deleteFile (unlinkSync) then removes.
    let sharpCalledWith: string | null = null

    const computer = createUniversalPhashComputer('/ffmpeg', {
      spawnFn: makeSpawnMock(0, Buffer.from('jpeg')),
      computeSharpPhash: async (fp) => {
        sharpCalledWith = fp
        return { phash: 'default-path-hash', width: 100, height: 80 }
      }
      // generateTempPath and deleteFile intentionally NOT injected
    })

    const result = await computer('/photos/IMG.heic')

    expect(result).not.toBeNull()
    expect(sharpCalledWith).not.toBeNull()
    // The temp path should follow the keepic-phash-*.jpg pattern
    expect(sharpCalledWith).toMatch(/keepic-phash-.+\.jpg$/)
    // The temp file should have been deleted by the default deleteFile
    expect(existsSync(sharpCalledWith!)).toBe(false)
  })
})
