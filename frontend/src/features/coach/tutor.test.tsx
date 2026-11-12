import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi, renderApp, session } from '../../test/utils'
import { CoachPage } from './CoachPage'
import { RichText } from './RichText'
import { parseSse } from './tutorApi'
import { splitSentences } from './voice'

const MODES = [
  { id: 'FREE_CONVERSATION', title: 'Free conversation', description: 'Chat about anything.' },
  { id: 'GRAMMAR_TUTOR', title: 'Grammar tutor', description: 'Learn grammar.' },
  { id: 'INTERVIEW_PRACTICE', title: 'Interview practice', description: 'Practise interviews.' },
  { id: 'ROLEPLAY', title: 'Real-life roleplay', description: 'Practise a situation.' },
]
const base = {
  'POST /api/auth/refresh': session(),
  'GET /api/coach/status': { available: true, consent: true, dailyLimit: 20 },
  'GET /api/coach/modes': MODES,
  'GET /api/coach/preferences': { explanationLanguage: null },
  'GET /api/profile': { displayName: 'Ana', englishLevel: 'B1', interests: [], learningGoals: [], country: 'ES', timeZone: 'UTC', nativeLanguage: 'es', onboardingCompleted: true },
}

/** A server-sent-events reply as the browser would read it. */
function sse(events: [string, unknown][]) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({ start(c) { for (const [e, d] of events) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)); c.close() } }), {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  })
}
const reply = (text: string) => sse([
  ...text.split(' ').map((w, i, a): [string, unknown] => ['delta', { text: w + (i < a.length - 1 ? ' ' : '') }]),
  ['done', { reply: text, mode: 'FREE_CONVERSATION' }],
])

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const type = async (text: string) => {
  await userEvent.type(await screen.findByLabelText('Message to the coach'), text)
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
}
const chats = (api: { calls: { method: string; url: string; body: any }[] }) => api.calls.filter((c) => c.url === '/api/coach/stream')

