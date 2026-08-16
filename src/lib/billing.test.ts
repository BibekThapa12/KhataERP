import { describe, expect, it } from 'vitest'
import { companyBillingStatus, companyCanWrite, companyPlanExpiryDateInput, companyRemainingDays } from './billing'
import type { Company } from '@/types'

const company = (values: Partial<Company>): Company => ({ id: 'c', user_id: 'u', name: 'Test', fiscal_year_start: '2026-07-17', ...values })
const now = new Date('2026-08-16T00:00:00.000Z')

describe('company billing', () => {
  it('keeps active trials writable and rounds remaining partial days upward', () => {
    const value = company({ plan_status: 'trial', plan_expires_at: '2026-08-17T12:00:00.000Z' })
    expect(companyBillingStatus(value, now)).toBe('trial')
    expect(companyRemainingDays(value, now)).toBe(2)
    expect(companyCanWrite(value, now)).toBe(true)
  })

  it('makes trial and paid plans read-only at their exact deadline', () => {
    for (const plan_status of ['trial', 'paid'] as const) {
      const value = company({ plan_status, plan_expires_at: now.toISOString() })
      expect(companyBillingStatus(value, now)).toBe('expired')
      expect(companyCanWrite(value, now)).toBe(false)
    }
  })

  it('supports lifetime paid and legacy free companies', () => {
    const lifetime = company({ plan_status: 'paid', plan_expires_at: null, trial_ends_at: '2020-01-01' })
    expect(companyBillingStatus(lifetime, now)).toBe('paid')
    expect(companyRemainingDays(lifetime, now)).toBeNull()
    expect(companyBillingStatus(company({ plan_status: 'free' }), now)).toBe('free')
  })

  it('gives suspension precedence over plan status', () => {
    expect(companyBillingStatus(company({ plan_status: 'paid', suspended: true }), now)).toBe('suspended')
  })

  it('formats the final covered Nepal calendar day for developer editing', () => {
    expect(companyPlanExpiryDateInput(company({ plan_expires_at: '2026-08-26T18:15:00.000Z' }))).toBe('2026-08-26')
  })
})
