import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.')

export function isAtLeast18(isoDate: string, today = new Date()): boolean {
  const dob = new Date(isoDate)
  if (Number.isNaN(dob.getTime())) return false
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()))
  return dob.getTime() <= cutoff.getTime()
}

export const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(40, 'Use at most 40 characters.'),
  email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
  dateOfBirth: z
    .string()
    .min(1, 'Enter your date of birth.')
    .refine((v) => isAtLeast18(v), 'You must be at least 18 years old to use this service.'),
  password: passwordSchema,
  agree: z.boolean().refine((v) => v, 'Please confirm to continue.'),
})

export const forgotSchema = z.object({ email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.') })

export const resetSchema = z.object({ newPassword: passwordSchema })

const sixDigits = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.')
export const codeSchema = z.object({ code: sixDigits })
export const resetCodeSchema = z.object({ code: sixDigits, newPassword: passwordSchema })

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
