import { describe, expect, it } from 'vitest'
import { newPasswordValidationError } from '@/lib/passwordRecovery'

describe('password recovery validation', () => {
  it('requires length, a letter, and a number', () => {
    expect(newPasswordValidationError('short1', 'short1')).toContain('8 characters')
    expect(newPasswordValidationError('abcdefgh', 'abcdefgh')).toContain('a number')
    expect(newPasswordValidationError('12345678', '12345678')).toContain('a letter')
  })

  it('requires matching confirmation', () => {
    expect(newPasswordValidationError('secure123', 'secure124')).toBe('The passwords do not match.')
    expect(newPasswordValidationError('secure123', 'secure123')).toBeNull()
  })
})
