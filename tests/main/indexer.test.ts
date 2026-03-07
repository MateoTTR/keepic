import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, chmodSync } from 'fs'
import { join, extname } from 'path'
import { tmpdir } from 'os'
import { KeePicDatabase } from '../../src/main/db/database'
import { scanLibraryFiles, runIndexer } from '../../src/main/indexer'
import type { ExifLoader } from '../../src/main/exif'
import type { PhashComputer } from '../../src/main/phash'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'keepic-indexer-test-'))
}

/** Creates a minimal 1-byte file (not a real image — fine for tests using mock PhashComputer). */
function touch(filePath: string): void {
  writeFileSync(filePath, 'x', 'utf-8')
}

/** Builds a library folder structure and returns the root path. */
function buildLibrary(root: string, structure: Record<string, string[]>): void {
  for (const [folder, files] of Object.entries(structure)) {
    const dir = join(root, ...folder.split('/'))
    mkdirSync(dir, { recursive: true })
    for (const file of files) {
      touch(join(dir, file))
    }
  }
}

/** Mock ExifLoader — always returns null (falls back to mtime). */
const nullExifLoader: ExifLoader = async () => null

/** Mock PhashComputer — returns a predictable hash based on the file path. */
const mockPhashComputer: PhashComputer = async (filePath: string) => ({
  phash: Buffer.from(filePath).toString('hex').slice(0, 16).padEnd(16, '0'),
  width: 100,
  height: 100
})

/**
 * Mock PhashComputer that simulates HEIC-aware behaviour:
 * - .heic/.heif files return a non-null pHash (as createUniversalPhashComputer would)
 * - all other files return a regular pHash
 */
const heicAwarePhashComputer: PhashComputer = async (filePath: string) => {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.heic' || ext === '.heif') {
    return {
      phash: 'heic' + Buffer.from(filePath).toString('hex').slice(0, 12),
      width: 4032,
      height: 3024
    }
  }
  return {
    phash: Buffer.from(filePath).toString('hex').slice(0, 16).padEnd(16, '0'),
    width: 100,
    height: 100
  }
}

/** Mock PhashComputer that always returns null (e.g. unsupported format). */
const nullPhashComputer: PhashComputer = async () => null

function openDb(dbDir: string): KeePicDatabase {
  const db = new KeePicDatabase(join(dbDir, 'index.db'))
  db.open()
  return db
}

function getAllPhotos(db: KeePicDatabase): { path: string; deleted_at: string | null }[] {
  return db.db.prepare('SELECT path, deleted_at FROM photos ORDER BY path').all() as {
    path: string
    deleted_at: string | null
  }[]
}

// ---------------------------------------------------------------------------
// scanLibraryFiles
// ---------------------------------------------------------------------------

