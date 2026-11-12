import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOUNDARY_WAIT_MS, FINAL_WORDS_WAIT_MS, createSpeaker, firstWords, startTurnListening } from './voice'

/** A continuous recogniser as the browser provides it. Words are fed in by the test; stop() ends the recording after the last words arrive. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  static alive = () => FakeRecognition.instances.filter((r) => r.started && !r.ended).length
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: { results: unknown[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  ended = false
  stopped = false
  aborted = false
  constructor() { FakeRecognition.instances.push(this) }
  start() { this.started = true }
  stop() { this.stopped = true; setTimeout(() => this.end(), 50) }
  abort() { this.aborted = true; this.ended = true }
  end() { this.ended = true; this.onend?.() }
  say(...segments: string[]) { this.onresult?.({ results: segments.map((t) => ({ 0: { transcript: t }, isFinal: false })) }) }
}

describe('listening for a whole turn', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); FakeRecognition.instances = []; vi.stubGlobal('SpeechRecognition', FakeRecognition) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const listen = (level: string | null = 'B1') => {
    const log = { text: [] as string[], commits: [] as string[], errors: [] as [string, string][] }
    const l = startTurnListening({ level, onText: (t) => log.text.push(t), onCommit: (t) => log.commits.push(t), onError: (c, h) => log.errors.push([c, h]) })
    return { l, log, r: () => FakeRecognition.instances[FakeRecognition.instances.length - 1] }
  }

  it('keeps the recogniser in continuous mode so the browser does not decide when the turn ends', () => {
    const { r } = listen()
    expect(r().continuous).toBe(true)
    expect(r().interimResults).toBe(true)
  })

  it('does not finish the turn after a one second thinking pause', () => {
    const { log, r } = listen()
    r().say('I think the best way to learn is')
    vi.advanceTimersByTime(1000)
    expect(log.commits).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(log.commits).toEqual([])
  })

  it('finishes the turn after enough silence, and the words of the last second are not lost', () => {
    const { log, r } = listen('B2')
    r().say('I live in Bangalore and I work as a teacher')
    vi.advanceTimersByTime(2300)
    const first = r()
    expect(first.stopped).toBe(true) // asked to stop, not aborted: it may still be finishing the last words
    first.say('I live in Bangalore and I work as a teacher every day') // a late final result arrives
    vi.advanceTimersByTime(FINAL_WORDS_WAIT_MS)
    expect(log.commits).toEqual(['I live in Bangalore and I work as a teacher every day'])
    expect(first.aborted).toBe(false)
  })

  it('delivers once, even though the recogniser ends and the timer also fires', () => {
    const { log, r } = listen('B2')
    r().say('I like football very much')
    vi.advanceTimersByTime(10_000)
    expect(log.commits).toHaveLength(1)
  })

  it('when the browser ends the recording by itself the words are kept and listening carries on with a single new recogniser', () => {
    const { log, r } = listen()
    r().say('My name is Ravi and')
    r().end() // the browser's own silence timeout
    vi.advanceTimersByTime(200)
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(FakeRecognition.alive()).toBe(1)
    r().say('I come from Mysore')
    expect(log.text[log.text.length - 1]).toBe('My name is Ravi and I come from Mysore')
    vi.advanceTimersByTime(6000)
    vi.advanceTimersByTime(FINAL_WORDS_WAIT_MS)
    expect(log.commits).toEqual(['My name is Ravi and I come from Mysore'])
  })

  it('the Done control delivers at once', () => {
    const { l, log, r } = listen()
    r().say('I want to tell you about my')
    l.finish()
    vi.advanceTimersByTime(FINAL_WORDS_WAIT_MS)
    expect(log.commits).toEqual(['I want to tell you about my'])
  })

  it('"that\'s all" ends the turn quickly and is not sent', () => {
    const { log, r } = listen()
    r().say("I like tea that's all")
    vi.advanceTimersByTime(400)
    vi.advanceTimersByTime(FINAL_WORDS_WAIT_MS)
    expect(log.commits).toEqual(['I like tea'])
  })

  it('stops with a message after a few attempts in which nothing was heard', () => {
    const { log, r } = listen()
    for (let i = 0; i < 3; i++) {
      r().end()
      vi.advanceTimersByTime(200)
    }
    expect(log.errors).toEqual([['no-speech', '']])
    expect(FakeRecognition.alive()).toBe(0)
  })

  it('reports a blocked microphone with whatever was heard, and stops', () => {
    const { log, r } = listen()
    r().say('Hello there')
    r().onerror?.({ error: 'not-allowed' })
    expect(log.errors).toEqual([['not-allowed', 'Hello there']])
    expect(FakeRecognition.alive()).toBe(0)
  })

  it('a brief network failure is retried instead of ending the turn', () => {
    const { log, r } = listen()
    r().say('I was saying that')
    r().onerror?.({ error: 'network' })
    r().end()
    vi.advanceTimersByTime(900)
    expect(log.errors).toEqual([])
    expect(FakeRecognition.instances).toHaveLength(2)
    r().onerror?.({ error: 'network' })
    r().end()
    vi.advanceTimersByTime(900)
    r().onerror?.({ error: 'network' })
    expect(log.errors).toEqual([['network', 'I was saying that']])
  })

  it('cancelling delivers nothing and leaves no recogniser running', () => {
    const { l, log, r } = listen()
    r().say('Something I started to say')
    l.cancel()
    vi.advanceTimersByTime(20_000)
    expect(log.commits).toEqual([])
    expect(FakeRecognition.alive()).toBe(0)
    expect(FakeRecognition.instances[0].aborted).toBe(true)
  })

  it('says so when this browser has no speech recognition', async () => {
    vi.unstubAllGlobals()
    const { log } = listen()
    await Promise.resolve()
    expect(log.errors).toEqual([['unsupported', '']])
  })
})

describe('speaking and showing what is spoken', () => {
  class Utterance {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    voice = null
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null = null
    constructor(t: string) { this.text = t }
  }
  const queued: Utterance[] = []
  const cancel = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    queued.length = 0
    cancel.mockClear()
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (u: Utterance) => queued.push(u) })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('keeps the first words of a sentence with their spacing', () => {
    expect(firstWords('We use does with he and she.', 3)).toBe('We use does')
    expect(firstWords('Hello there', 0)).toBe('')
    expect(firstWords('Hello there', 9)).toBe('Hello there')
  })

  it('shows a sentence only when the voice starts it, never ahead of the speech', () => {
    const shown: string[] = []
    const s = createSpeaker(() => undefined, 'NORMAL', { onReveal: (t) => shown.push(t) })
    s.push('Good question! We use does with he, she and it. ')
    expect(queued.map((u) => u.text)).toEqual(['Good question!'])
    expect(shown).toEqual([]) // queued, not yet spoken: nothing on screen
    queued[0].onstart?.()
    vi.advanceTimersByTime(BOUNDARY_WAIT_MS) // this voice reports no word positions, so the sentence is shown whole
    expect(shown[shown.length - 1]).toBe('Good question!')
    queued[0].onend?.()
    vi.advanceTimersByTime(500)
    expect(queued).toHaveLength(2)
    expect(shown[shown.length - 1]).toBe('Good question!') // the second sentence is not shown until it is spoken
    queued[1].onstart?.()
    vi.advanceTimersByTime(BOUNDARY_WAIT_MS)
    expect(shown[shown.length - 1]).toBe('Good question! We use does with he, she and it.')
  })

  it('follows the voice word by word when the voice reports where it is', () => {
    const shown: string[] = []
    const s = createSpeaker(() => undefined, 'NORMAL', { onReveal: (t) => shown.push(t) })
    s.push('We use does with he. ')
    queued[0].onstart?.()
    expect(shown[shown.length - 1]).toBe('') // nothing yet: the voice has not said a word
    queued[0].onboundary?.({ name: 'word', charIndex: 0, charLength: 2 })
    expect(shown[shown.length - 1]).toBe('We')
    queued[0].onboundary?.({ name: 'word', charIndex: 3, charLength: 3 })
    expect(shown[shown.length - 1]).toBe('We use')
    vi.advanceTimersByTime(BOUNDARY_WAIT_MS * 2)
    expect(shown[shown.length - 1]).toBe('We use') // it did report, so it is trusted: still only what was said
    queued[0].onend?.()
    expect(shown[shown.length - 1]).toBe('We use does with he.')
  })

  it('a voice that never reports positions shows the whole sentence once it has started', () => {
    const shown: string[] = []
    const s = createSpeaker(() => undefined, 'NORMAL', { onReveal: (t) => shown.push(t) })
    s.push('This is one sentence. ')
    queued[0].onstart?.()
    vi.advanceTimersByTime(BOUNDARY_WAIT_MS)
    expect(shown[shown.length - 1]).toBe('This is one sentence.')
  })

  it('speaks one sentence at a time, never overlapping', () => {
    const s = createSpeaker(() => undefined)
    s.push('One. Two. Three. ')
    expect(queued).toHaveLength(1)
    queued[0].onend?.()
    vi.advanceTimersByTime(450)
    expect(queued).toHaveLength(2)
    s.stop()
  })

  it('an interruption stops the voice at once, reports only what was spoken, and nothing more is spoken or shown', () => {
    const shown: string[] = []
    let idle = 0
    const s = createSpeaker(() => { idle++ }, 'NORMAL', { onReveal: (t) => shown.push(t) })
    s.push('First sentence here. Second sentence here. ')
    queued[0].onstart?.()
    vi.advanceTimersByTime(BOUNDARY_WAIT_MS)
    const heard = s.stop()
    expect(heard).toBe('First sentence here.')
    expect(cancel).toHaveBeenCalled()
    const count = shown.length
    queued[0].onend?.() // the browser may still report the end of the cancelled sentence
    vi.advanceTimersByTime(5000)
    expect(queued).toHaveLength(1)
    expect(shown).toHaveLength(count)
    expect(idle).toBe(0) // an interruption is not a completion
    s.push('Late text. ')
    expect(queued).toHaveLength(1)
  })

  it('reports completion once everything has been spoken', () => {
    let idle = 0
    const s = createSpeaker(() => { idle++ })
    s.push('Only sentence. ')
    s.finish()
    queued[0].onstart?.()
    queued[0].onend?.()
    expect(idle).toBe(1)
  })
})
