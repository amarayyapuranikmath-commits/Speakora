import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../../test/utils'
import { Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { RegisterPage } from './RegisterPage'
import { VerifyEmailPage } from './VerifyEmailPage'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('verifying the email with the six-digit code (the second step of signing up)', () => {
  it('asks a signed-in, unverified account for the code, says where it was sent, and verifies it', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': session({ emailVerified: false, email: 'ana@example.com' }), 'POST /api/auth/verify-email-code': {} })
    renderApp(<VerifyEmailPage />, { route: '/verify-email' })
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByText(/One last step to finish creating your account/)).toBeInTheDocument()
    await userEvent.type(await screen.findByLabelText('6-digit code'), '482913')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    expect(await screen.findByText('Your email address is verified.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.url.endsWith('/verify-email-code'))?.body).toEqual({ code: '482913' })
  })

  it('refuses anything but six digits before it asks the server', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': session({ emailVerified: false }) })
    renderApp(<VerifyEmailPage />, { route: '/verify-email' })
    await userEvent.type(await screen.findByLabelText('6-digit code'), '12ab')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.url.endsWith('/verify-email-code'))).toBe(false)
  })

  it('shows the server message for a wrong code and keeps the form', async () => {
    mockApi({
      'POST /api/auth/refresh': session({ emailVerified: false }),
      'POST /api/auth/verify-email-code': () => errorResponse(400, 'INVALID_CODE', 'That code is not right. Check it and try again.'),
    })
    renderApp(<VerifyEmailPage />, { route: '/verify-email' })
    await userEvent.type(await screen.findByLabelText('6-digit code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
    expect(await screen.findByText('That code is not right. Check it and try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument()
  })

  describe('asking for a new code', () => {
    it('is offered at once (no waiting time), sends immediately, and shows loading, then a message that names the address and says earlier codes stop working', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => { release = r })
      const api = mockApi({
        'POST /api/auth/refresh': session({ emailVerified: false, email: 'ana@example.com' }),
        'POST /api/auth/resend-verification': async () => { await gate; return new Response(null, { status: 202 }) },
      })
      renderApp(<VerifyEmailPage />, { route: '/verify-email' })
      const button = await screen.findByRole('button', { name: 'Send a new code' }) // right after sign-up: no countdown first
      expect(screen.queryByText(/You can ask for a new code in/)).toBeNull()
      await userEvent.click(button)
      expect(await screen.findByRole('button', { name: /Sending a new code/ })).toBeDisabled() // loading state
      release()
      expect(await screen.findByText(/A new code was sent to ana@example.com\. Check your inbox and your spam folder\. Earlier codes no longer work\./)).toBeInTheDocument()
      expect(api.calls.filter((c) => c.url.endsWith('/resend-verification'))).toHaveLength(1)
      // and again straight away: nothing is silently ignored
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }))
      await waitFor(() => expect(api.calls.filter((c) => c.url.endsWith('/resend-verification'))).toHaveLength(2))
    })

    it('says clearly when the email service could not send it', async () => {
      mockApi({
        'POST /api/auth/refresh': session({ emailVerified: false }),
        'POST /api/auth/resend-verification': () => errorResponse(503, 'EMAIL_SEND_FAILED', 'We could not reach the email service. Please try again in a moment.'),
      })
      renderApp(<VerifyEmailPage />, { route: '/verify-email' })
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }))
      expect(await screen.findByText('We could not reach the email service. Please try again in a moment.')).toBeInTheDocument()
      expect(screen.queryByText(/A new code was sent/)).toBeNull() // never a success message after a failure
      expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled() // and it can be tried again
    })

    it('explains the limit when too many codes were asked for, and says how long to wait', async () => {
      mockApi({
        'POST /api/auth/refresh': session({ emailVerified: false }),
        'POST /api/auth/resend-verification': () => errorResponse(429, 'TOO_MANY_CODES', 'You have asked for several codes in a short time. To keep email delivery reliable, please wait about 15 minutes before asking again. The newest code you received still works.'),
      })
      renderApp(<VerifyEmailPage />, { route: '/verify-email' })
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }))
      expect(await screen.findByText(/please wait about 15 minutes before asking again/)).toBeInTheDocument()
    })

    it('tells the person when the network is down instead of doing nothing', async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/auth/refresh')) return new Response(JSON.stringify(session({ emailVerified: false })), { status: 200, headers: { 'Content-Type': 'application/json' } })
        throw new TypeError('Failed to fetch')
      }))
      renderApp(<VerifyEmailPage />, { route: '/verify-email' })
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }))
      expect(await screen.findByText(/We could not send a new code\. Please check your connection and try again\./)).toBeInTheDocument()
    })
  })

  it('goes to onboarding after sign-up, asks for no code and makes no verification request', async () => {
    const api = mockApi({
      'POST /api/auth/refresh': () => errorResponse(401, 'UNAUTHENTICATED', 'no'),
      'POST /api/auth/register': session({ emailVerified: false, onboardingCompleted: false, email: 'ana@example.com' }),
    })
    renderApp(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/onboarding" element={<h1>Onboarding</h1>} />
      </Routes>,
      { route: '/register' },
    )
    await userEvent.type(await screen.findByLabelText('Display name'), 'Ana')
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-05-01')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rdOK')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument()
    expect(screen.queryByText(/6-digit code/)).toBeNull()
    expect(api.calls.some((c) => /verif/.test(c.url))).toBe(false)
  })

  it('lets someone who typed the wrong address sign out and start again', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': session({ emailVerified: false }), 'POST /api/auth/logout': {} })
    renderApp(<VerifyEmailPage />, { route: '/verify-email' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out and start again' }))
    await waitFor(() => expect(api.calls.some((c) => c.url.endsWith('/api/auth/logout'))).toBe(true))
  })

  it('does not show the code form to someone who is already verified', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ emailVerified: true }) })
    renderApp(<VerifyEmailPage />, { route: '/verify-email' })
    expect(await screen.findByText('Your email address is already verified.')).toBeInTheDocument()
    expect(screen.queryByLabelText('6-digit code')).toBeNull()
  })
})

