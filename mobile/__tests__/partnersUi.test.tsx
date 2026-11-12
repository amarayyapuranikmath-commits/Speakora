import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }))
jest.mock('../src/features/main/CallForms', () => {
  const { Text } = require('react-native')
  return { PartnerSafety: ({ partnerName }: { partnerName: string }) => <Text>{`safety panel for ${partnerName}`}</Text> }
})
jest.mock('../src/lib/queries', () => ({ keys: { partners: ['partners'], friends: ['friends'] }, usePartners: () => mockPartners }))
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
const mockApi = jest.fn()
jest.mock('../src/features/call/CallContext', () => ({ useCall: () => mockCall }))

const mockNavigate = jest.fn()
let mockPartners: { isLoading: boolean; isError: boolean; data?: unknown[]; refetch: jest.Mock }
let mockCall: Record<string, unknown>

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/lib/api'
import { AVATAR_LIGHTNESS, AVATAR_SATURATION, initials } from '../src/lib/initials'
import { PartnersScreen } from '../src/features/partners/PartnersScreen'
import { RequestLayer } from '../src/features/partners/RequestLayer'
import { resultMessage } from '../src/features/partners/partnerText'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const partner = (over: Record<string, unknown>) => ({
  ref: 'ref-' + (over.displayName ?? 'x'), displayName: 'Pat', englishLevel: 'B2', country: 'GB', conversations: 3,
  lastConversationAt: '2026-11-03T10:00:00Z', lastCallId: 'call-1', friendStatus: 'NONE', canAddFriend: true, ...over,
})
const actions = () => ({ requestConnect: jest.fn(), cancelRequest: jest.fn(), acceptRequest: jest.fn(), declineRequest: jest.fn(), dismissRequestResult: jest.fn() })
const baseCall = { phase: 'idle', micError: null, notice: null, incoming: null, outgoing: null, requestResult: null }

function setCall(over: Record<string, unknown> = {}) {
  const a = actions()
  mockCall = { ...baseCall, ...a, ...over }
  return a
}

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient()
  await act(async () => {
    r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}>{ui}</QueryClientProvider></SafeAreaProvider>)
  })
  return r
}

/** All visible strings, in order. React Native splits one sentence into fragments, so raw JSON cannot be searched for it. */
const flat = (node: unknown): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flat).join('')
  return flat((node as { children?: unknown }).children)
}
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const byLabel = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]

beforeEach(() => {
  mockNavigate.mockClear()
  mockApi.mockReset()
  mockApi.mockResolvedValue(undefined)
  mockPartners = {
    isLoading: false, isError: false, refetch: jest.fn(),
    data: [
      partner({ displayName: 'Pat' }),
      partner({ displayName: 'Olga', friendStatus: 'FRIENDS', canAddFriend: false, englishLevel: null, country: null, conversations: 1 }),
      partner({ displayName: 'Ivan', friendStatus: 'REQUEST_SENT', canAddFriend: false }),
      partner({ displayName: 'Quinn', friendStatus: 'REQUEST_RECEIVED', canAddFriend: false }),
    ],
  }
})

describe('PartnersScreen', () => {
  it('shows each previous partner with level, date and count', async () => {
    setCall()
    const t = text(await render(<PartnersScreen />))
    for (const s of ['Pat', 'English B2', 'Last talked', '3 conversations', 'Olga', '1 conversation']) expect(t).toContain(s)
    expect(t).not.toContain('English null')
  })

  it('offers Add friend instead of Connect, and shows where each person stands', async () => {
    setCall()
    const r = await render(<PartnersScreen />)
    expect(byLabel(r, 'Add Pat as a friend')).toBeDefined()
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Connect'))).toHaveLength(0)
    expect(byLabel(r, 'Add Olga as a friend')).toBeUndefined()
    const t = text(r)
    expect(t).toContain('Olga is your friend')
    expect(t).toContain('Request sent')
    expect(t).toContain('Respond to request')
  })

  it('Add friend sends the request for that person, using only the opaque handle', async () => {
    setCall()
    const r = await render(<PartnersScreen />)
    await act(async () => { byLabel(r, 'Add Pat as a friend').props.onPress() })
    expect(mockApi).toHaveBeenCalledWith('/api/friends/requests', { method: 'POST', body: { partnerRef: 'ref-Pat' } })
  })

  it('shows the reason when the server refuses (for example after a decline)', async () => {
    setCall()
    mockApi.mockRejectedValueOnce(new ApiError(429, 'FRIEND_REQUEST_COOLDOWN', 'You cannot send this person a request right now.'))
    const r = await render(<PartnersScreen />)
    await act(async () => { byLabel(r, 'Add Pat as a friend').props.onPress() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }) // React Query notifies on the next tick
    expect(text(r)).toContain('You cannot send this person a request right now.')
  })

  it('offers block and report for a partner', async () => {
    setCall()
    const r = await render(<PartnersScreen />)
    expect(text(r)).not.toContain('safety panel')
    act(() => byLabel(r, 'More options for Pat').props.onPress())
    expect(text(r)).toContain('safety panel for Pat')
  })

  it('explains an empty list and offers a retry on error', async () => {
    setCall()
    mockPartners = { isLoading: false, isError: false, data: [], refetch: jest.fn() }
    expect(text(await render(<PartnersScreen />))).toContain('No previous partners yet')
    mockPartners = { isLoading: false, isError: true, refetch: jest.fn() }
    const r = await render(<PartnersScreen />)
    expect(r.root.findAll((n) => typeof n.props.onPress === 'function').length).toBeGreaterThan(0)
  })
})

