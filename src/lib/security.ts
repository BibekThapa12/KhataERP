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

export function publicErrorMessage(error: unknown, operation = 'request'): string {
  const correlationId = reportClientError(error, operation)
  notifyError(`Could not complete ${operation}`, `Reference: ${correlationId}`)
  return `Could not complete ${operation}. Reference: ${correlationId}`
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
