import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: vi.fn().mockResolvedValue({ ticket: 'ticket' }) }))

import { SignalingClient, type LinkStatus } from './signaling'

/** A WebSocket that behaves like the browser's for the parts the client uses: a failed connection fires `error` and then `close`. */
class FakeSocket {
  static all: FakeSocket[] = []
  static OPEN = 1
  readyState = 0
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send() {}
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.({ code, reason: '' })
  }
  accept() {
    this.readyState = 1
    this.onmessage?.({ data: JSON.stringify({ type: 'connected' }) })
  }
  /** The attempt never gets through (network down). */
  fail() {
    this.readyState = 3
    this.onerror?.()
    this.onclose?.({ code: 1006, reason: '' })
  }
  /** An open connection is lost. */
  drop() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: '' })
  }
}

const tick = () => vi.advanceTimersByTimeAsync(0)

async function connected() {
  const statuses: LinkStatus[] = []
  const client = new SignalingClient({ onMessage: () => {}, onStatus: (s) => statuses.push(s) })
  const done = client.connect()
  await tick()
  FakeSocket.all[0].accept()
  await done
  return { client, statuses }
}

/** The link is down and the client is waiting out a back-off: first retry failed, so the next one is 2+ seconds away. */
async function waitingToRetry() {
  const { client, statuses } = await connected()
  FakeSocket.all[0].drop()
  await vi.advanceTimersByTimeAsync(1000) // first retry
  FakeSocket.all[1].fail()
  await tick()
  expect(FakeSocket.all).toHaveLength(2)
  return { client, statuses }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('signalling URL', () => {
  it('uses the configured production URL and appends the one-time ticket', async () => {
    vi.stubEnv('VITE_WS_URL', 'wss://speakora-6mkd.onrender.com/ws/signaling')
    const client = new SignalingClient({ onMessage: () => {}, onStatus: () => {} })
    const done = client.connect()
    await tick()

    expect(FakeSocket.all[0].url).toBe('wss://speakora-6mkd.onrender.com/ws/signaling?ticket=ticket')
    FakeSocket.all[0].accept()
    await done
    client.close()
  })

  it('falls back to the current origin for local development', async () => {
    const client = new SignalingClient({ onMessage: () => {}, onStatus: () => {} })
    const done = client.connect()
    await tick()

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    expect(FakeSocket.all[0].url).toBe(`${scheme}://${location.host}/ws/signaling?ticket=ticket`)
    FakeSocket.all[0].accept()
    await done
    client.close()
  })
})

describe('signalling reconnection', () => {
  it('retries on its back-off schedule by itself', async () => {
    const { statuses } = await connected()
    FakeSocket.all[0].drop()
    expect(statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('reconnects at once when the browser reports the network is back, instead of waiting out the back-off', async () => {
    const { client, statuses } = await waitingToRetry()
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(FakeSocket.all).toHaveLength(3) // no time passed, and the third attempt is already under way
    FakeSocket.all[2].accept()
    await tick()
    expect(statuses.at(-1)).toBe('open')
    client.close()
  })

  it('reconnects at once when a hidden tab becomes visible again', async () => {
    const { client } = await waitingToRetry()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    expect(FakeSocket.all).toHaveLength(3)
    client.close()
  })

  it('does not open a second connection when the network event arrives while the link is fine or an attempt is already running', async () => {
    const { client } = await connected()
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(FakeSocket.all).toHaveLength(1) // connected: nothing to hurry

    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(1000) // the retry is in flight (its socket is not answered yet)
    expect(FakeSocket.all).toHaveLength(2)
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(FakeSocket.all).toHaveLength(2) // no timer is waiting, so no extra attempt
    client.close()
  })

  it('stops listening for the network once closed on purpose', async () => {
    const { client } = await waitingToRetry()
    client.close()
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(2) // nothing reconnects a link that was closed deliberately
  })

  it('does not reconnect a connection the server ended because the account was opened elsewhere', async () => {
    const { client } = await connected()
    FakeSocket.all[0].close(4001)
    await tick()
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    client.close()
  })
})
