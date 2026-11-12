import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '../../lib/api'

/** Maps server-side field errors onto the form; returns a message for anything that is not field-specific. */
export function applyApiError<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): string | null {
  if (error instanceof ApiError) {
    const fields = Object.entries(error.details)
    if (fields.length > 0) {
      fields.forEach(([field, message]) => setError(field as Path<T>, { type: 'server', message }))
      return null
    }
    return error.message
  }
  return 'We could not reach the server. Check your connection and try again.'
}
