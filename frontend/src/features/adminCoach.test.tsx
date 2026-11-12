import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../test/utils'
import { AdminPage } from './admin/AdminPage'
import { AdminRoute, ProtectedRoute } from './auth/ProtectedRoute'
import { CoachPage } from './coach/CoachPage'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const report = (over = {}) => ({
  id: 'r1', createdAt: '2026-11-08T10:00:00Z', status: 'OPEN', reason: 'HARASSMENT', details: 'Was rude', callId: 'c1',
  reporterName: 'Ana', reportedUserId: 'u2', reportedName: 'Sam', reportedStatus: 'ACTIVE', openReportsAgainst: 2, totalReportsAgainst: 3,
  resolutionNote: null, resolvedAt: null, ...over,
})
const page = <T,>(items: T[]) => ({ items, page: 0, size: 15, totalElements: items.length, totalPages: 1 })
const adminUser = (over = {}) => ({
  id: 'u2', email: 'sam@example.com', displayName: 'Sam', status: 'ACTIVE', role: 'USER', createdAt: '2026-11-01T10:00:00Z',
  suspendedReason: null, openReportsAgainst: 0, totalReportsAgainst: 0, ...over,
})

describe('AdminRoute', () => {
  const tree = () => (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<h1>Dashboard</h1>} />
        <Route element={<AdminRoute />}>
          <Route path="/app/admin" element={<h1>Moderation</h1>} />
        </Route>
      </Route>
    </Routes>
  )

  it('keeps ordinary users out of the moderation screen', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ role: 'USER' }) })
    renderApp(tree(), { route: '/app/admin' })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('lets administrators in', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ role: 'ADMIN' }) })
    renderApp(tree(), { route: '/app/admin' })
    expect(await screen.findByRole('heading', { name: 'Moderation' })).toBeInTheDocument()
  })
})

describe('AdminPage', () => {
  it('lists open reports with context for the decision', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ role: 'ADMIN' }), 'GET /api/admin/reports': page([report()]) })
    renderApp(<AdminPage />)
    expect(await screen.findByText('Sam')).toBeInTheDocument()
    expect(screen.getByText(/2 open of 3 total/)).toBeInTheDocument()
    expect(screen.getByText('Was rude')).toBeInTheDocument()
  })

  it('suspending from a report requires a reason and sends the decision', async () => {
    const mock = mockApi({
      'POST /api/auth/refresh': session({ role: 'ADMIN' }),
      'GET /api/admin/reports': page([report()]),
      'POST /api/admin/reports/r1/resolve': undefined,
    })
    renderApp(<AdminPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend user' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Suspend user' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Confirmed abuse')
    await userEvent.click(confirm)
    await waitFor(() => expect(mock.calls.some((c) => c.url === '/api/admin/reports/r1/resolve')).toBe(true))
    expect(mock.calls.find((c) => c.url === '/api/admin/reports/r1/resolve')?.body).toEqual({ action: 'SUSPEND', note: 'Confirmed abuse' })
  })

  it('dismissing sends DISMISS and shows server errors', async () => {
    mockApi({
      'POST /api/auth/refresh': session({ role: 'ADMIN' }),
      'GET /api/admin/reports': page([report()]),
      'POST /api/admin/reports/r1/resolve': () => errorResponse(409, 'REPORT_ALREADY_RESOLVED', 'This report has already been resolved.'),
    })
    renderApp(<AdminPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already been resolved')
  })

  it('shows an empty state when nothing needs review', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ role: 'ADMIN' }), 'GET /api/admin/reports': page([]) })
    renderApp(<AdminPage />)
    expect(await screen.findByText('No open reports')).toBeInTheDocument()
  })

  it('users tab searches, suspends active accounts and unsuspends suspended ones, never offering to suspend admins', async () => {
    const mock = mockApi({
      'POST /api/auth/refresh': session({ role: 'ADMIN' }),
      'GET /api/admin/reports': page([]),
      'GET /api/admin/users': page([
        adminUser(),
        adminUser({ id: 'u3', displayName: 'Lee', email: 'lee@example.com', status: 'SUSPENDED', suspendedReason: 'Spam' }),
        adminUser({ id: 'u4', displayName: 'Boss', email: 'boss@example.com', role: 'ADMIN' }),
      ]),
      'POST /api/admin/users/u3/unsuspend': undefined,
      'POST /api/admin/users/u2/suspend': undefined,
    })
    renderApp(<AdminPage />)
    await userEvent.click(await screen.findByRole('tab', { name: 'users' }))
    expect(await screen.findByText('sam@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Reason: Spam/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(1) // not for the suspended user, not for the admin
    await userEvent.click(screen.getByRole('button', { name: 'Unsuspend' }))
    await waitFor(() => expect(mock.calls.some((c) => c.url === '/api/admin/users/u3/unsuspend')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Reason'), 'Scam')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspend user' }))
    await waitFor(() => expect(mock.calls.find((c) => c.url === '/api/admin/users/u2/suspend')?.body).toEqual({ reason: 'Scam' }))
    await userEvent.type(screen.getByLabelText('Search by email or name'), 'sam')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes('q=sam'))).toBe(true))
  })
})

