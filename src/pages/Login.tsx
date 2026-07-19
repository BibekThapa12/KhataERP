import { useEffect, useState } from 'react'
import { getRememberSession, requestPasswordReset, setRememberSession, signIn, signUp } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isInvalidCredentialsError, publicAuthErrorMessage } from '@/lib/security'
import { clearLoginFailures, consumeBrowserAuthAttempt, getLoginThrottle, recordInvalidLogin } from '@/lib/authRateLimit'

/*
 * CAPTCHA is temporarily disabled. To restore it later, re-enable the
 * @hcaptcha/react-hcaptcha import, captcha ref/token state, challenge JSX, and
 * pass captchaToken through the Supabase auth helpers.
 */

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [panVat, setPanVat] = useState('')
  const [phone, setPhone] = useState('')
  const [vatEnabled, setVatEnabled] = useState(true)
  const [rememberSession, setRememberSessionChoice] = useState(getRememberSession)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loginRetryAfter, setLoginRetryAfter] = useState(() => getLoginThrottle().retryAfterSeconds)

  useEffect(() => {
    if (loginRetryAfter <= 0) return
    const timer = window.setInterval(() => setLoginRetryAfter(getLoginThrottle().retryAfterSeconds), 1000)
    return () => window.clearInterval(timer)
  }, [loginRetryAfter])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    const rateLimit = mode === 'login' ? getLoginThrottle() : consumeBrowserAuthAttempt(mode === 'signup' ? 'signup' : 'password_reset')
    if (!rateLimit.allowed) {
      setLoading(false)
      if (mode === 'login') setLoginRetryAfter(rateLimit.retryAfterSeconds)
      else setError(`Too many attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`)
      return
    }
    setLoading(true)
    try {
      setRememberSession(rememberSession)
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) {
          if (isInvalidCredentialsError(error)) {
            const throttle = recordInvalidLogin()
            setLoginRetryAfter(throttle.retryAfterSeconds)
          }
          throw error
        }
        clearLoginFailures()
        setLoginRetryAfter(0)
      } else if (mode === 'signup') {
        const { error } = await signUp(email, password, {
          name: companyName.trim(),
          address: companyAddress.trim(),
          pan_vat: panVat.trim(),
          phone: phone.trim(),
          vat_enabled: vatEnabled,
        })
        if (error) throw error
        setSuccess('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      } else {
        const { error } = await requestPasswordReset(email.trim())
        if (error) throw error
        setSuccess('If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.')
      }
    } catch (e: unknown) {
      const throttle = mode === 'login' ? getLoginThrottle() : { allowed: true }
      setError(!throttle.allowed ? '' : mode === 'forgot' ? 'Could not request a password reset. Try again later.' : publicAuthErrorMessage(e, mode === 'login' ? 'sign in' : 'sign up'))
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login')
    setError('')
    setSuccess('')
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="font-serif text-4xl font-bold text-[#1B2A4A]">Khata</h1>
          <p className="text-muted-foreground mt-1 text-sm uppercase tracking-widest">ERP for Nepal</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}</CardTitle>
            <CardDescription>
              {mode === 'login' ? 'Access your company books' : mode === 'signup' ? 'Set up your Khata account' : 'Receive a secure password reset link by email'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              {mode !== 'forgot' && <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="********" required minLength={6} />
                {mode === 'login' && <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); setPassword('') }} className="text-xs font-medium text-primary hover:underline">Forgot password?</button>}
              </div>}
              {mode === 'login' && <label htmlFor="remember-session" className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input id="remember-session" type="checkbox" checked={rememberSession} onChange={event => setRememberSessionChoice(event.target.checked)} className="mt-0.5 h-4 w-4" />
                <span><span className="block font-medium">Keep me signed in on this device</span><span className="block text-xs text-muted-foreground">Uncheck this on a shared or public computer.</span></span>
              </label>}
              {mode === 'signup' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="company-name">Company Name</Label>
                    <Input id="company-name" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="My Trading Co." required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company-address">Address</Label>
                    <Textarea id="company-address" value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} rows={2} placeholder="Kathmandu, Nepal" required />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pan-vat">PAN / VAT No.</Label>
                      <Input id="pan-vat" value={panVat} onChange={e => setPanVat(e.target.value)} placeholder="600000000" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="9800000000" required />
                    </div>
                  </div>
                  <label htmlFor="vat-enabled" className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
                    <input
                      id="vat-enabled"
                      type="checkbox"
                      checked={vatEnabled}
                      onChange={e => setVatEnabled(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium">VAT Mode</span>
                      <span className="block text-xs text-muted-foreground">
                        {vatEnabled ? 'Use VAT invoices and VAT reports.' : 'Use internal bookkeeping without VAT fields.'}
                      </span>
                    </span>
                  </label>
                </>
              )}
              {/* Future CAPTCHA challenge mounts here. */}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-forest">{success}</p>}
              {mode === 'login' && loginRetryAfter > 0 && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">Too many incorrect attempts. Try again in {String(Math.floor(loginRetryAfter / 60)).padStart(2, '0')}:{String(loginRetryAfter % 60).padStart(2, '0')}.</p>}
              <Button type="submit" className="w-full" disabled={loading || (mode === 'login' && loginRetryAfter > 0)}>
                {loading ? 'Please wait...' : mode === 'login' && loginRetryAfter > 0 ? `Try again in ${loginRetryAfter}s` : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
              </Button>
              {mode === 'forgot' && <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess('') }} className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground">Back to sign in</button>}
              {mode !== 'forgot' &&
              <button
                type="button"
                onClick={toggleMode}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>}
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Double-entry accounting | VAT optional | NPR | Multi-user
        </p>
      </div>
    </div>
  )
}
