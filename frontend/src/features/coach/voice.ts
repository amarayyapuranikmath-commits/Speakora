/**
 * Voice for the tutor uses the browser's own speech services, so the app never receives or stores any audio.
 *  - Speech to text: the Web Speech API (SpeechRecognition). In some browsers (Chrome, Edge) the browser sends the audio to its
 *    vendor's speech service to recognise it; that is the browser's behaviour, not ours, and the screen says so.
 *  - Text to speech: speechSynthesis, which speaks on the device.
 * Neither can judge pronunciation, and nothing here pretends to.
 */

import { createTurnTaker, withoutDonePhrase } from './turn'

interface RecognitionResultLike { 0: { transcript: string }; isFinal: boolean }
interface RecognitionEventLike { results: ArrayLike<RecognitionResultLike> }
export interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionCtor = new () => Recognition

export function recognitionConstructor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const voiceInputSupported = () => recognitionConstructor() !== null

export const voiceOutputSupported = () => typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined'

/** A short, plain message for a recognition error code. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it for this site to use voice input.'
    case 'no-speech':
      return 'I did not hear anything. Try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition needs an internet connection in this browser.'
    default:
      return 'Voice input stopped. You can type instead.'
  }
}

/**
 * How fast the tutor speaks. A browser voice at its own normal rate (1) is brisk for someone learning a language, so Normal is a little
 * slower, with a short pause after each sentence; Slow leaves more room still. Pitch is never changed (it makes voices robotic).
 */
export type SpeechSpeed = 'SLOW' | 'NORMAL' | 'FAST'
export const SPEECH_SPEEDS: Record<SpeechSpeed, { rate: number; pauseMs: number; label: string }> = {
  SLOW: { rate: 0.75, pauseMs: 750, label: 'Slow' },
  NORMAL: { rate: 0.9, pauseMs: 450, label: 'Normal' },
  FAST: { rate: 1.05, pauseMs: 250, label: 'Fast' },
}
export const DEFAULT_SPEECH_SPEED: SpeechSpeed = 'NORMAL'
export const speechSpeedOf = (v: string | null | undefined): SpeechSpeed => (v === 'SLOW' || v === 'FAST' ? v : DEFAULT_SPEECH_SPEED)

const clean = (text: string) => text.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim()

function utteranceFor(text: string, speed: SpeechSpeed): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-GB'
  u.rate = SPEECH_SPEEDS[speed].rate
  u.pitch = 1
  const voice = globalThis.speechSynthesis.getVoices?.().find((v) => v.lang.toLowerCase().startsWith('en'))
  if (voice) u.voice = voice
  return u
}

/** Speaks text aloud at the chosen speed and returns a function that stops it. Markdown-like symbols are removed so they are not read out. */
export function speak(text: string, speed: SpeechSpeed = DEFAULT_SPEECH_SPEED): () => void {
  if (!voiceOutputSupported()) return () => undefined
  const spoken = clean(text)
  if (!spoken) return () => undefined
  globalThis.speechSynthesis.cancel()
  globalThis.speechSynthesis.speak(utteranceFor(spoken, speed))
  return () => globalThis.speechSynthesis.cancel()
}

/** Splits text into the sentences that are complete so far and the unfinished remainder. Exported for tests. */
export function splitSentences(buffer: string): { sentences: string[]; rest: string } {
  const re = /[.!?…]+["')\]]*\s+|\n+/g
  const sentences: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(buffer))) {
    const piece = buffer.slice(last, m.index + m[0].length).trim()
    if (piece) sentences.push(piece)
    last = m.index + m[0].length
  }
  return { sentences, rest: buffer.slice(last) }
}

export interface Speaker {
  /** Adds the next piece of a streamed reply; complete sentences start to be spoken straight away. */
  push(piece: string): void
  /** No more pieces: speak whatever is left, then report that speaking is done. */
  finish(): void
  /** Stops speaking at once (an interruption) without reporting completion. Returns the text that had been spoken so far. */
  stop(): string
  /** The text of the reply that has been spoken (or is being spoken) so far. */
  revealed(): string
}

export interface SpeakerHooks {
  /**
   * The words that have actually been spoken so far in this reply, as they become spoken: a sentence is shown when the voice starts it, and,
   * when the voice reports where it is (most local voices do), only up to the word being spoken. Never text that has not been spoken.
   */
  onReveal?: (text: string) => void
}

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** The first n words of a sentence, with its original spacing. */
export function firstWords(raw: string, n: number): string {
  if (n <= 0) return ''
  const parts = raw.split(/(\s+)/)
  let seen = 0
  let out = ''
  for (const p of parts) {
    if (p.trim() === '') { out += p; continue }
    if (seen >= n) break
    out += p
    seen++
  }
  return out.trimEnd()
}

/** How long to wait for a first word-boundary event before concluding that this voice does not report them. */
export const BOUNDARY_WAIT_MS = 700

