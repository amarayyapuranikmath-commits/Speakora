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
  for (;;) {
    const { value, done } = await reader.read()
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
