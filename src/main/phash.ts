import sharp from 'sharp'

// ---------------------------------------------------------------------------
// DCT-based perceptual hash
// ---------------------------------------------------------------------------

const HASH_SIZE = 8 // Top-left NxN DCT coefficients used for the hash
const SAMPLE_SIZE = 32 // Image resized to SxS before DCT

/**
 * Applies a 1-D Discrete Cosine Transform to an array of N values.
 * Returns N DCT coefficients.
 */
function dct1d(signal: number[]): number[] {
  const N = signal.length
  const result = new Array<number>(N)
  for (let k = 0; k < N; k++) {
    let sum = 0
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N))
    }
    result[k] = sum
  }
  return result
}

/**
 * Applies a 2-D DCT to a square matrix by applying 1-D DCT on each row then
 * each column.
 */
function dct2d(matrix: number[][], size: number): number[][] {
  const rowDct = matrix.map((row) => dct1d(row))

  const result: number[][] = Array.from({ length: size }, () => new Array<number>(size))
  for (let col = 0; col < size; col++) {
    const column = rowDct.map((row) => row[col])
    const colResult = dct1d(column)
    for (let row = 0; row < size; row++) {
      result[row][col] = colResult[row]
    }
  }
  return result
}

/**
 * Computes a 64-bit DCT perceptual hash from a flat grayscale pixel array.
 *
 * Algorithm:
 *   1. Build a SAMPLE_SIZE × SAMPLE_SIZE matrix from the pixel data.
 *   2. Compute the 2-D DCT.
 *   3. Extract the top-left HASH_SIZE × HASH_SIZE coefficients (64 values).
 *   4. Compute the mean of the 63 AC coefficients (excluding the DC term).
 *   5. Each bit: 1 if coefficient > mean, 0 otherwise.
 *   6. Encode as a 16-character lowercase hex string.
 *
 * @param pixels - Flat Uint8Array of grayscale pixel values (length = size²).
 * @param size   - Width/height of the square image (must equal Math.sqrt(pixels.length)).
 */
export function dctHash(pixels: Uint8Array, size: number): string {
  const matrix: number[][] = []
  for (let y = 0; y < size; y++) {
    const row = new Array<number>(size)
    for (let x = 0; x < size; x++) {
      row[x] = pixels[y * size + x]
    }
    matrix.push(row)
  }

  const dct = dct2d(matrix, size)

  // Extract top-left HASH_SIZE × HASH_SIZE coefficients
  const low: number[] = []
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      low.push(dct[y][x])
    }
  }

  // Mean of the 63 AC coefficients (skip DC at index 0)
  const ac = low.slice(1)
  const mean = ac.reduce((a, b) => a + b, 0) / ac.length

  // Build bit array: 1 if coefficient > mean
  const bits = low.map((v) => (v > mean ? 1 : 0))

  // Encode as hex (4 bits per hex char)
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16)
  }
  return hex
}

// ---------------------------------------------------------------------------
// Injectable dependency type
// ---------------------------------------------------------------------------

export interface PhashResult {
  phash: string
  width: number
  height: number
}

/** Injectable function type for computing pHash + image dimensions from a file. */
export type PhashComputer = (filePath: string) => Promise<PhashResult | null>

// ---------------------------------------------------------------------------
// File I/O (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Default PhashComputer: opens the image with sharp, reads width/height, resizes
 * to SAMPLE_SIZE × SAMPLE_SIZE grayscale, and computes the DCT hash.
 *
 * Returns null on any error (unsupported format, corrupt file, etc.).
 */
export async function defaultPhashComputer(filePath: string): Promise<PhashResult | null> {
  try {
    const meta = await sharp(filePath).metadata()
    const { data } = await sharp(filePath)
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    return {
      phash: dctHash(new Uint8Array(data), SAMPLE_SIZE),
      /* v8 ignore next 2 */
      width: meta.width ?? 0,
      height: meta.height ?? 0
    }
  } catch {
    return null
  }
}