describe('AI Coach', () => {
  it('is one clean conversation: every mode from the server, voice settings, no history and no Review my text', async () => {
    mockApi(base)
    renderApp(<CoachPage />)
    expect(await screen.findByRole('option', { name: 'Grammar tutor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voice and coach settings' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText(/review my text/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /history/i })).toBeNull()
    expect(screen.getByText(/Voice input is not available in this browser/i)).toBeInTheDocument() // jsdom has no speech recognition
    expect(screen.queryByRole('button', { name: /start voice conversation/i })).toBeNull()
  })

  it('states honestly that the conversation is not saved, and that the provider processes the text', async () => {
    mockApi(base)
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Voice and coach settings' }))
    const note = screen.getByText(/Your conversation is not saved/)
    expect(note).toHaveTextContent(/disappears when you end the session or leave/)
    expect(note).toHaveTextContent(/processed by the AI provider/)
    expect(note).toHaveTextContent(/does not score pronunciation/)
  })

  it('sends the whole live conversation with every message, streams the reply, and never creates or reads stored conversations', async () => {
    const api = mockApi({ ...base, 'POST /api/coach/stream': () => reply('We use does with he, she and it.') })
    renderApp(<CoachPage />)
    await type('Why do we use "does"?')
    expect(await screen.findByText(/We use does with he, she and it\./)).toBeInTheDocument()
    expect(chats(api)[0].body).toEqual({ mode: 'FREE_CONVERSATION', messages: [{ role: 'user', content: 'Why do we use "does"?' }], language: null, topicId: null, scenario: null, spoken: false })

    await type('One more example please.')
    await waitFor(() => expect(chats(api)).toHaveLength(2))
    expect(chats(api)[1].body.messages).toEqual([
      { role: 'user', content: 'Why do we use "does"?' },
      { role: 'assistant', content: 'We use does with he, she and it.' },
      { role: 'user', content: 'One more example please.' },
    ])
    // Nothing conversation-shaped is ever requested from, or written to, the server.
    expect(api.calls.some((c) => /conversations/.test(c.url))).toBe(false)
    expect(api.calls.some((c) => c.method === 'GET' && c.url.startsWith('/api/coach/') && !/status|modes|preferences/.test(c.url))).toBe(false)
  })

  it('ending the session clears the conversation, and the next message starts fresh', async () => {
    const api = mockApi({ ...base, 'POST /api/coach/stream': () => reply('Hello there!') })
    renderApp(<CoachPage />)
    await type('Hi coach')
    await screen.findByText('Hello there!')
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(screen.queryByText('Hello there!')).toBeNull()
    expect(screen.queryByText('Hi coach')).toBeNull()
    await type('A new topic')
    await waitFor(() => expect(chats(api)).toHaveLength(2))
    expect(chats(api)[1].body.messages).toEqual([{ role: 'user', content: 'A new topic' }])
  })

  it('leaving the page drops the conversation: coming back shows an empty coach', async () => {
    mockApi({ ...base, 'POST /api/coach/stream': () => reply('Hello there!') })
    const first = renderApp(<CoachPage />)
    await type('Remember this please')
    await screen.findByText('Hello there!')
    first.unmount()
    renderApp(<CoachPage />)
    await screen.findByLabelText('Message to the coach')
    expect(screen.queryByText('Remember this please')).toBeNull()
    expect(screen.queryByText('Hello there!')).toBeNull()
  })

  it('switching mode keeps the conversation in memory and the next request carries the new mode', async () => {
    const api = mockApi({ ...base, 'POST /api/coach/stream': () => reply('Hello there!') })
    renderApp(<CoachPage />)
    await type('Hi coach')
    await screen.findByText('Hello there!')
    await userEvent.selectOptions(screen.getByLabelText('What would you like to do?'), 'INTERVIEW_PRACTICE')
    expect(await screen.findByText(/Switched to Interview practice\. This conversation carries on\./)).toBeInTheDocument()
    await type('Ask me something')
    await waitFor(() => expect(chats(api)).toHaveLength(2))
    expect(chats(api)[1].body.mode).toBe('INTERVIEW_PRACTICE')
    expect(chats(api)[1].body.messages).toHaveLength(3)
  })

  it('a failed reply can be retried without showing the learner message twice', async () => {
    let attempts = 0
    mockApi({ ...base, 'POST /api/coach/stream': () => (++attempts === 1 ? errorResponse(502, 'COACH_FAILED', 'The tutor could not respond right now. Please try again.') : reply('Here is my answer.')) })
    renderApp(<CoachPage />)
    await type('Explain binary search.')
    expect(await screen.findByRole('alert')).toHaveTextContent('could not respond')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Here is my answer.')).toBeInTheDocument()
    expect(screen.getAllByText('Explain binary search.')).toHaveLength(1)
  })

  it('a connection that drops is reported and can be retried', async () => {
    let attempts = 0
    mockApi({ ...base, 'POST /api/coach/stream': () => { if (++attempts === 1) throw new TypeError('Failed to fetch'); return reply('Back again.') } })
    renderApp(<CoachPage />)
    await type('Hello')
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection was lost/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Back again.')).toBeInTheDocument()
  })

  it('shows the server message when the limit is reached, and nothing from the coach', async () => {
    mockApi({ ...base, 'POST /api/coach/stream': () => errorResponse(429, 'RATE_LIMITED', 'You have reached today’s chat limit.') })
    renderApp(<CoachPage />)
    await type('Hello there')
    expect(await screen.findByRole('alert')).toHaveTextContent('chat limit')
  })

  it('arrives from a lesson with the mode and topic chosen, and saves the explanation language to the account', async () => {
    let saved: string | null = null
    const api = mockApi({
      ...base,
      'GET /api/coach/preferences': () => ({ explanationLanguage: saved }),
      'POST /api/coach/stream': () => reply('Let us start.'),
      'PUT /api/coach/preferences': () => { saved = 'Kannada'; return { explanationLanguage: 'Kannada' } },
    })
    renderApp(<CoachPage />, { route: '/app/coach?mode=GRAMMAR_TUTOR&topic=g2.03' })
    await userEvent.click(await screen.findByRole('button', { name: 'Voice and coach settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Explain in'), 'Kannada')
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/coach/preferences', body: { explanationLanguage: 'Kannada' } }))
    await type('Explain it again.')
    await screen.findByText('Let us start.')
    expect(chats(api)[0].body).toMatchObject({ mode: 'GRAMMAR_TUTOR', topicId: 'g2.03', language: 'Kannada' })
  })

  it('keeps the newest text in view as the reply grows, and offers a way back after you scroll up', async () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    try {
      mockApi({ ...base, 'POST /api/coach/stream': () => reply('One. Two. Three. Four. Five.') })
      renderApp(<CoachPage />)
      await type('Count for me')
      await screen.findByText(/Five\./)
      expect(scrollTo).toHaveBeenCalled()
      const log = screen.getByRole('log', { name: 'Conversation with the coach' })
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 })
      Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 })
      log.scrollTop = 0
      act(() => { log.dispatchEvent(new Event('scroll')) })
      const latest = await screen.findByRole('button', { name: /latest/i })
      scrollTo.mockClear()
      await userEvent.click(latest)
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 2000 }))
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    }
  })
})

