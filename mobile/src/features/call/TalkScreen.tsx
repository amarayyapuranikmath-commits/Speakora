import { useNavigation, useRoute } from '@react-navigation/native'
import { ChevronLeft, ChevronRight, Lightbulb, Mic, MicOff, PhoneOff, ShieldCheck, SkipForward, Volume2, VolumeX } from 'lucide-react-native'
import { useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native'
import { countryName, LEVEL_LABEL } from '../../lib/geo'
import { formatClock, formatDuration } from '../../lib/format'
import type { Quality } from '../../lib/quality'
import { useProfile, useTopics } from '../../lib/queries'
import { Alert, Button, Panel, Screen, Spinner } from '../../ui/components'
import { colors, space, themed, type } from '../../ui/theme'
import { FeedbackForm, PartnerSafety } from '../main/CallForms'
import { useCall, useElapsed, type CallState } from './CallContext'

export function TalkScreen() {
  const call = useCall()
  switch (call.phase) {
    case 'starting':
      return <Screen><Spinner label="Starting your microphone" /></Screen>
    case 'searching':
      return <Searching />
    case 'connecting':
    case 'connected':
    case 'reconnecting':
      return <ActiveCall />
    case 'ended':
      return <Ended />
    default:
      return <Idle />
  }
}

function MicProblem({ error }: { error: NonNullable<CallState['micError']> }) {
  const text = {
    denied: 'The microphone permission was not granted. Allow it when asked, then try again.',
    blocked: 'Microphone access is turned off for this app. Open the app settings, allow Microphone, then come back.',
    'not-found': 'No microphone was found on this device.',
    other: 'We could not start your microphone. Close other apps that might be using it and try again.',
  }[error]
  return (
    <View>
      <Alert><Text style={{ fontWeight: '600' }}>Microphone unavailable. </Text>{text}</Alert>
      {error === 'blocked' ? <Button label="Open app settings" variant="secondary" onPress={() => void Linking.openSettings()} style={{ marginTop: -space.sm, marginBottom: space.lg }} /> : null}
    </View>
  )
}

function Idle() {
  const call = useCall()
  const topics = useTopics()
  const profile = useProfile()
  const nav = useNavigation<any>()
  const route = useRoute<{ key: string; name: string; params?: { topic?: string } }>()
  const [topic, setTopic] = useState<string>(route.params?.topic ?? '')
  const options = [{ slug: '', name: 'Any topic', description: 'Talk about whatever comes up.' }, ...(topics.data ?? [])]

  return (
    <Screen>
      <Text accessibilityRole="header" style={type.title}>Find a speaking partner</Text>
      <Text style={[type.small, { fontSize: 16, lineHeight: 23, marginTop: space.sm }]}>
        We will connect you with someone who is online now{profile.data?.englishLevel ? ` and prefer a similar level to your ${profile.data.englishLevel}` : ''}. Calls are voice only and are never recorded.
      </Text>

      <View style={{ marginTop: space.xl }}>
        {call.micError ? <MicProblem error={call.micError} /> : null}
        {call.notice ? <Alert tone="info">{call.notice}</Alert> : null}
      </View>

      <Text style={[type.label, { marginBottom: 4 }]}>Topic <Text style={{ fontWeight: '400', color: colors.subtle }}>(optional)</Text></Text>
      <Text style={[type.small, { marginBottom: space.md }]}>Choosing a topic gives you conversation prompts. If your partner picks the same one, you will be matched on it.</Text>
      {topics.isLoading ? <Spinner label="Loading topics" /> : (
        <View style={{ gap: space.sm }}>
          {options.map((t) => {
            const selected = topic === t.slug
            return (
              <Pressable
                key={t.slug || 'any'}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setTopic(t.slug)}
                style={{ borderWidth: 1, borderRadius: 10, padding: space.md, borderColor: selected ? colors.accent : colors.lineStrong, backgroundColor: selected ? colors.accentSoft : colors.surface }}
              >
                <Text style={type.label}>{t.name}</Text>
                {t.description ? <Text style={type.small}>{t.description}</Text> : null}
              </Pressable>
            )
          })}
        </View>
      )}

      <Button label="Start looking for a partner" onPress={() => void call.start(topic || null)} style={{ marginTop: space.xl }} />
      <Button label="Talk to a previous partner" variant="secondary" onPress={() => nav.navigate('Partners')} style={{ marginTop: space.sm }} />
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
        <ShieldCheck size={16} color={colors.muted} style={{ marginTop: 2 }} />
        <Text style={[type.small, { flex: 1 }]}>You can leave at any time, and block or report anyone after a call.</Text>
      </View>
    </Screen>
  )
}

