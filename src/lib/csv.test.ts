import { describe, expect, it } from 'vitest'
import { escapeCsvCell } from './csv'

describe('CSV export safety', () => {
  it('neutralizes spreadsheet formulas, including whitespace-prefixed formulas', () => {
    expect(escapeCsvCell('=HYPERLINK("https://attacker.test")')).toBe('"\'=HYPERLINK(""https://attacker.test"")"')
    expect(escapeCsvCell('  +1+1')).toBe("'  +1+1")
    expect(escapeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"')
  })

  it('preserves ordinary values and CSV quoting', () => {
    expect(escapeCsvCell('Normal party')).toBe('Normal party')
    expect(escapeCsvCell('Kathmandu, Nepal')).toBe('"Kathmandu, Nepal"')
  })
})