describe('helpers', () => {
  it('parses server-sent events across chunk boundaries', () => {
    const first = parseSse('event: delta\ndata: {"text":"Hel"}\n\nevent: del')
    expect(first.events).toEqual([{ event: 'delta', data: '{"text":"Hel"}' }])
    const second = parseSse(first.rest + 'ta\ndata: {"text":"lo"}\n\n')
    expect(second.events).toEqual([{ event: 'delta', data: '{"text":"lo"}' }])
    expect(second.rest).toBe('')
  })

  it('splits a streamed reply into complete sentences for speaking', () => {
    expect(splitSentences('Good question! We use does with')).toEqual({ sentences: ['Good question!'], rest: 'We use does with' })
    expect(splitSentences('One. Two? Three')).toEqual({ sentences: ['One.', 'Two?'], rest: 'Three' })
    expect(splitSentences('No end yet')).toEqual({ sentences: [], rest: 'No end yet' })
    expect(splitSentences('Line one\nLine two')).toEqual({ sentences: ['Line one'], rest: 'Line two' })
  })

  it('shows lists and bold text but never renders markup from a reply', () => {
    const { container } = render(<RichText text={'Use **does** like this:\n- She works\n- Does she work?\n\n<img src=x onerror=alert(1)> <script>x</script>'} />)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(within(container).getByText('does').tagName).toBe('STRONG')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('Voice conversation', () => {
  class FakeRecognition {
    static instances: FakeRecognition[] = []
    lang = ''
    interimResults = false
    continuous = false
    onresult: ((e: { results: unknown[] }) => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
    onend: (() => void) | null = null
    started = false
    aborted = false
    constructor() { FakeRecognition.instances.push(this) }
    start() { this.started = true }
    stop() { setTimeout(() => this.onend?.(), 5) }
    abort() { this.aborted = true }
    say(text: string) { this.onresult?.({ results: [{ 0: { transcript: text }, isFinal: false }] }) }
  }
  class Utterance {
    text: string
    lang = ''
    voice = null
    rate = 1
    pitch = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    onboundary: (() => void) | null = null
    constructor(t: string) { this.text = t }
  }
  const utterances: Utterance[] = []
  const cancel = vi.fn()
  const current = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]

  beforeEach(() => {
    FakeRecognition.instances = []
    utterances.length = 0
    cancel.mockClear()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    // The voice speaks each sentence for a moment: it starts (the text appears) and then ends.
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (u: Utterance) => { utterances.push(u); setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 5) }, 0) } })
  })

  it('listens with a live bubble, waits for Done, sends the words as a voice message, shows and speaks the reply, then listens again', async () => {
    const api = mockApi({ ...base, 'POST /api/coach/stream': () => reply('Good question! We use does with he, she and it.') })
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice conversation' }))
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(1))
    expect(current().continuous).toBe(true)
    expect(screen.getByRole('status', { name: 'Listening' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Done speaking/ })).toBeDisabled() // nothing heard yet

    act(() => current().say('Why do we use does'))
    expect(within(screen.getByRole('status', { name: 'Listening' })).getByText('Why do we use does')).toBeInTheDocument() // shown as it is heard
    await new Promise((r) => setTimeout(r, 1200)) // an ordinary pause: nothing is sent yet
    expect(chats(api)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /Done speaking/ }))
    expect(await screen.findByText(/We use does with he, she and it\./, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(chats(api)[0].body).toMatchObject({ messages: [{ role: 'user', content: 'Why do we use does' }], spoken: true })
    await waitFor(() => expect(utterances.map((u) => u.text)).toEqual(['Good question!', 'We use does with he, she and it.']), { timeout: 3000 })
    // After the coach finishes speaking, the microphone opens again by itself, with a single new recogniser.
    await waitFor(() => expect(FakeRecognition.instances.length).toBeGreaterThanOrEqual(2), { timeout: 3000 })
    await userEvent.click(screen.getByRole('button', { name: 'End voice' }))
    expect(await screen.findByRole('button', { name: 'Start voice conversation' })).toBeInTheDocument()
  })

  it('shows the coach\'s words only as they are spoken', async () => {
    // A voice that starts the first sentence and then waits: the second sentence must not be on screen yet.
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (u: Utterance) => { utterances.push(u) } })
    mockApi({ ...base, 'POST /api/coach/stream': () => reply('Good question! We use does with he, she and it.') })
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice conversation' }))
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(1))
    act(() => current().say('Why do we use does'))
    await userEvent.click(screen.getByRole('button', { name: /Done speaking/ }))
    await waitFor(() => expect(utterances).toHaveLength(1), { timeout: 3000 })
    expect(screen.queryByText(/Good question/)).toBeNull() // queued, not yet spoken: not on screen
    act(() => { utterances[0].onstart?.() })
    await waitFor(() => expect(screen.getByText(/Good question!/)).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText(/We use does/)).toBeNull() // the next sentence has not been spoken
  })

  it('tells the learner when the microphone is blocked and falls back to typing, keeping what was heard', async () => {
    mockApi(base)
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice conversation' }))
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(1))
    act(() => current().say('Hello coach'))
    act(() => current().onerror?.({ error: 'not-allowed' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('microphone is blocked')
    expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message to the coach')).toHaveValue('Hello coach')
  })

  it('an interruption stops the voice at once, keeps only what was spoken, and listens again', async () => {
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (u: Utterance) => { utterances.push(u) } }) // never finishes speaking
    const api = mockApi({ ...base, 'POST /api/coach/stream': () => reply('This is a long answer. It has two sentences.') })
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice conversation' }))
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(1))
    act(() => current().say('Tell me something'))
    await userEvent.click(screen.getByRole('button', { name: /Done speaking/ }))
    await waitFor(() => expect(utterances).toHaveLength(1), { timeout: 3000 })
    act(() => { utterances[0].onstart?.() })
    expect(await screen.findByText(/This is a long answer\./, undefined, { timeout: 3000 })).toBeInTheDocument() // spoken, so shown
    await userEvent.click(await screen.findByRole('button', { name: 'Interrupt' }))
    expect(cancel).toHaveBeenCalled()
    await waitFor(() => expect(FakeRecognition.instances.length).toBeGreaterThanOrEqual(2))
    expect(utterances).toHaveLength(1) // the second sentence is never spoken

    // What the learner heard is what the coach is taken to have said.
    act(() => current().say('Okay but why'))
    await userEvent.click(screen.getByRole('button', { name: /Done speaking/ }))
    await waitFor(() => expect(chats(api)).toHaveLength(2), { timeout: 3000 })
    const second = chats(api)[1].body.messages
    expect(second[1].role).toBe('assistant')
    expect(second[1].content).not.toContain('two sentences')
  })

  it('stops with a message when nothing is heard, instead of listening for ever', async () => {
    mockApi(base)
    renderApp(<CoachPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice conversation' }))
    for (let i = 1; i <= 3; i++) {
      await waitFor(() => expect(FakeRecognition.instances).toHaveLength(i), { timeout: 3000 })
      act(() => current().onend?.()) // the browser ended the recording with nothing heard
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('did not hear anything')
  })

  it('ending the session stops listening and speaking and clears everything', async () => {
    mockApi({ ...base, 'POST /api/coach/stream': () => reply('Hello there.') })
    renderApp(<CoachPage />)
    await type('Hi')
    await screen.findByText('Hello there.')
    await userEvent.click(screen.getByRole('button', { name: 'Start voice conversation' }))
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(current().aborted).toBe(true)
    expect(screen.queryByText('Hello there.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeInTheDocument()
  })
})
