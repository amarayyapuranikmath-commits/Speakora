import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/feedback'
import { useAuth } from './AuthContext'
import { AuthShell } from './AuthShell'
import { applyApiError } from './formErrors'
import { registerSchema, type RegisterValues } from './schemas'

export function RegisterPage() {
  const { register: signUp } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), defaultValues: { agree: false } })

  async function onSubmit({ agree: _agree, ...values }: RegisterValues) {
    setFormError(null)
    try {
      await signUp(values)
      navigate('/verify-email', { replace: true })
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. You must be 18 or older."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Display name" autoComplete="nickname" hint="Partners will see this name." error={errors.displayName?.message} {...register('displayName')} />
        <TextField label="Email" type="email" autoComplete="email" hint="Never shown to other users." error={errors.email?.message} {...register('email')} />
        <TextField
          label="Date of birth"
          type="date"
          autoComplete="bday"
          hint="Used only to confirm you are 18 or older."
          error={errors.dateOfBirth?.message}
          {...register('dateOfBirth')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" {...register('agree')} />
            <span className="text-muted">
              I am 18 or older and I agree to follow the{' '}
              <Link to="/safety" className="font-medium text-accent hover:underline" target="_blank">
                community guidelines
              </Link>
              .
            </span>
          </label>
          {errors.agree && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {errors.agree.message}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  )
}
