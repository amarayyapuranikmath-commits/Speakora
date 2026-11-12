import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Drives the real CallProvider with a fake signalling socket and a fake peer. It proves the client logic (what is sent, which
 * state follows which message); it cannot prove audio.
 */
const h = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  handlers: null as null | { onMessage: (m: unknown) => void; onStatus: (s: string) => void },
  mic: { stream: null as unknown } as { stream?: unknown; error?: string },
  micTrack: { enabled: true, stop: vi.fn(), getSettings: () => ({}) },
  connectFails: false,
  created: 0,
}))

vi.mock('./signaling', () => ({
  SignalingClient: class {
    constructor(handlers: typeof h.handlers) { h.handlers = handlers; h.created += 1 }
    async connect() {
      if (h.connectFails) throw new Error('down')
      h.handlers!.onStatus('open')
    }
    send(m: Record<string, unknown>) { h.sent.push(m); return true }
    close() { h.handlers!.onStatus('closed') }
  },
}))
vi.mock('./peer', () => ({
  CallPeer: class {
    connectionState = 'new'
    close() {}
    async createOffer() { return { type: 'offer', sdp: 'o' } }
    async acceptOffer() { return { type: 'answer', sdp: 'a' } }
    async acceptAnswer() {}
    async addCandidate() {}
    setIceServers() {}
  },
  acquireMicrophone: async () => (h.mic.error ? { error: h.mic.error } : { stream: h.mic.stream }),
  listMicrophones: async () => [],
}))
vi.mock('../../lib/api', () => ({
  api: vi.fn(async () => ({ iceServers: [{ urls: ['stun:s'], username: null, credential: null }], forceRelay: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })),
}))

import { CallProvider, useCall } from './CallContext'

let call: ReturnType<typeof useCall>
function Probe() {
  // The tests read the latest context value from outside React.
  // oxlint-disable-next-line react/globals
  call = useCall()
  return null
}

const mount = async () => { await act(async () => { render(<CallProvider><Probe /></CallProvider>) }) }
const server = (m: unknown) => act(async () => { h.handlers!.onMessage(m); await Promise.resolve(); await Promise.resolve() })
const link = (s: string) => act(async () => { h.handlers!.onStatus(s) })
const match = { type: 'match.found', callId: 'c1', initiator: true, topic: null, partner: { displayName: 'Sam' } }
const incomingMsg = { type: 'connect.request', requestId: 'r1', expiresAt: new Date(Date.now() + 45_000).toISOString(), from: { displayName: 'Pat', englishLevel: 'B2', country: 'GB' } }

beforeEach(() => {
  h.sent.length = 0
  h.mic = { stream: { getAudioTracks: () => [h.micTrack], getTracks: () => [h.micTrack] } }
  h.connectFails = false
  h.created = 0
  h.micTrack.stop.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('staying connected', () => {
  it('opens the link once and reuses it for a search', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await act(async () => { await call.start('travel') })
    expect(h.created).toBe(1)
    expect(h.sent).toContainEqual({ type: 'queue.join', topicSlug: 'travel' })
    expect(call.phase).toBe('searching')
  })

  it('keeps the link open after a call ends, so the next search starts instantly and people can still reach you', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await server({ type: 'call.state', callId: 'c1', status: 'COMPLETED', endReason: 'ENDED', durationSeconds: 90, endedBy: 'partner' })
    expect(call.phase).toBe('ended')
    expect(call.link).toBe('open')
    await act(async () => { await call.start(null) })
    expect(h.created).toBe(1)
    expect(h.sent.filter((m) => m.type === 'queue.join')).toHaveLength(2)
  })
})

describe('a search survives a dropped connection', () => {
  it('rejoins the queue when the link comes back while searching', async () => {
    await mount()
    await act(async () => { await call.start('travel') })
    h.sent.length = 0
    await link('reconnecting')
    expect(h.sent).toHaveLength(0)
    await link('open')
    expect(h.sent).toContainEqual({ type: 'queue.join', topicSlug: 'travel' })
  })

  it('does not rejoin when nobody was searching', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    h.sent.length = 0
    await link('reconnecting')
    await link('open')
    expect(h.sent.filter((m) => m.type === 'queue.join')).toHaveLength(0)
  })

  it('a second window taking over is reported and ends the search instead of fighting for the account', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server({ type: 'error', code: 'SESSION_REPLACED', message: 'This account is open in another window.' })
    expect(call.phase).toBe('idle')
    expect(call.notice).toMatch(/another window/)
    expect(h.micTrack.stop).toHaveBeenCalled()
  })
})

