import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { FlatList } from 'react-native'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }), useRoute: () => ({ params: mockRouteParams }) }))
jest.mock('../src/features/main/CallForms', () => {
  const { Text } = require('react-native')
  return { PartnerSafety: ({ partnerName, friendRef }: { partnerName: string; friendRef?: string }) => <Text>{`safety panel for ${partnerName} via ${friendRef}`}</Text> }
})
jest.mock('../src/lib/queries', () => ({
  keys: { partners: ['partners'], friends: ['friends'], messages: (r: string) => ['messages', r] },
  useFriends: () => mockFriends,
  useMessages: () => mockMessages,
  usePartners: () => ({ data: mockPartners }),
}))
jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    status: number
    code: string
    constructor(statusCode: number, errorCode: string, message: string) {
      super(message)
      this.status = statusCode
      this.code = errorCode
    }
  }
  return { ApiError, api: (...args: unknown[]) => mockApi(...args) }
})
jest.mock('../src/features/call/CallContext', () => ({ useCall: () => mockCall }))

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
let mockPartners: unknown[] = []
const mockApi = jest.fn()
let mockRouteParams: Record<string, unknown> = {}
let mockFriends: { isLoading: boolean; isError: boolean; data?: unknown; refetch: jest.Mock }
let mockMessages: { isLoading: boolean; isError: boolean; data?: unknown }
let mockCall: Record<string, unknown>

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/lib/api'
import { ChatScreen, toRows } from '../src/features/friends/ChatScreen'
import { FriendsScreen } from '../src/features/friends/FriendsScreen'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const friend = (over: Record<string, unknown> = {}) => ({
  ref: 'fref-pat', displayName: 'Pat', englishLevel: 'B2', country: 'GB', since: '2026-11-01T10:00:00Z', online: true, unread: 0, lastMessageAt: null, ...over,
})
const overview = (over: Record<string, unknown> = {}) => ({ friends: [friend()], incoming: [], outgoing: [], ...over })
const msg = (id: string, body: string, mine: boolean, at = '2026-11-09T10:00:00Z') => ({ id, mine, body, createdAt: at })

function setCall(over: Record<string, unknown> = {}) {
  const requestConnect = jest.fn()
  mockCall = { phase: 'idle', micError: null, notice: null, outgoing: null, requestConnect, ...over }
  return { requestConnect }
}

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient()
  await act(async () => {
    r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}>{ui}</QueryClientProvider></SafeAreaProvider>)
  })
  return r
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

const flat = (node: unknown): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flat).join('')
  return flat((node as { children?: unknown }).children)
}
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const byLabel = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
const isDisabled = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.accessibilityState)[0].props.accessibilityState.disabled

beforeEach(() => {
  mockNavigate.mockClear()
  mockGoBack.mockClear()
  mockPartners = []
  mockApi.mockReset()
  mockApi.mockResolvedValue(undefined)
  mockRouteParams = { ref: 'fref-pat', name: 'Pat' }
  mockFriends = { isLoading: false, isError: false, refetch: jest.fn(), data: overview() }
  mockMessages = { isLoading: false, isError: false, data: { messages: [], hasMore: false } }
  setCall()
})

