import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../../components/ui/feedback'
import { useAuth } from './AuthContext'

/** Guards routes behind a real session. The onboarding page is the one route that requires an un-onboarded user. */
export function ProtectedRoute({ onboarding = false }: { onboarding?: boolean }) {
  const { status, user, endedBy } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <Spinner label="Loading your account" />
  // Signing out or deleting the account on purpose goes home; an expired or revoked session goes to the login page.
  if ((status === 'anonymous' || !user) && endedBy === 'user') return <Navigate to="/" replace />
  if (status === 'anonymous' || !user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (!onboarding && !user.onboardingCompleted) return <Navigate to="/onboarding" replace />
  if (onboarding && user.onboardingCompleted) return <Navigate to="/app" replace />
  return <Outlet />
}

/** Moderation pages: the server enforces ADMIN on every call; this only keeps everyone else out of the screen. */
export function AdminRoute() {
  const { user } = useAuth()
  return user?.role === 'ADMIN' ? <Outlet /> : <Navigate to="/app" replace />
}

/** Login/register pages bounce already-signed-in users into the app. */
export function GuestRoute() {
  const { status, user } = useAuth()
  if (status === 'loading') return <Spinner label="Loading" />
  if (status === 'authenticated' && user) return <Navigate to={user.onboardingCompleted ? '/app' : '/onboarding'} replace />
  return <Outlet />
}
