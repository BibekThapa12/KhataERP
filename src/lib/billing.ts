import type { Company, CompanyBillingStatus } from '@/types'

const DAY_MS = 86_400_000

function legacyExpiry(value?: string) {
  if (!value) return null
  const parsed = new Date(`${value}T23:59:59.999+05:45`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function companyPlanExpiry(company?: Company | null) {
  if (!company) return null
  if ('plan_expires_at' in company) {
    if (!company.plan_expires_at) return null
    const parsed = new Date(company.plan_expires_at)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return legacyExpiry(company.trial_ends_at)
}

export function companyBillingStatus(company?: Company | null, now = new Date()): CompanyBillingStatus {
  if (company?.suspended) return 'suspended'
  const configured = company?.plan_status || 'trial'
  if (configured === 'expired') return 'expired'
  const expiry = companyPlanExpiry(company)
  if ((configured === 'trial' || configured === 'paid') && expiry && expiry.getTime() <= now.getTime()) return 'expired'
  return configured
}

export function companyRemainingDays(company?: Company | null, now = new Date()) {
  const expiry = companyPlanExpiry(company)
  if (!expiry) return null
  const difference = expiry.getTime() - now.getTime()
  return difference > 0 ? Math.ceil(difference / DAY_MS) : -Math.ceil(Math.abs(difference) / DAY_MS)
}

export function companyPlanExpiryDateInput(company?: Company | null) {
  const expiry = companyPlanExpiry(company)
  if (!expiry) return ''
  const coveredInstant = new Date(expiry.getTime() - 1)
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kathmandu' }).formatToParts(coveredInstant)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function companyCanWrite(company?: Company | null, now = new Date()) {
  return !['expired', 'suspended'].includes(companyBillingStatus(company, now))
}

export function companyBillingTooltip(company?: Company | null, now = new Date()) {
  const status = companyBillingStatus(company, now)
  const expiry = companyPlanExpiry(company)
  if (status === 'suspended') return 'Company access is suspended.'
  if (status === 'free') return 'Free plan with no expiry.'
  if (status === 'paid' && !expiry) return 'Paid plan with no expiry.'
  if (!expiry) return `${status === 'trial' ? 'Trial' : 'Plan'} has no expiry date.`
  const days = companyRemainingDays(company, now) || 0
  // Expiry is exclusive. Show the final covered calendar day rather than
  // midnight at the start of the following day.
  const date = new Intl.DateTimeFormat('en-NP', { dateStyle: 'medium', timeZone: 'Asia/Kathmandu' }).format(new Date(expiry.getTime() - 1))
  if (status === 'expired') return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Read-only since ${date}.`
  return `${days} day${days === 1 ? '' : 's'} remaining. Access ends ${date}.`
}
