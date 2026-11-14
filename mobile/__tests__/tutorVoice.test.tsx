import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('../src/lib/api', () => ({ ApiError: class extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code } }, api: (...args: unknown[]) => mockApi(...args) }))
jest.mock('../src/features/main/tutorApi', () => {
  const actual = jest.requireActual('../src/features/main/tutorApi')
  class Aborted extends Error {}
  return { ...actual, Aborted, streamChat: (...a: unknown[]) => mockStream(...a) }
})
jest.mock('../src/lib/speech', () => ({
  ...jest.requireActual('../src/lib/speech'),
  checkSupport: () => mockSupport(),
  listenTurn: (h: unknown) => mockListenTurn(h),
  createSpeaker: (idle: () => void, interrupted: () => void, speed: string, hooks: unknown) => mockSpeaker(idle, interrupted, speed, hooks),
  openAppSettings: () => mockOpenSettings(),
}))
const mockApi = jest.fn()
const mockStream = jest.fn()
const mockSupport = jest.fn()
const mockListenTurn = jest.fn()
const mockSpeaker = jest.fn()
const mockOpenSettings = jest.fn()

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TutorChat } from '../src/features/main/TutorChat'
import { ApiError } from '../src/lib/api'

interface TurnHandlers { level?: string | null; onText: (t: string) => void; onCommit: (t: string) => void; onError: (c: string, heard: string) => void }
interface FakeSpeaker { push: jest.Mock; finish: jest.Mock; stop: jest.Mock; revealed: jest.Mock; idle: () => void; interrupted: () => void; speed: string; hooks: { onReveal?: (t: string) => void } }
const turns: TurnHandlers[] = []
const handles: { finish: jest.Mock; cancel: jest.Mock }[] = []
const speakers: FakeSpeaker[] = []
const lastTurn = () => turns[turns.length - 1]

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const MODES = [{ id: 'FREE_CONVERSATION', title: 'Free conversation', description: 'Chat about anything.' }]

const tree = (suspended: boolean, client: QueryClient) => <SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}><TutorChat suspended={suspended} level="A2" /></QueryClientProvider></SafeAreaProvider>
async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { r = ReactTestRenderer.create(tree(false, client)) })
  await settle()
  ;(r as unknown as { client: QueryClient }).client = client
  return r
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const find = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')
const press = (r: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = find(r, label)[0]
  if (!node) throw new Error(`no pressable labelled "${label}"`)
  return node
}
const has = (r: ReactTestRenderer.ReactTestRenderer, label: string) => find(r, label).length > 0
const input = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.props.accessibilityLabel === 'Message to the coach' && typeof n.props.onChangeText === 'function')[0]

async function startVoice(r: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => { press(r, 'Start voice conversation').props.onPress() })
  await settle()
}
const openSettings = (r: ReactTestRenderer.ReactTestRenderer) => act(() => press(r, 'Voice and coach settings').props.onPress())

beforeEach(() => {
  for (const m of [mockApi, mockStream, mockSupport, mockListenTurn, mockSpeaker, mockOpenSettings]) m.mockReset()
  turns.length = 0
  handles.length = 0
  speakers.length = 0
  mockApi.mockImplementation((path: string) => Promise.resolve(path === '/api/coach/modes' ? MODES : { explanationLanguage: null }))
  mockStream.mockImplementation(async (_req: unknown, onDelta: (p: string) => void) => { onDelta('Good '); onDelta('question!'); return 'Good question!' })
  mockSupport.mockResolvedValue({ recognition: true, synthesis: true })
  mockListenTurn.mockImplementation((h: TurnHandlers) => {
    turns.push(h)
    const handle = { finish: jest.fn(), cancel: jest.fn() }
    handles.push(handle)
    return handle
  })
  mockSpeaker.mockImplementation((idle: () => void, interrupted: () => void, speed: string, hooks: FakeSpeaker['hooks']) => {
    const sp: FakeSpeaker = { push: jest.fn(), finish: jest.fn(), stop: jest.fn(() => ''), revealed: jest.fn(() => ''), idle, interrupted, speed, hooks }
    speakers.push(sp)
    return sp
  })
})

