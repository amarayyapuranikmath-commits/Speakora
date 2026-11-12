import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initials } from '../../lib/initials'
import { setAccessToken } from '../../lib/api'
import type { PartnerSummary } from '../../lib/types'
import { errorResponse, mockApi } from '../../test/utils'
import { PartnersPage } from './PartnersPage'
import { resultMessage } from './partnerText'
import { RequestLayer } from './RequestLayer'

const callMock = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../call/CallContext', async (orig) => ({ ...(await orig<typeof import('../call/CallContext')>()), useCall: () => callMock.value }))

const actions = () => ({
  requestConnect: vi.fn(), cancelRequest: vi.fn(), acceptRequest: vi.fn(), declineRequest: vi.fn(), dismissRequestResult: vi.fn(),
})
const baseCall = { phase: 'idle', micError: null, notice: null, incoming: null, outgoing: null, requestResult: null }

const partner = (over: Partial<PartnerSummary>): PartnerSummary => ({
  ref: 'ref-' + (over.displayName ?? 'x'), displayName: 'Pat', englishLevel: 'B2', country: 'GB', conversations: 3,
  lastConversationAt: '2026-11-03T10:00:00Z', lastCallId: 'call-1', friendStatus: 'NONE', canAddFriend: true, ...over,
})

function setCall(over: Record<string, unknown> = {}) {
  const a = actions()
  callMock.value = { ...baseCall, ...a, ...over }
  return a
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><PartnersPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PartnersPage', () => {
  beforeEach(() => {
    mockApi({
      'GET /api/partners': [
        partner({ displayName: 'Pat' }),
        partner({ displayName: 'Olga', friendStatus: 'FRIENDS', canAddFriend: false, englishLevel: null, country: null, conversations: 1 }),
        partner({ displayName: 'Ivan', friendStatus: 'REQUEST_SENT', canAddFriend: false }),
        partner({ displayName: 'Quinn', friendStatus: 'REQUEST_RECEIVED', canAddFriend: false }),
      ],
    })
  })

  it('shows each previous partner with level, last conversation date and count', async () => {
    setCall()
    renderPage()
    const pat = (await screen.findByText('Pat')).closest('li')!
    expect(pat).toHaveTextContent('English B2')
    expect(pat).toHaveTextContent('Last talked')
    expect(pat).toHaveTextContent('3 conversations')
    const olga = screen.getByText('Olga').closest('li')!
    expect(olga).toHaveTextContent('1 conversation')
    expect(olga).not.toHaveTextContent('English')
  })

  it('offers Add friend instead of Connect, and shows where each person stands', async () => {
    setCall()
    renderPage()
    await screen.findByText('Pat')
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add friend Pat' })).toBeEnabled()
    expect(screen.getByText('Olga').closest('li')).toHaveTextContent('Friends')
    expect(screen.queryByRole('button', { name: 'Add friend Olga' })).toBeNull()
    expect(screen.getByText('Ivan').closest('li')).toHaveTextContent('Request sent')
    expect(screen.getByText('Quinn').closest('li')).toHaveTextContent('Respond to request')
  })

  it('Add friend sends the request for that person, using only the opaque handle', async () => {
    setCall()
    const api = mockApi({
      'GET /api/partners': [partner({ displayName: 'Pat' })],
      'POST /api/friends/requests': undefined,
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Add friend Pat' }))
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/friends/requests', body: { partnerRef: 'ref-Pat' } }))
  })

  it('shows the reason when the server refuses (for example after a decline)', async () => {
    setCall()
    mockApi({
      'GET /api/partners': [partner({ displayName: 'Pat' })],
      'POST /api/friends/requests': () => errorResponse(429, 'FRIEND_REQUEST_COOLDOWN', 'You cannot send this person a request right now.'),
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Add friend Pat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot send this person a request right now.')
  })

  it('offers block and report for a partner', async () => {
    setCall()
    renderPage()
    await screen.findByText('Pat')
    await userEvent.click(screen.getByRole('button', { name: 'More options for Pat' }))
    expect(screen.getByRole('button', { name: /Block Pat/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report/ })).toBeInTheDocument()
  })

  it('explains an empty list', async () => {
    mockApi({ 'GET /api/partners': [] })
    setCall()
    renderPage()
    expect(await screen.findByText('No previous partners yet')).toBeInTheDocument()
  })
})

describe('RequestLayer', () => {
  it('asks you before anything happens, with who is asking', () => {
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat', englishLevel: 'B2', country: 'GB' }, expiresAt: Date.now() + 40_000 } })
    render(<RequestLayer />)
    const dialog = screen.getByRole('dialog', { name: 'A friend wants to talk' })
    expect(dialog).toHaveTextContent('Pat')
    expect(dialog).toHaveTextContent('English B2 · GB')
    expect(dialog).toHaveTextContent(/Nothing starts unless you accept/)
    expect(a.acceptRequest).not.toHaveBeenCalled()
  })

  it('Accept and Not now do what they say', async () => {
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat' }, expiresAt: Date.now() + 40_000 } })
    render(<RequestLayer />)
    await userEvent.click(screen.getByRole('button', { name: /Accept and talk/ }))
    expect(a.acceptRequest).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(a.declineRequest).toHaveBeenCalledTimes(1)
  })

  it('Escape declines', async () => {
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat' }, expiresAt: Date.now() + 40_000 } })
    render(<RequestLayer />)
    await userEvent.keyboard('{Escape}')
    expect(a.declineRequest).toHaveBeenCalled()
  })

  it('an unanswered prompt declines itself when its time is up', async () => {
    vi.useFakeTimers()
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat' }, expiresAt: Date.now() + 3_000 } })
    render(<RequestLayer />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/Answer within 3s/)
    await act(async () => { vi.advanceTimersByTime(3_500) })
    expect(a.declineRequest).toHaveBeenCalled()
  })

  it('shows who you are asking and lets you cancel once the server has confirmed it', async () => {
    const a = setCall({ outgoing: { requestId: 'r9', partnerName: 'Pat', expiresAt: Date.now() + 30_000 } })
    render(<RequestLayer />)
    expect(screen.getByText('Asking Pat to talk…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(a.cancelRequest).toHaveBeenCalled()
  })

  it('cannot cancel in the instant before the server has confirmed the request', () => {
    setCall({ outgoing: { requestId: null, partnerName: 'Pat', expiresAt: null } })
    render(<RequestLayer />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it.each([
    ['DECLINED', null, "Pat can't talk right now."],
    ['EXPIRED', null, "Pat didn't answer."],
    ['UNAVAILABLE', 'OFFLINE', 'Pat is offline.'],
    ['UNAVAILABLE', 'BUSY', 'Pat is in another call'],
    ['UNAVAILABLE', 'NOT_ACCEPTING', "Pat isn't accepting calls"],
    ['UNAVAILABLE', 'LINK', 'We could not reach the server'],
  ])('tells you plainly what happened: %s %s', async (status, reason, text) => {
    const a = setCall({ requestResult: { status, reason, partnerName: 'Pat' } })
    render(<RequestLayer />)
    expect(screen.getByRole('status')).toHaveTextContent(text)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(a.dismissRequestResult).toHaveBeenCalled()
  })

  it('says nothing when you cancelled it yourself', async () => {
    const a = setCall({ requestResult: { status: 'CANCELLED', reason: null, partnerName: 'Pat' } })
    render(<RequestLayer />)
    await waitFor(() => expect(a.dismissRequestResult).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing when there is nothing to show', () => {
    setCall()
    const { container } = render(<RequestLayer />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('helpers', () => {
  it('initials are one or two letters', () => {
    expect(initials('Pat')).toBe('PA')
    expect(initials('Ana Maria Lopez')).toBe('AL')
    expect(initials('  ')).toBe('?')
    expect(initials('éva')).toBe('ÉV')
  })

  it('has no message for a request the user cancelled', () => {
    expect(resultMessage({ status: 'CANCELLED', reason: null, partnerName: 'Pat' })).toBeNull()
  })
})
