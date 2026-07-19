import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, updateRecoveredPassword } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { newPasswordValidationError } from '@/lib/passwordRecovery'

const RECOVERY_MARKER = 'khataerp:password-recovery'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const markRecovery = () => {
      try { window.sessionStorage.setItem(RECOVERY_MARKER, '1') } catch { /* unavailable */ }
      if (active) { setAuthorized(true); setChecking(false) }
    }
    if (window.location.hash.includes('type=recovery')) markRecovery()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') markRecovery()
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      let marked = false
      try { marked = window.sessionStorage.getItem(RECOVERY_MARKER) === '1' } catch { /* unavailable */ }
      setAuthorized(Boolean(session && marked))
      setChecking(false)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const validationError = newPasswordValidationError(password, confirmPassword)
    if (validationError) return setError(validationError)
    setSaving(true)
    try {
      const { error: updateError } = await updateRecoveredPassword(password)
      if (updateError) throw updateError
      try { window.sessionStorage.removeItem(RECOVERY_MARKER) } catch { /* unavailable */ }
      await supabase.auth.signOut({ scope: 'local' })
      setComplete(true)
      setPassword('')
      setConfirmPassword('')
    } catch {
      setError('Could not update the password. The recovery link may have expired; request a new one.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="flex min-h-dvh items-center justify-center bg-background p-4"><Card className="w-full max-w-md">
    <CardHeader><CardTitle>{complete ? 'Password updated' : 'Choose a new password'}</CardTitle><CardDescription>{complete ? 'Your old session has been closed. Sign in with your new password.' : 'Use a strong password you do not use elsewhere.'}</CardDescription></CardHeader>
    <CardContent>
      {checking ? <p className="text-sm text-muted-foreground">Verifying recovery link...</p> : complete ? <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>Continue to sign in</Button> : !authorized ? <div className="space-y-3"><p className="text-sm text-destructive">This recovery link is invalid or expired.</p><Button className="w-full" variant="outline" onClick={() => navigate('/login', { replace: true })}>Request another link</Button></div> : <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="new-password">New Password</Label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></div>
        <div className="space-y-1.5"><Label htmlFor="confirm-password">Confirm Password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} required /></div>
        <p className="text-xs text-muted-foreground">At least 8 characters with a letter and a number.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Updating password...' : 'Update password'}</Button>
      </form>}
    </CardContent>
  </Card></div>
}
