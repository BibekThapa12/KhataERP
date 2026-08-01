export const IDENTITY_LIMITS = { name: 150, address: 500, branch: 100, bankAccount: 34, chequeNumber: 50 } as const

const bankAccountPattern = /^[\p{L}\p{N} -]+$/u
const chequeNumberPattern = /^[\p{L}\p{N}/-]+$/u
const hasUnsupportedControl = (value: string) => [...value].some(character => { const code = character.charCodeAt(0); return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127 })

export function digitsOnly(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength)
}

export function normalizePhoneInput(value: string) { return digitsOnly(value, 10) }
export function normalizePanInput(value: string) { return digitsOnly(value, 9) }

export function validatePhone(value: string | null | undefined, required = false) {
  const clean = value?.trim() || ''
  if (!clean) return required ? 'Enter a 10-digit phone number.' : null
  return /^\d{10}$/.test(clean) ? null : 'Phone number must contain exactly 10 digits.'
}

export function validatePan(value: string | null | undefined, required = false) {
  const clean = value?.trim() || ''
  if (!clean) return required ? 'Enter a 9-digit PAN / VAT number.' : null
  return /^\d{9}$/.test(clean) ? null : 'PAN / VAT number must contain exactly 9 digits.'
}

export function validateIdentityText(value: string | null | undefined, label: string, maxLength: number, required = false) {
  const clean = value?.trim() || ''
  if (!clean) return required ? `Enter ${label.toLowerCase()}.` : null
  if (hasUnsupportedControl(clean)) return `${label} contains an unsupported control character.`
  if (clean.length > maxLength) return `${label} cannot exceed ${maxLength} characters.`
  return null
}

export function validateName(value: string | null | undefined, label = 'Name', required = true) { return validateIdentityText(value, label, IDENTITY_LIMITS.name, required) }
export function validateAddress(value: string | null | undefined, required = false) { return validateIdentityText(value, 'Address', IDENTITY_LIMITS.address, required) }
export function validateBranch(value: string | null | undefined) { return validateIdentityText(value, 'Bank branch', IDENTITY_LIMITS.branch) }

export function validateBankAccount(value: string | null | undefined) {
  const clean = value?.trim() || ''
  const base = validateIdentityText(clean, 'Bank account number', IDENTITY_LIMITS.bankAccount)
  if (base) return base
  return clean && !bankAccountPattern.test(clean) ? 'Bank account number may contain only letters, numbers, spaces, and hyphens.' : null
}

export function validateChequeNumber(value: string | null | undefined, required = true) {
  const clean = value?.trim() || ''
  const base = validateIdentityText(clean, 'Cheque number', IDENTITY_LIMITS.chequeNumber, required)
  if (base) return base
  return clean && !chequeNumberPattern.test(clean) ? 'Cheque number may contain only letters, numbers, slashes, and hyphens.' : null
}

export function identityDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
  if (/phone.*(check|valid|10)|identity_phone/i.test(message)) return 'Phone number must contain exactly 10 digits.'
  if (/(pan|vat).*(check|valid|9)|identity_pan/i.test(message)) return 'PAN / VAT number must contain exactly 9 digits.'
  if (/bank.*account.*(check|valid)|identity_bank_account/i.test(message)) return 'Bank account number may contain at most 34 letters, numbers, spaces, and hyphens.'
  if (/cheque.*number.*(check|valid)|identity_cheque/i.test(message)) return 'Cheque number may contain at most 50 letters, numbers, slashes, and hyphens.'
  if (/identity_(name|address|branch)|control character/i.test(message)) return 'One of the text fields is blank, too long, or contains an unsupported character.'
  return null
}
