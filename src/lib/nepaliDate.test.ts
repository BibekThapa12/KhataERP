import { describe, expect, it } from 'vitest'
import { normalizeBsDateInput } from '@/lib/nepaliDate'

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
})
