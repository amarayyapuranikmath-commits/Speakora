import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { liveEvents } from '../../lib/liveEvents'
import type { Friend, FriendsOverview } from '../../lib/types'
import { useLiveUpdates } from '../../lib/useLiveUpdates'
import { errorResponse, mockApi } from '../../test/utils'
import { ChatPage } from './ChatPage'
import { FriendsPage } from './FriendsPage'

const callMock = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../call/CallContext', async (orig) => ({ ...(await orig<typeof import('../call/CallContext')>()), useCall: () => callMock.value }))

const baseCall = { phase: 'idle', micError: null, notice: null, outgoing: null }
function setCall(over: Record<string, unknown> = {}) {
  const requestConnect = vi.fn()
  callMock.value = { ...baseCall, requestConnect, ...over }
  return { requestConnect }
}

const friend = (over: Partial<Friend> = {}): Friend => ({
  ref: 'fref-pat', displayName: 'Pat', englishLevel: 'B2', country: 'GB', since: '2026-11-01T10:00:00Z', online: true, unread: 0, lastMessageAt: null, ...over,
})
const overview = (over: Partial<FriendsOverview> = {}): FriendsOverview => ({ friends: [friend()], incoming: [], outgoing: [], ...over })

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Live() {
    useLiveUpdates()
    return null
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Live />
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/friends" element={<FriendsPage />} />
          <Route path="/app/friends/:ref" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('FriendsPage', () => {
  beforeEach(() => setCall())

  it('lists friends with online state and lets you call only an online friend', async () => {
    const a = setCall()
    mockApi({ 'GET /api/friends': overview({ friends: [friend(), friend({ ref: 'fref-olga', displayName: 'Olga', online: false })] }) })
    renderAt('/app/friends')
    const pat = (await screen.findByText('Pat')).closest('li')!
    expect(pat).toHaveTextContent('Online')
    expect(screen.getByText('Olga').closest('li')).toHaveTextContent('Offline')
    expect(screen.getByRole('button', { name: 'Call Olga' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Call Pat' }))
    expect(a.requestConnect).toHaveBeenCalledWith('fref-pat', 'Pat')
  })

  it('cannot start a call while you are already in one', async () => {
    setCall({ phase: 'connected' })
    mockApi({ 'GET /api/friends': overview() })
    renderAt('/app/friends')
    await screen.findByText('Pat')
    expect(screen.getByRole('button', { name: 'Call Pat' })).toBeDisabled()
  })

  it('shows unread messages on the Message link', async () => {
    mockApi({ 'GET /api/friends': overview({ friends: [friend({ unread: 3 })] }) })
    renderAt('/app/friends')
    const link = await screen.findByRole('link', { name: 'Message Pat' })
    expect(link).toHaveAttribute('href', '/app/friends/fref-pat')
    expect(screen.getByText('unread from Pat')).toBeInTheDocument()
    expect(screen.getByText('unread from Pat').parentElement).toHaveTextContent('3')
  })

  it('accepts, declines and cancels requests', async () => {
    const api = mockApi({
      'GET /api/friends': overview({
        friends: [],
        incoming: [{ id: 'in-1', displayName: 'Ivan', englishLevel: null, country: null, createdAt: '2026-11-09T10:00:00Z' }],
        outgoing: [{ id: 'out-1', displayName: 'Quinn', englishLevel: 'C1', country: null, createdAt: '2026-11-09T10:00:00Z' }],
      }),
      'POST /api/friends/requests/in-1/accept': undefined,
      'POST /api/friends/requests/in-1/decline': undefined,
      'DELETE /api/friends/requests/out-1': undefined,
    })
    renderAt('/app/friends')
    await userEvent.click(await screen.findByRole('button', { name: 'Accept Ivan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decline Ivan' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request to Quinn' }))
    await waitFor(() => expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(expect.arrayContaining([
      'POST /api/friends/requests/in-1/accept', 'POST /api/friends/requests/in-1/decline', 'DELETE /api/friends/requests/out-1',
    ])))
  })

  it('explains an empty list and points to previous partners', async () => {
    mockApi({ 'GET /api/friends': overview({ friends: [] }) })
    renderAt('/app/friends')
    expect(await screen.findByText('No friends yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open previous partners' })).toHaveAttribute('href', '/app/partners')
  })

  it('removing a friend asks first and says what is lost', async () => {
    const api = mockApi({ 'GET /api/friends': overview(), 'DELETE /api/friends/fref-pat': undefined })
    renderAt('/app/friends')
    await screen.findByText('Pat')
    await userEvent.click(screen.getByRole('button', { name: 'More options for Pat' }))
    await userEvent.click(screen.getByRole('button', { name: /Remove Pat from friends/ }))
    expect(screen.getByText(/lose your private conversation/)).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Remove friend' }))
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'DELETE', url: '/api/friends/fref-pat', body: undefined }))
  })

  it('offers block and report for a friend through the friend handle', async () => {
    const api = mockApi({ 'GET /api/friends': overview(), 'POST /api/friends/fref-pat/block': undefined })
    renderAt('/app/friends')
    await screen.findByText('Pat')
    await userEvent.click(screen.getByRole('button', { name: 'More options for Pat' }))
    await userEvent.click(screen.getByRole('button', { name: /Block Pat/ }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.url === '/api/friends/fref-pat/block')).toBe(true))
  })

  it('refetches when the server says friends changed', async () => {
    let calls = 0
    mockApi({ 'GET /api/friends': () => (++calls === 1 ? overview({ friends: [] }) : overview()) })
    renderAt('/app/friends')
    await screen.findByText('No friends yet')
    act(() => liveEvents.emit({ type: 'friends.changed' }))
    expect(await screen.findByText('Pat')).toBeInTheDocument()
  })
})

describe('ChatPage', () => {
  const msg = (id: string, body: string, mine: boolean, at = '2026-11-09T10:00:00Z') => ({ id, mine, body, createdAt: at })

  beforeEach(() => setCall())

  it('shows the conversation, oldest first, with who wrote each message', async () => {
    mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [msg('1', 'Hello', true), msg('2', 'Hi there', false)], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    const log = await screen.findByRole('log', { name: 'Conversation with Pat' })
    const items = within(log).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Hello')
    expect(items[0]).toHaveTextContent('You')
    expect(items[1]).toHaveTextContent('Hi there')
    expect(items[1]).toHaveTextContent('Pat')
  })

  it('marks the conversation as read when it is opened', async () => {
    const api = mockApi({
      'GET /api/friends': overview({ friends: [friend({ unread: 2 })] }),
      'GET /api/friends/fref-pat/messages': { messages: [msg('1', 'Hello', false)], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    await screen.findByText('Hello')
    await waitFor(() => expect(api.calls.some((c) => c.url === '/api/friends/fref-pat/messages/read')).toBe(true))
  })

  it('sends a trimmed message with Enter and clears the box; Shift+Enter does not send', async () => {
    const api = mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
      'POST /api/friends/fref-pat/messages': () => msg('9', 'How are you?', true),
    })
    renderAt('/app/friends/fref-pat')
    const box = await screen.findByLabelText('Message to Pat')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await userEvent.type(box, '  How are you?  {Shift>}{Enter}{/Shift}')
    expect(api.calls.some((c) => c.method === 'POST' && c.url === '/api/friends/fref-pat/messages')).toBe(false)
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/friends/fref-pat/messages', body: { body: 'How are you?' } }))
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('says so when messages are sent too quickly', async () => {
    mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
      'POST /api/friends/fref-pat/messages': () => errorResponse(429, 'MESSAGE_RATE', 'You are sending messages very quickly. Please wait a moment.'),
    })
    renderAt('/app/friends/fref-pat')
    await userEvent.type(await screen.findByLabelText('Message to Pat'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('very quickly')
  })

  it('loads earlier messages on request', async () => {
    const api = mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': (r: { url: string }) =>
        r.url.includes('before=')
          ? { messages: [msg('0', 'Very first', false, '2026-11-01T10:00:00Z')], hasMore: false }
          : { messages: [msg('1', 'Recent', true)], hasMore: true },
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    await userEvent.click(await screen.findByRole('button', { name: 'Show earlier messages' }))
    expect(await screen.findByText('Very first')).toBeInTheDocument()
    expect(api.calls.some((c) => c.url.includes('before=2026-11-09T10%3A00%3A00Z'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull()
  })

  it('a new message pushed by the server appears without reloading', async () => {
    let n = 0
    mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': () => ({ messages: ++n === 1 ? [] : [msg('5', 'Live hello', false)], hasMore: false }),
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    await screen.findByText(/No messages yet/)
    act(() => liveEvents.emit({ type: 'message.new', friendRef: 'fref-pat' }))
    expect(await screen.findByText('Live hello')).toBeInTheDocument()
  })

  it('delete for me asks first and explains the friend keeps their copy', async () => {
    const api = mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [msg('1', 'Hello', true)], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
      'DELETE /api/friends/fref-pat/messages': undefined,
    })
    renderAt('/app/friends/fref-pat')
    await screen.findByText('Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Conversation options' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete conversation for me' }))
    expect(screen.getByText(/Pat keeps their own copy/)).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete for me' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE' && c.url === '/api/friends/fref-pat/messages')).toBe(true))
  })

  it('calls the friend from the conversation', async () => {
    const a = setCall()
    mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    await userEvent.click(await screen.findByRole('button', { name: 'Call Pat' }))
    expect(a.requestConnect).toHaveBeenCalledWith('fref-pat', 'Pat')
  })

  it('shows nothing of a conversation with someone who is not a friend', async () => {
    const api = mockApi({ 'GET /api/friends': overview({ friends: [] }) })
    renderAt('/app/friends/somebody-elses-ref')
    expect(await screen.findByText('Conversation not available')).toBeInTheDocument()
    expect(api.calls.some((c) => c.url.includes('/messages'))).toBe(false)
  })

  it('is honest that messages are stored and not end-to-end encrypted', async () => {
    mockApi({
      'GET /api/friends': overview(),
      'GET /api/friends/fref-pat/messages': { messages: [], hasMore: false },
      'POST /api/friends/fref-pat/messages/read': undefined,
    })
    renderAt('/app/friends/fref-pat')
    expect(await screen.findByText(/not end-to-end encrypted/)).toBeInTheDocument()
  })
})