describe('FriendsScreen', () => {
  it('lists friends with their online state, and only an online friend can be called', async () => {
    const a = setCall()
    mockFriends.data = overview({ friends: [friend(), friend({ ref: 'fref-olga', displayName: 'Olga', online: false })] })
    const r = await render(<FriendsScreen />)
    const t = text(r)
    expect(t).toContain('Pat')
    expect(t).toContain('Online')
    expect(t).toContain('Offline')
    expect(isDisabled(r, 'Call Olga')).toBe(true)
    expect(isDisabled(r, 'Call Pat')).toBe(false)
    act(() => byLabel(r, 'Call Pat').props.onPress())
    expect(a.requestConnect).toHaveBeenCalledWith('fref-pat', 'Pat')
  })

  it('cannot start a call while already in one', async () => {
    setCall({ phase: 'connected' })
    const r = await render(<FriendsScreen />)
    expect(isDisabled(r, 'Call Pat')).toBe(true)
  })

  it('opens the conversation and shows unread messages in the label', async () => {
    mockFriends.data = overview({ friends: [friend({ unread: 3 })] })
    const r = await render(<FriendsScreen />)
    expect(text(r)).toContain('3')
    act(() => byLabel(r, 'Open conversation with Pat, 3 unread').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Chat', { ref: 'fref-pat', name: 'Pat' })
    act(() => byLabel(r, 'Message Pat').props.onPress())
    expect(mockNavigate).toHaveBeenCalledTimes(2)
  })

  it('accepts, declines and cancels requests', async () => {
    mockFriends.data = overview({
      friends: [],
      incoming: [{ id: 'in-1', displayName: 'Ivan', englishLevel: null, country: null, createdAt: '2026-11-09T10:00:00Z' }],
      outgoing: [{ id: 'out-1', displayName: 'Quinn', englishLevel: 'C1', country: null, createdAt: '2026-11-09T10:00:00Z' }],
    })
    const r = await render(<FriendsScreen />)
    await act(async () => { byLabel(r, 'Accept Ivan').props.onPress() })
    await act(async () => { byLabel(r, 'Decline Ivan').props.onPress() })
    await act(async () => { byLabel(r, 'Cancel request to Quinn').props.onPress() })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/requests/in-1/accept', { method: 'POST' })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/requests/in-1/decline', { method: 'POST' })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/requests/out-1', { method: 'DELETE' })
  })

  it('explains an empty list and points to previous partners', async () => {
    mockFriends.data = overview({ friends: [] })
    const r = await render(<FriendsScreen />)
    expect(text(r)).toContain('No friends yet')
    act(() => byLabel(r, 'Find a partner to talk to').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Talk' })
  })

  it('keeps Previous partners as one quiet row with the real count', async () => {
    mockPartners = [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }]
    const r = await render(<FriendsScreen />)
    expect(text(r)).toContain('3 people you have spoken with')
    act(() => byLabel(r, 'Previous partners').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Partners')
  })

  it('shows level, country and a status dot for each friend, and keeps block, report and remove in the menu', async () => {
    const r = await render(<FriendsScreen />)
    expect(text(r)).toContain('English B2 · GB · Online')
    // the safety controls are not on the row itself
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /^(Block|Report|Remove)/.test(n.props.accessibilityLabel) && typeof n.props.onPress === 'function' && n.props.accessibilityLabel !== 'Remove Pat from friends')).toHaveLength(0)
  })

  it('removing a friend asks first and says what is lost', async () => {
    const r = await render(<FriendsScreen />)
    act(() => byLabel(r, 'More options for Pat').props.onPress())
    expect(text(r)).toContain('safety panel for Pat via fref-pat')
    act(() => byLabel(r, 'Remove Pat from friends').props.onPress())
    expect(text(r)).toContain('lose your private conversation')
    expect(mockApi).not.toHaveBeenCalled()
    await act(async () => { byLabel(r, 'Remove friend').props.onPress() })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/fref-pat', { method: 'DELETE' })
  })

  it('offers a retry when the list cannot be loaded', async () => {
    mockFriends = { isLoading: false, isError: true, refetch: jest.fn() }
    const r = await render(<FriendsScreen />)
    act(() => byLabel(r, 'Try again').props.onPress())
    expect(mockFriends.refetch).toHaveBeenCalled()
  })
})