function Searching() {
  const call = useCall()
  const [startedAt] = useState(() => Date.now())
  const elapsed = useElapsed(startedAt)
  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: 64 }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[type.title, { marginTop: space.xl, textAlign: 'center' }]}>Looking for a partner…</Text>
        <Text style={[type.small, { fontSize: 16, marginTop: space.sm, textAlign: 'center' }]}>This usually takes under a minute. You can switch to another app; the search keeps running.</Text>
        <Text style={[type.caption, { marginTop: space.xl }]}>{elapsed}s</Text>
        {call.link === 'reconnecting' ? <Text style={{ color: colors.warning, marginTop: space.md }}>Reconnecting to the server…</Text> : null}
        {call.notice ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginTop: space.md, textAlign: 'center' }}>{call.notice}</Text> : null}
        <Button label="Cancel" variant="secondary" onPress={call.cancelSearch} style={{ marginTop: space.xxl, alignSelf: 'stretch' }} />
      </View>
    </Screen>
  )
}

const QUALITY = themed<Record<Quality, { label: string; bars: number; color: string }>>(() => ({
  unknown: { label: 'Measuring connection', bars: 0, color: colors.lineStrong },
  good: { label: 'Good connection', bars: 3, color: colors.success },
  fair: { label: 'Fair connection', bars: 2, color: colors.warning },
  poor: { label: 'Poor connection', bars: 1, color: colors.danger },
}))

function QualityIndicator({ quality }: { quality: Quality }) {
  const m = QUALITY[quality]
  return (
    <View accessibilityLabel={m.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 16, gap: 2 }} importantForAccessibility="no-hide-descendants">
        {[1, 2, 3].map((i) => <View key={i} style={{ width: 4, height: `${i * 33}%`, borderRadius: 1, backgroundColor: i <= m.bars ? m.color : colors.line }} />)}
      </View>
      <Text style={type.small}>{m.label}</Text>
    </View>
  )
}

const STATUS_TEXT = { connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Connection lost. Reconnecting…' } as const

function ActiveCall() {
  const call = useCall()
  const elapsed = useElapsed(call.phase === 'connected' || call.phase === 'reconnecting' ? call.connectedAt : null)
  const phase = call.phase === 'connecting' || call.phase === 'connected' || call.phase === 'reconnecting' ? call.phase : 'connecting'
  const partner = call.partner
  const meta = [partner?.country && countryName(partner.country), partner?.englishLevel && LEVEL_LABEL[partner.englishLevel]].filter(Boolean).join(' · ')

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: space.xl }}>
        <View accessibilityElementsHidden style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 36, fontWeight: '600', color: colors.accent }}>{partner?.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text accessibilityRole="header" style={[type.title, { marginTop: space.lg }]}>{partner?.displayName}</Text>
        {meta ? <Text style={[type.small, { marginTop: 4 }]}>{meta}</Text> : null}

        <Text accessibilityLiveRegion="polite" style={{ marginTop: space.xl, fontWeight: '600', color: phase === 'reconnecting' ? colors.warning : colors.muted }}>{STATUS_TEXT[phase]}</Text>
        <Text accessibilityLabel={`Call duration ${formatClock(elapsed)}`} style={{ fontSize: 52, fontWeight: '600', color: colors.ink, marginTop: 4, fontVariant: ['tabular-nums'] }}>
          {call.connectedAt ? formatClock(elapsed) : '0:00'}
        </Text>
        <View style={{ marginTop: space.md }}><QualityIndicator quality={call.quality} /></View>

        <View style={{ flexDirection: 'row', gap: space.lg, marginTop: space.xxl, alignItems: 'flex-start' }}>
          <RoundButton label={call.muted ? 'Unmute' : 'Mute'} active={call.muted} onPress={call.toggleMute} icon={call.muted ? <MicOff size={26} color={colors.onAccent} /> : <Mic size={26} color={colors.ink} />} />
          <RoundButton label={call.speakerOn ? 'Speaker on' : 'Speaker'} active={call.speakerOn} onPress={call.toggleSpeaker} icon={call.speakerOn ? <Volume2 size={26} color={colors.onAccent} /> : <VolumeX size={26} color={colors.ink} />} />
          <RoundButton label="Next partner" onPress={call.skip} icon={<SkipForward size={26} color={colors.ink} />} />
          <RoundButton label="End call" danger onPress={call.endCall} icon={<PhoneOff size={26} color={colors.onAccent} />} />
        </View>

        {call.link === 'reconnecting' ? <Text style={{ color: colors.warning, marginTop: space.lg, textAlign: 'center' }}>Reconnecting to the server. Your call audio continues if the connection holds.</Text> : null}
        {call.muted ? <Text style={[type.small, { marginTop: space.lg, textAlign: 'center' }]}>Your microphone is muted. Your partner cannot hear you.</Text> : null}
        {call.notice ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginTop: space.lg, textAlign: 'center' }}>{call.notice}</Text> : null}
      </View>

      <PromptHelper topicPrompts={call.topic?.prompts} topicName={call.topic?.name} />
    </Screen>
  )
}

