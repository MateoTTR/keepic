import { hammingDistance, HAMMING_THRESHOLD } from './phash'

// ---------------------------------------------------------------------------
// Multi-Index Hashing for fast Hamming-distance neighbor search
// ---------------------------------------------------------------------------
//
// Pigeonhole principle: if two 64-bit hashes (16 hex chars) differ by ≤ 4 bits,
// then when split into 5 chunks, at least one chunk is identical.
//
// We build 5 Maps (one per chunk position). For each hash, we insert it into all
// 5 maps. To find neighbors, we query all 5 maps and collect candidates, then
// verify full Hamming distance on the (small) candidate set.
//
// Complexity: O(5n) build, O(5 × bucket_size) per query — effectively O(n) total
// instead of O(n²).
// ---------------------------------------------------------------------------

/** Number of chunks — must be > HAMMING_THRESHOLD for pigeonhole guarantee. */
const NUM_CHUNKS = 5

/** Chunk boundaries: character ranges in the 16-char hex string. */
const CHUNK_RANGES: Array<[start: number, end: number]> = [
  [0, 3], // 3 chars = 12 bits
  [3, 6], // 3 chars = 12 bits
  [6, 9], // 3 chars = 12 bits
  [9, 12], // 3 chars = 12 bits
  [12, 16] // 4 chars = 16 bits
]

/**
 * Multi-Index Hash structure for finding all pairs of hashes within
 * Hamming distance ≤ HAMMING_THRESHOLD in sub-quadratic time.
 */
export class MultiIndexHash {
  private readonly indices: Array<Map<string, number[]>>

  constructor() {
    this.indices = Array.from({ length: NUM_CHUNKS }, () => new Map())
  }

  /** Insert a hash at the given position index. O(5). */
  insert(hash: string, index: number): void {
    for (let c = 0; c < NUM_CHUNKS; c++) {
      const chunk = hash.substring(CHUNK_RANGES[c][0], CHUNK_RANGES[c][1])
      const bucket = this.indices[c].get(chunk)
      if (bucket) {
        bucket.push(index)
      } else {
        this.indices[c].set(chunk, [index])
      }
    }
  }

  /**
   * Find all candidate indices whose hash might be within Hamming distance
   * ≤ HAMMING_THRESHOLD of the given hash. Returns deduplicated indices.
   *
   * Callers must still verify the full Hamming distance on returned candidates.
   */
  queryCandidates(hash: string): number[] {
    const seen = new Set<number>()
    for (let c = 0; c < NUM_CHUNKS; c++) {
      const chunk = hash.substring(CHUNK_RANGES[c][0], CHUNK_RANGES[c][1])
      const bucket = this.indices[c].get(chunk)
      if (bucket) {
        for (const idx of bucket) {
          seen.add(idx)
        }
      }
    }
    return Array.from(seen)
  }
}

// ---------------------------------------------------------------------------
// Dual-hash matching helper (used by both dedup scan and importer)
// ---------------------------------------------------------------------------

/**
 * Returns true if two photos are considered duplicates based on dual-hash matching:
 * - pHash Hamming distance ≤ HAMMING_THRESHOLD, AND
 * - dHash Hamming distance ≤ HAMMING_THRESHOLD (if both available)
 *
 * If either dHash is null (legacy data), pHash match alone is accepted.
 */
export function isDualHashMatch(
  phashA: string,
  dhashA: string | null,
  phashB: string,
  dhashB: string | null
): boolean {
  if (hammingDistance(phashA, phashB) > HAMMING_THRESHOLD) return false
  if (dhashA && dhashB) {
    return hammingDistance(dhashA, dhashB) <= HAMMING_THRESHOLD
  }
  // Legacy data without dHash: accept pHash match alone
  return true
}
