import { describe, expect, it } from 'vitest'
import { auditFieldMarkers, backupFileValidationError, isSafePublicImageUrl, publicAuthErrorMessage, publicErrorMessage, redactSensitiveText, safeErrorMessage, sanitizeForLogging } from './security'

describe('secret-safe logging', () => {
  it('redacts credential-shaped text and sensitive object fields', () => {
    const jwt = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`
    const result = sanitizeForLogging({ authorization: `Bearer ${jwt}`, message: `failed token=${jwt}` }) as Record<string, string>
    expect(result.authorization).toBe('[REDACTED]')
    expect(result.message).not.toContain(jwt)
  })

  it('redacts credential URLs and error messages', () => {
    expect(redactSensitiveText('postgresql://user:pass@example.test/db')).toBe('postgresql://[REDACTED]')
    expect(safeErrorMessage(new Error('password=hunter2'))).toBe('password=[REDACTED]')
  })

  it('retains only changed field names in audit snapshots', () => {
    expect(auditFieldMarkers({ phone: '9800000000', address: 'Kathmandu' })).toEqual({
      phone: '[CHANGED]',
      address: '[CHANGED]',
    })
  })

  it('does not expose internal error details in a public message', () => {
    const message = publicErrorMessage(new Error('select * from auth.users at C:\\server\\auth.ts'), 'sign in')
    expect(message).toMatch(/^Could not complete sign in\. Reference: /)
    expect(message).not.toContain('auth.users')
    expect(message).not.toContain('server')
  })

  it('maps expected authentication errors without exposing provider details', () => {
    const message = publicAuthErrorMessage({
      code: 'captcha_failed',
      message: 'captcha secret rejected by internal host auth.example.test',
    }, 'sign in')
    expect(message).toBe('CAPTCHA verification failed. Complete a new challenge and try again.')
    expect(message).not.toContain('secret')
    expect(message).not.toContain('auth.example.test')
  })

  it('rejects oversized or non-JSON backup uploads before reading them', () => {
    expect(backupFileValidationError({ name: 'backup.json', size: 11 * 1024 * 1024, type: 'application/json' })).toContain('10 MB')
    expect(backupFileValidationError({ name: 'backup.html', size: 100, type: 'text/html' })).toContain('JSON')
    expect(backupFileValidationError({ name: 'backup.json', size: 100, type: '' })).toBeNull()
  })

  it('allows only credential-free HTTPS company logo URLs', () => {
    expect(isSafePublicImageUrl('https://cdn.example.test/logo.png')).toBe(true)
    expect(isSafePublicImageUrl('javascript:alert(1)')).toBe(false)
    expect(isSafePublicImageUrl('http://example.test/logo.png')).toBe(false)
    expect(isSafePublicImageUrl('https://user:pass@example.test/logo.png')).toBe(false)
  })
})
