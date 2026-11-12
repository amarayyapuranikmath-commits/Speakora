// streamChat reads a streamed reply through XMLHttpRequest progress events (React Native's fetch cannot stream).
// These tests drive it with a fake XMLHttpRequest that behaves the way a real one does: responseText grows, onprogress fires per chunk.
const mockRefresh = jest.fn()
let mockToken: string | null = 'access-1'
jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    status: number; code: string
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
  }
  return {
    ApiError,
    api: (...a: unknown[]) => mockApiCall(...a),
    getAccessToken: () => mockToken,
    getBaseUrl: () => 'http://api.test',
    refreshSession: (...a: unknown[]) => mockRefresh(...a),
  }
})
const mockApiCall = jest.fn()

import { Aborted, MAX_CONTEXT_TURNS, streamChat, type ChatRequest } from '../src/features/main/tutorApi'

class FakeXhr {
  static all: FakeXhr[] = []
  method = ''; url = ''; headers: Record<string, string> = {}; body = ''
  status = 0; responseText = ''; timeout = 0
  onprogress: (() => void) | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  aborted = false
  constructor() { FakeXhr.all.push(this) }
  open(m: string, u: string) { this.method = m; this.url = u }
  setRequestHeader(k: string, v: string) { this.headers[k] = v }
  send(b: string) { this.body = b }
  abort() { this.aborted = true }
  // test helpers
  chunk(text: string) { this.status = 200; this.responseText += text; this.onprogress?.() }
  finish() { this.onload?.() }
}
const lastXhr = () => FakeXhr.all[FakeXhr.all.length - 1]
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const DONE = { reply: 'Hello there', mode: 'FREE_CONVERSATION' }
const req = (text = 'Hi', spoken = false): ChatRequest => ({ mode: 'FREE_CONVERSATION', messages: [{ role: 'user', content: text }], spoken })
const tick = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  FakeXhr.all = []
  ;(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr
  mockRefresh.mockReset(); mockApiCall.mockReset()
  mockToken = 'access-1'
})

