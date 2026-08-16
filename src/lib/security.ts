import { notifyError } from '@/lib/notifications'

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|service[_-]?role|connection[_-]?string|email|phone|address|pan[_-]?vat|account[_-]?number|contact[_-]?number|holder[_-]?name|notes?|narration|party[_-]?id|voucher[_-]?id)/i

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi, '[REDACTED_SUPABASE_KEY]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s]+/gi, '$1://[REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|api_key|key|secret|token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d[\d -]{8,}\d)\b/g, '[REDACTED_NUMBER]')
}

export function sanitizeForLogging(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 4000)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(entry => sanitizeForLogging(entry, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeForLogging(entry, depth + 1),
    ]))
  }
  return String(value)
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactSensitiveText(error.message)
  if (typeof error === 'string') return redactSensitiveText(error)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const candidate = record.message ?? record.error_description ?? record.error ?? record.details
    if (typeof candidate === 'string' && candidate.trim()) return redactSensitiveText(candidate)
    if (typeof record.code === 'string' && record.code.trim()) return `Request failed with code ${redactSensitiveText(record.code)}`
    return 'Request failed with a structured error response.'
  }
  return redactSensitiveText(String(error))
}

export function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : undefined
}

export interface ClientErrorReport {
  error: unknown
  correlationId: string
  operation: string
}

export function createCorrelationId(): string {
  try { return crypto.randomUUID() }
  catch { return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

export function reportClientError(error: unknown, operation = 'request'): string {
  const correlationId = createCorrelationId()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ClientErrorReport>('khataerp:client-error', {
      detail: { error, correlationId, operation },
    }))
  }
  return correlationId
}

type PublicErrorRule = { pattern: RegExp; message: string }

// Database errors are intentionally translated through an allowlist. This
// keeps SQL/schema details private while giving users a concrete correction.
const PUBLIC_ERROR_RULES: PublicErrorRule[] = [
  { pattern: /invoice totals do not match server-calculated values/i, message: 'The invoice total could not be verified. Check the item quantities, rates, discount, and VAT, then save again.' },
  { pattern: /invoice items require positive quantities and non-negative rates/i, message: 'Every invoice row must have a valid item, a quantity greater than zero, and a rate of zero or more.' },
  { pattern: /invoice discount is outside the valid range/i, message: 'The discount cannot be negative or greater than the invoice subtotal.' },
  { pattern: /vat rate is outside the valid range/i, message: 'Enter a valid VAT rate.' },
  { pattern: /insufficient stock|not enough stock/i, message: 'There is not enough available stock to complete this transaction. Check the item quantities.' },
  { pattern: /voucher (?:is not balanced|debit and credit totals do not match)|lines do not balance/i, message: 'The accounting entry is not balanced. Review the amounts and try again.' },
  { pattern: /voucher total (?:does not match|must be greater than zero)/i, message: 'The voucher total is invalid. Review the entered amounts and try again.' },
  { pattern: /voucher date cannot be before|financial year start date/i, message: 'The transaction date is outside the allowed financial year. Select a valid date.' },
  { pattern: /voucher date cannot be in a future financial period/i, message: 'The transaction date cannot be in a future financial period.' },
  { pattern: /complete financial year setup/i, message: 'Complete the company Financial Year setup before posting transactions.' },
  { pattern: /supplier invoice number cannot exceed/i, message: 'The supplier invoice number is too long. Use 100 characters or fewer.' },
  { pattern: /enter the journal voucher number/i, message: 'Enter a Journal voucher number before saving.' },
  { pattern: /return quantity exceeds|exceeds the remaining quantity/i, message: 'The return quantity is greater than the quantity still available to return.' },
  { pattern: /return source invoice is invalid|original voucher.*another company/i, message: 'The selected original invoice is unavailable. Select another invoice and try again.' },
  { pattern: /linked return vouchers before cancelling/i, message: 'Cancel the linked return voucher before cancelling this invoice.' },
  { pattern: /ledger already exist/i, message: 'A ledger with this name already exists. Enter a different name.' },
  { pattern: /account category already exist/i, message: 'An account category with this name already exists under this account type.' },
  { pattern: /stock item already exist/i, message: 'A stock item with this name already exists. Enter a different name.' },
  { pattern: /stock item category already exist/i, message: 'A stock category with this name already exists.' },
  { pattern: /this issuing bank already exists/i, message: 'This issuing bank is already available. Select it from the existing bank list.' },
  { pattern: /duplicate cheque|cheque number already|issued_cheque_number_unique/i, message: 'This cheque number already exists for the selected bank.' },
  { pattern: /due date cannot be before issue date/i, message: 'The due date cannot be earlier than the cheque issue date.' },
  { pattern: /completed cheques cannot be edited/i, message: 'A settled cheque cannot be edited.' },
  { pattern: /only pending cheques/i, message: 'Only pending cheques can be changed or settled.' },
  { pattern: /cheque settlement ledger is unavailable|select the cash or bank ledger/i, message: 'Select an active Cash or Bank ledger for cheque settlement.' },
  { pattern: /issued cheque source must be/i, message: 'Select an active company Bank or Bank OD ledger in Paid From.' },
  { pattern: /party ledger must be active|cheque party must be an active/i, message: 'Select an active party belonging to this company.' },
  { pattern: /contra requires different source and destination/i, message: 'Transfer From and Transfer To must be different accounts.' },
  { pattern: /contra source and destination must be/i, message: 'Select active Cash, Bank, or Bank OD ledgers for the transfer.' },
  { pattern: /contra voucher lines are invalid/i, message: 'The Contra entry is invalid or unbalanced. Review the transfer amount and bank charge.' },
  { pattern: /phone.*10|companies_phone_format|parties_phone_format|accounts_phone_format/i, message: 'Phone number must contain exactly 10 digits.' },
  { pattern: /pan.*9|vat.*9|pan_vat.*check/i, message: 'PAN/VAT number must contain exactly 9 digits.' },
  { pattern: /account number must match the selected bank/i, message: 'The cheque account number must match the selected bank.' },
  { pattern: /account name must contain/i, message: 'Enter a valid ledger name within the allowed length.' },
  { pattern: /item field length is invalid/i, message: 'One or more item fields are too long or empty. Review the item details.' },
  { pattern: /party field length is invalid/i, message: 'One or more party fields are too long or empty. Review the party details.' },
  { pattern: /credit days.*valid range/i, message: 'Credit Days must be a whole number of zero or more.' },
  { pattern: /category hierarchy.*(?:three|four) levels|moving this category would exceed/i, message: 'The category cannot be placed there because the maximum hierarchy depth would be exceeded.' },
  { pattern: /category hierarchy cycle|own parent|moved into itself/i, message: 'A category cannot be placed inside itself or one of its child categories.' },
  { pattern: /company plan (?:is inactive|expired).*read-only/i, message: 'This company plan has expired. Existing data is available read-only until the plan is renewed.' },
  { pattern: /access denied|permission|not authorized|row-level security/i, message: 'You do not have permission to perform this action.' },
  { pattern: /failed to fetch|networkerror|network request|load failed/i, message: 'Could not connect to the server. Check your internet connection and try again.' },
  { pattern: /schema cache|could not find the function|does not exist/i, message: 'The application database is not up to date. Ask an administrator to apply the latest database migration.' },
]

