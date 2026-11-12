import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../../test/utils'
import { useAuth } from './AuthContext'
import { GuestRoute, ProtectedRoute } from './ProtectedRoute'
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'
import { isAtLeast18, registerSchema } from './schemas'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const refreshFails = () => errorResponse(401, 'UNAUTHENTICATED', 'no')

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function AppRoutes() {
  return (
    <>
      <Where />
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedRoute onboarding />}>
          <Route path="/onboarding" element={<h1>Onboarding</h1>} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<h1>Dashboard</h1>} />
        </Route>
        <Route path="/verify-email" element={<h1>Verify screen</h1>} />
      </Routes>
    </>
  )
}

describe('age validation', () => {
  const today = new Date('2026-11-09T12:00:00Z')
  it('accepts exactly 18 and rejects younger', () => {
    expect(isAtLeast18('2008-11-09', today)).toBe(true)
    expect(isAtLeast18('2008-11-10', today)).toBe(false)
    expect(isAtLeast18('', today)).toBe(false)
  })
  it('register schema requires adult, strong password and confirmation', () => {
    const base = { displayName: 'Ana', email: 'a@b.co', dateOfBirth: '1990-01-01', password: 'Passw0rdOK', agree: true }
    expect(registerSchema.safeParse(base).success).toBe(true)
    expect(registerSchema.safeParse({ ...base, password: 'onlyletters' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, password: 'Sh0rt' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, agree: false }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, dateOfBirth: '2030-01-01' }).success).toBe(false)
  })
})

describe('routing guards', () => {
  it('sends anonymous visitors to the login page', async () => {
    mockApi({ 'POST /api/auth/refresh': refreshFails })
    renderApp(<AppRoutes />, { route: '/app' })
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login'))
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })

  it('restores a session from the refresh cookie and shows the app', async () => {
    mockApi({ 'POST /api/auth/refresh': session() })
    renderApp(<AppRoutes />, { route: '/app' })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('redirects users who have not finished onboarding', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ onboardingCompleted: false }) })
    renderApp(<AppRoutes />, { route: '/app' })
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument()
  })

  it('keeps an account that has not verified its email on the code screen: nothing else opens until the code is entered', async () => {
    for (const route of ['/app', '/onboarding', '/login']) {
      const unverified = session({ emailVerified: false, onboardingCompleted: route !== '/onboarding' })
      mockApi({ 'POST /api/auth/refresh': unverified })
      const { unmount } = renderApp(<AppRoutes />, { route })
      expect(await screen.findByRole('heading', { name: 'Verify screen' })).toBeInTheDocument()
      unmount()
    }
  })

  it('keeps signed-in users away from the login page', async () => {
    mockApi({ 'POST /api/auth/refresh': session() })
    renderApp(<AppRoutes />, { route: '/login' })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('LoginPage', () => {
  it('has a small "Forgot password?" link that opens the reset flow, and nothing else about recovery', async () => {
    mockApi({ 'POST /api/auth/refresh': refreshFails })
    renderApp(<AppRoutes />, { route: '/login' })
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('validates before calling the server', async () => {
    const mock = mockApi({ 'POST /api/auth/refresh': refreshFails })
    renderApp(<AppRoutes />, { route: '/login' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(mock.calls.some((c) => c.url === '/api/auth/login')).toBe(false)
  })

  it('signs in and lands on the dashboard', async () => {
    const mock = mockApi({ 'POST /api/auth/refresh': refreshFails, 'POST /api/auth/login': session() })
    renderApp(<AppRoutes />, { route: '/login' })
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rdOK')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(mock.calls.find((c) => c.url === '/api/auth/login')?.body).toEqual({ email: 'ana@example.com', password: 'Passw0rdOK' })
  })

  it('shows the server’s message for bad credentials', async () => {
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/login': () => errorResponse(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.'),
    })
    renderApp(<AppRoutes />, { route: '/login' })
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })
})

describe('RegisterPage', () => {
  async function fillValid() {
    await userEvent.type(await screen.findByLabelText('Display name'), 'Ana')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-01')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rdOK')
  }

  it('blocks under-18 sign-ups on the client', async () => {
    const mock = mockApi({ 'POST /api/auth/refresh': refreshFails })
    renderApp(<AppRoutes />, { route: '/register' })
    await userEvent.type(await screen.findByLabelText('Display name'), 'Ana')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Date of birth'), '2015-05-01')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rdOK')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/at least 18 years old/i)).toBeInTheDocument()
    expect(mock.calls.some((c) => c.url === '/api/auth/register')).toBe(false)
  })

  it('registers and goes straight to the email code screen (signing up is finished only after the code), without sending the confirmation flag', async () => {
    const mock = mockApi({ 'POST /api/auth/refresh': refreshFails, 'POST /api/auth/register': session({ onboardingCompleted: false, emailVerified: false }) })
    renderApp(<AppRoutes />, { route: '/register' })
    await fillValid()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Verify screen' })).toBeInTheDocument()
    expect(mock.calls.find((c) => c.url === '/api/auth/register')?.body).toEqual({
      displayName: 'Ana', email: 'ana@example.com', dateOfBirth: '1990-05-01', password: 'Passw0rdOK',
    })
  })

  it('maps server field errors onto the form', async () => {
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/register': () => errorResponse(409, 'EMAIL_TAKEN', 'An account with this email already exists.'),
    })
    renderApp(<AppRoutes />, { route: '/register' })
    await fillValid()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})

describe('how a session ends', () => {
  function SignOutButton() {
    const { logout } = useAuth()
    return <button onClick={() => void logout()}>Sign out</button>
  }
  const tree = () => (
    <>
      <Where />
      <Routes>
        <Route path="/" element={<h1>Home page</h1>} />
        <Route path="/login" element={<h1>Login page</h1>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<SignOutButton />} />
        </Route>
      </Routes>
    </>
  )

  it('signing out on purpose goes to the home page, not the login page', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'POST /api/auth/logout': undefined })
    renderApp(tree(), { route: '/app' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument()
  })

  it('an expired or revoked session goes to the login page', async () => {
    mockApi({
      'POST /api/auth/refresh': () => errorResponse(401, 'UNAUTHENTICATED', 'no'),
    })
    renderApp(tree(), { route: '/app' })
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
  })
})