describe('scanLibraryFiles', () => {
  let libraryRoot: string

  beforeEach(() => {
    libraryRoot = makeTempDir()
  })

  afterEach(() => {
    rmSync(libraryRoot, { recursive: true, force: true })
  })

  it('returns an empty array for an empty library', () => {
    const { files, skippedFiles } = scanLibraryFiles(libraryRoot)
    expect(files).toEqual([])
    expect(skippedFiles).toEqual([])
  })

  it('returns an empty array for a non-existent library path', () => {
    const { files, skippedFiles } = scanLibraryFiles('/nonexistent/library')
    expect(files).toEqual([])
    expect(skippedFiles).toEqual([])
  })

  it('finds images in monthly folders', () => {
    buildLibrary(libraryRoot, {
      '2025/2025.01': ['photo1.jpg', 'photo2.jpeg']
    })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toContain('2025/2025.01/photo1.jpg')
    expect(files).toContain('2025/2025.01/photo2.jpeg')
  })

  it('finds images in event folders', () => {
    buildLibrary(libraryRoot, {
      '2025/2025.04.15-19.Londres': ['IMG_001.jpg']
    })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toContain('2025/2025.04.15-19.Londres/IMG_001.jpg')
  })

  it('ignores root-level folders that are not year folders', () => {
    buildLibrary(libraryRoot, {
      'ignore-me/2025.01': ['photo.jpg'],
      random: ['photo.jpg']
    })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(0)
  })

  it('ignores non-media files and reports them as unrecognized', () => {
    buildLibrary(libraryRoot, {
      '2025/2025.01': ['photo.jpg', 'document.pdf', 'notes.txt']
    })
    const { files, skippedFiles } = scanLibraryFiles(libraryRoot)
    expect(files).toEqual(['2025/2025.01/photo.jpg'])
    expect(skippedFiles).toHaveLength(2)
    expect(skippedFiles[0]).toMatchObject({ reason: 'unrecognized-extension', extension: '.pdf' })
    expect(skippedFiles[1]).toMatchObject({ reason: 'unrecognized-extension', extension: '.txt' })
  })

  it('finds video files alongside images', () => {
    buildLibrary(libraryRoot, {
      '2025/2025.01': ['photo.jpg', 'video.mp4', 'clip.mov']
    })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(3)
    expect(files).toContain('2025/2025.01/video.mp4')
    expect(files).toContain('2025/2025.01/clip.mov')
  })

  it('handles all supported media extensions (images + videos)', () => {
    const extensions = [
      'a.jpg',
      'b.jpeg',
      'c.heic',
      'd.heif',
      'e.png',
      'f.tiff',
      'g.tif',
      'h.cr2',
      'i.nef',
      'j.arw',
      'k.mp4',
      'l.mov',
      'm.avi',
      'n.mts',
      'o.3gp',
      'p.m4v',
      'q.mpg'
    ]
    buildLibrary(libraryRoot, { '2025/2025.01': extensions })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(extensions.length)
  })

  it('handles extension case-insensitively', () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['PHOTO.JPG', 'IMG.HEIC'] })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(2)
  })

  it('scans multiple year and sub-folders', () => {
    buildLibrary(libraryRoot, {
      '2024/2024.12': ['old.jpg'],
      '2025/2025.01': ['new1.jpg', 'new2.png'],
      '2025/2025.06.21.Mariage': ['wedding.heic']
    })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(4)
  })

  it('ignores non-directory entries directly inside a year folder', () => {
    mkdirSync(join(libraryRoot, '2025'), { recursive: true })
    writeFileSync(join(libraryRoot, '2025', 'stray.jpg'), 'x')
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toEqual(['2025/2025.01/photo.jpg'])
  })

  it('silently skips a year folder whose contents cannot be read', () => {
    mkdirSync(join(libraryRoot, '2025'), { recursive: true })
    buildLibrary(libraryRoot, { '2026/2026.01': ['photo.jpg'] })
    const restricted = join(libraryRoot, '2025')
    chmodSync(restricted, 0o000)
    try {
      const { files } = scanLibraryFiles(libraryRoot)
      expect(files.every((f) => !f.startsWith('2025/'))).toBe(true)
      expect(files.some((f) => f.startsWith('2026/'))).toBe(true)
    } finally {
      chmodSync(restricted, 0o755)
    }
  })

  it('silently skips a subfolder whose contents cannot be read', () => {
    buildLibrary(libraryRoot, { '2025/2025.01': [], '2025/2025.02': ['photo.jpg'] })
    const restricted = join(libraryRoot, '2025/2025.01')
    chmodSync(restricted, 0o000)
    try {
      const { files } = scanLibraryFiles(libraryRoot)
      expect(files.every((f) => !f.includes('2025.01'))).toBe(true)
      expect(files).toContain('2025/2025.02/photo.jpg')
    } finally {
      chmodSync(restricted, 0o755)
    }
  })

  it('silently skips system and hidden files', () => {
    buildLibrary(libraryRoot, {
      '2025/2025.01': ['photo.jpg', '.DS_Store', 'Thumbs.db', '.hidden']
    })
    const { files, skippedFiles } = scanLibraryFiles(libraryRoot)
    expect(files).toEqual(['2025/2025.01/photo.jpg'])
    expect(skippedFiles).toHaveLength(0)
  })

  it('ignores sub-directories inside month folders', () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    mkdirSync(join(libraryRoot, '2025/2025.01/subdir'))
    const { files } = scanLibraryFiles(libraryRoot)
    expect(files).toEqual(['2025/2025.01/photo.jpg'])
  })

  it('reports file with no extension as unrecognized', () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['Makefile'] })
    const { files, skippedFiles } = scanLibraryFiles(libraryRoot)
    expect(files).toHaveLength(0)
    expect(skippedFiles).toHaveLength(1)
    expect(skippedFiles[0].reason).toBe('unrecognized-extension')
    expect(skippedFiles[0].extension).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// runIndexer
// ---------------------------------------------------------------------------

