import { ApiError, api, getAccessToken, getBaseUrl, refreshSession } from '../../lib/api'

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

export interface SseEvent { event: string; data: string }

/** Splits a growing text buffer into complete server-sent events; returns the rest that is still incomplete. */
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

export class Aborted extends Error {
  constructor() { super('aborted') }
}

export interface Turn { role: 'user' | 'assistant'; content: string }

export interface ChatRequest {
  mode: string
  /** The live conversation, oldest first, ending with the learner's message. It exists only in memory on this phone. */
  messages: Turn[]
  language?: string | null
  topicId?: string | null
  scenario?: string | null
  spoken: boolean
}

/** The most recent turns that are sent. The conversation lives in memory on this phone and nothing is stored on the server. */
export const MAX_CONTEXT_TURNS = 20

const bodyOf = (req: ChatRequest) => ({ ...req, messages: req.messages.slice(-MAX_CONTEXT_TURNS), language: req.language ?? null, topicId: req.topicId ?? null, scenario: req.scenario ?? null })

/** The whole reply at once, through the plain endpoint. Nothing is stored. */
export const chatWhole = (req: ChatRequest) => api<{ reply: string }>('/api/coach/chat', { method: 'POST', body: bodyOf(req) }).then((r) => r.reply)

/**
 * Sends the live conversation and delivers the reply piece by piece, as it is written. React Native reads a streamed response through
 * XMLHttpRequest progress events. If the connection cannot be made before anything arrives, the plain endpoint is used instead, so a
 * device or network that cannot stream still gets its answer. The server keeps nothing. Aborting stops the reply.
 */
export function streamChat(req: ChatRequest, onDelta: (piece: string) => void, signal?: AbortSignal): Promise<string> {
  const body = JSON.stringify(bodyOf(req))
  const attempt = (retriedAuth: boolean): Promise<string> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${getBaseUrl()}/api/coach/stream`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Accept', 'text/event-stream')
    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    let offset = 0
    let buffer = ''
    let result: string | null = null
    let failure: ApiError | null = null
    let received = false
    const consume = () => {
      const text = xhr.responseText ?? ''
      buffer += text.slice(offset)
      offset = text.length
      const parsed = parseSse(buffer)
      buffer = parsed.rest
      for (const e of parsed.events) {
        received = true
        const payload = JSON.parse(e.data)
        if (e.event === 'delta') onDelta(payload.text as string)
        else if (e.event === 'done') result = payload.reply as string
        else if (e.event === 'error') failure = new ApiError(502, payload.code ?? 'COACH_FAILED', payload.message ?? 'The tutor could not respond right now. Please try again.')
      }
    }
    xhr.onprogress = () => { if (xhr.status < 400) consume() }
    xhr.onload = () => {
      if (xhr.status === 401 && !retriedAuth) {
        void refreshSession().then((s) => (s ? attempt(true).then(resolve, reject) : reject(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again.'))))
        return
      }
      if (xhr.status >= 400) {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new ApiError(xhr.status, err.code ?? 'UNKNOWN', err.message ?? 'Something went wrong.'))
        } catch {
          reject(new ApiError(xhr.status, 'UNKNOWN', 'Something went wrong. Please try again.'))
        }
        return
      }
      consume()
      if (failure) reject(failure)
      else if (result !== null) resolve(result)
      else reject(new ApiError(502, 'COACH_FAILED', 'The reply was cut off. Please try again.'))
    }
    xhr.onerror = () => (received ? reject(new ApiError(0, 'NETWORK', 'The connection was lost. Check your network and try again.')) : reject(new ApiError(0, 'NETWORK', 'NO_STREAM')))
    xhr.ontimeout = () => reject(new ApiError(0, 'NETWORK', 'The tutor took too long to answer. Please try again.'))
    xhr.timeout = 90_000
    signal?.addEventListener('abort', () => { xhr.abort(); reject(new Aborted()) })
    xhr.send(body)
  })

  return attempt(false).catch((e) => {
    // Nothing arrived and the connection failed: try the plain endpoint once before giving up.
    if (e instanceof ApiError && e.code === 'NETWORK' && e.message === 'NO_STREAM' && !signal?.aborted) {
      return chatWhole(req).then((whole) => { onDelta(whole); return whole })
    }
    throw e
  })
}
