type LimitedAuthAction = 'signup' | 'password_reset'

interface AttemptWindow {
  startedAt: number
  attempts: number
}

interface LoginFailureState {
  attempts: number
  lastFailureAt: number
  lockedUntil: number
}

const LOGIN_FAILURE_KEY = 'khataerp:auth-attempts:login'
const LOGIN_FAILURE_LIMIT = 5
const LOGIN_LOCK_MS = 60_000
const FAILURE_MEMORY_MS = 15 * 60_000
const keyFor = (action: LimitedAuthAction) => `khataerp:auth-attempts:${action}`

function readLoginState(): LoginFailureState {
  try {
    const stored = window.sessionStorage.getItem(LOGIN_FAILURE_KEY)
    return stored ? JSON.parse(stored) as LoginFailureState : { attempts: 0, lastFailureAt: 0, lockedUntil: 0 }
  } catch {
    return { attempts: 0, lastFailureAt: 0, lockedUntil: 0 }
  }
}

export function getLoginThrottle(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const state = readLoginState()
  if (state.lockedUntil > now) return { allowed: false, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) }
  if (state.lockedUntil || (state.lastFailureAt && now - state.lastFailureAt >= FAILURE_MEMORY_MS)) clearLoginFailures()
  return { allowed: true, retryAfterSeconds: 0 }
}

export function recordInvalidLogin(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const previous = readLoginState()
  const attempts = previous.lastFailureAt && now - previous.lastFailureAt < FAILURE_MEMORY_MS ? previous.attempts + 1 : 1
  const locked = attempts >= LOGIN_FAILURE_LIMIT
  const next: LoginFailureState = { attempts: locked ? 0 : attempts, lastFailureAt: now, lockedUntil: locked ? now + LOGIN_LOCK_MS : 0 }
  try { window.sessionStorage.setItem(LOGIN_FAILURE_KEY, JSON.stringify(next)) } catch { /* unavailable */ }
  return locked ? { allowed: false, retryAfterSeconds: 60 } : { allowed: true, retryAfterSeconds: 0 }
}

export function clearLoginFailures() {
  try { window.sessionStorage.removeItem(LOGIN_FAILURE_KEY) } catch { /* unavailable */ }
}

export function consumeBrowserAuthAttempt(action: LimitedAuthAction): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const limit = 3
  const windowMs = 60 * 60_000
  const key = keyFor(action)

  try {
    const stored = window.sessionStorage.getItem(key)
    const parsed = stored ? JSON.parse(stored) as AttemptWindow : null
    const current = parsed && now - parsed.startedAt < windowMs ? parsed : { startedAt: now, attempts: 0 }
    if (current.attempts >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000)) }
    window.sessionStorage.setItem(key, JSON.stringify({ ...current, attempts: current.attempts + 1 }))
    return { allowed: true, retryAfterSeconds: 0 }
  } catch {
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
