import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import {
  parseExifDateString,
  extractDateFromFilename,
  extractDateFromTags,
  defaultExifLoader,
  readExifDate,
  type ExifTags
} from '../../src/main/exif'

// ---------------------------------------------------------------------------
// parseExifDateString
// ---------------------------------------------------------------------------

describe('parseExifDateString', () => {
  it('parses a canonical EXIF date string', () => {
    const d = parseExifDateString('2023:04:15 12:30:00')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2023)
    expect(d!.getMonth()).toBe(3) // 0-indexed
    expect(d!.getDate()).toBe(15)
    expect(d!.getHours()).toBe(12)
    expect(d!.getMinutes()).toBe(30)
    expect(d!.getSeconds()).toBe(0)
  })

  it('returns null for undefined', () => {
    expect(parseExifDateString(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseExifDateString('')).toBeNull()
  })

  it('returns null for ISO format (not EXIF canonical)', () => {
    expect(parseExifDateString('2023-04-15T12:30:00')).toBeNull()
  })

  it('returns null for invalid month', () => {
    expect(parseExifDateString('2023:13:01 00:00:00')).toBeNull()
  })

  it('returns null for malformed string', () => {
    expect(parseExifDateString('not a date')).toBeNull()
  })

  it('parses midnight correctly', () => {
    const d = parseExifDateString('2025:01:01 00:00:00')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2025)
    expect(d!.getHours()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// extractDateFromFilename
// ---------------------------------------------------------------------------

describe('extractDateFromFilename', () => {
  it('extracts date from IMG_YYYYMMDD_HHMMSS pattern', () => {
    const d = extractDateFromFilename('IMG_20230415_120000.jpg')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2023)
    expect(d!.getMonth()).toBe(3)
    expect(d!.getDate()).toBe(15)
  })

  it('extracts date from YYYY-MM-DD pattern', () => {
    const d = extractDateFromFilename('photo_2024-12-31.jpg')
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getMonth()).toBe(11)
    expect(d!.getDate()).toBe(31)
  })

  it('extracts date from YYYY_MM_DD pattern', () => {
    const d = extractDateFromFilename('Screenshot_2025_06_21.png')
    expect(d!.getFullYear()).toBe(2025)
    expect(d!.getMonth()).toBe(5)
    expect(d!.getDate()).toBe(21)
  })

  it('extracts date from VID_YYYYMMDD_ pattern', () => {
    const d = extractDateFromFilename('VID_20231231_235959.mp4')
    expect(d!.getFullYear()).toBe(2023)
    expect(d!.getMonth()).toBe(11)
    expect(d!.getDate()).toBe(31)
  })

  it('returns null for filename with no date pattern', () => {
    expect(extractDateFromFilename('holiday.jpg')).toBeNull()
  })

  it('returns null for invalid month (13)', () => {
    expect(extractDateFromFilename('IMG_20231315_000000.jpg')).toBeNull()
  })

  it('returns null for invalid day (00)', () => {
    expect(extractDateFromFilename('IMG_20231200_000000.jpg')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractDateFromTags
// ---------------------------------------------------------------------------

function makeTags(overrides: Record<string, unknown> = {}): ExifTags {
  return overrides as unknown as ExifTags
}

describe('extractDateFromTags', () => {
  it('returns DateTimeOriginal when present', () => {
    const tags = makeTags({ DateTimeOriginal: { description: '2023:04:15 12:30:00' } })
    const d = extractDateFromTags(tags)
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2023)
  })

  it('falls back to DateTime when DateTimeOriginal is absent', () => {
    const tags = makeTags({ DateTime: { description: '2022:06:20 08:00:00' } })
    const d = extractDateFromTags(tags)
    expect(d!.getFullYear()).toBe(2022)
    expect(d!.getMonth()).toBe(5)
  })

  it('prefers DateTimeOriginal over DateTime', () => {
    const tags = makeTags({
      DateTimeOriginal: { description: '2023:04:15 12:30:00' },
      DateTime: { description: '2022:01:01 00:00:00' }
    })
    const d = extractDateFromTags(tags)
    expect(d!.getFullYear()).toBe(2023)
  })

  it('returns null when neither tag is present', () => {
    expect(extractDateFromTags(makeTags())).toBeNull()
  })

  it('returns null when DateTimeOriginal is unparseable and DateTime is absent', () => {
    const tags = makeTags({ DateTimeOriginal: { description: 'invalid' } })
    expect(extractDateFromTags(tags)).toBeNull()
  })

  it('falls back to DateTime when DateTimeOriginal is unparseable', () => {
    const tags = makeTags({
      DateTimeOriginal: { description: 'bad' },
      DateTime: { description: '2021:03:10 15:00:00' }
    })
    const d = extractDateFromTags(tags)
    expect(d!.getFullYear()).toBe(2021)
  })
})

// ---------------------------------------------------------------------------
// defaultExifLoader (file I/O — uses a real minimal JPEG)
// ---------------------------------------------------------------------------

describe('defaultExifLoader', () => {
  it('returns null for a non-existent file', async () => {
    const result = await defaultExifLoader('/nonexistent/path/image.jpg')
    expect(result).toBeNull()
  })

  it('returns a tags object (possibly empty) for a valid image without EXIF', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'keepic-exif-test-'))
    try {
      const imgPath = join(tmpDir, 'test.jpg')
      // Create a minimal 1x1 JPEG using sharp (no EXIF)
      await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } }
      })
        .jpeg()
        .toFile(imgPath)
      const result = await defaultExifLoader(imgPath)
      // exifreader may return an object or null — both are valid for a no-EXIF image
      // The important check: it does not throw
      expect(result === null || typeof result === 'object').toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null for a corrupt file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'keepic-exif-test-'))
    try {
      const filePath = join(tmpDir, 'corrupt.jpg')
      writeFileSync(filePath, 'this is not an image', 'utf-8')
      const result = await defaultExifLoader(filePath)
      expect(result).toBeNull()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// readExifDate
// ---------------------------------------------------------------------------

describe('readExifDate', () => {
  const mtime = new Date('2020-01-01T00:00:00Z')

  it('uses EXIF DateTimeOriginal when loader returns it', async () => {
    const loader = async () =>
      makeTags({ DateTimeOriginal: { description: '2023:04:15 12:30:00' } })
    const result = await readExifDate('/some/photo.jpg', mtime, loader)
    expect(result.source).toBe('exif')
    expect(result.date.getFullYear()).toBe(2023)
  })

  it('uses EXIF DateTime when DateTimeOriginal is absent', async () => {
    const loader = async () => makeTags({ DateTime: { description: '2022:06:20 08:00:00' } })
    const result = await readExifDate('/some/photo.jpg', mtime, loader)
    expect(result.source).toBe('exif')
    expect(result.date.getFullYear()).toBe(2022)
  })

  it('falls back to filename when loader returns null', async () => {
    const loader = async () => null
    const result = await readExifDate('/photos/IMG_20210510_120000.jpg', mtime, loader)
    expect(result.source).toBe('filename')
    expect(result.date.getFullYear()).toBe(2021)
    expect(result.date.getMonth()).toBe(4) // May = 4 (0-indexed)
  })

  it('falls back to filename when tags have no date', async () => {
    const loader = async () => makeTags()
    const result = await readExifDate('/photos/VID_20230101_000000.mp4', mtime, loader)
    expect(result.source).toBe('filename')
    expect(result.date.getFullYear()).toBe(2023)
  })

  it('falls back to mtime when loader returns null and filename has no date', async () => {
    const loader = async () => null
    const result = await readExifDate('/photos/holiday.jpg', mtime, loader)
    expect(result.source).toBe('file_mtime')
    expect(result.date).toBe(mtime)
  })

  it('falls back to mtime when tags have no date and filename has no date', async () => {
    const loader = async () => makeTags()
    const result = await readExifDate('/photos/photo.jpg', mtime, loader)
    expect(result.source).toBe('file_mtime')
    expect(result.date).toBe(mtime)
  })
})
