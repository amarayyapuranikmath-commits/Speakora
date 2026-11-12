import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, ChevronDown, Mic, RotateCw, SlidersHorizontal, Square, X } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react'
import { Animated, AppState, FlatList, Keyboard, KeyboardAvoidingView, Pressable, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { checkSupport, createSpeaker, listenTurn, openAppSettings, speechSpeedOf, voiceErrorMessage, type Speaker, type SpeechSupport, type TurnListening } from '../../lib/speech'
import { SpeechSpeedPicker } from './SpeechSpeedPicker'
import { Chip, Input, Sheet, TextField, Toggle } from '../../ui/components'
import { colors, radius, space, type } from '../../ui/theme'
import { RichText } from './RichText'
import { Aborted, savePreferredLanguage, streamChat, tutorKeys, type ModeInfo, type TutorPrefs, type Turn } from './tutorApi'

interface Msg { key: string; role: 'user' | 'assistant'; content: string; streaming?: boolean; stopped?: boolean; note?: string }

type VoiceState = 'off' | 'listening' | 'thinking' | 'speaking'

const LANGUAGES = ['English', 'Kannada', 'Hindi', 'Telugu', 'Tamil'] as const
const NEAR_BOTTOM = 96

/** The modes grouped by what the learner wants to do, so the list reads as four short choices rather than nine. */
const MODE_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Practise speaking', ids: ['FREE_CONVERSATION', 'ROLEPLAY', 'INTERVIEW_PRACTICE'] },
  { title: 'Learn', ids: ['GRAMMAR_TUTOR', 'VOCABULARY_COACH', 'PHRASAL_VERB_COACH'] },
  { title: 'Improve', ids: ['SENTENCE_CORRECTION', 'PRONUNCIATION_PRACTICE'] },
  { title: 'Ask anything', ids: ['GENERAL'] },
]
const uid = () => Math.random().toString(36).slice(2)

/** Starting points for an empty conversation. They only fill the message box and choose a mode; nothing is sent until you press send. */
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

function TypingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current
  useEffect(() => {
    const loops = dots.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 160),
      Animated.timing(v, { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 360, useNativeDriver: true }),
    ])))
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [dots])
  return (
    <View accessible accessibilityLabel="The coach is thinking" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 5, paddingVertical: 10 }}>
      {dots.map((v, i) => <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted, opacity: v }} />)}
    </View>
  )
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: pressed ? 'rgba(0,0,0,0.06)' : 'transparent' })}>
      {children}
    </Pressable>
  )
}

function TextButton({ label, onPress, primary, disabled, children }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, opacity: disabled ? 0.4 : 1, backgroundColor: primary ? colors.accent : 'transparent', borderWidth: primary ? 0 : 1, borderColor: colors.lineStrong }}>
      {children}
      <Text style={{ fontSize: 15, fontWeight: '600', color: primary ? colors.onAccent : colors.ink }}>{label}</Text>
    </Pressable>
  )
}

/**
 * The AI Coach conversation, laid out like a messaging app. The coach's words are plain text on the page; only your own messages are bubbles.
 *
 * Privacy: the conversation lives only in this component's memory. It is sent to the coach with each message, but nothing is saved to your
 * account, and it is gone when you end the session or close the app. There is no history.
 *
 * Voice: the phone's speech recognition turns what you say into text. WHEN YOU HAVE FINISHED is decided by src/lib/turn.ts (adaptive: it waits
 * longer after an unfinished sentence and for beginners), not by the phone's short silence cut-off; "Done" ends the turn at once. The coach
 * answers aloud sentence by sentence and the text on screen follows what is being spoken. "Interrupt" stops it immediately. The app never
 * receives or stores audio, and the coach works from the words only: it cannot hear you or score pronunciation.
 */