export function userFacingErrorMessage(error: unknown): string | null {
  const rawMessage = safeErrorMessage(error)
  const rule = PUBLIC_ERROR_RULES.find(entry => entry.pattern.test(rawMessage))
  if (rule) return rule.message

  const code = safeErrorCode(error)
  if (code === '23505') return 'A record with the same unique details already exists.'
  if (code === '23503') return 'This record is still being used elsewhere and cannot be changed or removed.'
  if (code === '23514' || code === '22003' || code === '22P02') return 'One or more entered values are invalid. Review the highlighted fields and try again.'
  if (code === '42501') return 'You do not have permission to perform this action.'
  return null
}

export function publicErrorMessage(error: unknown, operation = 'request'): string {
  const correlationId = reportClientError(error, operation)
  const friendlyMessage = userFacingErrorMessage(error)
  if (!friendlyMessage) {
    notifyError(`Could not complete ${operation}`, `Reference: ${correlationId}`)
    return `Could not complete ${operation}. Reference: ${correlationId}`
  }
  notifyError(friendlyMessage, `Reference: ${correlationId}`)
  return `${friendlyMessage} Reference: ${correlationId}`
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  captcha_failed: 'CAPTCHA verification failed. Complete a new challenge and try again.',
  invalid_credentials: 'The email or password is incorrect.',
  email_not_confirmed: 'Confirm your email address before signing in.',
  email_exists: 'An account already exists for this email address.',
  user_already_exists: 'An account already exists for this email address.',
  signup_disabled: 'New account registration is currently unavailable.',
  email_provider_disabled: 'Email and password authentication is currently unavailable.',
  over_request_rate_limit: 'Too many authentication attempts. Wait briefly and try again.',
  over_email_send_rate_limit: 'Too many confirmation emails were requested. Try again later.',
  weak_password: 'Use a stronger password and try again.',
}

export function publicAuthErrorMessage(error: unknown, operation: 'sign in' | 'sign up'): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const knownMessage = AUTH_ERROR_MESSAGES[code]
  if (!knownMessage) return publicErrorMessage(error, operation)
  reportClientError(error, operation)
  return knownMessage
}

export function isInvalidCredentialsError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return code === 'invalid_credentials' || /invalid login credentials/i.test(message)
}

// Audit history needs to show what changed, not retain a second copy of the
// underlying record. Keeping field names preserves that history while avoiding
// phone numbers, addresses, PAN/VAT values, account numbers and free text.
export function auditFieldMarkers(value: unknown): Record<string, '[CHANGED]'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .slice(0, 100)
      .map(key => [key, '[CHANGED]' as const]),
  )
}

export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024

export function backupFileValidationError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size <= 0) return 'The backup file is empty.'
  if (file.size > MAX_BACKUP_FILE_BYTES) return 'Backup files must be 10 MB or smaller.'
  if (!file.name.toLowerCase().endsWith('.json')) return 'Select a KhataERP JSON backup file.'
  if (file.type && file.type !== 'application/json' && file.type !== 'text/json') {
    return 'Select a JSON backup file.'
  }
  return null
}

export function isSafePublicImageUrl(value: string): boolean {
  if (!value.trim()) return true
  if (value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
