import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { brand } from '../config/brand'

const TITLES: [string, string][] = [
  ['/app/talk', 'Find a partner'],
  ['/app/topics', 'Topics'],
  ['/app/coach', 'Speaking coach'],
  ['/app/admin', 'Moderation'],
  ['/app/history', 'Call history'],
  ['/app/progress', 'Progress'],
  ['/app/settings', 'Settings'],
  ['/app', 'Home'],
  ['/onboarding', 'Set up your profile'],
  ['/login', 'Sign in'],
  ['/register', 'Create account'],
  ['/forgot-password', 'Reset password'],
  ['/reset-password', 'Choose a new password'],
  ['/verify-email', 'Verify email'],
  ['/safety', 'Safety and privacy'],
]

/** Keeps document.title in sync with the route so screen-reader users hear where they are after navigation. */
export function RouteTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const match = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'))
    document.title = match ? `${match[1]} · ${brand.name}` : brand.name
  }, [pathname])
  return null
}
