import { DeviceEventEmitter, Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { createTurnTaker, withoutDonePhrase } from './turn'

/**
 * Voice for the AI tutor on Android, on top of the phone's own speech services (see SpeechModule.kt).
 *  - Listening: android.speech.SpeechRecognizer. On most phones this is the Google speech service, which may send the audio to
 *    Google to be recognised (an on-device model is preferred when installed). This app never receives, records or stores audio.
 *  - Speaking: android.speech.tts.TextToSpeech, on the device.
 * Neither judges pronunciation, and nothing here pretends to: the tutor works from the words recognised, never the sound.
 */

interface NativeSpeech {
  status(): Promise<{ recognition: boolean; permission: boolean }>
  startListening(locale: string): Promise<void>
  stopListening(): void
  cancelListening(): void
  prepareSpeech(): Promise<boolean>
  speak(id: string, text: string, locale: string, rate: number, pauseMs: number): Promise<void>
  stopSpeaking(): void
}

const native = (): NativeSpeech | null => (Platform.OS === 'android' ? ((NativeModules as { EsSpeech?: NativeSpeech }).EsSpeech ?? null) : null)

export const LISTEN_LOCALE = 'en-US'
export const SPEAK_LOCALE = 'en-GB'

/**
 * How fast the tutor speaks. The phone's engine rate 1.0 is brisk for someone learning a language, so Normal is slower than the engine's
 * own normal, with a short pause after each sentence; Slow leaves more room still. Pitch is never changed (it makes voices robotic).
 */
export type SpeechSpeed = 'SLOW' | 'NORMAL' | 'FAST'
export const SPEECH_SPEEDS: Record<SpeechSpeed, { rate: number; pauseMs: number; label: string }> = {
  SLOW: { rate: 0.7, pauseMs: 750, label: 'Slow' },
  NORMAL: { rate: 0.85, pauseMs: 450, label: 'Normal' },
  FAST: { rate: 1.0, pauseMs: 250, label: 'Fast' },
}
export const DEFAULT_SPEECH_SPEED: SpeechSpeed = 'NORMAL'
export const speechSpeedOf = (v: string | null | undefined): SpeechSpeed => (v === 'SLOW' || v === 'FAST' ? v : DEFAULT_SPEECH_SPEED)
/** If the speech service has not said it is ready by now, the connection is treated as failed (an offline phone can hang for a long time). */
export const READY_TIMEOUT_MS = 8000

export interface SpeechSupport { recognition: boolean; synthesis: boolean }

/** What this phone can do. Both are false on a phone without a speech service or when the app was built without the module. */
export async function checkSupport(): Promise<SpeechSupport> {
  const n = native()
  if (!n) return { recognition: false, synthesis: false }
  const [s, synthesis] = await Promise.all([n.status().catch(() => ({ recognition: false, permission: false })), n.prepareSpeech().catch(() => false)])
  return { recognition: s.recognition, synthesis }
}

export type MicPermission = 'granted' | 'denied' | 'blocked'

/** Asks for the microphone the first time it is needed. 'blocked' means Android will not ask again: only the system settings can change it. */
export async function ensureMicrophone(): Promise<MicPermission> {
  if (Platform.OS !== 'android') return 'denied'
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
  if (await PermissionsAndroid.check(perm)) return 'granted'
  const result = await PermissionsAndroid.request(perm, {
    title: 'Use the microphone for the tutor',
    message: 'Your speech is turned into text on your phone’s speech service so you can talk with the tutor. The app never records or stores audio.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  })
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted'
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied'
}

export const openAppSettings = () => Linking.openSettings()

/** A short, plain message for a speech error code. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case 'permission':
      return 'The microphone is off for this app. Allow it in your phone’s settings to talk to the tutor.'
    case 'denied':
      return 'Microphone access was not allowed, so voice is off. You can still type to the tutor.'
    case 'no-speech':
      return 'I did not hear anything. Tap the microphone to try again.'
    case 'no-match':
      return 'I could not make out what you said. Try again a little closer to the microphone.'
    case 'network':
      return 'Speech recognition needs an internet connection right now. Check your network, or type instead.'
    case 'audio':
      return 'The microphone is busy or unavailable, for example during a call. Try again in a moment.'
    case 'busy':
      return 'Speech recognition is busy. Wait a moment and try again.'
    case 'language':
      return 'English speech recognition is not installed on this phone. Install it in your phone’s speech settings, or type instead.'
    case 'unavailable':
      return 'This phone has no speech recognition service. You can type instead.'
    default:
      return 'Voice input stopped. You can type instead.'
  }
}

export interface ListenHandlers {
  /** The words recognised so far, while the learner is still speaking. */
  onPartial?: (text: string) => void
  /** The final text (may be empty when nothing was understood). Called at most once, and never after cancel(). */
  onResult: (text: string) => void
  /** Something went wrong; called at most once. Codes: permission, network, audio, no-speech, no-match, busy, language, unavailable, failed. */
  onError: (code: string) => void
}

export interface Listening {
  /** The learner has finished: deliver what was heard as the result. */
  stop(): void
  /** Abort without delivering anything. */
  cancel(): void
}

/** Starts one listening session. Asks for the microphone first if needed. Rejects only for a programming error; every failure reaches onError. */
export async function listen(h: ListenHandlers): Promise<Listening> {
  let finished = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const subs: { remove(): void }[] = []
  const n = native()
  const end = () => {
    finished = true
    if (timer) clearTimeout(timer)
    timer = null
    subs.splice(0).forEach((s) => s.remove())
  }
  const fail = (code: string) => { if (finished) return; end(); h.onError(code) }
  const handle: Listening = {
    stop: () => { if (!finished) n?.stopListening() },
    cancel: () => { if (finished) return; end(); n?.cancelListening() },
  }
  if (!n) { fail('unavailable'); return handle }

  const mic = await ensureMicrophone()
  if (mic !== 'granted') { fail(mic === 'blocked' ? 'permission' : 'denied'); return handle }

  subs.push(
    DeviceEventEmitter.addListener('speechReady', () => { if (timer) clearTimeout(timer); timer = null }),
    DeviceEventEmitter.addListener('speechPartial', (e: { text?: string }) => { if (!finished && e?.text) h.onPartial?.(e.text) }),
    DeviceEventEmitter.addListener('speechResult', (e: { text?: string }) => { if (finished) return; end(); h.onResult((e?.text ?? '').trim()) }),
    DeviceEventEmitter.addListener('speechError', (e: { code?: string }) => fail(e?.code ?? 'failed')),
  )
  timer = setTimeout(() => { n.cancelListening(); fail('network') }, READY_TIMEOUT_MS)
  try {
    await n.startListening(LISTEN_LOCALE)
  } catch (e) {
    fail((e as { code?: string })?.code ?? 'failed')
  }
  return handle
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
export const FINAL_WORDS_WAIT_MS = 900
export const NO_SPEECH_SESSIONS = 2
const NETWORK_RETRIES = 2
const RESTART_MS = 60

/**
 * Listens for one whole turn. Android's recogniser ends a recording by itself after a short silence, which is far too soon for someone who is
 * thinking or still learning the language. So the recording is restarted whenever the phone ends it, the words are kept, and WHEN THE TURN IS
 * OVER is decided by createTurnTaker (see turn.ts): an adaptive wait that is longer after an unfinished sentence and for beginners, or at once
 * when the learner presses Done. After the decision the recogniser is asked to finish (not cancelled), so the last words still arrive.
 * Only one recording session exists at a time. (The phone may ignore the longer silence hints sent with the request, so the restart is essential.)
 */
export function listenTurn(h: TurnListenHandlers): TurnListening {
  let carry = '' // words from earlier sessions of this same turn
  let session = '' // words of the session that is running now
  let active: Listening | null = null
  let closed = false
  let committing = false
  let silentSessions = 0
  let networkFailures = 0
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const text = () => `${carry} ${session}`.replace(/\s+/g, ' ').trim()
  const close = () => {
    closed = true
    if (settleTimer) clearTimeout(settleTimer)
    if (restartTimer) clearTimeout(restartTimer)
    settleTimer = null
    restartTimer = null
  }
  const deliver = () => {
    if (closed) return
    const heard = withoutDonePhrase(text())
    close()
    active?.cancel()
    active = null
    if (heard) h.onCommit(heard)
  }
  const taker = createTurnTaker({
    level: h.level,
    onCommit: () => {
      if (closed || committing) return
      committing = true
      if (!active) return deliver()
      settleTimer = setTimeout(deliver, FINAL_WORDS_WAIT_MS)
      active.stop()
    },
  })
  const fail = (code: string) => {
    if (closed) return
    const heard = text()
    close()
    taker.reset()
    active?.cancel()
    active = null
    h.onError(code, heard)
  }
  const restart = (ms = RESTART_MS) => {
    if (closed) return
    restartTimer = setTimeout(() => { restartTimer = null; begin() }, ms)
  }
  const heard = () => {
    const all = text()
    if (!committing && all) { h.onText(all); taker.update(all) }
  }

  const begin = () => {
    if (closed || active) return
    session = ''
    let mine: Listening | null = null
    void listen({
      onPartial: (t) => {
        if (closed) return
        session = t
        silentSessions = 0
        networkFailures = 0
        heard()
      },
      onResult: (t) => {
        if (mine && active === mine) active = null
        if (closed) return
        if (t) { session = t; silentSessions = 0; networkFailures = 0 }
        if (committing) return deliver()
        // The phone ended this recording by itself: keep the words, add them to the turn, and carry on listening.
        carry = text()
        session = ''
        if (carry) { h.onText(carry); taker.update(carry) }
        else if (++silentSessions >= NO_SPEECH_SESSIONS) return fail('no-speech')
        restart()
      },
      onError: (code) => {
        if (mine && active === mine) active = null
        if (closed) return
        if (committing) return deliver()
        if (code === 'no-speech' || code === 'no-match') {
          carry = text()
          session = ''
          if (carry) return restart()
          if (++silentSessions >= NO_SPEECH_SESSIONS) return fail(code)
          return restart()
        }
        if ((code === 'network' || code === 'busy') && ++networkFailures <= NETWORK_RETRIES) {
          carry = text()
          session = ''
          return restart(800)
        }
        fail(code)
      },
    }).then((l) => {
      mine = l
      if (closed) l.cancel()
      else active = l
    })
  }

  begin()
  return {
    finish: () => { if (!closed && text()) taker.finishNow() },
    cancel: () => {
      if (closed) return
      close()
      taker.reset()
      active?.cancel()
      active = null
    },
  }
}

// ---------------------------------------------------------------------------------------------- speaking

/** Splits text into the sentences that are complete so far and the unfinished remainder. */
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

/** Removes markdown symbols and emoji so they are not read out. */
export const speakable = (s: string) => s.replace(/[*_`#>~]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim()

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

/** How long to wait for a first word position from the engine before concluding that it does not report them. */
export const BOUNDARY_WAIT_MS = 700

export interface Speaker {
  /** Adds the next piece of a streamed reply; complete sentences start to be spoken straight away. */
  push(piece: string): void
  /** No more pieces: speak whatever is left, then report that speaking is done. */
  finish(): void
  /** Stops speaking at once (an interruption by the learner) without reporting completion. Returns the text that had been spoken so far. */
  stop(): string
  /** The text of the reply that has been spoken (or is being spoken) so far. */
  revealed(): string
}

export interface SpeakerHooks {
  /**
   * The words that have actually been spoken so far in this reply, as they become spoken: a sentence is shown when the engine starts it and,
   * when the engine reports where it is (Android 8 and newer, with most engines), only up to the word being spoken. Never text that has not been spoken.
   */
  onReveal?: (text: string) => void
}

/**
 * Speaks a streamed reply sentence by sentence, so the tutor starts talking before the reply is complete.
 * onIdle: everything was spoken. onInterrupted: the phone took the audio away (a call, another app), which also ends the speech.
 */
export function createSpeaker(onIdle: () => void, onInterrupted: () => void = () => undefined, speed: SpeechSpeed = DEFAULT_SPEECH_SPEED, hooks: SpeakerHooks = {}): Speaker {
  const n = native()
  const { rate, pauseMs } = SPEECH_SPEEDS[speed]
  let buffer = ''
  let pending = 0
  let finished = false
  let cancelled = false
  let serial = 0
  const prefix = `s${Date.now()}-`
  const items = new Map<string, { raw: string; spoken: string; total: number }>()
  const ready: Promise<boolean> = n ? n.prepareSpeech().catch(() => false) : Promise.resolve(false)
  let chain: Promise<unknown> = Promise.resolve()
  const subs: { remove(): void }[] = []
  let boundaries: boolean | null = null // does this engine report word positions? unknown until a sentence has started
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null
  const done: string[] = []
  let current: { id: string; raw: string; total: number; words: number } | null = null

  const shown = () => [...done, current ? firstWords(current.raw, current.words) : ''].filter(Boolean).join(' ')
  const emit = () => { if (!cancelled) hooks.onReveal?.(shown()) }
  const dispose = () => subs.splice(0).forEach((s) => s.remove())
  const clearBoundaryTimer = () => { if (boundaryTimer) clearTimeout(boundaryTimer); boundaryTimer = null }
  const check = () => {
    if (!cancelled && finished && pending <= 0 && buffer.trim() === '') {
      finished = false
      dispose()
      onIdle()
    }
  }
  const settle = (id: string) => {
    const item = items.get(id)
    if (!item) return
    items.delete(id)
    pending--
    clearBoundaryTimer()
    if (!cancelled && item.raw) {
      done.push(item.raw)
      if (current?.id === id) current = null
      emit()
    }
    check()
  }
  if (n) {
    subs.push(
      DeviceEventEmitter.addListener('ttsStart', (e: { id?: string }) => {
        const item = e?.id ? items.get(e.id) : undefined
        if (cancelled || !item || !e.id) return
        current = { id: e.id, raw: item.raw, total: item.total, words: boundaries === false ? item.total : 0 }
        emit()
        if (boundaries === null) {
          clearBoundaryTimer()
          boundaryTimer = setTimeout(() => {
            boundaryTimer = null
            if (boundaries === null && current && !cancelled) { boundaries = false; current.words = current.total; emit() }
          }, BOUNDARY_WAIT_MS)
        }
      }),
      DeviceEventEmitter.addListener('ttsRange', (e: { id?: string; end?: number }) => {
        const item = e?.id ? items.get(e.id) : undefined
        if (cancelled || !item || !current || current.id !== e.id || typeof e.end !== 'number') return
        boundaries = true
        clearBoundaryTimer()
        const words = Math.min(item.total, countWords(item.spoken.slice(0, e.end)))
        if (words > current.words) { current.words = words; emit() }
      }),
      DeviceEventEmitter.addListener('ttsDone', (e: { id?: string }) => e?.id && settle(e.id)),
      DeviceEventEmitter.addListener('ttsError', (e: { id?: string }) => e?.id && settle(e.id)),
      DeviceEventEmitter.addListener('ttsInterrupted', () => {
        if (cancelled) return
        cancelled = true
        items.clear()
        pending = 0
        buffer = ''
        clearBoundaryTimer()
        dispose()
        onInterrupted()
      }),
    )
  }
  const say = (sentence: string) => {
    const clean = speakable(sentence)
    if (!clean || !n) return
    const id = prefix + serial++
    items.set(id, { raw: sentence.trim(), spoken: clean, total: countWords(sentence) })
    pending++
    // Sentences are handed to the phone one after another, in order, once the speech engine is ready.
    chain = chain.then(() => ready).then((ok) => {
      if (cancelled) return undefined
      if (!ok) { settle(id); return undefined }
      return n.speak(id, clean, SPEAK_LOCALE, rate, pauseMs).catch(() => settle(id))
    })
  }
  return {
    push(piece) {
      if (cancelled) return
      buffer += piece
      const { sentences, rest } = splitSentences(buffer)
      buffer = rest
      sentences.forEach(say)
    },
    finish() {
      if (cancelled) return
      const tail = buffer
      buffer = ''
      if (tail.trim()) say(tail)
      finished = true
      check()
    },
    stop() {
      const heard = shown()
      cancelled = true
      buffer = ''
      pending = 0
      items.clear()
      clearBoundaryTimer()
      dispose()
      n?.stopSpeaking()
      return heard
    },
    revealed: shown,
  }
}

// ---------------------------------------------------------------------------------------------- saying one word

let synthesisSupport: Promise<boolean> | null = null
/** Can this phone speak? Asked once. Used to decide whether to offer a pronunciation button. */
export const synthesisAvailable = (): Promise<boolean> => (synthesisSupport ??= checkSupport().then((s) => s.synthesis).catch(() => false))

let saying: Speaker | null = null
/** Says a word or a short sentence with the phone's English voice (pronunciation help). A new one replaces the one being said. */
export function speakOnce(text: string, speed: SpeechSpeed = DEFAULT_SPEECH_SPEED): void {
  saying?.stop()
  const s = createSpeaker(() => { if (saying === s) saying = null }, () => { if (saying === s) saying = null }, speed)
  saying = s
  s.push(text + ' ')
  s.finish()
}
