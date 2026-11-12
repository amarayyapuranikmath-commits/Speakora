import { AppState } from 'react-native'

jest.mock('../src/lib/api', () => ({ api: jest.fn().mockResolvedValue({ ticket: 'ticket' }), getBaseUrl: () => 'http://localhost:8080' }))
jest.mock('../src/features/call/callLog', () => ({ clog: () => undefined }))

import { SignalingClient, type LinkStatus } from '../src/features/call/signaling'

/** A WebSocket that behaves like the platform's for the parts the client uses: a failed connection fires `error`, then `close`. */
class FakeSocket {
  static all: FakeSocket[] = []
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
  fail() {
    this.readyState = 3
    this.onerror?.()
    this.onclose?.({ code: 1006, reason: '' })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: '' })
  }
}

type AppStateHandler = (state: string) => void
let appStateHandlers: AppStateHandler[] = []
let removed = 0
const tick = () => jest.advanceTimersByTimeAsync(0)

async function connected() {
  const statuses: LinkStatus[] = []
  const client = new SignalingClient({ onMessage: () => undefined, onStatus: (s) => statuses.push(s) })
  const done = client.connect()
  await tick()
  FakeSocket.all[0].accept()
  await done
  return { client, statuses }
}

/** The link is down and the client is waiting out a back-off: the first retry failed, so the next one is seconds away. */
async function waitingToRetry() {
  const { client, statuses } = await connected()
  FakeSocket.all[0].drop()
  await jest.advanceTimersByTimeAsync(1000)
  FakeSocket.all[1].fail()
  await tick()
  expect(FakeSocket.all).toHaveLength(2)
  return { client, statuses }
}

const appBecomes = (state: string) => appStateHandlers.forEach((h) => h(state))

beforeEach(() => {
  jest.useFakeTimers()
  FakeSocket.all = []
  appStateHandlers = []
  removed = 0
  ;(global as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: AppStateHandler) => {
    appStateHandlers.push(handler)
    return { remove: () => { removed += 1; appStateHandlers = appStateHandlers.filter((h) => h !== handler) } }
  }) as never)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('signalling reconnection on the phone', () => {
  it('retries on its back-off schedule by itself', async () => {
    const { statuses } = await connected()
    FakeSocket.all[0].drop()
    expect(statuses[statuses.length - 1]).toBe('reconnecting')
    await jest.advanceTimersByTimeAsync(999)
    expect(FakeSocket.all).toHaveLength(1)
    await jest.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('reconnects at once when the app comes back to the foreground, instead of waiting out the back-off', async () => {
    const { client, statuses } = await waitingToRetry()
    appBecomes('active')
    await tick()
    expect(FakeSocket.all).toHaveLength(3) // no time passed, the next attempt is already under way
    FakeSocket.all[2].accept()
    await tick()
    expect(statuses[statuses.length - 1]).toBe('open')
    client.close()
  })

  it('ignores the app going to the background, and a foreground event when the link is fine or an attempt is already running', async () => {
    const { client } = await connected()
    appBecomes('active')
    expect(FakeSocket.all).toHaveLength(1) // connected: nothing to hurry

    FakeSocket.all[0].drop()
    await jest.advanceTimersByTimeAsync(1000) // the retry is in flight
    appBecomes('active')
    appBecomes('active')
    await tick()
    expect(FakeSocket.all).toHaveLength(2) // no timer was waiting, so no extra connection

    FakeSocket.all[1].fail()
    await tick()
    appBecomes('background')
    appBecomes('inactive')
    await tick()
    expect(FakeSocket.all).toHaveLength(2)
    client.close()
  })

  it('keeps one subscription however often it connects, and removes it when closed on purpose', async () => {
    const { client } = await connected()
    expect(appStateHandlers).toHaveLength(1)
    FakeSocket.all[0].drop()
    await jest.advanceTimersByTimeAsync(1000)
    FakeSocket.all[1].accept()
    await tick()
    expect(appStateHandlers).toHaveLength(1)
    client.close()
    expect(removed).toBe(1)
    appBecomes('active')
    await jest.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(2) // nothing reconnects a link that was closed deliberately
  })

  it('leaves no retry timer behind when a failed attempt reports error and close in one go', async () => {
    const { client } = await waitingToRetry()
    client.close()
    await jest.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('does not reconnect a connection the server ended because the account was opened elsewhere', async () => {
    const { client } = await connected()
    FakeSocket.all[0].close(4001)
    await tick()
    appBecomes('active')
    await jest.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    client.close()
  })
})