describe('runIndexer', () => {
  let libraryRoot: string
  let dbDir: string
  let db: KeePicDatabase

  beforeEach(() => {
    libraryRoot = makeTempDir()
    dbDir = makeTempDir()
    db = openDb(dbDir)
  })

  afterEach(() => {
    db.close()
    rmSync(libraryRoot, { recursive: true, force: true })
    rmSync(dbDir, { recursive: true, force: true })
  })

  const opts = { loadExif: nullExifLoader, computePhash: mockPhashComputer }

  it('returns zeroes for an empty library', async () => {
    const result = await runIndexer(libraryRoot, db, () => {}, opts)
    expect(result).toEqual({ indexed: 0, indexedPhotos: 0, indexedVideos: 0, skipped: 0, deleted: 0, errors: [], skippedFiles: [] })
  })

  it('uses default ExifLoader and PhashComputer when options are omitted', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    // Default loaders gracefully return null for non-real image files
    const result = await runIndexer(libraryRoot, db, () => {})
    expect(result.indexed).toBe(1)
  })

  it('indexes new photos and returns correct counts', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['a.jpg', 'b.jpg'] })
    const result = await runIndexer(libraryRoot, db, () => {}, opts)
    expect(result.indexed).toBe(2)
    expect(result.indexedPhotos).toBe(2)
    expect(result.indexedVideos).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.deleted).toBe(0)
  })

  it('inserts photos with correct paths and filenames', async () => {
    buildLibrary(libraryRoot, { '2025/2025.03': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)
    const rows = getAllPhotos(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe('2025/2025.03/photo.jpg')
  })

  it('stores phash from the mock computer', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['img.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)
    const row = db.db
      .prepare('SELECT phash FROM photos WHERE path = ?')
      .get('2025/2025.01/img.jpg') as { phash: string }
    expect(row.phash).toHaveLength(16)
  })

  it('stores null phash when PhashComputer returns null', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['raw.cr2'] })
    await runIndexer(libraryRoot, db, () => {}, {
      loadExif: nullExifLoader,
      computePhash: nullPhashComputer
    })
    const row = db.db
      .prepare('SELECT phash, width, height FROM photos WHERE path = ?')
      .get('2025/2025.01/raw.cr2') as {
      phash: string | null
      width: number | null
      height: number | null
    }
    expect(row.phash).toBeNull()
    expect(row.width).toBeNull()
    expect(row.height).toBeNull()
  })

  it('skips unchanged files on second run', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)
    const result2 = await runIndexer(libraryRoot, db, () => {}, opts)
    expect(result2.indexed).toBe(0)
    expect(result2.skipped).toBe(1)
  })

  it('re-indexes a file whose mtime has changed', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)

    // Force a distinct mtime — write + explicitly set mtime 2 seconds in the future
    const filePath = join(libraryRoot, '2025/2025.01/photo.jpg')
    writeFileSync(filePath, 'updated content', 'utf-8')
    const futureTime = new Date(Date.now() + 2000)
    utimesSync(filePath, futureTime, futureTime)

    const result2 = await runIndexer(libraryRoot, db, () => {}, opts)
    expect(result2.indexed).toBe(1)
    expect(result2.skipped).toBe(0)
  })

  it('marks photos as deleted when they are removed from disk', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['keep.jpg', 'remove.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)

    // Remove one file
    rmSync(join(libraryRoot, '2025/2025.01/remove.jpg'))

    const result2 = await runIndexer(libraryRoot, db, () => {}, opts)
    expect(result2.deleted).toBe(1)

    const rows = getAllPhotos(db)
    const removed = rows.find((r) => r.path === '2025/2025.01/remove.jpg')
    expect(removed?.deleted_at).not.toBeNull()

    const kept = rows.find((r) => r.path === '2025/2025.01/keep.jpg')
    expect(kept?.deleted_at).toBeNull()
  })

  it('revives a previously deleted photo when it reappears', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)

    rmSync(join(libraryRoot, '2025/2025.01/photo.jpg'))
    await runIndexer(libraryRoot, db, () => {}, opts)

    // Re-add the file with an explicitly distinct mtime to ensure re-indexing
    const readdedPath = join(libraryRoot, '2025/2025.01/photo.jpg')
    touch(readdedPath)
    const futureTime = new Date(Date.now() + 2000)
    utimesSync(readdedPath, futureTime, futureTime)
    await runIndexer(libraryRoot, db, () => {}, opts)

    const rows = getAllPhotos(db)
    expect(rows[0].deleted_at).toBeNull()
  })

  it('reports progress via the onProgress callback', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['a.jpg', 'b.jpg', 'c.jpg'] })
    const progressEvents: { processed: number; total: number; indexed: number }[] = []
    await runIndexer(libraryRoot, db, (p) => progressEvents.push(p), opts)

    // Initial event (processed=0) + 3 Phase 1 events + 3 Phase 2 events = 7
    expect(progressEvents).toHaveLength(7)

    // Initial progress
    expect(progressEvents[0]).toMatchObject({ total: 3, processed: 0, indexed: 0 })

    // Phase 1 progress: processed increments, indexed stays 0
    expect(progressEvents[1]).toMatchObject({ total: 3, processed: 1, indexed: 0 })
    expect(progressEvents[3]).toMatchObject({ total: 3, processed: 3, indexed: 0 })

    // Phase 2 progress: processed stays at 3, indexed increments
    const phase2Events = progressEvents.slice(4)
    expect(phase2Events[phase2Events.length - 1].processed).toBe(3)
    expect(phase2Events[phase2Events.length - 1].indexed).toBe(3)
  })

  it('sets source to "local" for indexer-discovered photos', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)
    const row = db.db
      .prepare('SELECT source FROM photos WHERE path = ?')
      .get('2025/2025.01/photo.jpg') as { source: string }
    expect(row.source).toBe('local')
  })

  it('preserves existing source on re-index', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg'] })
    await runIndexer(libraryRoot, db, () => {}, opts)

    // Manually change source to simulate a google_photos import
    db.db
      .prepare("UPDATE photos SET source = 'google_photos' WHERE path = ?")
      .run('2025/2025.01/photo.jpg')

    // Force re-index by changing mtime
    const filePath = join(libraryRoot, '2025/2025.01/photo.jpg')
    writeFileSync(filePath, 'new content', 'utf-8')
    await runIndexer(libraryRoot, db, () => {}, opts)

    const row = db.db
      .prepare('SELECT source FROM photos WHERE path = ?')
      .get('2025/2025.01/photo.jpg') as { source: string }
    expect(row.source).toBe('google_photos')
  })

  it('stores a non-null pHash for HEIC files when using a HEIC-aware computePhash', async () => {
    // With createUniversalPhashComputer as the default, HEIC files are routed
    // through ffmpeg → temp JPEG → native sharp, resulting in a real pHash.
    // This test verifies that the indexer correctly stores a non-null pHash for
    // HEIC files when a HEIC-aware computer is injected.
    buildLibrary(libraryRoot, { '2025/2025.06': ['IMG_1234.heic'] })
    await runIndexer(libraryRoot, db, () => {}, {
      loadExif: nullExifLoader,
      computePhash: heicAwarePhashComputer
    })

    const row = db.db
      .prepare('SELECT phash, width, height FROM photos WHERE path = ?')
      .get('2025/2025.06/IMG_1234.heic') as {
      phash: string | null
      width: number | null
      height: number | null
    }
    expect(row.phash).not.toBeNull()
    expect(row.width).toBe(4032)
    expect(row.height).toBe(3024)
  })

  it('reports pHash errors without stopping indexing', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['good.jpg', 'bad.heic', 'also-good.jpg'] })

    const errorPhash: PhashComputer = async (filePath: string) => {
      if (filePath.endsWith('.heic')) throw new Error('HEIF decode failed')
      return mockPhashComputer(filePath)
    }

    const result = await runIndexer(libraryRoot, db, () => {}, {
      loadExif: nullExifLoader,
      computePhash: errorPhash
    })

    expect(result.indexed).toBe(3) // all 3 indexed (bad.heic with null phash)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].file).toContain('bad.heic')
    expect(result.errors[0].error).toBe('HEIF decode failed')

    // Verify the bad file was still indexed (with null phash)
    const row = db.db
      .prepare('SELECT phash FROM photos WHERE path LIKE ?')
      .get('%bad.heic') as { phash: string | null }
    expect(row.phash).toBeNull()
  })

  it('stores media_type as photo for image files and video for video files', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['photo.jpg', 'clip.mp4'] })
    const result = await runIndexer(libraryRoot, db, () => {}, opts)

    const photoRow = db.db
      .prepare('SELECT media_type FROM photos WHERE path = ?')
      .get('2025/2025.01/photo.jpg') as { media_type: string }
    expect(photoRow.media_type).toBe('photo')

    const videoRow = db.db
      .prepare('SELECT media_type FROM photos WHERE path = ?')
      .get('2025/2025.01/clip.mp4') as { media_type: string }
    expect(videoRow.media_type).toBe('video')

    expect(result.indexedPhotos).toBe(1)
    expect(result.indexedVideos).toBe(1)
  })

  it('skips pHash computation for video files', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['clip.mp4'] })
    let phashCalled = false
    const videoPhashComputer: PhashComputer = async () => {
      phashCalled = true
      return { phash: 'should-not-be-used', width: 100, height: 100 }
    }
    await runIndexer(libraryRoot, db, () => {}, {
      loadExif: nullExifLoader,
      computePhash: videoPhashComputer
    })

    expect(phashCalled).toBe(false)
    const row = db.db
      .prepare('SELECT phash, width, height, media_type FROM photos WHERE path = ?')
      .get('2025/2025.01/clip.mp4') as {
      phash: string | null
      width: number | null
      height: number | null
      media_type: string
    }
    expect(row.phash).toBeNull()
    expect(row.width).toBeNull()
    expect(row.height).toBeNull()
    expect(row.media_type).toBe('video')
  })

  it('reports non-Error pHash failures as strings', async () => {
    buildLibrary(libraryRoot, { '2025/2025.01': ['fail.jpg'] })

    const throwStringPhash: PhashComputer = async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error'
    }

    const result = await runIndexer(libraryRoot, db, () => {}, {
      loadExif: nullExifLoader,
      computePhash: throwStringPhash
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe('string error')
  })
})
