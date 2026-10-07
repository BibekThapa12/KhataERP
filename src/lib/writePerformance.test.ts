import { describe, expect, it } from 'vitest'
import { performanceCompanySizeBand, shouldPersistWritePerformance } from './writePerformance'

describe('performanceCompanySizeBand', () => {
  it.each([
    [0, 'under_1k'], [999, 'under_1k'], [1000, '1k_10k'],
    [9999, '1k_10k'], [10000, '10k_50k'], [49999, '10k_50k'],
    [50000, '50k_100k'], [100000, '50k_100k'], [100001, 'over_100k'],
  ] as const)('classifies %s vouchers as %s', (size, expected) => {
    expect(performanceCompanySizeBand(size)).toBe(expected)
  })
})

describe('shouldPersistWritePerformance', () => {
  it('retains failures, slow writes, and sampled successes only', () => {
    expect(shouldPersistWritePerformance(false, 20, false)).toBe(true)
    expect(shouldPersistWritePerformance(true, 1000, false)).toBe(true)
    expect(shouldPersistWritePerformance(true, 20, true)).toBe(true)
    expect(shouldPersistWritePerformance(true, 20, false)).toBe(false)
  })
})
