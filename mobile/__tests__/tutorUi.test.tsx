import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('../src/lib/api', () => ({ ApiError: class extends Error { status = 429 }, api: (...args: unknown[]) => mockApi(...args) }))
jest.mock('../src/features/main/tutorApi', () => {
  const actual = jest.requireActual('../src/features/main/tutorApi')
  class Aborted extends Error {}
  return {
    ...actual,
    Aborted,
    savePreferredLanguage: (...a: unknown[]) => mockSavePrefs(...a),
    streamChat: (...a: unknown[]) => mockStream(...a),
  }
})
const mockApi = jest.fn()
const mockSavePrefs = jest.fn()
const mockStream = jest.fn()

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TutorChat } from '../src/features/main/TutorChat'
import { RichText } from '../src/features/main/RichText'
import { ApiError } from '../src/lib/api'
import { parseSse } from '../src/features/main/tutorApi'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const MODES = [
  { id: 'FREE_CONVERSATION', title: 'Free conversation', description: 'Chat about anything.' },
  { id: 'GRAMMAR_TUTOR', title: 'Grammar tutor', description: 'Learn grammar.' },
  { id: 'INTERVIEW_PRACTICE', title: 'Interview practice', description: 'Practise interviews.' },
  { id: 'SENTENCE_CORRECTION', title: 'Sentence correction', description: 'Get sentences corrected.' },
  { id: 'GENERAL', title: 'General questions', description: 'Ask anything.' },
]

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}>{ui}</QueryClientProvider></SafeAreaProvider>) })
  await settle()
  return r
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const press = (r: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
  if (!node) throw new Error(`no pressable labelled "${label}"`)
  return node
}
const has = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function').length > 0
const input = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.props.accessibilityLabel === 'Message to the coach' && typeof n.props.onChangeText === 'function')[0]

async function sendText(r: ReactTestRenderer.ReactTestRenderer, t: string) {
  act(() => input(r).props.onChangeText(t))
  await act(async () => { press(r, 'Send message').props.onPress() })
  await settle()
}

const openSettings = (r: ReactTestRenderer.ReactTestRenderer) => act(() => press(r, 'Voice and coach settings').props.onPress())
const sentBody = (call = 0) => mockStream.mock.calls[call][0]

beforeEach(() => {
  for (const m of [mockApi, mockSavePrefs, mockStream]) m.mockReset()
  mockApi.mockImplementation((path: string) => Promise.resolve(path === '/api/coach/modes' ? MODES : { explanationLanguage: null }))
  mockStream.mockImplementation(async (_req: unknown, onDelta: (p: string) => void) => { onDelta('Good '); onDelta('question!'); return 'Good question!' })
})

