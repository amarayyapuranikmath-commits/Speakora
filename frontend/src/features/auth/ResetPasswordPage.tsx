import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router-dom'
import type { z } from 'zod'
import { Button, LinkButton } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/feedback'
import { api } from '../../lib/api'
import { AuthShell } from './AuthShell'
import { applyApiError } from './formErrors'
import { resetSchema } from './schemas'

type Values = z.infer<typeof resetSchema>

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token')
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(resetSchema) })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword: values.newPassword }, auth: false })
      setDone(true)
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  if (!token) {
    return (
      <AuthShell title="Link not valid" subtitle="This password reset link is missing its token.">
        <LinkButton to="/forgot-password">Request a new link</LinkButton>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div className="space-y-5">
          <Alert tone="success">Your password has been changed. You have been signed out everywhere.</Alert>
          <LinkButton to="/login" size="lg" className="w-full">
            Sign in
          </LinkButton>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          {formError && <Alert>{formError}</Alert>}
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
        </form>
      )}
    </AuthShell>
  )
}