/**
 * Speaks a streamed reply sentence by sentence, so the tutor starts talking before the reply is complete. Sentences are spoken one at a time
 * with a short pause between them (the browser has no pause control, so the pause is a timer), at the learner's chosen speed.
 * {@link SpeakerHooks.onReveal} reports the text as it is spoken, so the screen shows what is heard and nothing ahead of it.
 */
export function createSpeaker(onIdle: () => void, speed: SpeechSpeed = DEFAULT_SPEECH_SPEED, hooks: SpeakerHooks = {}): Speaker {
  const { pauseMs } = SPEECH_SPEEDS[speed]
  const queue: { raw: string; spoken: string }[] = []
  let buffer = ''
  let speaking = false
  let finished = false
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null
  let boundaries: boolean | null = null // does this voice report word positions? unknown until a sentence has started
  const done: string[] = [] // sentences spoken completely
  let current: { raw: string; words: number } | null = null

  const shown = () => {
    const part = current ? firstWords(current.raw, current.words) : ''
    return [...done, part].filter(Boolean).join(' ')
  }
  const emit = () => { if (!cancelled) hooks.onReveal?.(shown()) }
  const idleCheck = () => {
    if (!cancelled && finished && !speaking && queue.length === 0 && buffer.trim() === '' && timer === null) {
      finished = false
      onIdle()
    }
  }
  const next = () => {
    timer = null
    if (cancelled || speaking) return
    const item = queue.shift()
    if (item === undefined) return idleCheck()
    speaking = true
    const u = utteranceFor(item.spoken, speed)
    const total = countWords(item.raw)
    const finishSentence = () => {
      speaking = false
      if (boundaryTimer !== null) clearTimeout(boundaryTimer)
      boundaryTimer = null
      if (cancelled) return
      done.push(item.raw)
      current = null
      emit()
      // No pause after the last sentence of a finished reply; otherwise a short breath before the next one.
      if (queue.length === 0 && finished && buffer.trim() === '') return idleCheck()
      timer = setTimeout(next, pauseMs)
    }
    u.onstart = () => {
      if (cancelled) return
      current = { raw: item.raw, words: boundaries === false ? total : 0 }
      emit()
      if (boundaries === null) {
        boundaryTimer = setTimeout(() => {
          boundaryTimer = null
          if (boundaries === null && current && !cancelled) { boundaries = false; current.words = total; emit() }
        }, BOUNDARY_WAIT_MS)
      }
    }
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (cancelled || !current || (e.name && e.name !== 'word')) return
      boundaries = true
      if (boundaryTimer !== null) { clearTimeout(boundaryTimer); boundaryTimer = null }
      const end = e.charIndex + (e.charLength && e.charLength > 0 ? e.charLength : (/^\S*/.exec(item.spoken.slice(e.charIndex))?.[0].length ?? 0))
      const words = Math.min(total, countWords(item.spoken.slice(0, end)))
      if (words > current.words) { current.words = words; emit() }
    }
    u.onend = finishSentence
    u.onerror = finishSentence
    globalThis.speechSynthesis.speak(u)
  }
  const add = (sentence: string) => {
    const c = clean(sentence)
    if (!c || !voiceOutputSupported()) return
    queue.push({ raw: sentence.trim(), spoken: c })
    if (!speaking && timer === null) next()
  }
  return {
    push(piece) {
      if (cancelled) return
      buffer += piece
      const { sentences, rest } = splitSentences(buffer)
      buffer = rest
      sentences.forEach(add)
    },
    finish() {
      if (cancelled) return
      const tail = buffer
      buffer = ''
      if (tail.trim()) add(tail)
      finished = true
      if (!speaking && timer === null && queue.length === 0) idleCheck()
    },
    stop() {
      const heard = shown()
      cancelled = true
      buffer = ''
      queue.length = 0
      if (timer !== null) clearTimeout(timer)
      if (boundaryTimer !== null) clearTimeout(boundaryTimer)
      timer = null
      boundaryTimer = null
      if (voiceOutputSupported()) globalThis.speechSynthesis.cancel()
      return heard
    },
    revealed: shown,
  }
}

// ---------------------------------------------------------------------------------------------- listening for a whole turn

export interface TurnListenHandlers {
  /** English level (A1..C2) when known: beginners get more time. */
  level?: string | null
  /** The words heard so far in this turn, as they arrive. */
  onText: (text: string) => void
  /** The turn is finished: the learner's words. Called once. */
  onCommit: (text: string) => void
  /** Listening failed. `heard` is whatever had been recognised, so it is not lost. */
  onError: (code: string, heard: string) => void
}

export interface TurnListening {
  /** The learner pressed Done: deliver what was heard now. */
  finish(): void
  /** Stop listening and deliver nothing. */
  cancel(): void
}

/** How long to wait for the recogniser's last words after asking it to stop, so the end of the learner's sentence is not lost. */
export const FINAL_WORDS_WAIT_MS = 700
const NO_SPEECH_RESTARTS = 3
const NETWORK_RETRIES = 2

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()
/** True when `longer` is `shorter` with more words after it (ignoring case and punctuation): the same sentence, further on. */
export const extendsText = (longer: string, shorter: string): boolean => {
  const a = normalise(longer)
  const b = normalise(shorter)
  return b !== '' && (a === b || a.startsWith(b + ' '))
}

