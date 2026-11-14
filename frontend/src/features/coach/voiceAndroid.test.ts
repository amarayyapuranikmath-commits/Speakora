import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTurnListening } from './voice'

type Seg = { t: string; f?: boolean }

/** A recogniser fed with exactly the `results` list a browser reports. Android Chrome in continuous mode adds a new, longer interim entry on every update. */
class Rec {
  static all: Rec[] = []
  lang = ''; interimResults = false; continuous = false
  onresult: ((e: { results: unknown[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() { Rec.all.push(this) }
  start() {}
  stop() { setTimeout(() => this.onend?.(), 50) }
  abort() {}
  report(...segs: Seg[]) { this.onresult?.({ results: segs.map((s) => ({ 0: { transcript: s.t }, isFinal: s.f ?? false })) }) }
}

describe('a phone browser that reports every interim update as a new, longer result', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); Rec.all = []; vi.stubGlobal('SpeechRecognition', Rec) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const listen = () => {
    const log = { text: [] as string[], commits: [] as string[] }
    startTurnListening({ level: 'B1', onText: (t) => log.text.push(t), onCommit: (t) => log.commits.push(t), onError: () => {} })
    return { log, r: () => Rec.all[Rec.all.length - 1] }
  }

  it('shows one sentence once, however many interim updates the browser sends', () => {
    const { log, r } = listen()
    r().report({ t: 'hello' })
    r().report({ t: 'hello' }, { t: 'hello how' })
    r().report({ t: 'hello' }, { t: 'hello how' }, { t: 'hello how are' })
    r().report({ t: 'hello' }, { t: 'hello how' }, { t: 'hello how are' }, { t: 'hello how are you today' })
    expect(log.text[log.text.length - 1]).toBe('hello how are you today')
  })

  it('delivers one accurate transcript for a long answer sent as twenty growing updates', () => {
    const { log, r } = listen()
    const words = 'I would like to talk about my last holiday because it was the best trip of my whole life and I met many people'.split(' ')
    const entries: Seg[] = []
    for (let i = 1; i <= words.length; i++) {
      entries.push({ t: words.slice(0, i).join(' ') })
      r().report(...entries)
    }
    r().report(...entries.slice(0, -1), { t: words.join(' '), f: true })
    vi.advanceTimersByTime(4000)
    vi.advanceTimersByTime(700)
    expect(log.commits).toEqual([words.join(' ')])
  })

  it('also copes when the browser marks every growing entry as final', () => {
    const { log, r } = listen()
    r().report({ t: 'my name', f: true })
    r().report({ t: 'my name', f: true }, { t: 'my name is Ravi', f: true })
    r().report({ t: 'my name', f: true }, { t: 'my name is Ravi', f: true }, { t: 'my name is Ravi and I live in Mysore', f: true })
    expect(log.text[log.text.length - 1]).toBe('my name is Ravi and I live in Mysore')
  })
})

import { extendsText, transcriptOf } from './voice'

describe('transcriptOf', () => {
  const res = (...segs: Seg[]) => segs.map((s) => ({ 0: { transcript: s.t }, isFinal: s.f ?? false }))

  it('desktop shape: finished sentences plus one unfinished entry are all kept, in order', () => {
    expect(transcriptOf(res({ t: 'I like tea.', f: true }, { t: 'and I also like', f: false }))).toBe('I like tea. and I also like')
  })

  it('a final result replaces its own interim guesses and is never doubled', () => {
    expect(transcriptOf(res({ t: 'good', f: false }, { t: 'good morning', f: false }, { t: 'good morning everyone', f: true }))).toBe('good morning everyone')
  })

  it('two different sentences are both kept, even when the second begins with a repeated word', () => {
    expect(transcriptOf(res({ t: 'yes I agree', f: true }, { t: 'yes it was late', f: true }))).toBe('yes I agree yes it was late')
  })

  it('a later guess that corrects an earlier one wins over the earlier one', () => {
    expect(transcriptOf(res({ t: 'their going home', f: false }, { t: "they're going home now", f: false }))).toBe("they're going home now")
  })

  it('ignores empty entries and tolerates an empty list', () => {
    expect(transcriptOf(res({ t: '  ', f: true }))).toBe('')
    expect(transcriptOf([])).toBe('')
  })

  it('extendsText ignores case and punctuation but not partial words', () => {
    expect(extendsText('Hello, how are you', 'hello how')).toBe(true)
    expect(extendsText('Hello world', 'hell')).toBe(false)
    expect(extendsText('anything', '')).toBe(false)
  })
})

describe('restarts and repeated events', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); Rec.all = []; vi.stubGlobal('SpeechRecognition', Rec) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('the same event delivered twice changes nothing', () => {
    const texts: string[] = []
    startTurnListening({ level: 'B1', onText: (t) => texts.push(t), onCommit: () => {}, onError: () => {} })
    const r = Rec.all[0]
    r.report({ t: 'I am fine', f: true })
    r.report({ t: 'I am fine', f: true })
    expect(texts[texts.length - 1]).toBe('I am fine')
  })

  it('a browser restart keeps earlier words once, and a session that replays them does not double them', () => {
    const texts: string[] = []
    startTurnListening({ level: 'B1', onText: (t) => texts.push(t), onCommit: () => {}, onError: () => {} })
    Rec.all[0].report({ t: 'I went to the market', f: true })
    Rec.all[0].onend?.() // the browser ended the recording by itself
    vi.advanceTimersByTime(200)
    const second = Rec.all[1]
    second.report({ t: 'and bought some fruit', f: false })
    expect(texts[texts.length - 1]).toBe('I went to the market and bought some fruit')
    second.report({ t: 'I went to the market and bought some fruit today', f: false }) // a restart that replays the earlier words
    expect(texts[texts.length - 1]).toBe('I went to the market and bought some fruit today')
  })
})
