import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getBaseUrl, refreshSession, setAccessToken, setSessionLostHandler, storeSession } from '../../lib/api'
import { clearRefreshToken, getRefreshToken } from '../../lib/storage'
import type { UserSummary } from '../../lib/types'

type Status = 'loading' | 'authenticated' | 'anonymous'

export interface RegisterInput {
  email: string
  password: string
  displayName: string
  dateOfBirth: string
}

interface MobileSession {
  accessToken: string
  expiresInSeconds: number
  user: UserSummary
  refreshToken: string
  /** Sign-up only: why the first code email could not be sent (the account was still made). */
  verificationEmailProblem?: string | null
}

interface AuthValue {
  status: Status
  user: UserSummary | null
  /** True when the last sign-out was the user's own choice (so the app goes to the welcome screen, not an "expired" notice). */
  /** Set right after sign-up when the first code email could not be sent; the code screen shows it. */
  verificationEmailProblem: string | null
  login: (email: string, password: string) => Promise<UserSummary>
  register: (input: RegisterInput) => Promise<UserSummary>
  logout: () => Promise<void>
  updateUser: (patch: Partial<UserSummary>) => void
  reloadUser: () => Promise<void>
  applySession: (session: MobileSession) => Promise<void>
  clearSession: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserSummary | null>(null)
  const [verificationEmailProblem, setVerificationEmailProblem] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const applySession = useCallback(async (session: MobileSession) => {
    await storeSession(session)
    setUser(session.user)
    setStatus('authenticated')
  }, [])

  const clearSession = useCallback(async () => {
    setAccessToken(null)
    await clearRefreshToken()
    setUser(null)
    setVerificationEmailProblem(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    refreshSession().then((session) => {
      if (cancelled) return
      if (session) {
        setUser(session.user)
        setStatus('authenticated')
      } else {
        setStatus('anonymous')
      }
    })
    setSessionLostHandler(() => void clearSession())
    return () => {
      cancelled = true
      setSessionLostHandler(null)
    }
  }, [clearSession])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      verificationEmailProblem,
      async login(email, password) {
        const session = await api<MobileSession>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false })
        await applySession(session)
        return session.user
      },
      async register(input) {
        const session = await api<MobileSession>('/api/auth/register', { method: 'POST', body: input, auth: false })
        setVerificationEmailProblem(session.verificationEmailProblem ?? null)
        await applySession(session)
        return session.user
      },
      async logout() {
        try {
          const token = await getRefreshToken()
          if (token) {
            await fetch(`${getBaseUrl()}/api/auth/logout`, { method: 'POST', headers: { 'X-Client-Type': 'mobile', 'X-Refresh-Token': token } })
          }
        } catch {
          // offline: still sign out locally; the server revokes the token when it is next seen
        } finally {
          await clearSession()
        }
      },
      updateUser(patch) {
        setUser((u) => (u ? { ...u, ...patch } : u))
      },
      async reloadUser() {
        try {
          setUser(await api<UserSummary>('/api/me'))
        } catch {
          // keep what we have
        }
      },
      applySession,
      clearSession,
    }),
    [status, user, verificationEmailProblem, applySession, clearSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
