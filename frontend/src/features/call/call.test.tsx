import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi } from '../../test/utils'
import type { CallState } from './CallContext'
import { CallControls } from './CallControls'
import { FeedbackForm } from './FeedbackForm'
import { FindPartnerPage } from './FindPartnerPage'
import { QualityIndicator } from './QualityIndicator'

const callMock = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('./CallContext', async (orig) => ({ ...(await orig<typeof import('./CallContext')>()), useCall: () => callMock.value }))

const baseState: CallState = {
  phase: 'idle', callId: null, partner: null, topic: null, requestedTopic: null, quality: 'unknown', muted: false, speakerOn: true,
  connectedAt: null, micError: null, micId: null, microphones: [], notice: null, endInfo: null, link: 'closed', remoteStream: null,
}
const actions = () => ({
  start: vi.fn(), cancelSearch: vi.fn(), endCall: vi.fn(), skip: vi.fn(), toggleMute: vi.fn(), toggleSpeaker: vi.fn(), selectMicrophone: vi.fn(), dismissEnded: vi.fn(), reset: vi.fn(),
})

function renderPage(state: Partial<CallState>, route = '/app/talk') {
  const a = actions()
  callMock.value = { ...baseState, ...state, ...a }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <FindPartnerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return a
}

const topics = [
  { slug: 'travel', name: 'Travel', description: 'Places', prompts: ['Where next?'] },
  { slug: 'general', name: 'General discussion', description: null, prompts: ['Anything new?'] },
]

beforeEach(() => {
  mockApi({
    'GET /api/topics': topics,
    'GET /api/profile': { displayName: 'Ana', englishLevel: 'B1', interests: [], learningGoals: [], country: 'ES', timeZone: 'UTC', nativeLanguage: 'es', onboardingCompleted: true },
  })
})
afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('CallControls', () => {
  it('every control triggers its real action and reflects state', async () => {
    const h = { onToggleMute: vi.fn(), onToggleSpeaker: vi.fn(), onSkip: vi.fn(), onEnd: vi.fn() }
    const { rerender } = render(<CallControls muted={false} speakerOn {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
    await userEvent.click(screen.getByRole('button', { name: 'Speaker' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await userEvent.click(screen.getByRole('button', { name: 'End call' }))
    expect(h.onToggleMute).toHaveBeenCalledOnce()
    expect(h.onToggleSpeaker).toHaveBeenCalledOnce()
    expect(h.onSkip).toHaveBeenCalledOnce()
    expect(h.onEnd).toHaveBeenCalledOnce()

    rerender(<CallControls muted speakerOn={false} {...h} />)
    expect(screen.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Speaker' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('QualityIndicator', () => {
  it('exposes the quality to assistive tech', () => {
    render(<QualityIndicator quality="poor" />)
    expect(screen.getByRole('status', { name: 'Poor connection' })).toBeInTheDocument()
  })
})

describe('FindPartnerPage', () => {
  it('starts matching with the chosen topic', async () => {
    const a = renderPage({}, '/app/talk?topic=travel')
    expect(await screen.findByRole('radio', { name: /Travel/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /start looking/i }))
    expect(a.start).toHaveBeenCalledWith('travel')
  })

  it('starts with no topic by default', async () => {
    const a = renderPage({})
    await userEvent.click(await screen.findByRole('button', { name: /start looking/i }))
    expect(a.start).toHaveBeenCalledWith(null)
  })

  it('explains a blocked microphone', async () => {
    renderPage({ micError: 'denied' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/microphone access is blocked/i)
  })

  it('lets the user cancel while searching', async () => {
    const a = renderPage({ phase: 'searching' })
    expect(screen.getByRole('status')).toHaveTextContent('Looking for a partner')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(a.cancelSearch).toHaveBeenCalledOnce()
  })

  it('shows the partner, status and working controls during a call', async () => {
    const a = renderPage({ phase: 'connected', callId: 'c1', connectedAt: Date.now(), partner: { displayName: 'Sam', country: 'GB', englishLevel: 'B2' }, quality: 'good' })
    expect(screen.getByRole('heading', { name: 'Sam' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Good connection' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'End call' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(a.endCall).toHaveBeenCalledOnce()
    expect(a.skip).toHaveBeenCalledOnce()
  })

  it('shows reconnecting state', () => {
    renderPage({ phase: 'reconnecting', callId: 'c1', partner: { displayName: 'Sam' } })
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument()
  })

  it('opens conversation prompts only on request', async () => {
    renderPage({ phase: 'connected', callId: 'c1', connectedAt: Date.now(), partner: { displayName: 'Sam' }, topic: { slug: 'travel', name: 'Travel', prompts: ['Where next?', 'Best trip?'] } })
    expect(screen.queryByText('Where next?')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /something to talk about/i }))
    expect(screen.getByText('Where next?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next prompt' }))
    expect(screen.getByText('Best trip?')).toBeInTheDocument()
  })

  it('after a completed call offers feedback, safety actions and another match', async () => {
    const a = renderPage({
      phase: 'ended', partner: { displayName: 'Sam' }, requestedTopic: 'travel',
      endInfo: { callId: 'c1', status: 'COMPLETED', endReason: 'ENDED', durationSeconds: 125, endedBy: 'you' },
    })
    expect(screen.getByRole('heading', { name: 'Call ended' })).toBeInTheDocument()
    expect(screen.getByText(/2 min/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit feedback' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /block sam/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find another partner' }))
    expect(a.dismissEnded).toHaveBeenCalled()
    expect(a.start).toHaveBeenCalledWith('travel')
  })

  it('does not ask for feedback when the call never connected', () => {
    renderPage({ phase: 'ended', partner: { displayName: 'Sam' }, endInfo: { callId: 'c1', status: 'FAILED', endReason: 'FAILED', durationSeconds: null, endedBy: 'system' } })
    expect(screen.getByRole('heading', { name: /could not connect/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit feedback' })).not.toBeInTheDocument()
  })
})

describe('FeedbackForm', () => {
  function renderForm() {
    const queryClient = new QueryClient()
    return render(
      <QueryClientProvider client={queryClient}>
        <FeedbackForm callId="c1" />
      </QueryClientProvider>,
    )
  }

  it('requires a rating, then submits rating, respect and comment', async () => {
    const mock = mockApi({ 'POST /api/calls/c1/feedback': undefined })
    renderForm()
    const submit = screen.getByRole('button', { name: 'Submit feedback' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: '4 out of 5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await userEvent.type(screen.getByLabelText(/comments/i), 'Friendly')
    await userEvent.click(submit)
    expect(await screen.findByText(/feedback has been saved/i)).toBeInTheDocument()
    expect(mock.calls[0].body).toEqual({ rating: 4, partnerWasRespectful: true, comment: 'Friendly' })
  })

  it('treats an already-submitted conflict as success', async () => {
    mockApi({ 'POST /api/calls/c1/feedback': () => errorResponse(409, 'FEEDBACK_EXISTS', 'already') })
    renderForm()
    await userEvent.click(screen.getByRole('radio', { name: '5 out of 5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    await waitFor(() => expect(screen.getByText(/feedback has been saved/i)).toBeInTheDocument())
  })

  it('shows an error and keeps the form when saving fails', async () => {
    mockApi({ 'POST /api/calls/c1/feedback': () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.') })
    renderForm()
    await userEvent.click(screen.getByRole('radio', { name: '3 out of 5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Submit feedback' })).toBeEnabled()
  })
})
