import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Mic, RotateCw, Settings2, Square, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import { useProfile } from '../../lib/queries'
import { MessageRow, type Msg } from './MessageRow'
import { SpeechSpeedControl } from './SpeechSpeedControl'
import { savePreferredLanguage, streamChat, tutorKeys, type ModeInfo, type TutorPrefs, type Turn } from './tutorApi'
import { createSpeaker, speechSpeedOf, startTurnListening, voiceErrorMessage, voiceInputSupported, voiceOutputSupported, type Speaker, type TurnListening } from './voice'

type VoiceState = 'off' | 'listening' | 'thinking' | 'speaking'

const LANGUAGES = ['English', 'Kannada', 'Hindi', 'Telugu', 'Tamil'] as const
const uid = () => Math.random().toString(36).slice(2)
const NEAR_BOTTOM_PX = 96

/** A few ways to begin. They only fill the message box and choose a mode: nothing is sent until you send it. */
const STARTERS = [
  { text: 'Explain the present perfect', mode: 'GRAMMAR_TUTOR' },
  { text: 'Correct this sentence: Yesterday I goed to the market.', mode: 'SENTENCE_CORRECTION' },
  { text: 'Ask me three interview questions', mode: 'INTERVIEW_PRACTICE' },
]

/** The conversation as the tutor should see it: what was actually said or heard, without empty or interrupted-before-speaking replies. */
function historyOf(messages: Msg[], next?: string): Turn[] {
  const out: Turn[] = messages.filter((m) => !m.note && m.content.trim() !== '').map((m) => ({ role: m.role, content: m.content.trim() }))
  if (next !== undefined) out.push({ role: 'user', content: next })
  return out
}

/**
 * The AI Coach conversation.
 *
 * Privacy: the conversation lives only in this component's memory. It is sent to the tutor with each message, but nothing is saved to your
 * account, and it is gone when you end the session, start a new one, or leave this page. There is no history.
 *
 * Voice: the browser listens and turns speech into text. When you have finished is decided by turn.ts (adaptive: it waits for longer after an
 * unfinished sentence and for beginners), not by the browser's one-second cut-off; "Done" ends the turn at once. The tutor answers aloud sentence
 * by sentence and the text on screen follows what is being spoken. "Interrupt" stops it immediately.
 */