describe('AI Coach (Android)', () => {
  it('opens like a messaging app: honest starting points, no history, no Review my text', async () => {
    const r = await render(<TutorChat />)
    const t = text(r)
    expect(t).toContain('What would you like to talk about?')
    expect(t).toContain('Try asking')
    expect(t).toContain('Free conversation')
    expect(t).not.toMatch(/review my text/i)
    expect(has(r, 'Conversation history')).toBe(false)
    expect(has(r, 'Voice and coach settings')).toBe(true)
    expect(mockStream).not.toHaveBeenCalled()
    expect(has(r, 'Send message')).toBe(true)
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Send message' && n.props.accessibilityState)[0].props.accessibilityState.disabled).toBe(true)
  })

  it('states honestly that the conversation is not saved, that the provider processes the text, and that pronunciation is not scored', async () => {
    const r = await render(<TutorChat />)
    openSettings(r)
    const t = text(r)
    expect(t).toContain('Your conversation is not saved')
    expect(t).toContain('disappears when you end the session or close the app')
    expect(t).toContain('processed by the AI provider')
    expect(t).toContain('does not score pronunciation')
  })

  it('a starting point only fills the message box and chooses a mode; nothing is sent', async () => {
    const r = await render(<TutorChat />)
    act(() => press(r, 'Explain the present perfect').props.onPress())
    expect(input(r).props.value).toBe('Explain the present perfect')
    expect(text(r)).toContain('Grammar tutor')
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('sends the whole live conversation with every message and shows the streamed reply; nothing is requested from or written to a conversation store', async () => {
    const r = await render(<TutorChat />)
    await sendText(r, 'Why do we use "does"?')
    expect(sentBody(0)).toEqual({ mode: 'FREE_CONVERSATION', messages: [{ role: 'user', content: 'Why do we use "does"?' }], language: null, topicId: undefined, scenario: null, spoken: false })
    expect(text(r)).toContain('Good question!')
    expect(text(r)).toContain('Why do we use "does"?')
    await sendText(r, 'One more example, please.')
    expect(sentBody(1).messages).toEqual([
      { role: 'user', content: 'Why do we use "does"?' },
      { role: 'assistant', content: 'Good question!' },
      { role: 'user', content: 'One more example, please.' },
    ])
    expect(mockApi.mock.calls.map((c) => c[0]).filter((p) => /conversations/.test(String(p)))).toEqual([])
  })

  it('ending the session clears the conversation, and the next message starts fresh', async () => {
    const r = await render(<TutorChat />)
    await sendText(r, 'Hi coach')
    expect(text(r)).toContain('Good question!')
    await act(async () => { press(r, 'End session').props.onPress() })
    expect(text(r)).not.toContain('Good question!')
    expect(text(r)).not.toContain('Hi coach')
    expect(text(r)).toContain('What would you like to talk about?')
    await sendText(r, 'A new topic')
    expect(sentBody(1).messages).toEqual([{ role: 'user', content: 'A new topic' }])
  })

  it('leaving the screen drops the conversation: coming back shows an empty coach', async () => {
    const first = await render(<TutorChat />)
    await sendText(first, 'Remember this please')
    act(() => first.unmount())
    const again = await render(<TutorChat />)
    expect(text(again)).not.toContain('Remember this please')
    expect(text(again)).toContain('What would you like to talk about?')
  })

  it('shows a typing indicator before the first words arrive, and can stop the reply', async () => {
    mockStream.mockImplementation((_req: unknown, _d: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new (jest.requireMock('../src/features/main/tutorApi').Aborted)()))
    }))
    const r = await render(<TutorChat />)
    act(() => input(r).props.onChangeText('Explain binary search.'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'The coach is thinking').length).toBeGreaterThan(0)
    await act(async () => { press(r, 'Stop the reply').props.onPress() })
    await settle()
    expect(has(r, 'Send message')).toBe(true)
  })

  it('a failed reply shows an error with Try again, and retrying does not repeat the learner message', async () => {
    mockStream.mockRejectedValueOnce(new (ApiError as unknown as new (m: string) => Error)('The tutor could not respond right now. Please try again.'))
    const r = await render(<TutorChat />)
    await sendText(r, 'Explain binary search.')
    expect(text(r)).toContain('The coach could not respond'.replace('coach', 'tutor')) // generic fallback or the server message
    mockStream.mockImplementationOnce(async (_req: unknown, onDelta: (p: string) => void) => { onDelta('Here is my answer.'); return 'Here is my answer.' })
    await act(async () => { press(r, 'Try again').props.onPress() })
    await settle()
    expect(text(r)).toContain('Here is my answer.')
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'You: Explain binary search.').length).toBeGreaterThan(0)
    expect(text(r).split('Explain binary search.').length - 1).toBe(1)
    expect(sentBody(1).messages).toEqual([{ role: 'user', content: 'Explain binary search.' }]) // not sent twice
  })

  it('changing the mode keeps the conversation in memory and the next request carries the new mode', async () => {
    const r = await render(<TutorChat />)
    await sendText(r, 'Hi coach')
    act(() => press(r, 'Mode: Free conversation. Change mode').props.onPress())
    act(() => press(r, 'Interview practice').props.onPress())
    await settle()
    expect(text(r)).toContain('Switched to Interview practice. This conversation carries on.')
    expect(text(r)).toContain('Hi coach')
    await sendText(r, 'Ask me something')
    expect(sentBody(1).mode).toBe('INTERVIEW_PRACTICE')
    expect(sentBody(1).messages).toHaveLength(3)
  })

  it('saves the explanation language to the account', async () => {
    mockSavePrefs.mockResolvedValue({ explanationLanguage: 'Kannada' })
    const r = await render(<TutorChat />)
    openSettings(r)
    let node: ReactTestRenderer.ReactTestInstance | null = r.root.findAll((n) => n.props.children === 'Kannada')[0]
    while (node && typeof node.props.onPress !== 'function') node = node.parent
    await act(async () => { node!.props.onPress() })
    expect(mockSavePrefs).toHaveBeenCalledWith('Kannada')
  })

  it('arrives from a lesson with the mode and topic chosen', async () => {
    const r = await render(<TutorChat initialMode="GRAMMAR_TUTOR" topicId="g2.03" />)
    await sendText(r, 'Explain it again.')
    expect(sentBody(0)).toMatchObject({ mode: 'GRAMMAR_TUTOR', topicId: 'g2.03' })
  })

  it('without a speech service no microphone is offered, and the keyboard dictation key is mentioned honestly', async () => {
    const r = await render(<TutorChat />)
    expect(has(r, 'Start voice conversation')).toBe(false)
    expect(text(r)).toContain('Voice is not available on this phone')
    expect(text(r)).toContain('keyboard’s microphone key')
  })

  it('keeps the newest text in view: new content scrolls to the end, and after scrolling up a "Latest" button brings you back', async () => {
    const r = await render(<TutorChat />)
    await sendText(r, 'Count for me')
    const list = r.root.findAll((n) => typeof n.props.onScroll === 'function' && typeof n.props.onContentSizeChange === 'function')[0]
    const scrollToEnd = jest.fn()
    // The FlatList instance's scrollToEnd is what auto-scroll calls; spy on it through the ref the component holds.
    const instance = r.root.findAll((n) => typeof n.instance?.scrollToEnd === 'function')[0]?.instance
    if (instance) instance.scrollToEnd = scrollToEnd
    act(() => list.props.onContentSizeChange(0, 1200))
    expect(scrollToEnd).toHaveBeenCalled()
    expect(has(r, 'Jump to the latest message')).toBe(false)
    act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 500 } } }))
    expect(has(r, 'Jump to the latest message')).toBe(true)
    scrollToEnd.mockClear()
    act(() => list.props.onContentSizeChange(0, 2100))
    expect(scrollToEnd).not.toHaveBeenCalled() // you scrolled up on purpose: it does not yank you down
    act(() => press(r, 'Jump to the latest message').props.onPress())
    expect(scrollToEnd).toHaveBeenCalled()
    expect(has(r, 'Jump to the latest message')).toBe(false)
  })
})

describe('helpers', () => {
  it('parses server-sent events across chunk boundaries', () => {
    const first = parseSse('event: delta\ndata: {"text":"Hel"}\n\nevent: del')
    expect(first.events).toEqual([{ event: 'delta', data: '{"text":"Hel"}' }])
    expect(parseSse(first.rest + 'ta\ndata: {"text":"lo"}\n\n').events).toEqual([{ event: 'delta', data: '{"text":"lo"}' }])
  })

  it('shows lists and bold text, and never anything else, from a reply', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer
    await act(async () => { r = ReactTestRenderer.create(<RichText text={'Use **does** like this:\n- She works\n- Does she work?\n\n<b>not bold</b>'} />) })
    const t = flat(r.toJSON())
    expect(t).toContain('Use does like this:')
    expect(t).toContain('•')
    expect(t).toContain('She works')
    expect(t).toContain('<b>not bold</b>')
  })
})
