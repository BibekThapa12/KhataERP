import { describe, expect, it } from 'vitest'
import {
  addDaysToBs,
  compareBsDates,
  formatBsParts,
  getBsMonthLength,
  normalizeBsDateInput,
  parseBsDate,
  shiftBsMonth,
} from '@/lib/nepaliDate'

describe('Nepali date input normalization', () => {
  it('expands a six-digit BS date shorthand', () => {
    expect(normalizeBsDateInput('830101')).toBe('2083-01-01')
  })

  it('formats an eight-digit full BS date', () => {
    expect(normalizeBsDateInput('20830415')).toBe('2083-04-15')
  })

  it('preserves an already formatted BS date', () => {
    expect(normalizeBsDateInput('2083-04-15')).toBe('2083-04-15')
  })

  it('does not normalize partial or invalid compact dates', () => {
    expect(normalizeBsDateInput('208301')).toBeNull()
    expect(normalizeBsDateInput('831301')).toBeNull()
    expect(normalizeBsDateInput('830100')).toBeNull()
  })

  it('rejects days beyond the configured length of a BS month', () => {
    const monthLength = getBsMonthLength(2083, 1)
    expect(monthLength).toBeGreaterThanOrEqual(29)
    expect(parseBsDate(formatBsParts({ year: 2083, month: 1, day: monthLength }))).not.toBeNull()
    expect(parseBsDate(formatBsParts({ year: 2083, month: 1, day: monthLength + 1 }))).toBeNull()
  })

  it('moves backward and forward across BS month and year boundaries', () => {
    expect(shiftBsMonth(2083, 1, -1)).toEqual({ year: 2082, month: 12 })
    expect(shiftBsMonth(2083, 12, 1)).toEqual({ year: 2084, month: 1 })
  })

  it('supports keyboard-style movement into the previous day', () => {
    const previous = addDaysToBs('2083-01-01', -1)
    expect(compareBsDates(previous, '2083-01-01')).toBeLessThan(0)
  })
})
