export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Same rule as the server: 8 to 72 characters with a letter and a number. */
export function passwordProblem(v: string): string | null {
  if (v.length < 8) return 'Use at least 8 characters.'
  if (v.length > 72) return 'Use at most 72 characters.'
  if (!/[A-Za-z]/.test(v)) return 'Include at least one letter.'
  if (!/\d/.test(v)) return 'Include at least one number.'
  return null
}

/** `YYYY-MM-DD` that is a real calendar date. */
export function parseDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null
}

export function isAtLeast18(isoDate: string, today = new Date()): boolean {
  const dob = parseDate(isoDate)
  if (!dob) return false
  const cutoff = Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate())
  return dob.getTime() <= cutoff
}