describe('RequestLayer', () => {
  it('asks before anything happens, saying who is asking', async () => {
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat', englishLevel: 'B2', country: 'GB' }, expiresAt: Date.now() + 40_000 } })
    const t = text(await render(<RequestLayer />))
    for (const s of ['A friend wants to talk', 'Pat', 'English B2 · GB', 'Nothing starts unless you accept']) expect(t).toContain(s)
    expect(a.acceptRequest).not.toHaveBeenCalled()
  })

  it('Accept and Not now do what they say', async () => {
    const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat' }, expiresAt: Date.now() + 40_000 } })
    const r = await render(<RequestLayer />)
    act(() => byLabel(r, 'Accept and talk').props.onPress())
    expect(a.acceptRequest).toHaveBeenCalledTimes(1)
    act(() => byLabel(r, 'Not now').props.onPress())
    expect(a.declineRequest).toHaveBeenCalledTimes(1)
  })

  it('an unanswered prompt declines itself when its time is up', async () => {
    jest.useFakeTimers()
    try {
      const a = setCall({ incoming: { requestId: 'r1', from: { displayName: 'Pat' }, expiresAt: Date.now() + 3_000 } })
      const r = await render(<RequestLayer />)
      expect(text(r)).toContain('Answer within 3s')
      await act(async () => { jest.advanceTimersByTime(3_500) })
      expect(a.declineRequest).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows who you are asking and lets you cancel once the server has confirmed it', async () => {
    const a = setCall({ outgoing: { requestId: 'r9', partnerName: 'Pat', expiresAt: Date.now() + 30_000 } })
    const r = await render(<RequestLayer />)
    expect(text(r)).toContain('Asking Pat to talk')
    act(() => byLabel(r, 'Cancel').props.onPress())
    expect(a.cancelRequest).toHaveBeenCalled()
  })

  it('cannot cancel in the instant before the server has confirmed the request', async () => {
    setCall({ outgoing: { requestId: null, partnerName: 'Pat', expiresAt: null } })
    const r = await render(<RequestLayer />)
    const btn = r.root.findAll((x) => x.props.accessibilityLabel === 'Cancel' && x.props.accessibilityState)[0]
    expect(btn.props.accessibilityState.disabled).toBe(true)
  })

  it.each([
    ['DECLINED', null, "Pat can't talk right now."],
    ['EXPIRED', null, "Pat didn't answer."],
    ['UNAVAILABLE', 'OFFLINE', 'Pat is offline.'],
    ['UNAVAILABLE', 'BUSY', 'Pat is in another call'],
    ['UNAVAILABLE', 'NOT_ACCEPTING', "Pat isn't accepting calls"],
    ['UNAVAILABLE', 'LINK', 'We could not reach the server'],
  ])('tells you plainly what happened: %s %s', async (status, reason, expected) => {
    const a = setCall({ requestResult: { status, reason, partnerName: 'Pat' } })
    const r = await render(<RequestLayer />)
    expect(text(r)).toContain(expected.replace(/'/g, "'"))
    act(() => byLabel(r, 'Dismiss').props.onPress())
    expect(a.dismissRequestResult).toHaveBeenCalled()
  })

  it('says nothing when you cancelled it yourself, and nothing when there is nothing to show', async () => {
    const a = setCall({ requestResult: { status: 'CANCELLED', reason: null, partnerName: 'Pat' } })
    await render(<RequestLayer />)
    expect(a.dismissRequestResult).toHaveBeenCalled()
    setCall()
    expect(text(await render(<RequestLayer />))).toBe('')
  })
})

describe('helpers', () => {
  it('initials are one or two letters', () => {
    expect(initials('Pat')).toBe('PA')
    expect(initials('Ana Maria Lopez')).toBe('AL')
    expect(initials('  ')).toBe('?')
  })

  it('has no message for a request the user cancelled', () => {
    expect(resultMessage({ status: 'CANCELLED', reason: null, partnerName: 'Pat' })).toBeNull()
  })
})

describe('avatar colours', () => {
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    s /= 100
    l /= 100
    const k = (n: number) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0), f(8), f(4)]
  }
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

  it('white initials are readable (WCAG AA, 4.5:1) on EVERY possible avatar colour', () => {
    let worst = Infinity
    for (let hue = 0; hue < 360; hue++) worst = Math.min(worst, 1.05 / (lum(hslToRgb(hue, AVATAR_SATURATION, AVATAR_LIGHTNESS)) + 0.05))
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })
})
