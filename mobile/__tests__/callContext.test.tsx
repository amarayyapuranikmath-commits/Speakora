/**
 * Drives the call state machine with a fake signalling server and a fake peer connection. This proves the
 * phase transitions and the messages sent to the server; it cannot prove audio (that needs two real phones).
 */
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

const mockSent: Record<string, unknown>[] = []
let mockHandlers: { onMessage: (m: unknown) => void; onStatus: (s: string) => void }
let mockPeerCallbacks: { onConnectionState: (s: string) => void; onStats: (s: unknown, q: string) => void }
let mockMic: { stream: unknown } | { error: string }
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
jest.mock('../src/lib/api', () => ({ api: jest.fn(async () => ({ iceServers: [{ urls: ['stun:s.test:3478'], username: null, credential: null }], forceRelay: false })), getBaseUrl: () => 'http://x' }))
jest.mock('../src/features/call/signaling', () => ({
  SignalingClient: class {
    constructor(h: typeof mockHandlers) { mockHandlers = h }
    async connect() { mockHandlers.onStatus('open') }
    send(m: Record<string, unknown>) { mockSent.push(m) }
    close() { /* closed */ }
  },
}))
jest.mock('../src/features/call/peer', () => ({
  CallPeer: class {
    constructor(_config: unknown, _stream: unknown, cb: typeof mockPeerCallbacks) { mockPeerCallbacks = cb; return mockPeer }
  },
  acquireMicrophone: jest.fn(async () => mockMic),
}))

// Required (not imported) so the mock objects above exist when the module graph loads: imports are hoisted above them.
const { CallProvider, useCall } = require('../src/features/call/CallContext') as typeof import('../src/features/call/CallContext')

