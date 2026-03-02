/**
 * HEIC pHash comparison test script
 *
 * Tests three approaches for computing pHash on HEIC files:
 *   A) ffmpeg decode → temp JPEG → sharp pHash  (current production approach)
 *   B) ffmpeg convert → full-quality JPEG → sharp pHash
 *   C) EXIF embedded thumbnail → sharp pHash    (pure-JS, no native decoder)
 *
 * Usage:
 *   node scripts/heic-phash-test.mjs [folder]
 *
 * Default folder: /tmp/heic-test
 */

import { readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import sharp from 'sharp'
import ExifReader from 'exifreader'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FOLDER = process.argv[2] ?? '/tmp/heic-test'
const SAMPLE_SIZE = 32
const HASH_SIZE = 8
const JPEG_QUALITY = 85 // matches config.heicConversion.jpegQuality default

// ---------------------------------------------------------------------------
// Helpers — ffmpeg
// ---------------------------------------------------------------------------

const ffmpegPath = (await import('ffmpeg-static')).default.replace('app.asar', 'app.asar.unpacked')

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args)
    const stderr = []
    child.stderr?.on('data', (d) => stderr.push(d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.join('')}`))
    })
    child.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Helpers — pHash (copy of src/main/phash.ts logic)
// ---------------------------------------------------------------------------

function dct1d(signal) {
  const N = signal.length
  return Array.from({ length: N }, (_, k) =>
    signal.reduce((sum, v, n) => sum + v * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N)), 0)
  )
}

function dct2d(matrix, size) {
  const rowDct = matrix.map((row) => dct1d(row))
  const result = Array.from({ length: size }, () => new Array(size))
  for (let col = 0; col < size; col++) {
    const column = rowDct.map((row) => row[col])
    const colResult = dct1d(column)
    for (let row = 0; row < size; row++) result[row][col] = colResult[row]
  }
  return result
}

function dctHash(pixels, size) {
  const matrix = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (__, x) => pixels[y * size + x])
  )
  const dct = dct2d(matrix, size)
  const low = []
  for (let y = 0; y < HASH_SIZE; y++)
    for (let x = 0; x < HASH_SIZE; x++) low.push(dct[y][x])
  const ac = low.slice(1)
  const mean = ac.reduce((a, b) => a + b, 0) / ac.length
  const bits = low.map((v) => (v > mean ? 1 : 0))
  let hex = ''
  for (let i = 0; i < 64; i += 4)
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16)
  return hex
}

async function phashFromBuffer(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const meta = await sharp(buffer).metadata()
  return {
    phash: dctHash(new Uint8Array(data), SAMPLE_SIZE),
    width: meta.width ?? info.width,
    height: meta.height ?? info.height,
  }
}

async function phashFromFile(filePath) {
  const { data } = await sharp(filePath)
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const meta = await sharp(filePath).metadata()
  return {
    phash: dctHash(new Uint8Array(data), SAMPLE_SIZE),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Approach A — ffmpeg decode → temp JPEG → sharp pHash
// ---------------------------------------------------------------------------

async function approachA_decode(heicPath) {
  const tempPath = join(tmpdir(), `keepic-test-a-${randomUUID()}.jpg`)
  try {
    await runFfmpeg(['-i', heicPath, '-frames:v', '1', tempPath, '-y'])
    const result = await phashFromFile(tempPath)
    return result
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath)
  }
}

// ---------------------------------------------------------------------------
// Approach B — ffmpeg convert → JPEG (with quality) → sharp pHash
// ---------------------------------------------------------------------------

async function approachB_convert(heicPath) {
  const tempPath = join(tmpdir(), `keepic-test-b-${randomUUID()}.jpg`)
  try {
    await runFfmpeg(['-i', heicPath, '-q:v', String(JPEG_QUALITY), tempPath, '-y'])
    const result = await phashFromFile(tempPath)
    return result
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath)
  }
}

// ---------------------------------------------------------------------------
// Approach C — EXIF embedded thumbnail → sharp pHash
// ---------------------------------------------------------------------------

async function approachC_thumbnail(heicPath) {
  const fileBuffer = readFileSync(heicPath)
  const tags = ExifReader.load(fileBuffer.buffer, { expanded: true, includeUnknown: false })

  // Dump all available tag groups for exploration
  const tagGroups = Object.keys(tags)

  // Look for thumbnail data — ExifReader stores it as a Uint8Array in tags.Thumbnail
  const thumbnailEntry = tags.Thumbnail
  if (!thumbnailEntry) {
    return { error: 'No thumbnail group found', tagGroups }
  }

  // The thumbnail data may be in different places depending on the file
  // Common: tags.Thumbnail.base64 or tags.Thumbnail['Thumbnail Data']
  let thumbBuffer = null
  let thumbInfo = {}

  if (thumbnailEntry.base64) {
    // ExifReader provides base64-encoded thumbnail
    const b64 = thumbnailEntry.base64
    thumbBuffer = Buffer.from(b64, 'base64')
    thumbInfo = { source: 'thumbnail.base64', bytes: thumbBuffer.length }
  } else if (thumbnailEntry['Thumbnail Data']) {
    const td = thumbnailEntry['Thumbnail Data']
    if (td.value instanceof Uint8Array) {
      thumbBuffer = Buffer.from(td.value)
      thumbInfo = { source: 'ThumbnailData.value', bytes: thumbBuffer.length }
    }
  }

  if (!thumbBuffer) {
    // Log all keys in the thumbnail group to debug
    const thumbnailKeys = Object.keys(thumbnailEntry)
    return { error: 'Thumbnail group found but no data extracted', tagGroups, thumbnailKeys }
  }

  // Verify it's a valid JPEG (starts with FFD8)
  const isJpeg = thumbBuffer[0] === 0xff && thumbBuffer[1] === 0xd8
  thumbInfo.isJpeg = isJpeg
  thumbInfo.firstBytes = Array.from(thumbBuffer.slice(0, 4)).map((b) => b.toString(16)).join(' ')

  if (!isJpeg) {
    return { error: 'Thumbnail found but is not JPEG', thumbInfo }
  }

  try {
    const result = await phashFromBuffer(thumbBuffer)
    return { ...result, thumbInfo }
  } catch (err) {
    return { error: `sharp failed on thumbnail: ${err.message}`, thumbInfo }
  }
}

// ---------------------------------------------------------------------------
// Hamming distance between two hex pHash strings
// ---------------------------------------------------------------------------

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    dist += xor.toString(2).split('').filter((c) => c === '1').length
  }
  return dist
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(FOLDER)) {
  console.error(`Folder not found: ${FOLDER}`)
  process.exit(1)
}

const files = readdirSync(FOLDER).filter((f) =>
  ['.heic', '.heif'].includes(extname(f).toLowerCase())
)

if (files.length === 0) {
  console.error(`No HEIC/HEIF files found in ${FOLDER}`)
  process.exit(1)
}

console.log(`\nffmpeg: ${ffmpegPath}`)
console.log(`Found ${files.length} HEIC file(s) in ${FOLDER}\n`)
console.log('='.repeat(80))

for (const file of files) {
  const heicPath = join(FOLDER, file)
  console.log(`\n📷  ${file}`)
  console.log('-'.repeat(60))

  // Approach A
  let resA = null
  try {
    resA = await approachA_decode(heicPath)
    console.log(`  A (ffmpeg decode → temp JPEG):  phash=${resA.phash}  ${resA.width}×${resA.height}`)
  } catch (err) {
    console.log(`  A (ffmpeg decode → temp JPEG):  ERROR — ${err.message}`)
  }

  // Approach B
  let resB = null
  try {
    resB = await approachB_convert(heicPath)
    console.log(`  B (ffmpeg convert q=${JPEG_QUALITY} → JPEG):  phash=${resB.phash}  ${resB.width}×${resB.height}`)
  } catch (err) {
    console.log(`  B (ffmpeg convert q=${JPEG_QUALITY} → JPEG):  ERROR — ${err.message}`)
  }

  // Approach C
  let resC = null
  try {
    resC = await approachC_thumbnail(heicPath)
    if (resC.error) {
      console.log(`  C (EXIF thumbnail):  FAILED — ${resC.error}`)
      if (resC.tagGroups) console.log(`    ExifReader tag groups: ${resC.tagGroups.join(', ')}`)
      if (resC.thumbnailKeys) console.log(`    Thumbnail keys: ${resC.thumbnailKeys.join(', ')}`)
    } else {
      console.log(`  C (EXIF thumbnail):  phash=${resC.phash}  ${resC.width}×${resC.height}  [${resC.thumbInfo.source}, ${resC.thumbInfo.bytes} bytes]`)
    }
  } catch (err) {
    console.log(`  C (EXIF thumbnail):  ERROR — ${err.message}`)
  }

  // Hamming distances
  if (resA?.phash && resB?.phash) {
    console.log(`  Hamming A↔B: ${hammingDistance(resA.phash, resB.phash)} bits`)
  }
  if (resA?.phash && resC?.phash) {
    console.log(`  Hamming A↔C: ${hammingDistance(resA.phash, resC.phash)} bits (thumbnail vs full-res)`)
  }
  if (resB?.phash && resC?.phash) {
    console.log(`  Hamming B↔C: ${hammingDistance(resB.phash, resC.phash)} bits (thumbnail vs converted JPEG)`)
  }
}

console.log('\n' + '='.repeat(80))
console.log('Done.')
