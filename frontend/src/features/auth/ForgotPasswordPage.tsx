import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { Button, LinkButton } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import { AuthShell } from './AuthShell'
import { applyApiError } from './formErrors'
import { forgotSchema, resetCodeSchema } from './schemas'
import type { z } from 'zod'

type Values = z.infer<typeof forgotSchema>
type CodeValues = z.infer<typeof resetCodeSchema>

/** Step 2: the six-digit code from the email and a new password. A new code can be asked for at any time; it is sent at once and only the newest works. */
function CodeStep({ email }: { email: string }) {
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CodeValues>({ resolver: zodResolver(resetCodeSchema) })

  async function onSubmit(values: CodeValues) {
    setFormError(null)
    setNotice(null)
    try {
      await api('/api/auth/reset-password-code', { method: 'POST', body: { email, code: values.code, newPassword: values.newPassword }, auth: false })
      setDone(true)
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  async function resend() {
    setFormError(null)
    setNotice(null)
    setSending(true)
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email }, auth: false })
      // The same words whether or not an account exists, so this reveals nothing about who has one.
      setNotice(`If an account exists for ${email}, a new code was just sent. Check your inbox and your spam folder. Earlier codes no longer work.`)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'We could not send a new code. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">Your password has been changed. You have been signed out everywhere.</Alert>
        <LinkButton to="/login" size="lg" className="w-full">
          Sign in
        </LinkButton>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Alert tone="success">If an account exists for {email}, a 6-digit code and a reset link are on their way. The code works for 30 minutes.</Alert>
      {formError && <Alert>{formError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} error={errors.code?.message} {...register('code')} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Change password
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={() => void resend()} loading={sending}>
        {sending ? 'Sending a new code…' : 'Send a new code'}
      </Button>
      <p className="text-sm text-muted">You can also open the link in the email instead of entering the code.</p>
    </form>
  )
}

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(forgotSchema) })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: values, auth: false })
      setSentTo(values.email)
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sentTo ? undefined : 'Enter your email and we will send you a 6-digit code and a link to choose a new password.'}
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <CodeStep email={sentTo} />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          {formError && <Alert>{formError}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Send reset code
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