describe('streamChat over XMLHttpRequest', () => {
  it('delivers text pieces as chunks arrive (even when an event is split across chunks) and resolves with the whole reply', async () => {
    const pieces: string[] = []
    const p = streamChat(req(), (t) => pieces.push(t))
    const x = lastXhr()
    expect(x.method).toBe('POST')
    expect(x.url).toBe('http://api.test/api/coach/stream')
    expect(x.headers.Authorization).toBe('Bearer access-1')
    expect(JSON.parse(x.body)).toEqual({ mode: 'FREE_CONVERSATION', messages: [{ role: 'user', content: 'Hi' }], language: null, topicId: null, scenario: null, spoken: false })
    const first = sse('delta', { text: 'Hello ' })
    x.chunk(first.slice(0, 15)) // an event cut in the middle
    expect(pieces).toEqual([])
    x.chunk(first.slice(15) + sse('delta', { text: 'there' }))
    expect(pieces).toEqual(['Hello ', 'there'])
    x.chunk(sse('done', DONE))
    x.finish()
    await expect(p).resolves.toBe('Hello there')
  })

  it('marks voice turns so the coach writes for the ear', async () => {
    const p = streamChat(req('spoken words', true), () => undefined)
    expect(JSON.parse(lastXhr().body).spoken).toBe(true)
    lastXhr().chunk(sse('done', DONE)); lastXhr().finish()
    await p
  })

  it('reports an error event from the tutor and does not resolve', async () => {
    const p = streamChat(req(), () => undefined)
    lastXhr().chunk(sse('delta', { text: 'Half ' }) + sse('error', { code: 'COACH_FAILED', message: 'The tutor could not respond right now. Please try again.' }))
    lastXhr().finish()
    await expect(p).rejects.toMatchObject({ code: 'COACH_FAILED', message: expect.stringContaining('could not respond') })
  })

  it('a reply cut off before the end event is an error, not a silent half answer', async () => {
    const p = streamChat(req(), () => undefined)
    lastXhr().chunk(sse('delta', { text: 'Half ' }))
    lastXhr().finish()
    await expect(p).rejects.toMatchObject({ message: expect.stringContaining('cut off') })
  })

  it('the connection dropping mid-reply says the connection was lost', async () => {
    const p = streamChat(req(), () => undefined)
    lastXhr().chunk(sse('delta', { text: 'Half ' }))
    lastXhr().onerror?.()
    await expect(p).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringContaining('connection was lost') })
  })

  it('a failure before anything arrived falls back to the plain endpoint once, and still shows the reply', async () => {
    mockApiCall.mockResolvedValue({ reply: 'Hello there' })
    const pieces: string[] = []
    const p = streamChat(req(), (t) => pieces.push(t))
    lastXhr().onerror?.()
    await expect(p).resolves.toBe('Hello there')
    expect(mockApiCall).toHaveBeenCalledWith('/api/coach/chat', { method: 'POST', body: { mode: 'FREE_CONVERSATION', messages: [{ role: 'user', content: 'Hi' }], language: null, topicId: null, scenario: null, spoken: false } })
    expect(pieces).toEqual(['Hello there'])
  })

  it('an expired sign-in is refreshed once and the same message is sent again', async () => {
    mockRefresh.mockImplementation(async () => { mockToken = 'access-2'; return { ok: true } })
    const pieces: string[] = []
    const p = streamChat(req(), (t) => pieces.push(t))
    const first = lastXhr()
    first.status = 401; first.responseText = '{"code":"UNAUTHENTICATED"}'
    first.finish()
    await tick()
    const second = lastXhr()
    expect(second).not.toBe(first)
    expect(second.headers.Authorization).toBe('Bearer access-2')
    second.chunk(sse('delta', { text: 'Hi' }) + sse('done', DONE)); second.finish()
    await expect(p).resolves.toBeTruthy()
    expect(pieces).toEqual(['Hi'])
  })

  it('a refused refresh asks the learner to sign in again', async () => {
    mockRefresh.mockResolvedValue(null)
    const p = streamChat(req(), () => undefined)
    lastXhr().status = 401; lastXhr().responseText = '{}'; lastXhr().finish()
    await expect(p).rejects.toMatchObject({ status: 401 })
  })

  it('shows the server\'s own message for limits and consent errors', async () => {
    const p = streamChat(req(), () => undefined)
    lastXhr().status = 429; lastXhr().responseText = JSON.stringify({ code: 'RATE_LIMITED', message: 'You are sending messages very quickly. Please wait a moment.' })
    lastXhr().finish()
    await expect(p).rejects.toMatchObject({ status: 429, message: expect.stringContaining('very quickly') })
  })

  it('stopping the reply aborts the request and rejects with Aborted', async () => {
    const ctrl = new AbortController()
    const p = streamChat(req(), () => undefined, ctrl.signal)
    lastXhr().chunk(sse('delta', { text: 'Partial ' }))
    ctrl.abort()
    expect(lastXhr().aborted).toBe(true)
    await expect(p).rejects.toBeInstanceOf(Aborted)
    expect(mockApiCall).not.toHaveBeenCalled() // no fallback after the learner stopped it
  })

  it('a reply that takes too long gives a clear message', async () => {
    const p = streamChat(req(), () => undefined)
    expect(lastXhr().timeout).toBeGreaterThanOrEqual(60_000)
    lastXhr().ontimeout?.()
    await expect(p).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringContaining('too long') })
  })

  it('sends only the most recent turns, and nothing else about the conversation', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `turn ${i}` }))
    const p = streamChat({ mode: 'GENERAL', messages: many, spoken: false }, () => undefined)
    const sent = JSON.parse(lastXhr().body)
    expect(sent.messages).toHaveLength(MAX_CONTEXT_TURNS)
    expect(sent.messages[sent.messages.length - 1].content).toBe('turn 39')
    expect(Object.keys(sent).sort()).toEqual(['language', 'messages', 'mode', 'scenario', 'spoken', 'topicId'])
    lastXhr().chunk(sse('done', DONE)); lastXhr().finish()
    await p
  })
})
