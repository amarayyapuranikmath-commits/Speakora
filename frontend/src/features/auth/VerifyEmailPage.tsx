import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { z } from 'zod'
import { Button, LinkButton } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Alert, Spinner } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import { useAuth } from './AuthContext'
import { AuthShell } from './AuthShell'
import { applyApiError } from './formErrors'
import { codeSchema } from './schemas'

type CodeValues = z.infer<typeof codeSchema>

/**
 * The second step of signing up: enter the six-digit code emailed to the address the account was made with. Signing up is not finished,
 * and nothing else in the app opens, until this is done (see ProtectedRoute). A new code can be asked for at any time: it is sent at once, and
 * only the newest one works. Someone who typed the wrong address can sign out and start again.
 */
function CodeStep({ email, firstEmailProblem, onVerified, onWrongAddress }: { email: string; firstEmailProblem: string | null; onVerified: () => void; onWrongAddress: () => void }) {
  const [formError, setFormError] = useState<string | null>(firstEmailProblem)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })

  async function onSubmit(values: CodeValues) {
    setFormError(null)
    setNotice(null)
    try {
      await api('/api/auth/verify-email-code', { method: 'POST', body: { code: values.code } })
      onVerified()
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  async function resend() {
    setFormError(null)
    setNotice(null)
    setSending(true)
    try {
      await api('/api/auth/resend-verification', { method: 'POST' })
      setNotice(`A new code was sent to ${email}. Check your inbox and your spam folder. Earlier codes no longer work.`)
    } catch (e) {
      // The server says what went wrong: the email service could not send it, or too many codes were asked for in a short time (with how long to wait).
      setFormError(e instanceof ApiError ? e.message : 'We could not send a new code. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <p className="text-sm text-muted">
        {firstEmailProblem ? 'We could not send the code to ' : 'We sent a 6-digit code to '}
        <strong className="font-semibold text-ink">{email}</strong>
        {firstEmailProblem ? '.' : '. It works for 30 minutes. Check your inbox and your spam folder.'}
      </p>
      {formError && <Alert>{formError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <TextField
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...register('code')}
      />
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Verify and continue
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={() => void resend()} loading={sending}>
        {sending ? 'Sending a new code…' : 'Send a new code'}
      </Button>
      <p className="text-center text-sm text-muted">
        Wrong address?{' '}
        <button type="button" onClick={onWrongAddress} className="font-medium text-accent hover:underline">
          Sign out and start again
        </button>
      </p>
    </form>
  )
}

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token')
  const navigate = useNavigate()
  const { status, user, reloadUser, logout, verificationEmailProblem } = useAuth()
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error')
  const [message, setMessage] = useState('This verification link is missing its token.')
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    api('/api/auth/verify-email', { method: 'POST', body: { token }, auth: false })
      .then(() => setState('ok'))
      .catch((e) => {
        setMessage(e instanceof ApiError ? e.message : 'We could not verify your email. Please try again.')
        setState('error')
      })
  }, [token])

  // Pull the fresh user once both facts are true: the email is verified and the session has finished loading.
  const reloaded = useRef(false)
  useEffect(() => {
    if (state === 'ok' && status === 'authenticated' && !reloaded.current) {
      reloaded.current = true // reloadUser changes identity with the user, so run exactly once
      void reloadUser()
    }
  }, [state, status, reloadUser])

  // Verified and signed in: carry on into the app (it sends a new account on to onboarding).
  useEffect(() => {
    if (state === 'ok' && status === 'authenticated' && user?.emailVerified) navigate('/app', { replace: true })
  }, [state, status, user?.emailVerified, navigate])

  const next = status === 'authenticated' ? { to: '/app', label: 'Continue' } : { to: '/login', label: 'Sign in' }
  // No link token: a signed-in account that has not verified yet enters the code here.
  const askForCode = !token && status === 'authenticated' && user !== null && !user.emailVerified && state === 'error'

  if (status === 'loading') return <Spinner label="Loading your account" />

  return (
    <AuthShell title={askForCode ? 'Verify your email' : 'Email verification'} subtitle={askForCode ? 'One last step to finish creating your account.' : undefined}>
      {state === 'pending' && <Spinner label="Verifying" />}
      {state === 'ok' && (
        <div className="space-y-5">
          <Alert tone="success">Your email address is verified.</Alert>
          <LinkButton to={next.to} size="lg" className="w-full">
            {next.label}
          </LinkButton>
        </div>
      )}
      {askForCode && user && (
        <CodeStep
          email={user.email}
          firstEmailProblem={verificationEmailProblem}
          onVerified={() => setState('ok')}
          onWrongAddress={() => void logout().then(() => navigate('/register', { replace: true }))}
        />
      )}
      {state === 'error' && !askForCode && (
        <div className="space-y-5">
          <Alert>{!token && status === 'authenticated' && user?.emailVerified ? 'Your email address is already verified.' : message}</Alert>
          <LinkButton to={next.to} variant="secondary" size="lg" className="w-full">
            {next.label}
          </LinkButton>
        </div>
      )}
    </AuthShell>
  )
}
