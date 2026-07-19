type AuthAction = 'login' | 'signup'

interface AttemptWindow {
  startedAt: number
  attempts: number
}

const keyFor = (action: AuthAction) => `khataerp:auth-attempts:${action}`

export function consumeBrowserAuthAttempt(action: AuthAction): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const limit = action === 'login' ? 5 : 3
  const windowMs = action === 'login' ? 60_000 : 60 * 60_000
  const key = keyFor(action)

  try {
    const stored = window.sessionStorage.getItem(key)
    const parsed = stored ? JSON.parse(stored) as AttemptWindow : null
    const current = parsed && now - parsed.startedAt < windowMs
      ? parsed
      : { startedAt: now, attempts: 0 }
    if (current.attempts >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000)) }
    }
    window.sessionStorage.setItem(key, JSON.stringify({ ...current, attempts: current.attempts + 1 }))
    return { allowed: true, retryAfterSeconds: 0 }
  } catch {
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
