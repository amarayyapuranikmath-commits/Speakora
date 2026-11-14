import { ApiError, api, apiRaw } from '../../lib/api'

export interface ModeInfo { id: string; title: string; description: string }

export const tutorKeys = {
  modes: ['coach', 'modes'] as const,
  preferences: ['coach', 'preferences'] as const,
}

/** The learner's tutor settings: the language explanations are given in (null = simple English) and how fast the voice speaks. */
export interface TutorPrefs { explanationLanguage: string | null; speechSpeed?: string }

export const savePreferredLanguage = (explanationLanguage: string | null) =>
  api<TutorPrefs>('/api/coach/preferences', { method: 'PUT', body: { explanationLanguage } })

export const saveSpeechSpeed = (speechSpeed: 'SLOW' | 'NORMAL' | 'FAST') =>
  api<TutorPrefs>('/api/coach/preferences/speech-speed', { method: 'PUT', body: { speechSpeed } })

/** One parsed server-sent event. */
export interface SseEvent { event: string; data: string }

/** Splits a growing text buffer into complete events; returns the rest that is still incomplete. Exported for tests. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

export interface Turn { role: 'user' | 'assistant'; content: string }

export interface ChatRequest {
  mode: string
  /** The live conversation, oldest first, ending with the learner's message. It exists only in memory on this device. */
  messages: Turn[]
  language?: string | null
  topicId?: string | null
  scenario?: string | null
  spoken: boolean
}

/** The most recent turns that are sent. The conversation lives in memory on this device and nothing is stored on the server. */
export const MAX_CONTEXT_TURNS = 20

/**
 * Sends the live conversation and delivers the tutor's reply piece by piece. Resolves with the whole reply. The server keeps nothing: the
 * conversation exists only in this page's memory. If this browser cannot read a streamed body, the whole reply arrives at once.
 * Aborting stops the reply.
 */
/** How long to wait for the first piece (a sleeping server may need a minute and a half to wake) and for each piece after it. */
export const FIRST_PIECE_WAIT_MS = 100_000
export const NEXT_PIECE_WAIT_MS = 45_000

/**
 * One read of the reply stream that cannot hang for ever: it gives up when nothing arrives in time, and stops at once when the learner stops the
 * reply. Without this a stalled connection left the conversation "busy" until the page was reloaded.
 */
function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number, signal?: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
    const onAbort = () => { done(); void reader.cancel().catch(() => undefined); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => {
      done()
      void reader.cancel().catch(() => undefined)
      reject(new ApiError(504, 'COACH_TIMEOUT', 'The coach took too long to answer. Please try again.'))
    }, ms)
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    reader.read().then((r) => { done(); resolve(r) }, (e) => { done(); reject(e) })
  })
}

export async function streamChat(req: ChatRequest, onDelta: (piece: string) => void, signal?: AbortSignal): Promise<string> {
  const body = { ...req, messages: req.messages.slice(-MAX_CONTEXT_TURNS), language: req.language ?? null, topicId: req.topicId ?? null, scenario: req.scenario ?? null }
  const res = await apiRaw('/api/coach/stream', { method: 'POST', body, signal })
  const reader = res.body?.getReader()
  if (!reader) {
    const whole = await api<{ reply: string }>('/api/coach/chat', { method: 'POST', body, signal })
    onDelta(whole.reply)
    return whole.reply
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let reply: string | null = null
  let first = true
  for (;;) {
    const { value, done } = await readWithin(reader, first ? FIRST_PIECE_WAIT_MS : NEXT_PIECE_WAIT_MS, signal)
    first = false
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSse(buffer)
    buffer = parsed.rest
    for (const e of parsed.events) {
      const payload = JSON.parse(e.data)
      if (e.event === 'delta') onDelta(payload.text as string)
      else if (e.event === 'done') reply = payload.reply as string
      else if (e.event === 'error') throw new ApiError(502, payload.code ?? 'COACH_FAILED', payload.message ?? 'The tutor could not respond right now. Please try again.')
    }
  }
  if (reply === null) throw new ApiError(502, 'COACH_FAILED', 'The reply was cut off. Please try again.')
  return reply
}
