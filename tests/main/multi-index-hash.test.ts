import { describe, it, expect } from 'vitest'
import { MultiIndexHash, isDualHashMatch } from '../../src/main/multi-index-hash'

// ---------------------------------------------------------------------------
// MultiIndexHash
// ---------------------------------------------------------------------------

describe('MultiIndexHash', () => {
  it('returns empty candidates for empty index', () => {
    const mi = new MultiIndexHash()
    expect(mi.queryCandidates('0000000000000000')).toEqual([])
  })

  it('returns the item itself as a candidate (self-match)', () => {
    const mi = new MultiIndexHash()
    mi.insert('abcdef1234567890', 0)
    const candidates = mi.queryCandidates('abcdef1234567890')
    expect(candidates).toContain(0)
  })

  it('finds candidates with identical hash', () => {
    const mi = new MultiIndexHash()
    mi.insert('abcdef1234567890', 0)
    mi.insert('abcdef1234567890', 1)
    const candidates = mi.queryCandidates('abcdef1234567890')
    expect(candidates).toContain(0)
    expect(candidates).toContain(1)
  })

  it('finds candidates with 1-bit difference (shares at least one chunk)', () => {
    const mi = new MultiIndexHash()
    // ff00802080008080 vs ff00800080008080 — differ by 1 bit in chunk 1 (008→000 in hex)
    mi.insert('ff00802080008080', 0)
    mi.insert('ff00800080008080', 1)
    // Query for hash 0 should return hash 1 as candidate (they share chunks 0, 3, 4)
    const candidates = mi.queryCandidates('ff00802080008080')
    expect(candidates).toContain(1)
  })

  it('finds candidates with up to 4-bit difference (pigeonhole guarantee)', () => {
    const mi = new MultiIndexHash()
    // Hash A: 0000000000000000
    // Hash B: f000000000000000 — 4-bit difference (only in chunk 0)
    // Chunks 1-4 are identical → must be found
    mi.insert('0000000000000000', 0)
    mi.insert('f000000000000000', 1)
    const candidates = mi.queryCandidates('0000000000000000')
    expect(candidates).toContain(1)
  })

  it('does not return candidates with >4-bit difference when no chunk matches', () => {
    const mi = new MultiIndexHash()
    // Two hashes where ALL 5 chunks differ
    // A: chunks = aaa bbb ccc ddd eeee
    // B: chunks = 111 222 333 444 5555
    mi.insert('aaabbbcccdddeee0', 0)
    mi.insert('1112223334445550', 1)
    const candidates = mi.queryCandidates('aaabbbcccdddeee0')
    // index 1 should not appear (no shared chunks)
    expect(candidates).not.toContain(1)
  })

  it('returns deduplicated candidates', () => {
    const mi = new MultiIndexHash()
    // Insert hash that shares multiple chunks with query → should appear once
    mi.insert('abcdef1234567890', 0)
    const candidates = mi.queryCandidates('abcdef1234567890')
    const count = candidates.filter((c) => c === 0).length
    expect(count).toBe(1)
  })

  it('handles multiple inserts and queries', () => {
    const mi = new MultiIndexHash()
    for (let i = 0; i < 100; i++) {
      // All same hash → all should be candidates of each other
      mi.insert('1234567890abcdef', i)
    }
    const candidates = mi.queryCandidates('1234567890abcdef')
    expect(candidates).toHaveLength(100)
  })
})

// ---------------------------------------------------------------------------
// isDualHashMatch
// ---------------------------------------------------------------------------

describe('isDualHashMatch', () => {
  it('returns true for identical pHash and dHash', () => {
    expect(isDualHashMatch('abcd000000000000', 'ef01000000000000', 'abcd000000000000', 'ef01000000000000')).toBe(true)
  })

  it('returns true for pHash within threshold and dHash within threshold', () => {
    // 1-bit pHash difference, identical dHash
    expect(isDualHashMatch('ff00802080008080', 'aabb000000000000', 'ff00800080008080', 'aabb000000000000')).toBe(true)
  })

  it('returns false when pHash exceeds threshold', () => {
    // 8-bit pHash difference
    expect(isDualHashMatch('ff00000000000000', '0000000000000000', '00ff000000000000', '0000000000000000')).toBe(false)
  })

  it('returns false when pHash matches but dHash exceeds threshold', () => {
    // Same pHash, very different dHash
    expect(isDualHashMatch('8080808000000080', '1234567890abcdef', '8080808000000080', 'fedcba0987654321')).toBe(false)
  })

  it('returns true when pHash matches and one dHash is null (legacy)', () => {
    expect(isDualHashMatch('abcd000000000000', null, 'abcd000000000000', 'ef01000000000000')).toBe(true)
  })

  it('returns true when pHash matches and both dHash are null (legacy)', () => {
    expect(isDualHashMatch('abcd000000000000', null, 'abcd000000000000', null)).toBe(true)
  })

  it('returns true when pHash is within threshold and dHash A is null', () => {
    expect(isDualHashMatch('ff00802080008080', null, 'ff00800080008080', 'aabb000000000000')).toBe(true)
  })

  it('returns true when pHash is within threshold and dHash B is null', () => {
    expect(isDualHashMatch('ff00802080008080', 'aabb000000000000', 'ff00800080008080', null)).toBe(true)
  })
})
