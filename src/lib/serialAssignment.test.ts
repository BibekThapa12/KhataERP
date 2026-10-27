import { describe, expect, it } from 'vitest'
import { duplicateSerialNumbers, parseSerialNumberPaste, serializedQuantityRequirement } from './serialAssignment'

describe('serializedQuantityRequirement', () => {
  it('uses the existing alternate-unit conversion for the required serial count', () => {
    expect(serializedQuantityRequirement(12, 6)).toEqual({ baseQuantity: 2, requiredCount: 2, valid: true })
  })

  it('rejects fractional base quantities instead of rounding them to a serial count', () => {
    expect(serializedQuantityRequirement(5, 6)).toEqual({
      baseQuantity: 0.8333,
      requiredCount: 0,
      valid: false,
      reason: 'fractional_quantity',
    })
  })

  it('rejects zero and invalid quantities', () => {
    expect(serializedQuantityRequirement(0, 1).reason).toBe('missing_quantity')
    expect(serializedQuantityRequirement(Number.NaN, 1).reason).toBe('missing_quantity')
  })
})

describe('duplicateSerialNumbers', () => {
  it('detects duplicate serials case-insensitively across rows', () => {
    expect([...duplicateSerialNumbers([' SN-01 ', 'sn-01', 'SN-02'])]).toEqual(['SN-01'])
  })
})

describe('parseSerialNumberPaste', () => {
  it('accepts spreadsheet columns and multiline scanner input', () => {
    expect(parseSerialNumberPaste(' SN-01\r\nSN-02\tSN-03\n\n')).toEqual(['SN-01', 'SN-02', 'SN-03'])
  })

  it('does not split valid serials containing spaces or punctuation', () => {
    expect(parseSerialNumberPaste('IMEI 01\nCHASSIS-02/NP')).toEqual(['IMEI 01', 'CHASSIS-02/NP'])
  })
})
