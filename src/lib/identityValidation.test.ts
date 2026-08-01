import { describe, expect, it } from 'vitest'
import { normalizePanInput, normalizePhoneInput, validateAddress, validateBankAccount, validateChequeNumber, validateName, validatePan, validatePhone } from './identityValidation'

describe('identity validation', () => {
  it('normalizes digit fields without losing leading zeros', () => {
    expect(normalizePhoneInput('01-234 567890x')).toBe('0123456789')
    expect(normalizePanInput('060-000-0000')).toBe('060000000')
  })
  it('requires exact phone and PAN lengths when supplied', () => {
    expect(validatePhone('', false)).toBeNull()
    expect(validatePhone('', true)).toMatch(/enter/i)
    expect(validatePhone('0123456789')).toBeNull()
    expect(validatePhone('123')).toMatch(/10/)
    expect(validatePan('123456789')).toBeNull()
    expect(validatePan('12345678')).toMatch(/9/)
  })
  it('validates text limits and control characters', () => {
    expect(validateName('   ')).toMatch(/enter/i)
    expect(validateName('A'.repeat(151))).toMatch(/150/)
    expect(validateAddress(`Road\nTwo`)).toBeNull()
    expect(validateAddress(`Road\u0000Two`)).toMatch(/control/i)
  })
  it('validates bank and cheque identifiers', () => {
    expect(validateBankAccount('0012-AB 34')).toBeNull()
    expect(validateBankAccount('12/34')).toMatch(/only/i)
    expect(validateChequeNumber('AB/001-2')).toBeNull()
    expect(validateChequeNumber('AB 12')).toMatch(/only/i)
  })
})
