import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { errorResponse, mockApi, session } from '../../test/utils'
import { SPEED_SAMPLE, SpeechSpeedControl } from './SpeechSpeedControl'
import { tutorKeys } from './tutorApi'
import { SPEECH_SPEEDS, createSpeaker, speak, speechSpeedOf } from './voice'

/** A fake browser speech engine: records what was said, how fast, and lets the test finish each sentence. */
class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) { this.text = text }
}
const spoken: FakeUtterance[] = []
const synth = { speak: vi.fn((u: FakeUtterance) => { spoken.push(u) }), cancel: vi.fn(() => { spoken.length = 0 }), getVoices: () => [] }

beforeEach(() => {
  spoken.length = 0
  synth.speak.mockClear()
  synth.cancel.mockClear()
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', synth)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setAccessToken(null) })

describe('speech speeds', () => {
  it('Normal is the default and is slower than the browser\'s own normal, Slow slower still, Fast near the browser rate', () => {
    expect(speechSpeedOf(undefined)).toBe('NORMAL')
    expect(speechSpeedOf('nonsense')).toBe('NORMAL')
    expect(SPEECH_SPEEDS.NORMAL.rate).toBeLessThan(1)
    expect(SPEECH_SPEEDS.SLOW.rate).toBeLessThan(SPEECH_SPEEDS.NORMAL.rate)
    expect(SPEECH_SPEEDS.FAST.rate).toBeGreaterThan(SPEECH_SPEEDS.NORMAL.rate)
    for (const s of Object.values(SPEECH_SPEEDS)) { expect(s.rate).toBeGreaterThanOrEqual(0.7); expect(s.rate).toBeLessThanOrEqual(1.1) }
    expect(SPEECH_SPEEDS.SLOW.pauseMs).toBeGreaterThan(SPEECH_SPEEDS.NORMAL.pauseMs)
    expect(SPEECH_SPEEDS.NORMAL.pauseMs).toBeGreaterThan(SPEECH_SPEEDS.FAST.pauseMs)
  })

  it('one-off speech uses the chosen rate and the natural pitch, and strips markdown', () => {
    speak('**Hello** there', 'SLOW')
    expect(spoken[0].text).toBe('Hello there')
    expect(spoken[0].rate).toBe(SPEECH_SPEEDS.SLOW.rate)
    expect(spoken[0].pitch).toBe(1)
  })
})

describe('the sentence-by-sentence speaker', () => {
  it('speaks one sentence at a time at the chosen rate, with a pause before the next, and reports idle only after the last', () => {
    vi.useFakeTimers()
    const idle = vi.fn()
    const s = createSpeaker(idle, 'SLOW')
    s.push('First sentence. Second sen')
    s.push('tence. Third')
    s.finish()
    expect(spoken.map((u) => u.text)).toEqual(['First sentence.']) // the rest waits its turn
    expect(spoken[0].rate).toBe(SPEECH_SPEEDS.SLOW.rate)

    act(() => spoken[0].onend?.())
    expect(synth.speak).toHaveBeenCalledTimes(1) // paused: the next sentence has not started
    act(() => { vi.advanceTimersByTime(SPEECH_SPEEDS.SLOW.pauseMs - 1) })
    expect(synth.speak).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(2) })
    expect(synth.speak).toHaveBeenCalledTimes(2)
    expect(spoken[1].text).toBe('Second sentence.')
    expect(idle).not.toHaveBeenCalled()

    act(() => spoken[1].onend?.())
    act(() => { vi.advanceTimersByTime(SPEECH_SPEEDS.SLOW.pauseMs + 1) })
    expect(spoken[2].text).toBe('Third')
    act(() => spoken[2].onend?.())
    expect(idle).toHaveBeenCalledTimes(1) // no pause is waited after the very last sentence
  })

  it('starts speaking before the reply is complete, and waits for more text when it runs out', () => {
    vi.useFakeTimers()
    const idle = vi.fn()
    const s = createSpeaker(idle, 'NORMAL')
    s.push('Hello there. ')
    expect(spoken[0].text).toBe('Hello there.')
    act(() => spoken[0].onend?.())
    act(() => { vi.advanceTimersByTime(SPEECH_SPEEDS.NORMAL.pauseMs + 1) })
    expect(idle).not.toHaveBeenCalled() // the reply is still being written
    s.push('And more. ')
    expect(spoken[1].text).toBe('And more.')
    s.finish()
    act(() => spoken[1].onend?.())
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('stop() is an interruption: it silences the voice at once, cancels the pending pause and never reports idle', () => {
    vi.useFakeTimers()
    const idle = vi.fn()
    const s = createSpeaker(idle, 'NORMAL')
    s.push('One. Two. Three. ')
    act(() => spoken[0].onend?.())
    s.stop()
    expect(synth.cancel).toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(synth.speak).toHaveBeenCalledTimes(1)
    s.push('Ignored. ')
    s.finish()
    expect(idle).not.toHaveBeenCalled()
  })

  it('a failed sentence does not stall the conversation', () => {
    vi.useFakeTimers()
    const idle = vi.fn()
    const s = createSpeaker(idle, 'FAST')
    s.push('Broken. Fine. ')
    s.finish()
    act(() => spoken[0].onerror?.())
    act(() => { vi.advanceTimersByTime(SPEECH_SPEEDS.FAST.pauseMs + 1) })
    expect(spoken[1].text).toBe('Fine.')
    act(() => spoken[1].onend?.())
    expect(idle).toHaveBeenCalledTimes(1)
  })
})

describe('the speaking speed setting', () => {
  const wrap = (prefs?: { explanationLanguage: string | null; speechSpeed?: string }) => {
    const client = new QueryClient()
    if (prefs) client.setQueryData(tutorKeys.preferences, prefs)
    return { client, ui: <QueryClientProvider client={client}><SpeechSpeedControl prefs={prefs} /></QueryClientProvider> }
  }

  it('offers Slow, Normal and Fast, with Normal selected by default', () => {
    render(wrap({ explanationLanguage: null }).ui)
    const select = screen.getByLabelText('Speaking speed') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Slow', 'Normal', 'Fast'])
    expect(select.value).toBe('NORMAL')
  })

  it('saves a new choice to the account without touching the language', async () => {
    const api = mockApi({ 'PUT /api/coach/preferences/speech-speed': { explanationLanguage: 'Hindi', speechSpeed: 'SLOW' }, 'POST /api/auth/refresh': session() })
    const { client, ui } = wrap({ explanationLanguage: 'Hindi', speechSpeed: 'NORMAL' })
    render(ui)
    await userEvent.selectOptions(screen.getByLabelText('Speaking speed'), 'SLOW')
    await waitFor(() => expect(api.calls.find((c) => c.url === '/api/coach/preferences/speech-speed')?.body).toEqual({ speechSpeed: 'SLOW' }))
    expect(client.getQueryData<{ explanationLanguage: string; speechSpeed: string }>(tutorKeys.preferences)).toMatchObject({ explanationLanguage: 'Hindi', speechSpeed: 'SLOW' })
  })

  it('goes back to the earlier choice and says so when saving fails', async () => {
    mockApi({ 'PUT /api/coach/preferences/speech-speed': () => errorResponse(500, 'X', 'Server trouble.') })
    const { client, ui } = wrap({ explanationLanguage: null, speechSpeed: 'NORMAL' })
    render(ui)
    await userEvent.selectOptions(screen.getByLabelText('Speaking speed'), 'FAST')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server trouble.')
    expect(client.getQueryData<{ speechSpeed: string }>(tutorKeys.preferences)?.speechSpeed).toBe('NORMAL')
  })

  it('plays a sample at the chosen speed and says it does not change how fast replies are written', async () => {
    render(wrap({ explanationLanguage: null, speechSpeed: 'SLOW' }).ui)
    await userEvent.click(screen.getByRole('button', { name: 'Hear a sample' }))
    expect(SPEED_SAMPLE.startsWith(spoken[0].text)).toBe(true) // the first sentence of the sample is spoken first
    expect(spoken[0].rate).toBe(SPEECH_SPEEDS.SLOW.rate)
    expect(screen.getByRole('button', { name: 'Stop the sample' })).toBeInTheDocument()
    expect(screen.getByText(/does not change how quickly replies are written/)).toBeInTheDocument()
  })
})