describe('a call that never connects', () => {
  it('is failed after 30 seconds instead of leaving both people stuck', async () => {
    vi.useFakeTimers()
    try {
      await mount()
      await act(async () => { await call.start(null) })
      await server(match)
      expect(call.phase).toBe('connecting')
      await act(async () => { vi.advanceTimersByTime(29_000) })
      expect(h.sent.find((m) => m.type === 'call.failed')).toBeUndefined()
      await act(async () => { vi.advanceTimersByTime(2_000) })
      expect(h.sent).toContainEqual({ type: 'call.failed', callId: 'c1' })
      expect(call.notice).toMatch(/could not connect/i)
    } finally {
      vi.useRealTimers()
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
    expect(h.sent.filter((m) => String(m.type).startsWith('connect.'))).toHaveLength(0)
  })

  it('accepting takes the microphone, tells the server, and the call begins when the server matches you', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await act(async () => { await call.acceptRequest() })
    expect(h.sent).toContainEqual({ type: 'connect.accept', requestId: 'r1' })
    expect(call.incoming).toBeNull()
    expect(call.phase).toBe('starting')
    await server({ ...match, partner: { displayName: 'Pat' } })
    expect(call.phase).toBe('connecting')
    expect(call.partner?.displayName).toBe('Pat')
  })

  it('declining tells the server and clears the prompt', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    act(() => call.declineRequest())
    expect(h.sent).toContainEqual({ type: 'connect.decline', requestId: 'r1' })
    expect(call.incoming).toBeNull()
  })

  it('accepting without a usable microphone declines for you instead of leaving them waiting', async () => {
    h.mic = { error: 'denied' }
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await act(async () => { await call.acceptRequest() })
    expect(h.sent).toContainEqual({ type: 'connect.decline', requestId: 'r1' })
    expect(call.micError).toBe('denied')
    expect(call.phase).toBe('idle')
  })

  it('the prompt disappears when the other person cancels or it expires', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await server({ type: 'connect.closed', requestId: 'r1', reason: 'CANCELLED' })
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

  it('a dropped connection withdraws the prompt, because the server has too', async () => {
    await mount()
    await act(async () => { await call.ensureLink() })
    await server(incomingMsg)
    await link('reconnecting')
    expect(call.incoming).toBeNull()
  })
})

describe('asking a friend for a private call', () => {
  it('sends the request with the opaque friend handle and shows ringing', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(h.sent).toContainEqual({ type: 'connect.request', friendRef: 'ref-123' })
    expect(call.outgoing).toMatchObject({ partnerName: 'Pat', requestId: null })
    await server({ type: 'connect.ringing', requestId: 'r9', expiresAt: new Date(Date.now() + 45_000).toISOString(), partner: { displayName: 'Pat' } })
    expect(call.outgoing).toMatchObject({ requestId: 'r9', partnerName: 'Pat' })
  })

  it('cancelling withdraws the request and frees the microphone', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server({ type: 'connect.ringing', requestId: 'r9', expiresAt: new Date(Date.now() + 45_000).toISOString(), partner: { displayName: 'Pat' } })
    act(() => call.cancelRequest())
    expect(h.sent).toContainEqual({ type: 'connect.cancel', requestId: 'r9' })
    expect(call.outgoing).toBeNull()
    expect(h.micTrack.stop).toHaveBeenCalled()
  })

  it.each([
    ['DECLINED', null],
    ['EXPIRED', null],
    ['UNAVAILABLE', 'OFFLINE'],
    ['UNAVAILABLE', 'BUSY'],
  ] as const)('a %s answer (%s) is shown as a result and releases the microphone', async (status, reason) => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server({ type: 'connect.ringing', requestId: 'r9', expiresAt: new Date(Date.now() + 45_000).toISOString(), partner: { displayName: 'Pat' } })
    h.micTrack.stop.mockClear()
    await server({ type: 'connect.status', requestId: 'r9', status, reason })
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toEqual({ status, reason, partnerName: 'Pat' })
    expect(h.micTrack.stop).toHaveBeenCalled()
    expect(call.phase).toBe('idle')
  })

  it('an offline answer that arrives before ringing is still shown', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server({ type: 'connect.status', requestId: null, status: 'UNAVAILABLE', reason: 'OFFLINE' })
    expect(call.requestResult).toMatchObject({ reason: 'OFFLINE', partnerName: 'Pat' })
  })

  it('when they accept, the call begins and the request state clears', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server({ type: 'connect.ringing', requestId: 'r9', expiresAt: new Date(Date.now() + 45_000).toISOString(), partner: { displayName: 'Pat' } })
    await server({ ...match, partner: { displayName: 'Pat' } })
    expect(call.phase).toBe('connecting')
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toBeNull()
  })

  it('without a microphone nothing is sent', async () => {
    h.mic = { error: 'denied' }
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(h.sent.filter((m) => m.type === 'connect.request')).toHaveLength(0)
    expect(call.micError).toBe('denied')
    expect(call.outgoing).toBeNull()
  })

  it('if the server cannot be reached it says so instead of waiting forever', async () => {
    h.connectFails = true
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(call.outgoing).toBeNull()
    expect(call.requestResult).toMatchObject({ status: 'UNAVAILABLE', reason: 'LINK' })
  })

  it('starting a random search withdraws a request that is still waiting', async () => {
    await mount()
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    await server({ type: 'connect.ringing', requestId: 'r9', expiresAt: new Date(Date.now() + 45_000).toISOString(), partner: { displayName: 'Pat' } })
    await act(async () => { await call.start(null) })
    expect(call.outgoing).toBeNull()
    expect(h.sent).toContainEqual({ type: 'queue.join', topicSlug: null })
  })

  it('cannot ask while already in a call', async () => {
    await mount()
    await act(async () => { await call.start(null) })
    await server(match)
    await act(async () => { await call.requestConnect('ref-123', 'Pat') })
    expect(h.sent.filter((m) => m.type === 'connect.request')).toHaveLength(0)
  })
})