describe('resetting the password with the six-digit code', () => {
  const refreshFails = () => errorResponse(401, 'UNAUTHENTICATED', 'no')

  async function requestCode() {
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }))
    await screen.findByLabelText('6-digit code')
  }

  it('sends the code and a new password for the email that was asked about', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': refreshFails, 'POST /api/auth/forgot-password': {}, 'POST /api/auth/reset-password-code': {} })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await requestCode()
    expect(screen.getByText(/a 6-digit code and a reset link are on their way/i)).toBeInTheDocument() // the same words whether or not the account exists
    await userEvent.type(screen.getByLabelText('6-digit code'), '190377')
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument()
    // the reset code is requested for, and later checked against, the address that was typed: no other address is involved
    expect(api.calls.find((c) => c.url.endsWith('/forgot-password'))?.body).toEqual({ email: 'ana@example.com' })
    expect(api.calls.find((c) => c.url.endsWith('/reset-password-code'))?.body).toEqual({ email: 'ana@example.com', code: '190377', newPassword: 'NewPassw0rd' })
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('checks the code and the password rules before it asks the server', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': refreshFails, 'POST /api/auth/forgot-password': {} })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await requestCode()
    await userEvent.type(screen.getByLabelText('6-digit code'), '19')
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument()
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.url.endsWith('/reset-password-code'))).toBe(false)
  })

  it('shows one generic message for a wrong or expired code', async () => {
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/forgot-password': {},
      'POST /api/auth/reset-password-code': () => errorResponse(400, 'INVALID_CODE', 'That code is not right or has expired. Check it, or ask for a new one.'),
    })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await requestCode()
    await userEvent.type(screen.getByLabelText('6-digit code'), '000000')
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('That code is not right or has expired. Check it, or ask for a new one.')).toBeInTheDocument()
  })
})

describe('forgotten password: asking for a new code', () => {
  const refreshFails = () => errorResponse(401, 'UNAUTHENTICATED', 'no')

  async function toCodeStep() {
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }))
    await screen.findByLabelText('6-digit code')
  }

  it('sends a new code at once to the same address, with loading and a message that does not reveal whether the account exists', async () => {
    const api = mockApi({ 'POST /api/auth/refresh': refreshFails, 'POST /api/auth/forgot-password': {} })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await toCodeStep()
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' })) // no waiting time
    expect(await screen.findByText(/If an account exists for ana@example\.com, a new code was just sent\. Check your inbox and your spam folder\. Earlier codes no longer work\./)).toBeInTheDocument()
    const sent = api.calls.filter((c) => c.url.endsWith('/forgot-password'))
    expect(sent).toHaveLength(2) // the first request and the resend
    expect(sent[1].body).toEqual({ email: 'ana@example.com' })
    await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' })) // and again at once
    await waitFor(() => expect(api.calls.filter((c) => c.url.endsWith('/forgot-password'))).toHaveLength(3))
  })

  it('says clearly when the email service could not send the new code', async () => {
    let first = true
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/forgot-password': () => {
        if (first) { first = false; return new Response(null, { status: 202 }) }
        return errorResponse(503, 'EMAIL_SEND_FAILED', 'The email service did not answer in time. Please try again in a moment.')
      },
    })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await toCodeStep()
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    expect(await screen.findByText('The email service did not answer in time. Please try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByText(/a new code was just sent/)).toBeNull()
  })

  it('shows the failure on the first request too, instead of a page that promises an email', async () => {
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/forgot-password': () => errorResponse(503, 'EMAIL_SEND_FAILED', 'We could not reach the email service. Please try again in a moment.'),
    })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }))
    expect(await screen.findByText('We could not reach the email service. Please try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByLabelText('6-digit code')).toBeNull()
  })

  it('explains the limit when too many codes were asked for', async () => {
    let first = true
    mockApi({
      'POST /api/auth/refresh': refreshFails,
      'POST /api/auth/forgot-password': () => {
        if (first) { first = false; return new Response(null, { status: 202 }) }
        return errorResponse(429, 'TOO_MANY_CODES', 'You have asked for several codes in a short time. To keep email delivery reliable, please wait about 15 minutes before asking again. The newest code you received still works.')
      },
    })
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password' })
    await toCodeStep()
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    expect(await screen.findByText(/wait about 15 minutes/)).toBeInTheDocument()
  })
})