export function TutorChat() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const modes = useQuery({ queryKey: tutorKeys.modes, queryFn: () => api<ModeInfo[]>('/api/coach/modes'), staleTime: Infinity })
  const prefs = useQuery({ queryKey: tutorKeys.preferences, queryFn: () => api<TutorPrefs>('/api/coach/preferences') })
  const profile = useProfile()

  const [mode, setMode] = useState(params.get('mode') ?? 'FREE_CONVERSATION')
  const topicId = params.get('topic') ?? undefined
  const [scenario, setScenario] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [heard, setHeard] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ text: string; spoken: boolean } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [other, setOther] = useState('')
  const [readAloud, setReadAloud] = useState(false)
  const [voice, setVoice] = useState<VoiceState>('off')
  const [pinned, setPinned] = useState(true)

  const messagesRef = useRef<Msg[]>([])
  messagesRef.current = messages
  const voiceOn = useRef(false)
  // Whether a reply is in progress, as a ref: a listening session started while a render still said "busy" would otherwise keep that stale
  // answer for its whole life and silently drop the learner's spoken turn.
  const busyRef = useRef(false)
  const listening = useRef<TurnListening | null>(null)
  const speaker = useRef<Speaker | null>(null)
  const abort = useRef<AbortController | null>(null)
  const activeKey = useRef<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const startListeningRef = useRef<() => void>(() => undefined)
  const sendRef = useRef<(raw: string, spoken?: boolean, retry?: boolean) => Promise<void>>(async () => undefined)

  const language = prefs.data?.explanationLanguage ?? 'English'
  const speed = speechSpeedOf(prefs.data?.speechSpeed)
  const languageChoice = (LANGUAGES as readonly string[]).includes(language) ? language : 'Other'
  const current = modes.data?.find((m) => m.id === mode)
  const level = profile.data?.englishLevel ?? null

  // Everything stops and the conversation is dropped when the page is left.
  useEffect(() => () => { voiceOn.current = false; listening.current?.cancel(); speaker.current?.stop(); abort.current?.abort() }, [])

  // The newest text stays in view. Scrolling up yourself pauses this until you jump back down.
  const scrollToEnd = useCallback((smooth = false) => {
    const el = scroller.current
    if (!el) return
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    else el.scrollTop = el.scrollHeight
  }, [])
  useLayoutEffect(() => { if (stick.current) scrollToEnd() }, [messages, heard, voice, scrollToEnd])
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    stick.current = near
    setPinned(near)
  }
  const jumpToLatest = () => { stick.current = true; setPinned(true); scrollToEnd(true) }

  const patch = (key: string, fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.key === key ? fn(m) : m)))

  const send = useCallback(async (raw: string, spoken = false, retry = false) => {
    const content = raw.trim()
    if (!content || busyRef.current) return
    busyRef.current = true
    speaker.current?.stop()
    setError(null)
    setFailed(null)
    setBusy(true)
    stick.current = true
    setPinned(true)
    const key = uid()
    activeKey.current = key
    const turns = historyOf(messagesRef.current, retry ? undefined : content)
    setMessages((m) => [...(retry ? m : [...m, { key: uid(), role: 'user' as const, content }]), { key, role: 'assistant', content: '', streaming: true }])
    if (voiceOn.current) setVoice('thinking')
    const ctrl = new AbortController()
    abort.current = ctrl
    const talk = (voiceOn.current || readAloud) && voiceOutputSupported()
    let full = ''
    const s = talk
      ? createSpeaker(
          () => {
            patch(key, (m) => ({ ...m, content: full || m.content, streaming: false }))
            if (voiceOn.current) startListeningRef.current()
            else setVoice('off')
          },
          speed,
          { onReveal: (t) => { patch(key, (m) => ({ ...m, content: t })); if (voiceOn.current) setVoice('speaking') } },
        )
      : null
    speaker.current = s
    try {
      full = await streamChat(
        { mode, messages: turns, language: language === 'English' ? null : language, topicId, scenario: mode === 'ROLEPLAY' ? scenario.trim() || null : null, spoken },
        (piece) => { if (s) s.push(piece); else patch(key, (m) => ({ ...m, content: m.content + piece })) },
        ctrl.signal,
      )
      if (s) s.finish()
      else {
        patch(key, (m) => ({ ...m, content: full, streaming: false }))
        if (voiceOn.current) startListeningRef.current()
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        patch(key, (m) => ({ ...m, streaming: false, stopped: true }))
      } else {
        s?.stop()
        setMessages((all) => all.filter((m) => m.key !== key))
        setFailed({ text: content, spoken })
        setError(e instanceof ApiError ? e.message : 'The connection was lost. Check your network and try again.')
        if (voiceOn.current) { voiceOn.current = false; setVoice('off') }
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scenario, readAloud, topicId, speed, language])

  // ---------------------------------------------------------------- voice conversation

  const startListening = useCallback(() => {
    if (!voiceOn.current) return
    listening.current?.cancel()
    setVoice('listening')
    setHeard('')
    listening.current = startTurnListening({
      level,
      onText: (t) => { if (voiceOn.current) setHeard(t) },
      onCommit: (t) => {
        listening.current = null
        setHeard('')
        if (voiceOn.current) void sendRef.current(t, true)
      },
      onError: (code, partial) => {
        listening.current = null
        setHeard('')
        if (!voiceOn.current) return
        voiceOn.current = false
        setVoice('off')
        if (partial) setText(partial)
        setError(code === 'no-speech' ? 'I did not hear anything. Tap the microphone when you are ready to talk.' : voiceErrorMessage(code))
      },
    })
  }, [level, send])
  startListeningRef.current = startListening
  sendRef.current = send

  function endVoice() {
    voiceOn.current = false
    listening.current?.cancel()
    listening.current = null
    setHeard('')
    interruptSpeech()
    setVoice('off')
  }

  function toggleVoice() {
    if (voiceOn.current) return endVoice()
    setError(null)
    // Tapping the microphone while a reply is still streaming or being spoken stops that reply (what was heard is kept) so the learner can answer.
    if (busyRef.current || speaker.current) interruptSpeech()
    voiceOn.current = true
    startListening()
  }

  /** What was spoken so far is kept as the tutor's reply (so the next answer follows what you actually heard); the rest is dropped. */
  function interruptSpeech() {
    const heardSoFar = speaker.current?.stop() ?? ''
    speaker.current = null
    abort.current?.abort()
    const key = activeKey.current
    if (key) {
      setMessages((all) => all.flatMap((m) => {
        if (m.key !== key || !m.streaming) return [m]
        const kept = heardSoFar || (voiceOn.current || readAloud ? '' : m.content)
        return kept ? [{ ...m, content: kept, streaming: false, stopped: true }] : []
      }))
    }
  }

  /** The tutor stops at once; in a voice conversation you are listened to straight away. */
  function interrupt() {
    interruptSpeech()
    if (voiceOn.current) setTimeout(() => startListeningRef.current(), 120)
    else setVoice('off')
  }

  // ---------------------------------------------------------------- session

  function endSession() {
    voiceOn.current = false
    listening.current?.cancel()
    listening.current = null
    speaker.current?.stop()
    speaker.current = null
    abort.current?.abort()
    activeKey.current = null
    setVoice('off')
    setMessages([])
    setText('')
    setHeard('')
    setError(null)
    setFailed(null)
    busyRef.current = false
    setBusy(false)
    stick.current = true
    setPinned(true)
  }

  function switchMode(next: string) {
    setMode(next)
    if (messagesRef.current.length === 0) return
    const title = modes.data?.find((m) => m.id === next)?.title ?? next
    setMessages((m) => [...m, { key: uid(), role: 'assistant', content: '', note: `Switched to ${title}. This conversation carries on.` }])
  }

  async function chooseLanguage(v: string) {
    if (v === 'Other') { setOther(language === 'English' ? '' : language); return }
    setOther('')
    try { await savePreferredLanguage(v === 'English' ? null : v); void queryClient.invalidateQueries({ queryKey: tutorKeys.preferences }) } catch { setError('Your language choice could not be saved.') }
  }

  async function saveOther() {
    try { await savePreferredLanguage(other.trim() || null); void queryClient.invalidateQueries({ queryKey: tutorKeys.preferences }) } catch (e) { setError(e instanceof ApiError ? e.message : 'Your language choice could not be saved.') }
  }

  const submit = () => { const t = text; setText(''); void send(t) }
  const empty = messages.length === 0 && !heard
  const speaking = voice === 'speaking' || voice === 'thinking'
  const statusLabel = voice === 'listening' ? 'Listening' : voice === 'thinking' ? 'Thinking' : voice === 'speaking' ? 'Speaking' : null

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-[440px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <label htmlFor="tutor-mode" className="sr-only">What would you like to do?</label>
        <select id="tutor-mode" value={mode} onChange={(e) => switchMode(e.target.value)} className="h-10 min-w-0 flex-1 rounded-control border border-field bg-surface px-3 text-sm font-medium sm:flex-none">
          {(modes.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button type="button" onClick={endSession} className="h-10 rounded-control px-3 text-sm font-medium text-muted hover:bg-black/5 hover:text-ink">End session</button>
          )}
          <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} aria-label="Voice and coach settings" className="grid size-10 place-items-center rounded-control text-muted hover:bg-black/5 hover:text-ink">
            <Settings2 className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="grid gap-4 border-b border-line py-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tutor-language" className="mb-1.5 block text-sm font-medium">Explain in</label>
            <select id="tutor-language" value={languageChoice} onChange={(e) => void chooseLanguage(e.target.value)} className="block h-10 w-full rounded-control border border-field bg-surface px-3 text-sm">
              {LANGUAGES.map((l) => <option key={l} value={l}>{l === 'English' ? 'Simple English' : l}</option>)}
              <option value="Other">Another language</option>
            </select>
            {languageChoice === 'Other' && (
              <input aria-label="Language name" value={other || (language === 'English' ? '' : language)} onChange={(e) => setOther(e.target.value)} onBlur={() => void saveOther()} maxLength={40} placeholder="For example: Malayalam" className="mt-2 block h-10 w-full rounded-control border border-field bg-surface px-3 text-sm" />
            )}
            <p className="mt-1.5 text-xs text-muted">English examples always stay in English.</p>
          </div>
          {mode === 'ROLEPLAY' && (
            <div>
              <label htmlFor="tutor-scenario" className="mb-1.5 block text-sm font-medium">Situation</label>
              <input id="tutor-scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} maxLength={200} placeholder="For example: a waiter in a busy restaurant" className="block h-10 w-full rounded-control border border-field bg-surface px-3 text-sm" />
            </div>
          )}
          {voiceOutputSupported() && <SpeechSpeedControl prefs={prefs.data} />}
          {voiceOutputSupported() && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} className="size-4 accent-accent" />
              Read replies aloud
            </label>
          )}
          <p className="text-xs leading-relaxed text-muted sm:col-span-2">
            Your conversation is not saved: it stays in this page and disappears when you end the session or leave. The text you send is processed by the AI provider to write replies
            {voiceInputSupported() ? ', and your browser’s speech recognition may send your voice to its own provider; we never receive or store audio' : ''}. The coach cannot hear how you sound, so it does not score pronunciation.
          </p>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} role="log" aria-label="Conversation with the coach" aria-live="polite" className="h-full space-y-5 overflow-y-auto py-5 pr-1">
          {empty && (
            <div className="pt-8 text-center">
              <p className="text-lg font-medium">What would you like to talk about?</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{current?.description ?? 'Say hello, or ask anything.'}</p>
              <ul className="mx-auto mt-6 max-w-sm divide-y divide-line border-y border-line text-left">
                {STARTERS.map((s) => (
                  <li key={s.text}><button type="button" onClick={() => { setMode(s.mode); setText(s.text) }} className="block w-full py-3 text-left text-sm text-accent hover:underline">{s.text}</button></li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) => <MessageRow key={m.key} m={m} />)}
          {voice === 'listening' && (
            <div className="flex justify-end" role="status" aria-label="Listening">
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-panel border border-dashed border-accent/50 px-3.5 py-2.5 text-muted">
                <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-accent align-middle" aria-hidden />
                {heard || 'Listening… take your time.'}
              </p>
            </div>
          )}
        </div>
        {!pinned && (
          <button type="button" onClick={jumpToLatest} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-canvas">
            <ArrowDown className="size-3.5" aria-hidden /> Latest
          </button>
        )}
      </div>

      {error && (
        <div className="pb-3">
          <Alert>
            <span>{error}</span>
            {failed && (
              <button type="button" onClick={() => void send(failed.text, failed.spoken, messages.some((m) => m.role === 'user' && m.content === failed.text.trim()))} className="ml-3 inline-flex items-center gap-1 font-medium underline">
                <RotateCw className="size-3.5" aria-hidden /> Try again
              </button>
            )}
          </Alert>
        </div>
      )}

      <div className="border-t border-line pt-3">
        {voice !== 'off' && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p role="status" className="flex items-center gap-2 text-sm font-medium">
              <span className={`size-2.5 rounded-full ${voice === 'listening' ? 'animate-pulse bg-accent' : voice === 'speaking' ? 'bg-success' : 'bg-muted'}`} aria-hidden />
              {statusLabel}
            </p>
            <div className="ml-auto flex items-center gap-2">
              {voice === 'listening' && (
                <button type="button" onClick={() => listening.current?.finish()} disabled={!heard} className="inline-flex h-10 items-center gap-1.5 rounded-control bg-accent px-4 text-sm font-medium text-white disabled:opacity-40">
                  <Check className="size-4" aria-hidden /> Done speaking
                </button>
              )}
              {speaking && (
                <button type="button" onClick={interrupt} className="inline-flex h-10 items-center gap-1.5 rounded-control bg-ink px-4 text-sm font-medium text-white">
                  <Square className="size-3.5 fill-current" aria-hidden /> Interrupt
                </button>
              )}
              <button type="button" onClick={endVoice} className="inline-flex h-10 items-center gap-1.5 rounded-control border border-line-strong px-3 text-sm font-medium hover:bg-black/5">
                <X className="size-4" aria-hidden /> End voice
              </button>
            </div>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <label htmlFor="tutor-input" className="sr-only">Message to the coach</label>
          <textarea
            id="tutor-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
              if (e.key === 'Escape') interrupt()
            }}
            maxLength={1500}
            rows={1}
            placeholder={voice === 'off' ? 'Write a message' : 'Or type here'}
            className="block min-h-11 w-full resize-none rounded-control border border-field bg-surface px-3 py-2.5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {voiceInputSupported() && voice === 'off' && (
            <button type="button" onClick={toggleVoice} aria-label="Start voice conversation" className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-white hover:opacity-90">
              <Mic className="size-5" aria-hidden />
            </button>
          )}
          {busy ? (
            <button type="button" onClick={interrupt} aria-label="Stop the reply" className="grid size-11 shrink-0 place-items-center rounded-control bg-ink text-white"><Square className="size-4 fill-current" aria-hidden /></button>
          ) : (
            <button type="submit" disabled={!text.trim()} aria-label="Send message" className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong text-ink hover:bg-black/5 disabled:opacity-40"><ArrowUp className="size-5" aria-hidden /></button>
          )}
        </form>
        {voice === 'off' && !voiceInputSupported() && <p className="mt-2 text-xs text-muted">Voice input is not available in this browser. You can type, or use a browser such as Chrome or Edge for voice.</p>}
      </div>
    </div>
  )
}