describe('ChatScreen', () => {
  it('shows the conversation with who wrote each message', async () => {
    mockMessages.data = { messages: [msg('1', 'Hello', true), msg('2', 'Hi there', false)], hasMore: false }
    const r = await render(<ChatScreen />)
    await settle()
    const labelled = (re: RegExp) => r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && re.test(n.props.accessibilityLabel)).length
    expect(labelled(/^You, .+: Hello$/)).toBeGreaterThan(0)
    expect(labelled(/^Pat, .+: Hi there$/)).toBeGreaterThan(0)
  })

  it('keeps the newest message in view when the keyboard changes the height of the list', async () => {
    mockMessages.data = { messages: [msg('1', 'Hello', true), msg('2', 'Newest', false)], hasMore: false }
    const r = await render(<ChatScreen />)
    await settle()
    const listNode = r.root.findByType(FlatList)
    const scrollToEnd = jest.fn()
    ;(listNode.instance as { scrollToEnd: typeof scrollToEnd }).scrollToEnd = scrollToEnd
    act(() => { listNode.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } }) })
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false })
  })

  it('does not redraw the messages while something is typed: the list receives identical props on every keystroke', async () => {
    mockMessages.data = { messages: [msg('1', 'Hello', true), msg('2', 'Hi there', false)], hasMore: false }
    const r = await render(<ChatScreen />)
    await settle()
    const before = r.root.findByType(FlatList).props
    const input = r.root.findAll((n) => n.props.accessibilityLabel === 'Message to Pat' && typeof n.props.onChangeText === 'function')[0]
    act(() => input.props.onChangeText('H'))
    act(() => input.props.onChangeText('Hello Pat'))
    const after = r.root.findByType(FlatList).props
    for (const prop of ['data', 'renderItem', 'keyExtractor', 'onLayout', 'contentContainerStyle', 'ListHeaderComponent', 'ListEmptyComponent']) {
      expect({ prop, same: after[prop] === before[prop] }).toEqual({ prop, same: true })
    }
  })

  it('marks the conversation as read when it is opened', async () => {
    mockMessages.data = { messages: [msg('1', 'Hello', false)], hasMore: false }
    await render(<ChatScreen />)
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/friends/fref-pat/messages/read', { method: 'POST' })
  })

  it('sends a trimmed message and the send button needs some text', async () => {
    const r = await render(<ChatScreen />)
    expect(isDisabled(r, 'Send message')).toBe(true)
    const input = r.root.findAll((n) => n.props.accessibilityLabel === 'Message to Pat' && typeof n.props.onChangeText === 'function')[0]
    act(() => input.props.onChangeText('  How are you?  '))
    await act(async () => { byLabel(r, 'Send message').props.onPress() })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/fref-pat/messages', { method: 'POST', body: { body: 'How are you?' } })
  })

  it('says so when messages are sent too quickly', async () => {
    mockApi.mockImplementation((path: string) => (path.endsWith('/messages') ? Promise.reject(new ApiError(429, 'MESSAGE_RATE', 'You are sending messages very quickly. Please wait a moment.')) : Promise.resolve(undefined)))
    const r = await render(<ChatScreen />)
    const input = r.root.findAll((n) => n.props.accessibilityLabel === 'Message to Pat' && typeof n.props.onChangeText === 'function')[0]
    act(() => input.props.onChangeText('hi'))
    await act(async () => { byLabel(r, 'Send message').props.onPress() })
    await settle()
    expect(text(r)).toContain('very quickly')
  })

  it('loads earlier messages on request', async () => {
    mockMessages.data = { messages: [msg('1', 'Recent', true)], hasMore: true }
    mockApi.mockResolvedValue({ messages: [msg('0', 'Very first', false, '2026-11-01T10:00:00Z')], hasMore: false })
    const r = await render(<ChatScreen />)
    await act(async () => { byLabel(r, 'Show earlier messages').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/friends/fref-pat/messages?before=2026-11-09T10%3A00%3A00Z')
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /^Pat, .+: Very first$/.test(n.props.accessibilityLabel)).length).toBeGreaterThan(0)
    expect(byLabel(r, 'Show earlier messages')).toBeUndefined()
  })

  it('delete for me asks first and explains the friend keeps their copy', async () => {
    const r = await render(<ChatScreen />)
    act(() => byLabel(r, 'Conversation options').props.onPress())
    act(() => byLabel(r, 'Delete conversation for me').props.onPress())
    expect(text(r)).toContain('Pat keeps their own copy')
    expect(mockApi).not.toHaveBeenCalledWith('/api/friends/fref-pat/messages', { method: 'DELETE' })
    await act(async () => { byLabel(r, 'Delete for me').props.onPress() })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/fref-pat/messages', { method: 'DELETE' })
  })

  it('calls the friend from the conversation', async () => {
    const a = setCall()
    const r = await render(<ChatScreen />)
    act(() => byLabel(r, 'Call Pat').props.onPress())
    expect(a.requestConnect).toHaveBeenCalledWith('fref-pat', 'Pat')
  })

  it('shows nothing of a conversation with someone who is not a friend', async () => {
    mockRouteParams = { ref: 'somebody-elses-ref', name: 'X' }
    const r = await render(<ChatScreen />)
    expect(text(r)).toContain('Conversation not available')
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('keeps what was typed when sending fails, so nothing is lost', async () => {
    mockApi.mockImplementation((path: string) => (path.endsWith('/messages') ? Promise.reject(new ApiError(500, 'X', 'boom')) : Promise.resolve(undefined)))
    const r = await render(<ChatScreen />)
    const input = () => r.root.findAll((n) => n.props.accessibilityLabel === 'Message to Pat' && typeof n.props.onChangeText === 'function')[0]
    act(() => input().props.onChangeText('Important words'))
    await act(async () => { byLabel(r, 'Send message').props.onPress() })
    await settle()
    expect(text(r)).toContain('Your text is still here')
    expect(input().props.value).toBe('Important words')
  })

  it('has its own header with back, status, call and options', async () => {
    const r = await render(<ChatScreen />)
    expect(text(r)).toContain('Pat')
    expect(text(r)).toContain('Online')
    act(() => byLabel(r, 'Back to friends').props.onPress())
    expect(mockGoBack).toHaveBeenCalled()
  })

  it('the composer text is explicitly dark on white, whatever the phone theme', async () => {
    const r = await render(<ChatScreen />)
    const all = r.root.findAll((n) => n.props.accessibilityLabel === 'Message to Pat' && typeof n.props.onChangeText === 'function')
    const input = all[all.length - 1] // the innermost: the real text box with its final props
    const flatStyle = Object.assign({}, ...[].concat(input.props.style).flat(3).filter(Boolean))
    expect(flatStyle.color).toBe('#14171A')
    expect(flatStyle.backgroundColor).toBe('#FFFFFF')
    expect(input.props.placeholderTextColor).toBe('#656F79')
    expect(input.props.selectionColor).toBe('#1D4ED8')
  })

  it('is honest that messages are stored and not end-to-end encrypted', async () => {
    expect(text(await render(<ChatScreen />))).toContain('not end-to-end encrypted')
  })
})

