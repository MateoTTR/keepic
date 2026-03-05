import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { KeePicDatabase } from '../../src/main/db/database'
import { scanSourceFiles, buildImportPlan, executeImportPlan } from '../../src/main/importer'
import type { ExifLoader } from '../../src/main/exif'
import type { PhashComputer } from '../../src/main/phash'
import type { HeicConverter } from '../../src/main/heic'
import type { AppConfig, ImportPlan } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'keepic-importer-test-'))
}

function touch(filePath: string, content = 'x'): void {
  writeFileSync(filePath, content)
}

function openDb(): KeePicDatabase {
  const db = new KeePicDatabase(':memory:')
  db.open()
  return db
}

/** Inserts a photo record into the DB (used to simulate existing library entries). */
function seedPhoto(db: KeePicDatabase, path: string, phash: string): void {
  db.db
    .prepare(
      `INSERT INTO photos (path, filename, phash, date_taken, date_taken_source,
         width, height, file_size, file_mtime, source, google_id, imported_at, created_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, '', 'local', NULL, '', '')`
    )
    .run(path, path, phash)
}

/** Returns all photos from the DB. */
function getAllPhotos(
  db: KeePicDatabase
): { path: string; phash: string | null; deleted_at: string | null }[] {
  return db.db.prepare('SELECT path, phash, deleted_at FROM photos ORDER BY path').all() as {
    path: string
    phash: string | null
    deleted_at: string | null
  }[]
}

/** Returns all import jobs from the DB. */
function getAllJobs(
  db: KeePicDatabase
): { source: string; status: string; photos_imported: number; photos_skipped: number }[] {
  return db.db
    .prepare('SELECT source, status, photos_imported, photos_skipped FROM import_jobs')
    .all() as {
    source: string
    status: string
    photos_imported: number
    photos_skipped: number
  }[]
}

const nullExifLoader: ExifLoader = async () => null

/** Returns a fake hash derived from the file path — deterministic for tests. */
const mockPhashComputer: PhashComputer = async (filePath: string) => ({
  phash: Buffer.from(filePath).toString('hex').slice(0, 16).padEnd(16, '0'),
  width: 640,
  height: 480
})

const nullPhashComputer: PhashComputer = async () => null

const baseConfig: AppConfig = {
  libraryPath: '/unused',
  heic: { mode: 'keep', jpegQuality: 90 }
}

const heicConvertConfig: AppConfig = {
  ...baseConfig,
  heic: { mode: 'convert', jpegQuality: 90 }
}

// ---------------------------------------------------------------------------
// scanSourceFiles
// ---------------------------------------------------------------------------

