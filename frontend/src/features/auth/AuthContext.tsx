import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, refreshSession, sessionWasRejected, setAccessToken, setSessionLostHandler } from '../../lib/api'
import type { SessionResponse, UserSummary } from '../../lib/types'

type Status = 'loading' | 'authenticated' | 'anonymous'

export interface RegisterInput {
  email: string
  password: string
  displayName: string
  dateOfBirth: string
}

interface AuthContextValue {
  status: Status
  user: UserSummary | null
  /** Why the last session ended: the user chose to (sign out, delete account) or it expired / was revoked. */
  endedBy: 'user' | 'expired' | null
  /** Set right after sign-up when the first code email could not be sent; the code screen shows it. */
  verificationEmailProblem: string | null
  clearVerificationEmailProblem: () => void
  login: (email: string, password: string) => Promise<UserSummary>
  register: (input: RegisterInput) => Promise<UserSummary>
  logout: () => Promise<void>
  updateUser: (patch: Partial<UserSummary>) => void
  /** Re-reads the signed-in user from the server (e.g. after verifying an email address). */
  reloadUser: () => Promise<void>
  /** Used after password change, which re-issues the session. */
  applySession: (session: SessionResponse) => void
  /** Used after account deletion: the server already ended the session. */
  clearSession: (by?: 'user' | 'expired') => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserSummary | null>(null)
  const [endedBy, setEndedBy] = useState<'user' | 'expired' | null>(null)
  const [verificationEmailProblem, setVerificationEmailProblem] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const applySession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken)
    setUser(session.user)
    setEndedBy(null)
    setStatus('authenticated')
  }, [])

  const clearSession = useCallback((by: 'user' | 'expired' = 'expired') => {
    setAccessToken(null)
    setUser(null)
    setEndedBy(by)
    setVerificationEmailProblem(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let session = await refreshSession()
      // A dropped connection or a server hiccup at start-up is not "signed out": try once more before showing the login page.
      if (!session && !sessionWasRejected() && !cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        if (!cancelled) session = await refreshSession()
      }
      if (cancelled) return
      if (session) applySession(session)
      else setStatus('anonymous')
    })()
    setSessionLostHandler(() => clearSession('expired'))
    return () => {
      cancelled = true
      setSessionLostHandler(null)
    }
  }, [applySession, clearSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      endedBy,
      verificationEmailProblem,
      clearVerificationEmailProblem: () => setVerificationEmailProblem(null),
      async login(email, password) {
        const session = await api<SessionResponse>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false })
        applySession(session)
        return session.user
      },
      async register(input) {
        const session = await api<SessionResponse>('/api/auth/register', { method: 'POST', body: input, auth: false })
        setVerificationEmailProblem(session.verificationEmailProblem ?? null)
        applySession(session)
        return session.user
      },
      async logout() {
        try {
          await api('/api/auth/logout', { method: 'POST', auth: false })
        } finally {
          clearSession('user')
        }
      },
      updateUser(patch) {
        setUser((u) => (u ? { ...u, ...patch } : u))
      },
      async reloadUser() {
        try {
          setUser(await api<UserSummary>('/api/me'))
        } catch {
          // not signed in, or the server is unreachable: keep what we have
        }
      },
      applySession,
      clearSession,
    }),
    [status, user, endedBy, verificationEmailProblem, applySession, clearSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