describe('AI Coach voice conversation (Android)', () => {
  it('says plainly what voice does with audio and that pronunciation is not scored', async () => {
    const r = await render()
    expect(has(r, 'Start voice conversation')).toBe(true)
    openSettings(r)
    expect(text(r)).toContain('may send audio to its provider')
    expect(text(r)).toContain('never receives or stores audio')
    expect(text(r)).toContain('does not score pronunciation')
  })

  it('listens for a whole turn with the learner level, shows the words as they are heard, waits for the turn to end, then sends them as a voice message', async () => {
    const r = await render()
    await startVoice(r)
    expect(lastTurn().level).toBe('A2') // beginners get more time
    expect(text(r)).toContain('Listening')
    expect(has(r, 'End voice')).toBe(true)
    expect(find(r, 'Done speaking')[0].props.accessibilityState.disabled).toBe(true) // nothing heard yet
    act(() => lastTurn().onText('I want to prac'))
    expect(text(r)).toContain('I want to prac') // shown live in the conversation
    expect(find(r, 'Done speaking')[0].props.accessibilityState.disabled).toBe(false)
    expect(mockStream).not.toHaveBeenCalled() // a pause is not the end of the turn
    act(() => lastTurn().onText('I want to practise my English'))
    await act(async () => { lastTurn().onCommit('I want to practise my English') })
    await settle()
    expect(mockStream.mock.calls[0][0]).toMatchObject({ messages: [{ role: 'user', content: 'I want to practise my English' }], spoken: true })
    expect(text(r)).toContain('I want to practise my English')
    expect(speakers).toHaveLength(1)
    expect(speakers[0].push.mock.calls.map((c) => c[0]).join('')).toBe('Good question!')
    expect(speakers[0].finish).toHaveBeenCalled()
  })

  it('Done speaking ends the turn at once', async () => {
    const r = await render()
    await startVoice(r)
    act(() => lastTurn().onText('I want to tell you about my'))
    act(() => press(r, 'Done speaking').props.onPress())
    expect(handles[0].finish).toHaveBeenCalled()
  })

  it('shows the coach\'s words only as they are spoken, then listens again when it has finished', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Why do we use does') })
    await settle()
    expect(text(r)).not.toContain('Good question!') // streamed from the server but not spoken yet: not on screen
    act(() => speakers[0].hooks.onReveal?.('Good'))
    expect(text(r)).toContain('Good')
    expect(text(r)).not.toContain('Good question!')
    act(() => speakers[0].hooks.onReveal?.('Good question!'))
    expect(text(r)).toContain('Good question!')
    expect(text(r)).toContain('Speaking')
    const before = turns.length
    await act(async () => { speakers[0].idle() })
    await settle()
    expect(turns.length).toBe(before + 1) // back to listening once the coach has finished speaking
    expect(text(r)).toContain('Listening')
  })

  it('after a typed reply the microphone still works in the same session and the spoken turn carries the earlier conversation', async () => {
    const r = await render()
    act(() => input(r).props.onChangeText('Hello coach'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(text(r)).toContain('Good question!')
    expect(has(r, 'Send message')).toBe(true) // the reply is over: not stuck busy
    await startVoice(r)
    expect(turns).toHaveLength(1)
    act(() => lastTurn().onText('How are you'))
    await act(async () => { lastTurn().onCommit('How are you') })
    await settle()
    expect(mockStream).toHaveBeenCalledTimes(2)
    const second = mockStream.mock.calls[1][0] as { messages: { role: string; content: string }[]; spoken: boolean }
    expect(second.spoken).toBe(true)
    expect(second.messages.map((m) => m.content)).toEqual(['Hello coach', 'Good question!', 'How are you'])
  })

  it('tapping the microphone while a reply is still streaming stops that reply, and the spoken turn is then sent (not dropped as "busy")', async () => {
    let release: (v: string) => void = () => undefined
    mockStream.mockReset()
    mockStream.mockImplementationOnce((_req: unknown, onDelta: (p: string) => void, signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
      onDelta('Partial ')
      release = resolve
      signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    mockStream.mockImplementation(async (_req: unknown, onDelta: (p: string) => void) => { onDelta('Second reply'); return 'Second reply' })
    const r = await render()
    act(() => input(r).props.onChangeText('first typed'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(has(r, 'Stop the reply')).toBe(true) // the first reply is still going
    await startVoice(r)
    await settle()
    expect(has(r, 'Stop the reply')).toBe(false) // stopped by starting the microphone
    expect(turns).toHaveLength(1)
    await act(async () => { lastTurn().onCommit('now I speak') })
    await settle()
    expect(mockStream).toHaveBeenCalledTimes(2)
    expect((mockStream.mock.calls[1][0] as { messages: { content: string }[] }).messages.map((m) => m.content)).toEqual(['first typed', 'Partial', 'now I speak'])
    release('x')
  })

  it('a spoken turn is sent even if the microphone was opened from a render that still said busy', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('first spoken') })
    await settle()
    expect(speakers).toHaveLength(1)
    // The coach finishes speaking at the very moment the previous request is wrapping up; listening reopens at once.
    await act(async () => { speakers[0].idle() })
    await settle()
    expect(turns).toHaveLength(2)
    await act(async () => { lastTurn().onCommit('second spoken') })
    await settle()
    expect(mockStream).toHaveBeenCalledTimes(2)
  })

  it('a typed message is spoken only when "read replies aloud" is on, and that never turns the microphone on', async () => {
    const r = await render()
    act(() => input(r).props.onChangeText('Hello'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(speakers).toHaveLength(0)
    expect(text(r)).toContain('Good question!') // typed replies appear as they stream
    openSettings(r)
    act(() => r.root.findAll((n) => n.props.label === 'Read replies aloud' && typeof n.props.onChange === 'function')[0].props.onChange(true))
    act(() => input(r).props.onChangeText('Another one'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(speakers).toHaveLength(1)
    expect(speakers[0].push).toHaveBeenCalled()
    expect(turns).toHaveLength(0)
  })

  it('speaks at the speed saved on the account (Normal when none is saved)', async () => {
    let r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Hello') })
    await settle()
    expect(speakers[0].speed).toBe('NORMAL')

    mockApi.mockImplementation((path: string) => Promise.resolve(path === '/api/coach/modes' ? MODES : { explanationLanguage: null, speechSpeed: 'SLOW' }))
    speakers.length = 0
    r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Hello again') })
    await settle()
    expect(speakers[0].speed).toBe('SLOW')
  })

  it('the learner can interrupt: speech stops at once, only what was spoken is kept, and listening starts again', async () => {
    mockStream.mockImplementation((_req: unknown, onDelta: (p: string) => void, signal: AbortSignal) => new Promise((_res, rej) => {
      onDelta('A long answer. ')
      signal.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Tell me a story') })
    await settle()
    act(() => speakers[0].hooks.onReveal?.('A long answer.'))
    speakers[0].stop.mockReturnValue('A long answer.')
    expect(has(r, 'Interrupt')).toBe(true)
    const before = turns.length
    await act(async () => { press(r, 'Interrupt').props.onPress() })
    await wait(250)
    expect(speakers[0].stop).toHaveBeenCalled()
    expect(turns.length).toBe(before + 1)
    expect(text(r)).toContain('A long answer.')
    expect(text(r)).toContain('Stopped.')
    // The next request carries what the learner actually heard.
    await act(async () => { lastTurn().onCommit('Okay but why') })
    await settle()
    expect(mockStream.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'Tell me a story' },
      { role: 'assistant', content: 'A long answer.' },
      { role: 'user', content: 'Okay but why' },
    ])
  })

  it('ending the voice conversation stops the microphone and the voice', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Hello coach') })
    await settle()
    await act(async () => { press(r, 'End voice').props.onPress() })
    expect(speakers[0].stop).toHaveBeenCalled()
    expect(has(r, 'Start voice conversation')).toBe(true)
  })

  it('ending the voice conversation while listening cancels the recording', async () => {
    const r = await render()
    await startVoice(r)
    act(() => lastTurn().onText('Half a sentence'))
    await act(async () => { press(r, 'End voice').props.onPress() })
    expect(handles[0].cancel).toHaveBeenCalled()
    expect(mockStream).not.toHaveBeenCalled()
    expect(has(r, 'Start voice conversation')).toBe(true)
  })

  it('a refused microphone ends voice with a clear message and an Open phone settings button, keeping what was heard', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onError('permission', 'Hello coach') })
    expect(text(r)).toContain('The microphone is off for this app')
    expect(has(r, 'Start voice conversation')).toBe(true)
    expect(input(r).props.value).toBe('Hello coach')
    act(() => press(r, 'Open phone settings').props.onPress())
    expect(mockOpenSettings).toHaveBeenCalled()
  })

  it('a network failure in speech recognition ends voice and says so; typing still works', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onError('network', '') })
    expect(text(r)).toContain('needs an internet connection')
    act(() => input(r).props.onChangeText('I typed this instead'))
    await act(async () => { press(r, 'Send message').props.onPress() })
    await settle()
    expect(mockStream.mock.calls[0][0]).toMatchObject({ messages: [{ role: 'user', content: 'I typed this instead' }], spoken: false })
  })

  it('silence ends voice politely instead of listening for ever', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onError('no-speech', '') })
    expect(text(r)).toContain('I did not hear anything')
    expect(has(r, 'Start voice conversation')).toBe(true)
  })

  it('a call or another app taking the audio stops the voice conversation and tells the learner', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('Hello') })
    await settle()
    await act(async () => { speakers[0].interrupted() })
    expect(text(r)).toContain('took the audio')
    expect(has(r, 'Start voice conversation')).toBe(true)
  })

  it('a failed reply during voice ends voice and offers Try again', async () => {
    mockStream.mockRejectedValueOnce(new ApiError(502, 'COACH_FAILED', 'The tutor could not respond right now.'))
    const r = await render()
    await startVoice(r)
    await act(async () => { lastTurn().onCommit('What is a verb') })
    await settle()
    expect(text(r)).toContain('The tutor could not respond right now.')
    expect(has(r, 'Start voice conversation')).toBe(true)
    expect(has(r, 'Try again')).toBe(true)
  })

  it('switching to another tab or starting a call ends the voice conversation and releases the microphone', async () => {
    const r = await render()
    await startVoice(r)
    await act(async () => { r.update(tree(true, (r as unknown as { client: QueryClient }).client)) })
    expect(handles[0].cancel).toHaveBeenCalled()
    expect(has(r, 'Start voice conversation')).toBe(true)
    await act(async () => { press(r, 'Start voice conversation').props.onPress() })
    expect(text(r)).toContain('not available while you are in a call')
    expect(turns).toHaveLength(1) // it never listened again
  })

  it('the microphone is released when the screen goes away', async () => {
    const r = await render()
    await startVoice(r)
    act(() => r.unmount())
    expect(handles[0].cancel).toHaveBeenCalled()
  })
})