describe('scanSourceFiles', () => {
  let sourceDir: string

  beforeEach(() => {
    sourceDir = makeTempDir()
  })

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('returns empty arrays for an empty folder', () => {
    const result = scanSourceFiles(sourceDir)
    expect(result.candidates).toEqual([])
    expect(result.livePhotoMovs).toEqual([])
  })

  it('returns empty arrays for a non-existent folder', () => {
    const result = scanSourceFiles(join(sourceDir, 'ghost'))
    expect(result.candidates).toEqual([])
    expect(result.livePhotoMovs).toEqual([])
  })

  it('picks up supported image files in nested subfolders', () => {
    const sub = join(sourceDir, 'DCIM', 'Camera')
    mkdirSync(sub, { recursive: true })
    touch(join(sub, 'photo.jpg'))
    touch(join(sub, 'raw.CR2'))
    touch(join(sub, 'video.mp4')) // unsupported — ignored

    const { candidates } = scanSourceFiles(sourceDir)
    expect(candidates).toHaveLength(2)
    expect(candidates.some((p) => p.endsWith('photo.jpg'))).toBe(true)
    expect(candidates.some((p) => p.endsWith('raw.CR2'))).toBe(true)
  })

  it('detects Live Photo MOV companions and excludes them from candidates', () => {
    // Use lowercase .heic — isLivePhotoMov checks for lowercase on case-sensitive filesystems (Linux CI)
    touch(join(sourceDir, 'IMG_1234.heic'))
    touch(join(sourceDir, 'IMG_1234.MOV'))

    const { candidates, livePhotoMovs } = scanSourceFiles(sourceDir)
    expect(candidates.some((p) => p.endsWith('IMG_1234.heic'))).toBe(true)
    expect(livePhotoMovs.some((p) => p.endsWith('IMG_1234.MOV'))).toBe(true)
    expect(candidates.some((p) => p.endsWith('IMG_1234.MOV'))).toBe(false)
  })

  it('ignores .MOV files that are not Live Photo companions', () => {
    touch(join(sourceDir, 'video.MOV')) // no sibling HEIC

    const { candidates, livePhotoMovs } = scanSourceFiles(sourceDir)
    expect(candidates).toHaveLength(0)
    expect(livePhotoMovs).toHaveLength(0)
  })

  it('handles all supported extensions', () => {
    const exts = [
      '.jpg',
      '.jpeg',
      '.heic',
      '.heif',
      '.png',
      '.tiff',
      '.tif',
      '.cr2',
      '.nef',
      '.arw'
    ]
    for (const ext of exts) {
      touch(join(sourceDir, `file${ext}`))
    }
    const { candidates } = scanSourceFiles(sourceDir)
    expect(candidates).toHaveLength(exts.length)
  })

  it('is case-insensitive for extensions', () => {
    touch(join(sourceDir, 'IMG.JPG'))
    touch(join(sourceDir, 'IMG.HEIC'))
    const { candidates } = scanSourceFiles(sourceDir)
    expect(candidates).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// buildImportPlan
// ---------------------------------------------------------------------------

describe('buildImportPlan', () => {
  let sourceDir: string
  let libraryDir: string
  let db: KeePicDatabase

  beforeEach(() => {
    sourceDir = makeTempDir()
    libraryDir = makeTempDir()
    db = openDb()
  })

  afterEach(() => {
    db.close()
    rmSync(sourceDir, { recursive: true, force: true })
    rmSync(libraryDir, { recursive: true, force: true })
  })

  it('uses default ExifLoader and PhashComputer when options are omitted', async () => {
    // fake file — defaultExifLoader and defaultPhashComputer return null on non-images
    touch(join(sourceDir, 'photo.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {})
    // No options injected — exercises the ?? defaultExifLoader / ?? defaultPhashComputer branches

    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0].phash).toBeNull() // sharp returns null on fake file
    expect(plan.entries[0].status).toBe('ready')
  })

  it('returns an empty plan for an empty source folder', async () => {
    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })
    expect(plan.entries).toHaveLength(0)
    expect(plan.livePhotosDiscarded).toBe(0)
    expect(plan.sourceFolder).toBe(sourceDir)
  })

  it('marks a new photo as ready', async () => {
    touch(join(sourceDir, 'photo.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: mockPhashComputer
    })

    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0].status).toBe('ready')
    expect(plan.entries[0].phash).not.toBeNull()
    expect(plan.entries[0].destinationRelativePath).toMatch(/^\d{4}\/\d{4}\.\d{2}\/photo\.jpg$/)
  })

  it('marks a photo as duplicate when pHash matches existing library entry', async () => {
    const srcPath = join(sourceDir, 'photo.jpg')
    touch(srcPath)

    const phashResult = await mockPhashComputer(srcPath)
    seedPhoto(db, 'library/existing.jpg', phashResult!.phash)

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: mockPhashComputer
    })

    expect(plan.entries[0].status).toBe('duplicate')
    expect(plan.entries[0].duplicateOf).toBe('library/existing.jpg')
  })

  it('does not mark as duplicate when pHash is null', async () => {
    touch(join(sourceDir, 'photo.cr2'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.entries[0].status).toBe('ready')
    expect(plan.entries[0].phash).toBeNull()
  })

  it('marks as collision and resolves with _1 suffix when destination exists', async () => {
    touch(join(sourceDir, 'photo.jpg'))

    // Pre-create the destination in the library
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const destDir = join(libraryDir, String(year), `${year}.${month}`)
    mkdirSync(destDir, { recursive: true })
    touch(join(destDir, 'photo.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.entries[0].status).toBe('collision')
    expect(plan.entries[0].originalDestination).toMatch(/photo\.jpg$/)
    expect(plan.entries[0].destinationRelativePath).toMatch(/photo_1\.jpg$/)
  })

  it('marks as error when all 99 collision slots are taken', async () => {
    touch(join(sourceDir, 'photo.jpg'))

    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const destDir = join(libraryDir, String(year), `${year}.${month}`)
    mkdirSync(destDir, { recursive: true })

    // Create photo.jpg + photo_1.jpg through photo_99.jpg
    touch(join(destDir, 'photo.jpg'))
    for (let n = 1; n <= 99; n++) {
      touch(join(destDir, `photo_${n}.jpg`))
    }

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.entries[0].status).toBe('error')
    expect(plan.entries[0].errorMessage).toMatch(/No free filename slot/)
  })

  it('renames HEIC destination to .jpg when conversion is enabled', async () => {
    touch(join(sourceDir, 'IMG_1234.HEIC'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, heicConvertConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer,
      convertHeic: async () => {},
      stagingDir: join(sourceDir, 'staging'),
      mkdirp: () => {}
    })

    expect(plan.entries[0].destinationRelativePath).toMatch(/IMG_1234\.jpg$/)
  })

  it('stages HEIC via convertHeic and computes pHash from staged JPEG when conversion is enabled', async () => {
    touch(join(sourceDir, 'IMG.heic'))

    const stagingDir = mkdtempSync(join(tmpdir(), 'keepic-staging-test-'))
    let convertCalledWith: string | null = null
    let phashCalledWith: string | null = null

    const mockConvert: HeicConverter = async (src, dest) => {
      convertCalledWith = src
      writeFileSync(dest, 'fake-jpeg')
    }

    const plan = await buildImportPlan(sourceDir, libraryDir, db, heicConvertConfig, () => {}, {
      loadExif: nullExifLoader,
      convertHeic: mockConvert,
      computePhash: async (fp) => {
        phashCalledWith = fp
        return { phash: 'staged-phash', width: 100, height: 100 }
      },
      stagingDir
    })

    // convertHeic called on the HEIC source
    expect(convertCalledWith).toBe(join(sourceDir, 'IMG.heic'))
    // computePhash called on the staged JPEG (inside stagingDir)
    expect(phashCalledWith).not.toBeNull()
    expect(phashCalledWith).toContain(stagingDir)
    expect(plan.entries[0].phash).toBe('staged-phash')
    // stagedPath is set
    expect(plan.entries[0].stagedPath).toBeTruthy()
    expect(plan.entries[0].stagedPath).toContain(stagingDir)

    rmSync(stagingDir, { recursive: true, force: true })
  })

  it('sets status to error with message when convertHeic fails', async () => {
    touch(join(sourceDir, 'IMG.heic'))

    let regularPhashCalled = false

    const plan = await buildImportPlan(sourceDir, libraryDir, db, heicConvertConfig, () => {}, {
      loadExif: nullExifLoader,
      convertHeic: async () => {
        throw new Error('decode failed')
      },
      computePhash: async () => {
        regularPhashCalled = true
        return { phash: 'should-not-matter', width: 0, height: 0 }
      },
      stagingDir: join(sourceDir, 'staging'),
      mkdirp: () => {}
    })

    expect(plan.entries[0].stagedPath).toBeUndefined()
    expect(plan.entries[0].phash).toBeNull()
    expect(plan.entries[0].status).toBe('error')
    expect(plan.entries[0].errorMessage).toContain('decode failed')
    // computePhash is NOT called when staging fails (no staged file to compute from)
    expect(regularPhashCalled).toBe(false)
  })

  it('keeps HEIC extension when conversion is disabled', async () => {
    touch(join(sourceDir, 'IMG_1234.HEIC'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.entries[0].destinationRelativePath).toMatch(/IMG_1234\.HEIC$/)
  })

  it('sets status to error when pHash computation fails on a non-HEIC file', async () => {
    touch(join(sourceDir, 'broken.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: async () => {
        throw new Error('sharp decode error')
      }
    })

    expect(plan.entries[0].status).toBe('error')
    expect(plan.entries[0].errorMessage).toContain('sharp decode error')
    expect(plan.entries[0].phash).toBeNull()
  })

  it('handles non-Error throws in pHash and conversion error paths', async () => {
    // Non-HEIC path: non-Error throw
    touch(join(sourceDir, 'fail.jpg'))
    const plan1 = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      // eslint-disable-next-line no-throw-literal
      computePhash: async () => {
        throw 'string phash error'
      }
    })
    expect(plan1.entries[0].errorMessage).toContain('string phash error')

    // HEIC conversion path: non-Error throw
    rmSync(sourceDir, { recursive: true, force: true })
    sourceDir = makeTempDir()
    touch(join(sourceDir, 'fail.heic'))
    const plan2 = await buildImportPlan(sourceDir, libraryDir, db, heicConvertConfig, () => {}, {
      loadExif: nullExifLoader,
      // eslint-disable-next-line no-throw-literal
      convertHeic: async () => {
        throw 42
      },
      computePhash: nullPhashComputer,
      stagingDir: join(sourceDir, 'staging'),
      mkdirp: () => {}
    })
    expect(plan2.entries[0].errorMessage).toContain('42')
  })

  it('counts Live Photo MOVs in livePhotosDiscarded', async () => {
    // Use lowercase .heic — isLivePhotoMov checks for lowercase on case-sensitive filesystems (Linux CI)
    touch(join(sourceDir, 'IMG_1234.heic'))
    touch(join(sourceDir, 'IMG_1234.MOV'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.livePhotosDiscarded).toBe(1)
    expect(plan.entries).toHaveLength(1) // only the HEIC
  })

  it('reports progress: processed increments from 0 to total', async () => {
    touch(join(sourceDir, 'a.jpg'))
    touch(join(sourceDir, 'b.jpg'))

    const progressCalls: number[] = []
    await buildImportPlan(
      sourceDir,
      libraryDir,
      db,
      baseConfig,
      (p) => progressCalls.push(p.processed),
      {
        loadExif: nullExifLoader,
        computePhash: nullPhashComputer
      }
    )

    // Called twice per file (before and after processing), so 4 calls for 2 files
    expect(progressCalls).toEqual([0, 1, 1, 2])
  })

  it('populates width and height from pHash result', async () => {
    touch(join(sourceDir, 'photo.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: mockPhashComputer
    })

    expect(plan.entries[0].width).toBe(640)
    expect(plan.entries[0].height).toBe(480)
  })

  it('sets width and height to null when pHash computation returns null', async () => {
    touch(join(sourceDir, 'photo.jpg'))

    const plan = await buildImportPlan(sourceDir, libraryDir, db, baseConfig, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })

    expect(plan.entries[0].width).toBeNull()
    expect(plan.entries[0].height).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// executeImportPlan
// ---------------------------------------------------------------------------

describe('executeImportPlan', () => {
  let libraryDir: string
  let tempDir: string
  let db: KeePicDatabase

  const mockStat = () => ({ size: 12345, mtime: new Date('2024-06-15T12:00:00Z') })

  const noop = () => {}

  beforeEach(() => {
    libraryDir = makeTempDir()
    tempDir = makeTempDir()
    db = openDb()
  })

  afterEach(() => {
    db.close()
    rmSync(libraryDir, { recursive: true, force: true })
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makePlan(entries: ImportPlan['entries']): ImportPlan {
    return { entries, livePhotosDiscarded: 0, sourceFolder: '/source' }
  }

  function readyEntry(overrides: Partial<ImportPlan['entries'][0]> = {}): ImportPlan['entries'][0] {
    return {
      sourcePath: '/source/photo.jpg',
      destinationRelativePath: '2024/2024.06/photo.jpg',
      dateTaken: '2024-06-15T12:00:00.000Z',
      dateTakenSource: 'exif',
      phash: 'abc123',
      width: 640,
      height: 480,
      fileSize: 12345,
      status: 'ready',
      stagedPath: undefined,
      ...overrides
    }
  }

  it('imports a ready entry: calls copy + move + mkdirp + stat + upserts to DB', async () => {
    const copied: [string, string][] = []
    const moved: [string, string][] = []
    const mkdirped: string[] = []

    const plan = makePlan([readyEntry()])
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: (src, dest) => {
        copied.push([src, dest])
      },
      moveFile: (src, dest) => {
        moved.push([src, dest])
      },
      mkdirp: (p) => {
        mkdirped.push(p)
      },
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.imported).toBe(1)
    expect(result.status).toBe('completed')
    expect(copied).toHaveLength(1)
    expect(moved).toHaveLength(1)
    expect(mkdirped).toHaveLength(2) // tempDir + destDir

    const photos = getAllPhotos(db)
    expect(photos).toHaveLength(1)
    expect(photos[0].path).toBe('2024/2024.06/photo.jpg')
    expect(photos[0].phash).toBe('abc123')
  })

  it('skips duplicate entries and counts them in skipped', async () => {
    const plan = makePlan([readyEntry({ status: 'duplicate', duplicateOf: 'lib/existing.jpg' })])
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: () => {
        throw new Error('should not copy duplicates')
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(getAllPhotos(db)).toHaveLength(0)
  })

  it('pre-collects error entries into ImportResult.errors', async () => {
    const plan = makePlan([readyEntry({ status: 'error', errorMessage: 'No free slot' })])
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: noop,
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('No free slot')
    expect(result.imported).toBe(0)
  })

  it('uses error message fallback when errorMessage is undefined', async () => {
    const plan = makePlan([readyEntry({ status: 'error', errorMessage: undefined })])
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: noop,
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.errors[0].error).toBe('Planning error')
  })

  it('calls convertHeic instead of copyFile for HEIC files when conversion is enabled', async () => {
    let convertCalled = false
    let copyCalled = false

    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg'
      })
    ])

    await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      convertHeic: async () => {
        convertCalled = true
      },
      copyFile: () => {
        copyCalled = true
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(convertCalled).toBe(true)
    expect(copyCalled).toBe(false)
  })

  it('uses copyFile for non-HEIC files even when conversion is enabled', async () => {
    let copyCalled = false

    const plan = makePlan([readyEntry({ sourcePath: '/source/photo.jpg' })])

    await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      convertHeic: async () => {
        throw new Error('should not convert JPG')
      },
      copyFile: () => {
        copyCalled = true
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(copyCalled).toBe(true)
  })

  it('catches per-file errors and continues importing remaining files', async () => {
    let callCount = 0
    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/fail.jpg',
        destinationRelativePath: '2024/2024.06/fail.jpg'
      }),
      readyEntry({ sourcePath: '/source/ok.jpg', destinationRelativePath: '2024/2024.06/ok.jpg' })
    ])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: (src) => {
        callCount++
        if (src === '/source/fail.jpg') throw new Error('disk full')
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.imported).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('disk full')
    expect(callCount).toBe(2)
  })

  it('catches non-Error exceptions and converts them to strings', async () => {
    const plan = makePlan([readyEntry()])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: () => {
        throw 'some string error'
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.errors[0].error).toBe('some string error')
  })

  it('returns status cancelled when isCancelled returns true before first file', async () => {
    const plan = makePlan([readyEntry()])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      isCancelled: () => true,
      copyFile: () => {
        throw new Error('should not run')
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(result.status).toBe('cancelled')
    expect(result.imported).toBe(0)
  })

  it('stops processing after cancellation and still records partial results', async () => {
    let callCount = 0
    let cancelAfter = 0
    const plan = makePlan([
      readyEntry({ sourcePath: '/source/a.jpg', destinationRelativePath: '2024/2024.06/a.jpg' }),
      readyEntry({ sourcePath: '/source/b.jpg', destinationRelativePath: '2024/2024.06/b.jpg' })
    ])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: () => {
        callCount++
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      isCancelled: () => {
        cancelAfter++
        return cancelAfter > 1 // cancel before second file
      }
    })

    expect(result.status).toBe('cancelled')
    expect(result.imported).toBe(1)
    expect(callCount).toBe(1)
  })

  it('always calls rmTempDir in finally, even after error', async () => {
    let rmCalled = false
    const plan = makePlan([readyEntry()])

    await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: () => {
        throw new Error('copy failed')
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: () => {
        rmCalled = true
      }
    })

    expect(rmCalled).toBe(true)
  })

  it('ignores exceptions thrown by rmTempDir', async () => {
    const plan = makePlan([readyEntry()])

    await expect(
      executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
        copyFile: noop,
        moveFile: noop,
        mkdirp: noop,
        statFile: mockStat,
        rmTempDir: () => {
          throw new Error('cleanup failed')
        }
      })
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('creates and updates an import_jobs record', async () => {
    const plan = makePlan([readyEntry()])
    await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: noop,
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    const jobs = getAllJobs(db)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].source).toBe('local')
    expect(jobs[0].status).toBe('completed')
    expect(jobs[0].photos_imported).toBe(1)
    expect(jobs[0].photos_skipped).toBe(0)
  })

  it('reports import_jobs with cancelled status', async () => {
    const plan = makePlan([readyEntry()])
    await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      isCancelled: () => true,
      copyFile: noop,
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    const jobs = getAllJobs(db)
    expect(jobs[0].status).toBe('cancelled')
  })

  it('reports progress before and after each file', async () => {
    const progressEvents: number[] = []
    const plan = makePlan([
      readyEntry({ sourcePath: '/source/a.jpg', destinationRelativePath: '2024/2024.06/a.jpg' }),
      readyEntry({ sourcePath: '/source/b.jpg', destinationRelativePath: '2024/2024.06/b.jpg' })
    ])

    await executeImportPlan(
      plan,
      libraryDir,
      tempDir,
      db,
      baseConfig,
      (p) => progressEvents.push(p.processed),
      { copyFile: noop, moveFile: noop, mkdirp: noop, statFile: mockStat, rmTempDir: noop }
    )

    expect(progressEvents).toEqual([0, 1, 1, 2])
  })

  it('propagates livePhotosDiscarded from the plan', async () => {
    const plan: ImportPlan = { entries: [], livePhotosDiscarded: 3, sourceFolder: '/source' }
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      rmTempDir: noop
    })
    expect(result.livePhotosDiscarded).toBe(3)
  })

  it('uses default implementations when no options are injected (integration)', async () => {
    // Create a real source file so default copyFileSync + renameSync work
    const srcDir = makeTempDir()
    const srcFile = join(srcDir, 'photo.jpg')
    writeFileSync(srcFile, 'fake image content')

    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const destRelPath = `${year}/${year}.${month}/photo.jpg`

    const plan: ImportPlan = {
      entries: [
        {
          sourcePath: srcFile,
          destinationRelativePath: destRelPath,
          dateTaken: date.toISOString(),
          dateTakenSource: 'file_mtime',
          phash: null,
          width: null,
          height: null,
          fileSize: 19,
          status: 'ready'
        }
      ],
      livePhotosDiscarded: 0,
      sourceFolder: srcDir
    }

    // No options injected — exercises all default implementations
    const result = await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop)

    expect(result.imported).toBe(1)
    expect(result.status).toBe('completed')
    expect(existsSync(join(libraryDir, destRelPath))).toBe(true)
    // tempDir should have been cleaned by default rmTempDir
    expect(existsSync(tempDir)).toBe(false)

    rmSync(srcDir, { recursive: true, force: true })
  })

  it('handles a collision entry the same as a ready entry', async () => {
    const copied: string[] = []
    const plan = makePlan([
      readyEntry({
        status: 'collision',
        sourcePath: '/source/photo.jpg',
        destinationRelativePath: '2024/2024.06/photo_1.jpg',
        originalDestination: '2024/2024.06/photo.jpg'
      })
    ])

    await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: (src) => {
        copied.push(src)
      },
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    expect(copied).toHaveLength(1)
    const photos = getAllPhotos(db)
    expect(photos[0].path).toBe('2024/2024.06/photo_1.jpg')
  })

  // ---------------------------------------------------------------------------
  // stagedPath handling
  // ---------------------------------------------------------------------------

  it('moves stagedPath directly to library instead of converting when stagedPath is set', async () => {
    // Create a real staged file
    const stagedFile = join(tempDir, 'staged.jpg')
    writeFileSync(stagedFile, 'fake-jpeg')

    let convertCalled = false
    let copyCalled = false
    const moved: string[] = []

    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg',
        stagedPath: stagedFile
      })
    ])

    await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      convertHeic: async () => {
        convertCalled = true
      },
      copyFile: () => {
        copyCalled = true
      },
      moveFile: (src) => {
        moved.push(src)
      },
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      rmStagedFile: noop
    })

    // Convert and copy must NOT be called
    expect(convertCalled).toBe(false)
    expect(copyCalled).toBe(false)
    // Move must be called with the staged path
    expect(moved).toHaveLength(1)
    expect(moved[0]).toBe(stagedFile)

    const photos = getAllPhotos(db)
    expect(photos[0].path).toBe('2024/2024.06/IMG.jpg')
    expect(photos[0].phash).toBe('abc123')
  })

  it('cleans up staged files in finally regardless of move success', async () => {
    const stagedFile = join(tempDir, 'staged-cleanup.jpg')
    writeFileSync(stagedFile, 'fake-jpeg')

    const deletedFiles: string[] = []
    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg',
        stagedPath: stagedFile
      })
    ])

    await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      rmStagedFile: (p) => {
        deletedFiles.push(p)
      }
    })

    expect(deletedFiles).toContain(stagedFile)
  })

  it('cleans up staged file in finally when move throws', async () => {
    const stagedFile = join(tempDir, 'staged-error.jpg')
    writeFileSync(stagedFile, 'fake-jpeg')

    const deletedFiles: string[] = []
    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg',
        stagedPath: stagedFile
      })
    ])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      moveFile: () => {
        throw new Error('move failed')
      },
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      rmStagedFile: (p) => {
        deletedFiles.push(p)
      }
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('move failed')
    expect(deletedFiles).toContain(stagedFile)
  })

  it('cleans up all remaining staged files on cancellation', async () => {
    const staged1 = join(tempDir, 'staged-cancel-1.jpg')
    const staged2 = join(tempDir, 'staged-cancel-2.jpg')
    writeFileSync(staged1, 'fake-jpeg-1')
    writeFileSync(staged2, 'fake-jpeg-2')

    const deletedFiles: string[] = []
    let cancelAfter = 0
    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/A.heic',
        destinationRelativePath: '2024/2024.06/A.jpg',
        stagedPath: staged1
      }),
      readyEntry({
        sourcePath: '/source/B.heic',
        destinationRelativePath: '2024/2024.06/B.jpg',
        stagedPath: staged2
      })
    ])

    const result = await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      rmStagedFile: (p) => {
        deletedFiles.push(p)
      },
      isCancelled: () => {
        cancelAfter++
        return cancelAfter > 1 // cancel before second file
      }
    })

    expect(result.status).toBe('cancelled')
    // Both staged files must be cleaned up (even the one not processed)
    expect(deletedFiles).toContain(staged1)
    expect(deletedFiles).toContain(staged2)
  })

  it('does not call rmStagedFile for entries without stagedPath', async () => {
    let rmStagedCalled = false
    const plan = makePlan([readyEntry({ stagedPath: undefined })])

    await executeImportPlan(plan, libraryDir, tempDir, db, baseConfig, noop, {
      copyFile: noop,
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop,
      rmStagedFile: () => {
        rmStagedCalled = true
      }
    })

    expect(rmStagedCalled).toBe(false)
  })

  it('ignores exceptions thrown by rmStagedFile during cleanup', async () => {
    const stagedFile = join(tempDir, 'staged-rmthrow.jpg')
    writeFileSync(stagedFile, 'fake-jpeg')

    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg',
        stagedPath: stagedFile
      })
    ])

    // rmStagedFile throws — should be silently ignored, plan still completes
    await expect(
      executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
        moveFile: noop,
        mkdirp: noop,
        statFile: mockStat,
        rmTempDir: noop,
        rmStagedFile: () => {
          throw new Error('delete failed')
        }
      })
    ).resolves.toMatchObject({ status: 'completed' })
  })

  it('uses default rmStagedFile (rmSync with force) when not injected', async () => {
    const stagedFile = join(tempDir, 'staged-default-rm.jpg')
    writeFileSync(stagedFile, 'fake-jpeg')

    const plan = makePlan([
      readyEntry({
        sourcePath: '/source/IMG.heic',
        destinationRelativePath: '2024/2024.06/IMG.jpg',
        stagedPath: stagedFile
      })
    ])

    // rmStagedFile NOT injected → default uses rmSync(p, { force: true })
    await executeImportPlan(plan, libraryDir, tempDir, db, heicConvertConfig, noop, {
      moveFile: noop,
      mkdirp: noop,
      statFile: mockStat,
      rmTempDir: noop
    })

    // The default rmStagedFile should have deleted the staged file
    expect(existsSync(stagedFile)).toBe(false)
  })
})