describe('toRows', () => {
  const m = (id: string, mine: boolean, at: string) => ({ id, mine, body: id, createdAt: at })

  it('puts a day label wherever the day changes', () => {
    const rows = toRows([m('a', true, '2026-11-08T10:00:00Z'), m('b', false, '2026-11-09T10:00:00Z')])
    expect(rows.filter((r) => r.kind === 'day')).toHaveLength(2)
  })

  it('keeps neighbours from one person together and marks the last of each run', () => {
    const rows = toRows([m('a', true, '2026-11-09T10:00:00Z'), m('b', true, '2026-11-09T10:01:00Z'), m('c', false, '2026-11-09T10:02:00Z')])
    const messages = rows.filter((r) => r.kind === 'message') as { message: { id: string }; first: boolean; last: boolean }[]
    expect(messages.map((x) => [x.message.id, x.first, x.last])).toEqual([['a', true, false], ['b', false, true], ['c', true, true]])
  })

  it('starts a new run after a long pause', () => {
    const rows = toRows([m('a', true, '2026-11-09T10:00:00Z'), m('b', true, '2026-11-09T10:30:00Z')])
    const messages = rows.filter((r) => r.kind === 'message') as { first: boolean; last: boolean }[]
    expect(messages.map((x) => [x.first, x.last])).toEqual([[true, true], [true, true]])
  })
})
