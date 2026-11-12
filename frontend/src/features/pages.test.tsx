import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteTitle } from '../components/RouteTitle'
import { Dialog } from '../components/ui/Dialog'
import { setAccessToken } from '../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../test/utils'
import { CallProvider } from './call/CallContext'
import { LandingPage } from './landing/LandingPage'
import { OnboardingPage } from './onboarding/OnboardingPage'
import { SettingsPage } from './settings/SettingsPage'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const topics = [
  { slug: 'travel', name: 'Travel', description: null, prompts: [] },
  { slug: 'technology', name: 'Technology', description: null, prompts: [] },
]
const blankProfile = { displayName: 'Ana', country: null, timeZone: null, nativeLanguage: null, englishLevel: null, learningGoals: [], interests: [], onboardingCompleted: false }
const fullProfile = { ...blankProfile, country: 'ES', timeZone: 'Europe/Madrid', nativeLanguage: 'es', englishLevel: 'B1', interests: ['travel'], onboardingCompleted: true }
const prefs = { matchSimilarLevel: true, showCountry: true, showLevel: true, notifyEmailReminders: false }

describe('OnboardingPage', () => {
  function setup(extra: Record<string, unknown> = {}) {
    return mockApi({
      'POST /api/auth/refresh': session({ onboardingCompleted: false }),
      'GET /api/profile': blankProfile,
      'GET /api/topics': topics,
      ...extra,
    })
  }
  const renderOnboarding = () =>
    renderApp(
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/app" element={<h1>Dashboard</h1>} />
      </Routes>,
      { route: '/onboarding' },
    )

  it('will not advance until the step is valid', async () => {
    setup()
    renderOnboarding()
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Choose your country.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /set up your profile/i })).toBeInTheDocument()
  })

  it('walks through all three steps and saves the profile', async () => {
    const mock = setup({ 'POST /api/profile/onboarding': { ...fullProfile } })
    renderOnboarding()
    await userEvent.selectOptions(await screen.findByLabelText('Country'), 'ES')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await userEvent.selectOptions(await screen.findByLabelText('Native language'), 'es')
    await userEvent.click(screen.getByRole('radio', { name: /B1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await userEvent.click(within(await screen.findByRole('group', { name: /conversation interests/i })).getByRole('button', { name: 'Travel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(mock.calls.find((c) => c.url === '/api/profile/onboarding')?.body).toMatchObject({
      displayName: 'Ana', country: 'ES', nativeLanguage: 'es', englishLevel: 'B1', interests: ['travel'],
    })
  })

  it('requires at least one interest and shows server errors', async () => {
    setup({ 'POST /api/profile/onboarding': () => errorResponse(400, 'INVALID_INTEREST', 'One or more interests are not recognised.') })
    renderOnboarding()
    await userEvent.selectOptions(await screen.findByLabelText('Country'), 'ES')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.selectOptions(await screen.findByLabelText('Native language'), 'es')
    await userEvent.click(screen.getByRole('radio', { name: /B1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }))
    expect(await screen.findByText('Choose at least one interest.')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: /conversation interests/i })).getByRole('button', { name: 'Travel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not recognised')
  })
})

describe('SettingsPage', () => {
  const base = () => ({
    'POST /api/auth/refresh': session(),
    'GET /api/profile': fullProfile,
    'GET /api/topics': topics,
    'GET /api/preferences': prefs,
    'GET /api/blocks': [{ userId: 'x1', displayName: 'Pat', blockedAt: '2026-11-01T10:00:00Z' }],
  })

  it('tabs are keyboard operable', async () => {
    mockApi(base())
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    const profileTab = await screen.findByRole('tab', { name: 'Profile' })
    expect(profileTab).toHaveAttribute('aria-selected', 'true')
    profileTab.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Blocked users' })).toHaveAttribute('aria-selected', 'true')
  })

  it('saves profile changes via PUT', async () => {
    const mock = mockApi({ ...base(), 'PUT /api/profile': fullProfile })
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    const name = await screen.findByLabelText('Display name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Ana Maria')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(mock.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ displayName: 'Ana Maria', country: 'ES', englishLevel: 'B1', interests: ['travel'] })
  })

  it('privacy toggles persist the complete preference set', async () => {
    const mock = mockApi({ ...base(), 'PUT /api/preferences': { ...prefs, showCountry: false } })
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    await userEvent.click(await screen.findByRole('tab', { name: 'Privacy' }))
    const toggle = await screen.findByRole('switch', { name: 'Show my country' })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() => expect(mock.calls.some((c) => c.method === 'PUT' && c.url === '/api/preferences')).toBe(true))
    expect(mock.calls.find((c) => c.method === 'PUT')?.body).toEqual({ ...prefs, showCountry: false })
  })

  it('lists blocked users and unblocks them', async () => {
    const mock = mockApi({ ...base(), 'DELETE /api/blocks/x1': undefined })
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    await userEvent.click(await screen.findByRole('tab', { name: 'Blocked users' }))
    expect(await screen.findByText('Pat')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unblock' }))
    await waitFor(() => expect(mock.calls.some((c) => c.method === 'DELETE' && c.url === '/api/blocks/x1')).toBe(true))
  })

  it('account deletion needs a password and surfaces wrong-password errors', async () => {
    const mock = mockApi({ ...base(), 'DELETE /api/account': () => errorResponse(400, 'WRONG_PASSWORD', 'Your password is incorrect.') })
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    await userEvent.click(await screen.findByRole('tab', { name: 'Account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(screen.getByRole('button', { name: 'Permanently delete' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Password'), 'nope-nope-1')
    await userEvent.click(screen.getByRole('button', { name: 'Permanently delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')
    expect(mock.calls.find((c) => c.method === 'DELETE')?.body).toEqual({ password: 'nope-nope-1' })
  })
})

describe('LandingPage', () => {
  it('links to registration and safety, and makes no invented claims of user numbers', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Speak English with real people.')
    expect(screen.getAllByRole('link', { name: /create an account/i })[0]).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /read more about safety and privacy/i })).toHaveAttribute('href', '/safety')
    expect(document.body.textContent).not.toMatch(/\d+\s*(\+|k|million)?\s*(users|learners|members)/i)
  })
})

describe('Dialog', () => {
  it('moves focus in, traps Tab and closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Test dialog" onClose={onClose}>
        <button>First</button>
        <button>Last</button>
      </Dialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toHaveFocus()
    await userEvent.tab() // close button
    await userEvent.tab() // First
    await userEvent.tab() // Last
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    await userEvent.tab() // wraps to the close button
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('RouteTitle', () => {
  it('sets the document title per route', () => {
    render(
      <MemoryRouter initialEntries={['/app/history']}>
        <RouteTitle />
      </MemoryRouter>,
    )
    expect(document.title).toMatch(/^Call history · /)
  })
})
