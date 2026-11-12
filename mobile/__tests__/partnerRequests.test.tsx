/**
 * Drives the real CallProvider with a fake signalling socket and a fake peer connection: what is sent and which state follows
 * which server message for matching resilience and previous-partner requests. It cannot prove audio (that needs two real phones).
 */
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

const mockSent: Record<string, unknown>[] = []
let mockHandlers: { onMessage: (m: unknown) => void; onStatus: (s: string) => void }
let mockMic: { stream: unknown } | { error: string }
let mockConnectFails = false
let mockCreated = 0
const mockTrack = { enabled: true, stop: jest.fn() }
const mockStream = { getAudioTracks: () => [mockTrack], getTracks: () => [mockTrack] }
const mockIncall = { start: jest.fn(), stop: jest.fn(), setForceSpeakerphoneOn: jest.fn() }
const mockPeer = {
  connectionState: 'new',
  close: jest.fn(),
  createOffer: jest.fn(async () => ({ type: 'offer', sdp: 'o' })),
  acceptOffer: jest.fn(async () => ({ type: 'answer', sdp: 'a' })),
  acceptAnswer: jest.fn(async () => undefined),
  addCandidate: jest.fn(async () => undefined),
  setIceServers: jest.fn(),
}

jest.mock('react-native-incall-manager', () => ({ __esModule: true, default: mockIncall }))
jest.mock('../src/features/call/foreground', () => ({ showCallNotification: jest.fn(async () => undefined), endCallNotification: jest.fn(async () => undefined), registerForegroundService: jest.fn() }))
jest.mock('../src/lib/api', () => ({
  api: jest.fn(async () => ({ iceServers: [{ urls: ['stun:s.test:3478'], username: null, credential: null }], forceRelay: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })),
  getBaseUrl: () => 'http://x',
}))
jest.mock('../src/features/call/signaling', () => ({
  SignalingClient: class {
    constructor(h: typeof mockHandlers) { mockHandlers = h; mockCreated += 1 }
    async connect() {
      if (mockConnectFails) throw new Error('down')
      mockHandlers.onStatus('open')
    }
    send(m: Record<string, unknown>) { mockSent.push(m); return true }
    close() { mockHandlers.onStatus('closed') }
  },
}))
jest.mock('../src/features/call/peer', () => ({
  CallPeer: class {
    constructor(_c: unknown, _s: unknown, _cb: unknown) { return mockPeer }
  },
  acquireMicrophone: jest.fn(async () => mockMic),
}))

const { CallProvider, useCall } = require('../src/features/call/CallContext') as typeof import('../src/features/call/CallContext')

let call: ReturnType<typeof useCall>
function Probe() {
  call = useCall()
  return null
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async () => { await act(async () => { ReactTestRenderer.create(<CallProvider><Probe /></CallProvider>) }) }
const server = (m: unknown) => act(async () => { mockHandlers.onMessage(m); await Promise.resolve(); await Promise.resolve() })
const link = (s: string) => act(async () => { mockHandlers.onStatus(s) })
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString()
const match = { type: 'match.found', callId: 'c1', initiator: true, topic: null, partner: { displayName: 'Sam' } }
const incomingMsg = { type: 'connect.request', requestId: 'r1', expiresAt: inFuture(45_000), from: { displayName: 'Pat', englishLevel: 'B2', country: 'GB' } }
const ringing = { type: 'connect.ringing', requestId: 'r9', expiresAt: inFuture(45_000), partner: { displayName: 'Pat' } }

beforeEach(() => {
  mockSent.length = 0
  mockMic = { stream: mockStream }
  mockConnectFails = false
  mockCreated = 0
  mockTrack.enabled = true
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

describe('staying connected', () => {
  it('opens the link once and reuses it for searches, even after a call ends', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await act(async () => { await call.start('travel') })
    expect(mockCreated).toBe(1)
    expect(mockSent).toContainEqual({ type: 'queue.join', topicSlug: 'travel' })
    await server(match)
    await flush()
    await server({ type: 'call.state', callId: 'c1', status: 'COMPLETED', endReason: 'ENDED', durationSeconds: 90, endedBy: 'partner' })
    expect(call.phase).toBe('ended')
    expect(call.link).toBe('open')
    await act(async () => { await call.start(null) })
    expect(mockCreated).toBe(1)
    expect(mockSent.filter((m) => m.type === 'queue.join')).toHaveLength(2)
  })
})

describe('a search survives a dropped connection', () => {
  it('rejoins the queue when the link comes back while searching', async () => {
    await mount()
    await act(async () => { await call.start('travel') })
    mockSent.length = 0
    await link('reconnecting')
    expect(mockSent).toHaveLength(0)
    await link('open')
    expect(mockSent).toContainEqual({ type: 'queue.join', topicSlug: 'travel' })
  })

  it('does not rejoin when nobody was searching', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    mockSent.length = 0
    await link('reconnecting')
    await link('open')
    expect(mockSent.filter((m) => m.type === 'queue.join')).toHaveLength(0)
  })

  it('another device taking over is reported and ends the search instead of fighting for the account', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server({ type: 'error', code: 'SESSION_REPLACED', message: 'This account is open on another device.' })
    expect(call.phase).toBe('idle')
    expect(call.notice).toMatch(/another device/)
    expect(mockTrack.stop).toHaveBeenCalled()
  })
})