/**
 * The words of one recogniser session, from the browser's `results` list.
 *  - Desktop browsers update ONE entry in place while you speak, so the list is the finished sentences plus at most one unfinished entry.
 *  - Android browsers instead add a new, longer entry on every update ("hello", "hello how", "hello how are"...). Joining those gave the same
 *    words many times over (about twenty lines for one sentence).
 * So only the last unfinished entry counts (an unfinished entry before the end is always a superseded guess), and an entry that the next one
 * merely continues is dropped, whether or not the browser marked it final. Exported for tests.
 */
export function transcriptOf(results: ArrayLike<RecognitionResultLike>): string {
  const parts: { text: string; final: boolean }[] = []
  const all = Array.from(results)
  all.forEach((r, i) => {
    const text = (r[0]?.transcript ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    if (!r.isFinal && i < all.length - 1) return // superseded interim guess
    parts.push({ text, final: r.isFinal })
  })
  const kept: string[] = []
  parts.forEach((p, i) => {
    const next = parts[i + 1]
    if (next && extendsText(next.text, p.text)) return // the next entry is this one, continued
    kept.push(p.text)
  })
  return kept.join(' ')
}

/**
 * Listens for one whole turn. The browser's recogniser would end the recording after about a second of silence, so it is kept running in
 * continuous mode and restarted if the browser ends it; WHEN THE TURN IS OVER is decided by createTurnTaker (see turn.ts), not by the
 * browser. After the decision the recogniser is stopped (not aborted), so words it is still working on arrive before the text is delivered.
 * Only one recogniser exists at a time.
 */
export function startTurnListening(h: TurnListenHandlers): TurnListening {
  const Ctor = recognitionConstructor()
  let carry = '' // words from earlier recogniser sessions of this same turn
  let session = '' // words of the session that is running now
  let active: Recognition | null = null
  let closed = false
  let committing = false
  let silentSessions = 0
  let networkFailures = 0
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  // A restarted session that begins by repeating what was already heard is the same speech again, not new words.
  const text = () => (carry && extendsText(session, carry) ? session : `${carry} ${session}`).replace(/\s+/g, ' ').trim()
  const close = () => {
    closed = true
    if (settleTimer !== null) clearTimeout(settleTimer)
    if (restartTimer !== null) clearTimeout(restartTimer)
    settleTimer = null
    restartTimer = null
  }
  const deliver = () => {
    if (closed) return
    const heard = withoutDonePhrase(text())
    close()
    active = null
    if (heard) h.onCommit(heard)
  }
  const taker = createTurnTaker({
    level: h.level,
    onCommit: () => {
      if (closed || committing) return
      committing = true
      const r = active
      if (!r) return deliver()
      settleTimer = setTimeout(deliver, FINAL_WORDS_WAIT_MS)
      try { r.stop() } catch { deliver() }
    },
  })
  const fail = (code: string) => {
    if (closed) return
    const heard = text()
    close()
    taker.reset()
    try { active?.abort() } catch { /* already over */ }
    active = null
    h.onError(code, heard)
  }

  const begin = () => {
    if (closed || active || !Ctor) return
    const r = new Ctor()
    r.lang = 'en-GB'
    r.interimResults = true
    r.continuous = true
    session = ''
    r.onresult = (e) => {
      if (closed) return
      session = transcriptOf(e.results)
      if (session) { silentSessions = 0; networkFailures = 0 }
      const all = text()
      if (!committing) { h.onText(all); taker.update(all) }
    }
    r.onerror = (e) => {
      if (closed) return
      if (e.error === 'aborted' || e.error === 'no-speech') return // onend follows and decides what to do
      if (e.error === 'network' && ++networkFailures <= NETWORK_RETRIES) return // a hiccup: onend restarts it
      fail(e.error)
    }
    r.onend = () => {
      if (closed || active !== r) return
      active = null
      if (committing) return deliver()
      // The browser ended the recording by itself (silence or a time limit): keep the words and carry on listening.
      if (session === '' && carry === '') {
        if (++silentSessions >= NO_SPEECH_RESTARTS) return fail('no-speech')
      }
      carry = text()
      session = ''
      restartTimer = setTimeout(() => { restartTimer = null; begin() }, networkFailures > 0 ? 800 : 100)
    }
    active = r
    try {
      r.start()
    } catch {
      active = null
      fail('failed')
    }
  }

  if (!Ctor) {
    queueMicrotask(() => h.onError('unsupported', ''))
    return { finish: () => undefined, cancel: () => undefined }
  }
  begin()
  return {
    finish: () => { if (!closed && text()) taker.finishNow() },
    cancel: () => {
      if (closed) return
      close()
      taker.reset()
      const r = active
      active = null
      try { r?.abort() } catch { /* already over */ }
    },
  }
}