export function TutorChat({ initialMode, topicId, suspended = false, level = null }: { initialMode?: string; topicId?: string; suspended?: boolean; level?: string | null }) {
  const queryClient = useQueryClient()
  const modes = useQuery({ queryKey: tutorKeys.modes, queryFn: () => api<ModeInfo[]>('/api/coach/modes'), staleTime: Infinity })
  const prefs = useQuery({ queryKey: tutorKeys.preferences, queryFn: () => api<TutorPrefs>('/api/coach/preferences') })

  const [mode, setMode] = useState(initialMode ?? 'FREE_CONVERSATION')
  const [scenario, setScenario] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'mode' | 'options' | null>(null)
  const [keyboard, setKeyboard] = useState(false)
  const [voice, setVoice] = useState<VoiceState>('off')
  const [heard, setHeard] = useState('')
  const [support, setSupport] = useState<SpeechSupport | null>(null)
  const [readAloud, setReadAloud] = useState(false)
  const [needsSettings, setNeedsSettings] = useState(false)
  const [pinned, setPinned] = useState(true)
  const list = useRef<FlatList<Msg>>(null)
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const abort = useRef<AbortController | null>(null)
  const voiceOn = useRef(false)
  const listening = useRef<TurnListening | null>(null)
  const speaker = useRef<Speaker | null>(null)
  const activeKey = useRef<string | null>(null)
  const stick = useRef(true)
  const messagesRef = useRef<Msg[]>([])
  messagesRef.current = messages
  const startListeningRef = useRef<() => void>(() => undefined)

  const language = prefs.data?.explanationLanguage ?? 'English'
  const speed = speechSpeedOf(prefs.data?.speechSpeed)
  const currentMode = modes.data?.find((m) => m.id === mode)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => { show.remove(); hide.remove(); voiceOn.current = false; listening.current?.cancel(); speaker.current?.stop(); abort.current?.abort() }
  }, [])

  // What this phone can do, asked once. Both stay false on a phone without speech services.
  useEffect(() => {
    let live = true
    void checkSupport().then((s) => { if (live) setSupport(s) }).catch(() => { if (live) setSupport({ recognition: false, synthesis: false }) })
    return () => { live = false }
  }, [])

  // The tab stays mounted when another tab is shown, and a call needs the microphone: voice ends in both cases.
  useEffect(() => {
    if (suspended) endVoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended])

  // Leaving the app ends the voice conversation: the microphone is never kept while the app is out of view.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') endVoice() })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The newest text stays in view. Scrolling up yourself pauses this until you tap "Latest".
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const near = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_BOTTOM
    stick.current = near
    setPinned(near)
  }
  const jumpToLatest = () => { stick.current = true; setPinned(true); list.current?.scrollToEnd({ animated: true }) }

  const patch = (key: string, fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.key === key ? fn(m) : m)))

  const send = useCallback(async (raw: string, retry = false, spoken = false) => {
    const content = raw.trim()
    if (!content || busy) return
    speaker.current?.stop()
    setError(null)
    setFailed(null)
    setBusy(true)
    stick.current = true
    setPinned(true)
    if (voiceOn.current) setVoice('thinking')
    const key = uid()
    activeKey.current = key
    const turns = historyOf(messagesRef.current, retry ? undefined : content)
    setMessages((m) => [...(retry ? m : [...m, { key: uid(), role: 'user' as const, content }]), { key, role: 'assistant', content: '', streaming: true }])
    const ctrl = new AbortController()
    abort.current = ctrl
    // The coach speaks when a voice conversation is on or "read replies aloud" is chosen, and only if this phone can speak.
    const talk = (voiceOn.current || readAloud) && support?.synthesis === true
    let full = ''
    const s = talk
      ? createSpeaker(
          () => {
            patch(key, (m) => ({ ...m, content: full || m.content, streaming: false }))
            if (voiceOn.current) startListeningRef.current()
            else setVoice('off')
          },
          () => { endVoice(); setError('The coach stopped speaking because a call or another app took the audio.') },
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
      if (e instanceof Aborted || ctrl.signal.aborted) {
        patch(key, (m) => ({ ...m, streaming: false, stopped: true }))
      } else {
        s?.stop()
        setMessages((all) => all.filter((m) => m.key !== key))
        setFailed(content)
        setError(e instanceof ApiError ? e.message : 'The connection was lost. Check your network and try again.')
        endVoice()
      }
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, mode, scenario, topicId, readAloud, support, speed, language])

  // ---------------------------------------------------------------- voice conversation

  function startListening() {
    if (!voiceOn.current) return
    listening.current?.cancel()
    setVoice('listening')
    setHeard('')
    listening.current = listenTurn({
      level,
      onText: (t) => { if (voiceOn.current) setHeard(t) },
      onCommit: (t) => {
        listening.current = null
        setHeard('')
        if (voiceOn.current) void send(t, false, true)
      },
      onError: (code, partial) => {
        listening.current = null
        setHeard('')
        if (!voiceOn.current) return
        voiceOn.current = false
        setVoice('off')
        if (partial) setText(partial)
        setNeedsSettings(code === 'permission')
        setError(voiceErrorMessage(code))
      },
    })
  }
  startListeningRef.current = startListening

  /** What was spoken so far is kept as the coach's reply (so the next answer follows what you actually heard); the rest is dropped. */
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
    if (suspended) { setError('Voice is not available while you are in a call.'); return }
    setError(null)
    setFailed(null)
    setNeedsSettings(false)
    voiceOn.current = true
    Keyboard.dismiss()
    input.current?.blur()
    startListening()
  }

  /** The coach stops at once; in a voice conversation you are listened to straight away. */
  function interrupt() {
    interruptSpeech()
    if (voiceOn.current) setTimeout(() => startListeningRef.current(), 120)
    else setVoice('off')
  }

  function submit() {
    const t = text
    setText('')
    void send(t)
  }

  /** Ends the session: everything stops and the conversation is cleared. */
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
    setBusy(false)
    setSheet(null)
    stick.current = true
    setPinned(true)
  }

  function chooseMode(next: string) {
    setSheet(null)
    if (next === mode) return
    setMode(next)
    // A roleplay needs a situation: ask for it straight away rather than leaving it in a settings corner.
    if (next === 'ROLEPLAY' && !scenario.trim()) setTimeout(() => setSheet('options'), 120)
    if (messagesRef.current.length === 0) return
    const title = modes.data?.find((m) => m.id === next)?.title ?? next
    setMessages((m) => [...m, { key: uid(), role: 'assistant', content: '', note: `Switched to ${title}. This conversation carries on.` }])
  }

  async function chooseLanguage(v: string) {
    try {
      await savePreferredLanguage(v === 'English' ? null : v)
      void queryClient.invalidateQueries({ queryKey: tutorKeys.preferences })
    } catch {
      setError('Your language choice could not be saved.')
    }
  }

  const speaking = voice === 'speaking' || voice === 'thinking'
  const statusLabel = voice === 'listening' ? 'Listening' : voice === 'thinking' ? 'Thinking' : voice === 'speaking' ? 'Speaking' : ''

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior="padding">
      {/* Bar: current mode on the left; end session and settings (language, speaking speed, read aloud, roleplay situation) on the right. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.sm, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Mode: ${currentMode?.title ?? 'Free conversation'}. Change mode`} onPress={() => setSheet('mode')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 }}>{currentMode?.title ?? 'Free conversation'}</Text>
          <ChevronDown size={18} color={colors.muted} />
        </Pressable>
        {messages.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="End session" onPress={endSession} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.muted }}>End session</Text>
          </Pressable>
        ) : null}
        <IconButton label="Voice and coach settings" onPress={() => setSheet('options')}><SlidersHorizontal size={20} color={colors.ink} /></IconButton>
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.key}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={() => { if (stick.current) list.current?.scrollToEnd({ animated: false }) }}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: space.lg, flexGrow: 1 }}
          ListEmptyComponent={voice === 'listening' ? undefined : (
            <View style={{ paddingTop: space.xl }}>
              <Text style={type.heading}>What would you like to talk about?</Text>
              <Text style={[type.small, { marginTop: 4 }]}>{currentMode?.description ?? 'Say hello, or ask anything.'}</Text>
              <Text style={[type.label, { marginTop: space.xl, marginBottom: 4 }]}>Try asking</Text>
              {STARTERS.map((s) => (
                <Pressable key={s.text} accessibilityRole="button" accessibilityLabel={s.text} onPress={() => { setMode(s.mode); setText(s.text); input.current?.focus() }}
                  style={{ minHeight: 48, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.line }}>
                  <Text style={{ fontSize: 16, color: colors.accent }}>{s.text}</Text>
                </Pressable>
              ))}
            </View>
          )}
          ListFooterComponent={voice === 'listening' ? (
            <View accessibilityRole="alert" accessibilityLabel="Listening" style={{ alignItems: 'flex-end', marginTop: messages.length ? 0 : space.xl }}>
              <View style={{ maxWidth: '84%', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 8 }} />
                <Text style={{ flexShrink: 1, fontSize: 16, lineHeight: 23, color: colors.muted }}>{heard || 'Listening… take your time.'}</Text>
              </View>
            </View>
          ) : undefined}
          renderItem={({ item: m }) => {
            if (m.note) return <Text style={[type.caption, { textAlign: 'center' }]}>{m.note}</Text>
            if (m.role === 'user') {
              return (
                <View style={{ alignItems: 'flex-end' }}>
                  <View accessible accessibilityLabel={`You: ${m.content}`} style={{ maxWidth: '84%', backgroundColor: colors.accentSoft, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Text style={{ fontSize: 16, lineHeight: 23, color: colors.ink }}>{m.content}</Text>
                  </View>
                </View>
              )
            }
            return (
              <View accessible={!m.streaming} accessibilityLabel={m.streaming ? undefined : `Coach: ${m.content}`} style={{ maxWidth: '94%' }}>
                {m.streaming && !m.content ? <TypingDots /> : <RichText text={m.content} />}
                {m.stopped ? <Text style={[type.caption, { marginTop: 4 }]}>Stopped.</Text> : null}
              </View>
            )
          }}
        />
        {!pinned ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Jump to the latest message" onPress={jumpToLatest}
            style={{ position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
            <ArrowDown size={15} color={colors.ink} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>Latest</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.control, backgroundColor: colors.dangerSoft }}>
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.danger }}>{error}</Text>
          {needsSettings ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open phone settings" onPress={() => void openAppSettings()} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Settings</Text>
            </Pressable>
          ) : null}
          {failed ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => void send(failed, messages.some((m) => m.role === 'user' && m.content === failed.trim()))} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}>
              <RotateCw size={15} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {voice !== 'off' ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.canvas, paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm }}>
          <View accessibilityRole="alert" accessibilityLabel={statusLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: voice === 'listening' ? colors.accent : voice === 'speaking' ? colors.success : colors.muted }} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{statusLabel}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {voice === 'listening' ? (
              <TextButton label="Done speaking" primary disabled={!heard} onPress={() => listening.current?.finish()}>
                <Check size={17} color={colors.onAccent} />
              </TextButton>
            ) : null}
            {speaking ? (
              <TextButton label="Interrupt" onPress={interrupt}>
                <Square size={14} color={colors.ink} fill={colors.ink} />
              </TextButton>
            ) : null}
            <TextButton label="End voice" onPress={endVoice}>
              <X size={17} color={colors.ink} />
            </TextButton>
          </View>
        </View>
      ) : null}

      {/* Composer */}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.canvas, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 24, backgroundColor: colors.surface, paddingLeft: 16, paddingRight: 4 }}>
            <Input
              ref={input}
              accessibilityLabel="Message to the coach"
              value={text}
              onChangeText={setText}
              placeholder={voice === 'off' ? 'Message' : 'Or type here'}
              placeholderTextColor={colors.subtle}
              multiline
              maxLength={1500}
              style={{ flex: 1, maxHeight: 120, minHeight: 46, paddingTop: 11, paddingBottom: 11, fontSize: 16, lineHeight: 22, color: colors.ink }}
            />
            {support?.recognition && voice === 'off' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Start voice conversation" onPress={toggleVoice}
                style={{ width: 40, height: 40, marginBottom: 3, marginRight: 2, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }}>
                <Mic size={20} color={colors.onAccent} />
              </Pressable>
            ) : null}
          </View>
          {busy ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Stop the reply" onPress={interrupt} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Square size={16} color={colors.onAccent} fill={colors.onAccent} />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !text.trim() }} disabled={!text.trim()} onPress={submit}
              style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, opacity: text.trim() ? 1 : 0.4, alignItems: 'center', justifyContent: 'center' }}>
              <ArrowUp size={22} color={colors.onAccent} />
            </Pressable>
          )}
        </View>
        {support !== null && !support.recognition && !keyboard && voice === 'off' ? (
          <Text style={[type.caption, { marginTop: 6 }]}>Voice is not available on this phone, but you can dictate with your keyboard’s microphone key.</Text>
        ) : null}
      </View>

      <Sheet title="Choose a mode" visible={sheet === 'mode'} onClose={() => setSheet(null)}>
        {(() => {
          const all = modes.data ?? []
          const known = new Set(MODE_GROUPS.flatMap((g) => g.ids))
          const groups = [...MODE_GROUPS.map((g) => ({ title: g.title, items: g.ids.map((id) => all.find((m) => m.id === id)).filter((m): m is ModeInfo => !!m) })),
            { title: 'More', items: all.filter((m) => !known.has(m.id)) }].filter((g) => g.items.length > 0)
          return groups.map((g) => (
            <View key={g.title} style={{ marginBottom: space.md }}>
              <Text accessibilityRole="header" style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', marginBottom: 2 }}>{g.title}</Text>
              {g.items.map((m) => (
                <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={m.title} accessibilityState={{ selected: m.id === mode }} onPress={() => chooseMode(m.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{m.title}</Text>
                    <Text style={type.small}>{m.description}</Text>
                  </View>
                  {m.id === mode ? <Check size={20} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </View>
          ))
        })()}
      </Sheet>

      <Sheet title="Voice and coach settings" visible={sheet === 'options'} onClose={() => setSheet(null)}>
        <Text style={type.label}>Explain in</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.md }}>
          {LANGUAGES.map((l) => <Chip key={l} label={l === 'English' ? 'Simple English' : l} selected={language === l} onPress={() => void chooseLanguage(l)} />)}
        </View>
        <Text style={type.caption}>Saved to your account. English examples always stay in English.</Text>
        {support?.synthesis ? (
          <View style={{ marginTop: space.lg }}>
            <SpeechSpeedPicker prefs={prefs.data} canSpeak />
          </View>
        ) : null}
        {support?.synthesis ? (
          <View style={{ marginTop: space.lg }}>
            <Toggle label="Read replies aloud" description="The coach speaks its replies using your phone’s voice. Voice conversations always do." value={readAloud} onChange={setReadAloud} />
          </View>
        ) : null}
        {mode === 'ROLEPLAY' ? <View style={{ marginTop: space.lg }}><TextField label="Situation" value={scenario} onChangeText={setScenario} maxLength={200} placeholder="For example: a waiter in a busy restaurant" /></View> : null}
        <Text style={[type.caption, { marginTop: space.lg }]}>
          Your conversation is not saved: it stays in the app and disappears when you end the session or close the app. The text you send is processed by the AI provider to write replies.
          {support?.recognition ? ' Voice uses your phone’s speech recognition, which may send audio to its provider (usually Google); this app never receives or stores audio.' : ''} The coach cannot hear how you sound, so it does not score pronunciation.
        </Text>
      </Sheet>
    </KeyboardAvoidingView>
  )
}