describe('a call that never connects', () => {
  it('is failed after 30 seconds instead of leaving both people stuck', async () => {
    jest.useFakeTimers()
    try {
      await mount()
      await act(async () => { await call.start(null) })
      await server(match)
      await act(async () => { await Promise.resolve() })
      expect(call.phase).toBe('connecting')
      await act(async () => { jest.advanceTimersByTime(29_000) })
      expect(mockSent.find((m) => m.type === 'call.failed')).toBeUndefined()
      await act(async () => { jest.advanceTimersByTime(2_000) })
      expect(mockSent).toContainEqual({ type: 'call.failed', callId: 'c1' })
      expect(call.notice).toMatch(/could not connect/i)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('being asked to talk again', () => {
  it('shows the request and does nothing until you answer', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    expect(call.incoming).toMatchObject({ requestId: 'r1', from: { displayName: 'Pat' } })
    expect(call.phase).toBe('idle')
    expect(mockSent.filter((m) => String(m.type).startsWith('connect.'))).toHaveLength(0)
  })

  it('accepting takes the microphone, tells the server, and the call begins when matched', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await act(async () => { await call.acceptRequest() })
    expect(mockSent).toContainEqual({ type: 'connect.accept', requestId: 'r1' })
    expect(call.incoming).toBeNull()
    expect(call.phase).toBe('starting')
    await server({ ...match, partner: { displayName: 'Pat' } })
    await flush()
    expect(call.phase).toBe('connecting')
    expect(call.partner?.displayName).toBe('Pat')
  })

  it('declining tells the server and clears the prompt', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    act(() => call.declineRequest())
    expect(mockSent).toContainEqual({ type: 'connect.decline', requestId: 'r1' })
    expect(call.incoming).toBeNull()
  })

  it('accepting without a usable microphone declines for you instead of leaving them waiting', async () => {
    mockMic = { error: 'denied' }
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await act(async () => { await call.acceptRequest() })
    expect(mockSent).toContainEqual({ type: 'connect.decline', requestId: 'r1' })
    expect(call.micError).toBe('denied')
    expect(call.phase).toBe('idle')
  })

  it('the prompt disappears when the other person cancels, and a dropped link withdraws it too', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await server({ type: 'connect.closed', requestId: 'r1', reason: 'CANCELLED' })
    expect(call.incoming).toBeNull()
    await server(incomingMsg)
    await link('reconnecting')
    expect(call.incoming).toBeNull()
  })

  it('if the person becomes unavailable while you are accepting, you are told and put back to idle', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await act(async () => { await call.acceptRequest() })
    await server({ type: 'connect.closed', requestId: 'r1', reason: 'BUSY' })
    expect(call.phase).toBe('idle')
    expect(call.notice).toMatch(/no longer available/i)
  })
})

describe('asking a friend for a private call', () => {
  it('sends the request with the opaque friend handle and shows ringing', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(mockSent).toContainEqual({ type: 'connect.request', friendRef: 'ref-123' })
    expect(call.outgoing).toMatchObject({ partnerName: 'Pat', requestId: null })
    await server(ringing)
    expect(call.outgoing).toMatchObject({ requestId: 'r9', partnerName: 'Pat' })
  })

  it('cancelling withdraws the request and frees the microphone', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server(ringing)
    act(() => call.cancelRequest())
    expect(mockSent).toContainEqual({ type: 'connect.cancel', requestId: 'r9' })
    expect(call.outgoing).toBeNull()
    expect(mockTrack.stop).toHaveBeenCalled()
  })

  it.each([
    ['DECLINED', null],
    ['EXPIRED', null],
    ['UNAVAILABLE', 'OFFLINE'],
    ['UNAVAILABLE', 'BUSY'],
  ])('a %s answer (%s) is shown as a result and releases the microphone', async (status, reason) => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server(ringing)
    mockTrack.stop.mockClear()
    await server({ type: 'connect.status', requestId: 'r9', status, reason })
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toEqual({ status, reason, partnerName: 'Pat' })
    expect(mockTrack.stop).toHaveBeenCalled()
    expect(call.phase).toBe('idle')
  })

  it('when they accept, the call begins and the request state clears', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server(ringing)
    await server({ ...match, partner: { displayName: 'Pat' } })
    await flush()
    expect(call.phase).toBe('connecting')
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toBeNull()
  })

  it('without a microphone nothing is sent', async () => {
    mockMic = { error: 'denied' }
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(mockSent.filter((m) => m.type === 'connect.request')).toHaveLength(0)
    expect(call.micError).toBe('denied')
    expect(call.outgoing).toBeNull()
  })

  it('if the server cannot be reached it says so instead of waiting forever', async () => {
    mockConnectFails = true
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toMatchObject({ status: 'UNAVAILABLE', reason: 'LINK' })
  })

  it('starting a random search withdraws a request that is still waiting', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server(ringing)
    await act(async () => { await call.start(null) })
    expect(call.outgoing).toBeNull()
    expect(mockSent).toContainEqual({ type: 'queue.join', topicSlug: null })
  })

  it('cannot ask while already in a call', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await flush()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(mockSent.filter((m) => m.type === 'connect.request')).toHaveLength(0)
  })
})
