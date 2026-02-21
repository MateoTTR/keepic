import { describe, it, expect } from 'vitest'
import {
  isYearFolder,
  isMonthlyFolder,
  isEventFolder,
  getDestinationPath
} from '@shared/library-path'

describe('isYearFolder', () => {
  it('accepts a 4-digit year', () => {
    expect(isYearFolder('2025')).toBe(true)
    expect(isYearFolder('2026')).toBe(true)
  })

  it('rejects non-year folder names', () => {
    expect(isYearFolder('Archive')).toBe(false)
    expect(isYearFolder('25')).toBe(false)
    expect(isYearFolder('20255')).toBe(false)
    expect(isYearFolder('2025.01')).toBe(false)
    expect(isYearFolder('')).toBe(false)
  })
})

describe('isMonthlyFolder', () => {
  it('accepts valid monthly folders', () => {
    expect(isMonthlyFolder('2025.01')).toBe(true)
    expect(isMonthlyFolder('2025.12')).toBe(true)
    expect(isMonthlyFolder('2026.06')).toBe(true)
  })

  it('rejects invalid month numbers', () => {
    expect(isMonthlyFolder('2025.00')).toBe(false)
    expect(isMonthlyFolder('2025.13')).toBe(false)
  })

  it('rejects non-monthly folder names', () => {
    expect(isMonthlyFolder('2025')).toBe(false)
    expect(isMonthlyFolder('2025.04.15-19.Londres')).toBe(false)
    expect(isMonthlyFolder('Archive')).toBe(false)
  })
})

describe('isEventFolder', () => {
  it('accepts same-month range event folders', () => {
    expect(isEventFolder('2025.04.15-19.Londres')).toBe(true)
  })

  it('accepts cross-month range event folders', () => {
    expect(isEventFolder('2025.01.31-02.02.Center.Parcs')).toBe(true)
    expect(isEventFolder('2025.05.29-06.01.WE.Tarn')).toBe(true)
  })

  it('accepts single-day event folders', () => {
    expect(isEventFolder('2025.06.21.Mariage')).toBe(true)
  })

  it('rejects monthly folders', () => {
    expect(isEventFolder('2025.01')).toBe(false)
  })

  it('rejects year folders', () => {
    expect(isEventFolder('2025')).toBe(false)
  })

  it('rejects event folders without a name', () => {
    expect(isEventFolder('2025.04.15-19.')).toBe(false)
  })
})

describe('getDestinationPath', () => {
  it('returns correct path for a mid-year date', () => {
    const date = new Date(2025, 3, 15) // April 15, 2025
    expect(getDestinationPath(date, 'IMG_1234.jpg')).toBe('2025/2025.04/IMG_1234.jpg')
  })

  it('pads single-digit months with a leading zero', () => {
    const date = new Date(2025, 0, 5) // January 5, 2025
    expect(getDestinationPath(date, 'IMG_0001.jpg')).toBe('2025/2025.01/IMG_0001.jpg')
  })

  it('handles December correctly', () => {
    const date = new Date(2025, 11, 31) // December 31, 2025
    expect(getDestinationPath(date, 'IMG_9999.jpg')).toBe('2025/2025.12/IMG_9999.jpg')
  })

  it('preserves the original filename', () => {
    const date = new Date(2026, 5, 1)
    expect(getDestinationPath(date, 'HEIC_0042.jpg')).toBe('2026/2026.06/HEIC_0042.jpg')
  })
})
