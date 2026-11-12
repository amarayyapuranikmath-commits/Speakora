import { useNavigation } from '@react-navigation/native'
import { BookOpen, ChevronRight, Languages, Layers, Sparkles, Users } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { homeSummary } from '../../lib/homeSummary'
import { useActivity, usePartners, useStats } from '../../lib/queries'
import type { DayPoint } from '../../lib/types'
import { Avatar } from '../../ui/Avatar'
import { Button, Screen } from '../../ui/components'
import { colors, space, themed, type } from '../../ui/theme'
import { ProfileControl } from '../../navigation/ProfileControl'
import { useAuth } from '../auth/AuthContext'
import { useLearnProgress, type LearnProgress } from '../learn/learnApi'

const SUBJECT_LABEL = { grammar: 'Grammar', vocabulary: 'Vocabulary', phrasal: 'Phrasal verbs' } as const
const rule = themed(() => ({ borderTopWidth: 1, borderTopColor: colors.line, marginTop: space.xl, paddingTop: space.lg }))

export const greeting = (hour: number) => (hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')

/**
 * Home: what to do next, in the order a learner needs it. Speaking today, the next lesson, the three subjects, one line of progress and the
 * AI tutor. Everything shown is a recorded result or a plain fact about the course; nothing is estimated, a new learner sees no zeros,
 * and there are no boxes around things: sections are separated by thin lines.
 */
export function HomeScreen() {
  const { user } = useAuth()
  const nav = useNavigation<any>()
  const stats = useStats()
  const activity = useActivity(7)
  const partners = usePartners()
  const learn = useLearnProgress()
  const { goalDone, line } = homeSummary(stats.data)
  const level = stats.data?.englishLevel
  const l = learn.data
  const recent = (partners.data ?? []).slice(0, 4)

  return (
    <Screen>
      {/* Greeting and the account control */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[type.title, { fontSize: 24, lineHeight: 30 }]} numberOfLines={2}>{greeting(new Date().getHours())}, {user?.displayName}</Text>
          {level ? <Text style={[type.small, { marginTop: 2 }]}>English level <Text style={{ fontWeight: '600', color: colors.accent }}>{level}</Text></Text> : null}
        </View>
        <ProfileControl />
      </View>

      {/* Speaking today */}
      <View style={{ marginTop: space.xl }} accessibilityLabel="Speak today">
        <Text accessibilityRole="header" style={sectionLabel}>Speak today</Text>
        <Text style={[type.heading, { marginTop: space.sm }]}>{goalDone ? 'You have spoken today. Well done.' : 'Have one conversation today.'}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>Quick Match: a one-to-one voice call with another learner. A short call is enough.</Text>
        <Button label={goalDone ? 'Talk again' : 'Start speaking'} onPress={() => nav.navigate('Talk')} style={{ marginTop: space.md }} />
        <WeekStrip days={activity.data} />
        {recent.length > 0 ? (
          <Pressable accessibilityRole="link" accessibilityLabel="Previous partners" onPress={() => nav.navigate('Partners')} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm }}>
            <View style={{ flexDirection: 'row' }}>
              {recent.map((p, i) => <View key={p.ref} style={{ marginLeft: i === 0 ? 0 : -10, borderWidth: 2, borderColor: colors.canvas, borderRadius: 18 }}><Avatar name={p.displayName} size={30} /></View>)}
            </View>
            <Text style={{ flex: 1, fontSize: 15, color: colors.ink }} numberOfLines={1}>Previous partners</Text>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {l && (l.next || l.dueCount > 0) ? <Continue learn={l} /> : null}

      {/* The three subjects */}
      <View style={rule} accessibilityLabel="Learn">
        <Text accessibilityRole="header" style={sectionLabel}>Learn</Text>
        <SubjectRow icon={<BookOpen size={20} color={colors.accent} />} label="Grammar" hint={l ? `${l.grammarCompleted} of ${l.grammarTotal} lessons` : 'Five levels'} onPress={() => nav.navigate('Subject', { subject: 'grammar' })} />
        <SubjectRow icon={<Languages size={20} color={colors.accent} />} label="Vocabulary" hint={l ? `${l.wordsLearned} of ${l.wordsTotal} words learned` : 'Five levels'} onPress={() => nav.navigate('Subject', { subject: 'vocabulary' })} />
        <SubjectRow icon={<Layers size={20} color={colors.accent} />} label="Phrasal verbs" hint={l ? `${l.phrasalCompleted} of ${l.phrasalTotal} lessons` : 'Three levels'} onPress={() => nav.navigate('Subject', { subject: 'phrasal' })} last />
      </View>

      {/* Progress: one line of real numbers, or an honest nudge */}
      <View style={rule} accessibilityLabel="Your progress">
        <Text accessibilityRole="header" style={sectionLabel}>Progress</Text>
        {stats.isLoading ? (
          <Text accessibilityRole="progressbar" style={[type.body, { color: colors.muted, marginTop: space.sm }]}>Loading…</Text>
        ) : stats.isError ? (
          <Text accessibilityRole="alert" style={[type.body, { color: colors.muted, marginTop: space.sm }]}>
            We could not load your progress.{' '}
            <Text accessibilityRole="button" onPress={() => void stats.refetch()} style={{ color: colors.accent, fontWeight: '600' }}>Try again</Text>
          </Text>
        ) : line ? (
          <Pressable accessibilityRole="link" accessibilityLabel="See progress" onPress={() => nav.navigate('Progress')} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
            <Text style={[type.body, { flex: 1 }]}>{line}</Text>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        ) : (
          <Text style={[type.body, { color: colors.muted, marginTop: space.sm }]}>Your first conversation starts your progress.</Text>
        )}
      </View>

      {/* AI Coach and Friends */}
      <View style={rule} accessibilityLabel="More">
        <SubjectRow icon={<Sparkles size={20} color={colors.accent} />} label="AI Coach" hint="Talk or type with an AI tutor. Your conversation is not saved." onPress={() => nav.navigate('Coach', {})} />
        <SubjectRow icon={<Users size={20} color={colors.accent} />} label="Friends" hint="Message and call people you have spoken with." onPress={() => nav.navigate('Friends')} last />
      </View>
    </Screen>
  )
}

const sectionLabel = themed(() => ({ fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' as const }))

function Continue({ learn: l }: { learn: LearnProgress }) {
  const nav = useNavigation<any>()
  const started = l.grammarCompleted + l.phrasalCompleted > 0
  const next = l.next
  const done = next?.subject === 'phrasal' ? l.phrasalCompleted : l.grammarCompleted
  const total = next?.subject === 'phrasal' ? l.phrasalTotal : l.grammarTotal
  const unit = next?.subject === 'phrasal' ? 'phrasal verb lessons' : 'grammar lessons'
  return (
    <View style={rule} accessibilityLabel="Continue learning">
      <Text accessibilityRole="header" style={sectionLabel}>{started ? 'Continue learning' : 'Start learning'}</Text>
      {next ? (
        <>
          <Text style={[type.small, { marginTop: space.sm }]}>{SUBJECT_LABEL[next.subject]} · Level {next.level}</Text>
          <Text style={[type.heading, { marginTop: 2 }]}>{next.title}</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }} accessibilityLabel="Course progress" style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden', marginTop: space.md }}>
            <View style={{ height: 4, width: total ? `${(done / total) * 100}%` : '0%', backgroundColor: colors.accent }} />
          </View>
          <Text style={[type.caption, { marginTop: 6 }]}>{done === 0 ? 'Not started' : `${done} of ${total} ${unit}`}</Text>
          <Button label={started ? 'Continue learning' : 'Start learning'} variant="secondary" onPress={() => nav.navigate('Lesson', { id: next.lessonId })} style={{ marginTop: space.md }} />
        </>
      ) : null}
      {l.dueCount > 0 ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Revise now" onPress={() => nav.navigate('Revision', {})} style={{ minHeight: 48, justifyContent: 'center', marginTop: space.xs }}>
          <Text style={type.body}>{l.dueCount} {l.dueCount === 1 ? 'item is' : 'items are'} ready for revision. <Text style={{ color: colors.accent, fontWeight: '600' }}>Revise now</Text></Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** The last seven days as seven marks: filled when there was speaking that day. Real days from the server. */
function WeekStrip({ days }: { days: DayPoint[] | undefined }) {
  if (!days || days.length === 0) return null
  const week = days.slice(-7)
  const practised = week.filter((d) => d.seconds > 0).length
  const text = practised === 0 ? 'No speaking in the last 7 days yet.' : `Practised on ${practised} of the last 7 days.`
  return (
    <View style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View accessible accessibilityLabel={text} style={{ flexDirection: 'row', gap: 6 }}>
        {week.map((d) => <View key={d.date} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: d.seconds > 0 ? colors.accent : colors.lineStrong, backgroundColor: d.seconds > 0 ? colors.accent : 'transparent' }} />)}
      </View>
      <Text style={[type.caption, { flex: 1 }]}>{text}</Text>
    </View>
  )
}

function SubjectRow({ icon, label, hint, onPress, last }: { icon: React.ReactNode; label: string; hint: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line, backgroundColor: pressed ? 'rgba(0,0,0,0.03)' : 'transparent' })}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{label}</Text>
        <Text style={type.small}>{hint}</Text>
      </View>
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  )
}