function RoundButton({ label, icon, onPress, active, danger }: { label: string; icon: ReactNode; onPress: () => void; active?: boolean; danger?: boolean }) {
  const bg = danger ? colors.danger : active ? colors.accent : colors.surface
  return (
    <View style={{ alignItems: 'center', width: 68 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={active === undefined ? undefined : { selected: active }}
        onPress={onPress}
        style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 30, backgroundColor: bg, borderWidth: danger || active ? 0 : 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
      >
        {icon}
      </Pressable>
      <Text style={[type.caption, { marginTop: 6, textAlign: 'center' }]}>{label}</Text>
    </View>
  )
}

/** Opt-in conversation starters. Collapsed by default so it never competes with the conversation. */
function PromptHelper({ topicPrompts, topicName }: { topicPrompts?: string[]; topicName?: string }) {
  const topics = useTopics()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const prompts = useMemo(() => {
    if (topicPrompts && topicPrompts.length > 0) return topicPrompts
    return (topics.data ?? []).find((t) => t.slug === 'general')?.prompts ?? []
  }, [topicPrompts, topics.data])
  if (prompts.length === 0) return null
  const at = ((index % prompts.length) + prompts.length) % prompts.length

  return (
    <View style={{ marginTop: space.xxl }}>
      {!open ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', padding: space.md }}>
          <Lightbulb size={18} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Need something to talk about?</Text>
        </Pressable>
      ) : (
        <Panel>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={type.caption}>{topicName ?? 'General discussion'}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)}><Text style={type.caption}>Hide</Text></Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, lineHeight: 25, color: colors.ink, marginTop: space.md }}>{prompts[at]}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous prompt" onPress={() => setIndex(index - 1)} style={{ padding: 8 }}><ChevronLeft size={22} color={colors.muted} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next prompt" onPress={() => setIndex(index + 1)} style={{ padding: 8 }}><ChevronRight size={22} color={colors.muted} /></Pressable>
            <Text style={[type.caption, { marginLeft: 4 }]}>{at + 1} of {prompts.length}</Text>
          </View>
        </Panel>
      )}
    </View>
  )
}

function Ended() {
  const call = useCall()
  const nav = useNavigation<any>()
  const info = call.endInfo
  const partnerName = call.partner?.displayName ?? 'your partner'
  const completed = info?.status === 'COMPLETED'

  let headline = 'Call ended'
  let detail: string | null = null
  if (info?.status === 'FAILED') {
    headline = 'We could not connect the call'
    detail = 'This can happen on restrictive networks or if a connection dropped during setup. You can try again.'
  } else if (info?.status === 'CANCELLED') {
    headline = 'The call did not start'
    detail = info.endReason === 'SKIPPED' ? `${partnerName} moved on before you connected.` : 'The connection was not established before the call ended.'
  } else if (info?.endReason === 'SKIPPED' && info.endedBy === 'partner') {
    detail = `${partnerName} chose to move on to a new partner.`
  } else if (info?.endReason === 'DISCONNECTED') {
    detail = `${partnerName} lost their connection.`
  }

  return (
    <Screen>
      <Text accessibilityRole="header" style={type.title}>{headline}</Text>
      {completed && info?.durationSeconds != null ? <Text style={[type.small, { fontSize: 16, marginTop: space.sm }]}>You spoke with {partnerName} for {formatDuration(info.durationSeconds)}.</Text> : null}
      {detail ? <Text style={[type.small, { fontSize: 16, marginTop: space.sm }]}>{detail}</Text> : null}

      <View style={{ marginTop: space.xl }}>{call.micError ? <MicProblem error={call.micError} /> : null}</View>

      <Button label="Find another partner" onPress={() => { call.dismissEnded(); void call.start(call.requestedTopic) }} />
      <Button label="Back to home" variant="secondary" onPress={() => { call.dismissEnded(); nav.navigate('Home') }} style={{ marginTop: space.sm }} />

      {completed && info ? (
        <Panel style={{ marginTop: space.xl }}>
          <Text style={type.heading}>How was your conversation?</Text>
          <Text style={[type.small, { marginBottom: space.lg }]}>Feedback is private and helps improve matching.</Text>
          <FeedbackForm callId={info.callId} />
        </Panel>
      ) : null}
      {completed && info && call.partner ? (
        <Panel style={{ marginTop: space.lg }}>
          <Text style={type.heading}>Safety</Text>
          <Text style={[type.small, { marginBottom: space.lg }]}>Something not right? You can block this person or send a report.</Text>
          <PartnerSafety callId={info.callId} partnerName={partnerName} />
        </Panel>
      ) : null}
    </Screen>
  )
}