describe('AdminPage system tab', () => {
  const systemReport = {
    baseUrl: 'http://localhost:5173', https: false, cookieSecure: false, corsOrigins: ['http://localhost:5173'], smtpConfigured: true,
    mailFrom: 'no-reply@speak.test', coachConfigured: false, coachModel: 'm', turnConfigured: true, turnUrls: ['turn:t.example.com'], forceRelay: false,
    warnings: ['APP_BASE_URL is not https.', 'No AI provider key.'],
  }

  it('shows warnings and configuration without secrets, and runs each real test', async () => {
    const mock = mockApi({
      'POST /api/auth/refresh': session({ role: 'ADMIN' }),
      'GET /api/admin/reports': page([]),
      'GET /api/admin/system': systemReport,
      'POST /api/admin/system/test-email': { name: 'email', ok: true, detail: 'Sent to ana@example.com from no-reply@speak.test.' },
      'POST /api/admin/system/test-coach': { name: 'coach', ok: false, detail: 'No GROQ_API_KEY is configured.' },
      'POST /api/admin/system/test-turn': () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong.'),
    })
    renderApp(<AdminPage />)
    await userEvent.click(await screen.findByRole('tab', { name: 'system' }))
    expect(await screen.findByText('APP_BASE_URL is not https.')).toBeInTheDocument()
    expect(screen.getByText(/sending as no-reply@speak.test/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }))
    expect(await screen.findByText(/Sent to ana@example.com/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test AI coach' }))
    expect(await screen.findByText('No GROQ_API_KEY is configured.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test TURN' }))
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
    expect(mock.calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/admin/system/test-')).map((c) => c.url)).toEqual([
      '/api/admin/system/test-email', '/api/admin/system/test-coach', '/api/admin/system/test-turn',
    ])
  })
})

describe('CoachPage (availability and consent)', () => {
  it('says plainly when no AI provider is configured', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/coach/status': { available: false, consent: false, dailyLimit: 20 } })
    renderApp(<CoachPage />)
    expect(await screen.findByText('The coach is not enabled')).toBeInTheDocument()
    expect(screen.queryByLabelText('Message to the coach')).not.toBeInTheDocument()
  })

  it('asks for explicit consent before anything can be submitted', async () => {
    const mock = mockApi({
      'POST /api/auth/refresh': session(),
      'GET /api/coach/status': { available: true, consent: false, dailyLimit: 20 },
      'GET /api/preferences': { matchSimilarLevel: true, showCountry: true, showLevel: true, notifyEmailReminders: false, aiCoachConsent: false },
      'PUT /api/preferences': {},
    })
    renderApp(<CoachPage />)
    expect(await screen.findByText(/the text of your conversation/i)).toBeInTheDocument()
    expect(screen.getByText(/never recorded or analysed/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Message to the coach')).not.toBeInTheDocument()
    expect(screen.getByText(/not saved/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /i agree/i })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /i agree/i }))
    await waitFor(() => expect(mock.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ aiCoachConsent: true }))
  })
})
