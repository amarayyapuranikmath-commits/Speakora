import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../../test/utils'
import { CallProvider } from '../call/CallContext'
import { SettingsPage } from './SettingsPage'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const profile = { displayName: 'Ana', country: 'ES', timeZone: 'Europe/Madrid', nativeLanguage: 'es', englishLevel: 'B1', learningGoals: [], interests: ['travel'], onboardingCompleted: true }
const topics = [{ slug: 'travel', name: 'Travel', description: null, prompts: [] }]
const prefs = { matchSimilarLevel: true, showCountry: true, showLevel: true, notifyEmailReminders: false, allowPartnerRequests: true, aiCoachConsent: true }
const base = (language: string | null = null) => ({
  'POST /api/auth/refresh': session(),
  'GET /api/profile': profile,
  'GET /api/topics': topics,
  'GET /api/preferences': prefs,
  'GET /api/blocks': [],
  'GET /api/coach/preferences': { explanationLanguage: language },
})

async function openAiTab() {
  renderApp(<CallProvider><SettingsPage /></CallProvider>)
  await userEvent.click(await screen.findByRole('tab', { name: 'AI tutor' }))
}

describe('Settings: AI tutor', () => {
  it('shows the saved language (Simple English by default) and offers the languages the product promises', async () => {
    mockApi(base())
    await openAiTab()
    const select = await screen.findByLabelText('Explain in')
    expect(select).toHaveValue('English')
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)
    expect(labels).toEqual(['Simple English', 'Kannada', 'Hindi', 'Telugu', 'Tamil', 'Another language'])
    expect(screen.getAllByText(/saved to your account/i).length).toBeGreaterThan(0)
  })

  it('saves a chosen language to the account, and Simple English clears it', async () => {
    const mock = mockApi({ ...base(), 'PUT /api/coach/preferences': { explanationLanguage: 'Hindi' } })
    await openAiTab()
    await userEvent.selectOptions(await screen.findByLabelText('Explain in'), 'Hindi')
    await waitFor(() => expect(mock.calls.find((c) => c.method === 'PUT' && c.url === '/api/coach/preferences')?.body).toEqual({ explanationLanguage: 'Hindi' }))
    await userEvent.selectOptions(screen.getByLabelText('Explain in'), 'English')
    await waitFor(() => expect(mock.calls.filter((c) => c.method === 'PUT' && c.url === '/api/coach/preferences').pop()?.body).toEqual({ explanationLanguage: null }))
  })

  it('another language is typed in and saved when the field is left', async () => {
    const mock = mockApi({ ...base(), 'PUT /api/coach/preferences': { explanationLanguage: 'Malayalam' } })
    await openAiTab()
    await userEvent.selectOptions(await screen.findByLabelText('Explain in'), 'Other')
    const field = await screen.findByLabelText('Language name')
    await userEvent.type(field, 'Malayalam')
    expect(mock.calls.some((c) => c.method === 'PUT' && c.url === '/api/coach/preferences')).toBe(false) // nothing saved while typing
    await userEvent.tab()
    await waitFor(() => expect(mock.calls.find((c) => c.method === 'PUT' && c.url === '/api/coach/preferences')?.body).toEqual({ explanationLanguage: 'Malayalam' }))
  })

  it('a saved other language is shown in the box', async () => {
    mockApi(base('Malayalam'))
    await openAiTab()
    expect(await screen.findByLabelText('Explain in')).toHaveValue('Other')
    expect(await screen.findByLabelText('Language name')).toHaveValue('Malayalam')
  })

  it('shows the server\'s message when the language is refused', async () => {
    mockApi({ ...base(), 'PUT /api/coach/preferences': () => errorResponse(400, 'INVALID_LANGUAGE', 'Use a plain language name.') })
    await openAiTab()
    await userEvent.selectOptions(await screen.findByLabelText('Explain in'), 'Tamil')
    expect(await screen.findByText('Use a plain language name.')).toBeInTheDocument()
  })

  it('does not ask the server for anything before the tab is opened', async () => {
    const mock = mockApi(base())
    renderApp(<CallProvider><SettingsPage /></CallProvider>)
    await screen.findByRole('tab', { name: 'AI tutor' })
    expect(mock.calls.some((c) => c.url === '/api/coach/preferences')).toBe(false)
  })
})
