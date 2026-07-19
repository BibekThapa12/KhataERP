import { useRef, useState } from 'react'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { signIn, signUp } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { publicAuthErrorMessage } from '@/lib/security'
import { consumeBrowserAuthAttempt } from '@/lib/authRateLimit'

export function LoginPage() {
  const captchaRef = useRef<HCaptcha>(null)
  const captchaSiteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [panVat, setPanVat] = useState('')
  const [phone, setPhone] = useState('')
  const [vatEnabled, setVatEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!captchaToken) {
      setError('Complete the CAPTCHA challenge before continuing.')
      return
    }
    const action = mode === 'login' ? 'login' : 'signup'
    const rateLimit = consumeBrowserAuthAttempt(action)
    if (!rateLimit.allowed) {
      setLoading(false)
      setError(`Too many attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`)
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password, captchaToken)
        if (error) throw error
      } else {
        const { error } = await signUp(email, password, {
          name: companyName.trim(),
          address: companyAddress.trim(),
          pan_vat: panVat.trim(),
          phone: phone.trim(),
          vat_enabled: vatEnabled,
        }, captchaToken)
        if (error) throw error
        setSuccess('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      }
    } catch (e: unknown) {
      setError(publicAuthErrorMessage(e, mode === 'login' ? 'sign in' : 'sign up'))
    } finally {
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login')
    setError('')
    setSuccess('')
    captchaRef.current?.resetCaptcha()
    setCaptchaToken(null)
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
            <CardTitle>{mode === 'login' ? 'Sign in' : 'Create account'}</CardTitle>
            <CardDescription>
              {mode === 'login' ? 'Access your company books' : 'Set up your Khata account'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="********" required minLength={6} />
              </div>
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
              <div className="flex min-h-[78px] justify-center overflow-hidden" aria-label="CAPTCHA verification">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={captchaSiteKey}
                  onVerify={setCaptchaToken}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => {
                    setCaptchaToken(null)
                    setError('CAPTCHA could not load. Refresh the challenge and try again.')
                  }}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-forest">{success}</p>}
              <Button type="submit" className="w-full" disabled={loading || !captchaToken}>
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
              <button
                type="button"
                onClick={toggleMode}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
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