let call: ReturnType<typeof useCall>
function Probe() {
  call = useCall()
  return null
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async () => { await act(async () => { ReactTestRenderer.create(<CallProvider><Probe /></CallProvider>) }) }
const server = (m: unknown) => act(async () => { mockHandlers.onMessage(m); await Promise.resolve(); await Promise.resolve() })
const match = { type: 'match.found', callId: 'c1', initiator: true, topic: null, partner: { displayName: 'Sam', country: 'DE', englishLevel: 'B1' } }

beforeEach(() => {
  mockSent.length = 0
  mockMic = { stream: mockStream }
  mockTrack.enabled = true
  mockPeer.connectionState = 'new'
  jest.clearAllMocks()
})

describe('call state machine', () => {
  it('goes idle → searching → connecting → connected, telling the server at each step', async () => {
    await mount()
    expect(call.phase).toBe('idle')
    await act(async () => { await call.start('travel') })
    expect(call.phase).toBe('searching')
    expect(mockSent).toContainEqual({ type: 'queue.join', topicSlug: 'travel' })
    expect(mockIncall.start).toHaveBeenCalledWith({ media: 'audio' })

    await server(match)
    await flush()
    expect(call.phase).toBe('connecting')
    expect(call.partner?.displayName).toBe('Sam')
    expect(mockSent).toContainEqual({ type: 'signal', callId: 'c1', kind: 'offer', payload: { type: 'offer', sdp: 'o' } })

    await act(async () => { mockPeerCallbacks.onConnectionState('connected') })
    expect(call.phase).toBe('connected')
    expect(call.connectedAt).not.toBeNull()
    expect(mockSent).toContainEqual({ type: 'call.connected', callId: 'c1' })
  })

  it('answers an incoming offer when it is the responder', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server({ ...match, initiator: false })
    await flush()
    expect(mockSent.find((m) => m.kind === 'offer')).toBeUndefined()
    await server({ type: 'signal', callId: 'c1', kind: 'offer', payload: { type: 'offer', sdp: 'remote' } })
    expect(mockPeer.acceptOffer).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote' })
    expect(mockSent).toContainEqual({ type: 'signal', callId: 'c1', kind: 'answer', payload: { type: 'answer', sdp: 'a' } })
  })

  it('ignores signals that belong to another call', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await flush()
    await server({ type: 'signal', callId: 'other', kind: 'candidate', payload: { candidate: 'x' } })
    expect(mockPeer.addCandidate).not.toHaveBeenCalled()
  })

  it('mutes and unmutes the real microphone track', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await act(async () => { call.toggleMute() })
    expect(mockTrack.enabled).toBe(false)
    expect(call.muted).toBe(true)
    await act(async () => { call.toggleMute() })
    expect(mockTrack.enabled).toBe(true)
    expect(call.muted).toBe(false)
  })

  it('routes audio to the loudspeaker on request', async () => {
    await mount()
    await act(async () => { call.toggleSpeaker() })
    expect(mockIncall.setForceSpeakerphoneOn).toHaveBeenLastCalledWith(true)
    expect(call.speakerOn).toBe(true)
  })

  it('shows the ended screen with the server’s verdict and releases the microphone and audio session', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await flush()
    await act(async () => { mockPeerCallbacks.onConnectionState('connected') })
    await server({ type: 'call.state', callId: 'c1', status: 'COMPLETED', endReason: 'ENDED', durationSeconds: 125, endedBy: 'partner' })
    expect(call.phase).toBe('ended')
    expect(call.endInfo).toMatchObject({ callId: 'c1', status: 'COMPLETED', durationSeconds: 125, endedBy: 'partner' })
    expect(mockTrack.stop).toHaveBeenCalled()
    expect(mockIncall.stop).toHaveBeenCalled()
    expect(mockPeer.close).toHaveBeenCalled()
  })

  it('enters reconnecting after the grace period when the connection drops, then recovers', async () => {
    jest.useFakeTimers()
    try {
      await mount()
      await act(async () => { await call.start(null) })
      await server(match)
      await act(async () => { await Promise.resolve() })
      await act(async () => { mockPeerCallbacks.onConnectionState('connected') })
      await act(async () => { mockPeerCallbacks.onConnectionState('disconnected') })
      expect(call.phase).toBe('connected') // brief blips are tolerated
      await act(async () => { jest.advanceTimersByTime(4100) })
      expect(call.phase).toBe('reconnecting')
      expect(mockSent).toContainEqual({ type: 'call.reconnecting', callId: 'c1' })
      await act(async () => { mockPeerCallbacks.onConnectionState('connected') })
      expect(call.phase).toBe('connected')
    } finally {
      jest.useRealTimers()
    }
  })

  it('leaves the queue and reports the problem when the microphone is denied', async () => {
    mockMic = { error: 'denied' }
    await mount()
    await act(async () => { await call.start(null) })
    expect(call.phase).toBe('idle')
    expect(call.micError).toBe('denied')
    expect(mockSent).toHaveLength(0) // never joined the queue
  })

  it('returns to idle with a notice when nobody is available', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server({ type: 'queue.timeout' })
    expect(call.phase).toBe('idle')
    expect(call.notice).toMatch(/No partner/)
    expect(mockIncall.stop).toHaveBeenCalled()
  })

  it('cancelling the search tells the server and frees the microphone', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await act(async () => { call.cancelSearch() })
    expect(mockSent).toContainEqual({ type: 'queue.cancel' })
    expect(mockTrack.stop).toHaveBeenCalled()
    expect(call.phase).toBe('idle')
  })

  it('skip goes straight back to searching and ignores the old call’s end event', async () => {
    await mount()
    await act(async () => { await call.start('general') })
    await server(match)
    await flush()
    await act(async () => { call.skip() })
    expect(call.phase).toBe('searching')
    expect(mockSent).toContainEqual({ type: 'call.skip', callId: 'c1', topicSlug: 'general' })
    await server({ type: 'call.state', callId: 'c1', status: 'CANCELLED', endReason: 'SKIPPED', durationSeconds: null, endedBy: 'you' })
    expect(call.phase).toBe('searching') // not shown as "ended"
  })

  it('ending the call confirms with the server and falls back to a local end if no answer arrives', async () => {
    jest.useFakeTimers()
    try {
      await mount()
      await act(async () => { await call.start(null) })
      await server(match)
      await act(async () => { await Promise.resolve() })
      await act(async () => { call.endCall() })
      expect(mockSent).toContainEqual({ type: 'call.end', callId: 'c1' })
      await act(async () => { jest.advanceTimersByTime(4100) })
      expect(call.phase).toBe('ended')
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('TURN credential refresh', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const apiMock = (require('../src/lib/api') as { api: jest.Mock }).api
  const turnReply = (user: string, expiresInMs: number) => ({
    iceServers: [{ urls: ['stun:s.test:3478'], username: null, credential: null }, { urls: ['turn:t.test:3478'], username: user, credential: 'pw-' + user }],
    forceRelay: false,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  })

  const dropAndReconnect = async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await act(async () => { await Promise.resolve() })
    await act(async () => { mockPeerCallbacks.onConnectionState('connected') })
    mockPeer.createOffer.mockClear()
    await act(async () => { mockPeerCallbacks.onConnectionState('disconnected') })
    await act(async () => { jest.advanceTimersByTime(4100) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }

  it('fetches fresh credentials before an ICE restart when the current ones expire within a minute', async () => {
    jest.useFakeTimers()
    try {
      apiMock.mockResolvedValueOnce(turnReply('first', 30_000))
      apiMock.mockResolvedValueOnce(turnReply('second', 3_600_000))
      await dropAndReconnect()
      expect(apiMock).toHaveBeenCalledTimes(2)
      expect(mockPeer.setIceServers).toHaveBeenCalledTimes(1)
      expect(mockPeer.setIceServers).toHaveBeenCalledWith([
        { urls: ['stun:s.test:3478'] },
        { urls: ['turn:t.test:3478'], username: 'second', credential: 'pw-second' },
      ])
      expect(mockPeer.createOffer).toHaveBeenCalledWith(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not refetch while the credentials are comfortably valid', async () => {
    jest.useFakeTimers()
    try {
      apiMock.mockResolvedValueOnce(turnReply('first', 3_600_000))
      await dropAndReconnect()
      expect(apiMock).toHaveBeenCalledTimes(1)
      expect(mockPeer.setIceServers).not.toHaveBeenCalled()
      expect(mockPeer.createOffer).toHaveBeenCalledWith(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('still restarts ICE when the refresh itself fails', async () => {
    jest.useFakeTimers()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      apiMock.mockResolvedValueOnce(turnReply('first', 10_000))
      apiMock.mockRejectedValueOnce(new Error('offline'))
      await dropAndReconnect()
      expect(mockPeer.setIceServers).not.toHaveBeenCalled()
      expect(mockPeer.createOffer).toHaveBeenCalledWith(true)
    } finally {
      warn.mockRestore()
      jest.useRealTimers()
    }
  })
})
