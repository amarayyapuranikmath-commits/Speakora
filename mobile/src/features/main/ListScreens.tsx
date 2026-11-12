import { useNavigation } from '@react-navigation/native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { formatDate, formatDuration } from '../../lib/format'
import { useActivity, useHistory, useStats, useTopics } from '../../lib/queries'
import type { DayPoint } from '../../lib/types'
import { Button, EmptyState, ErrorState, Panel, Screen, Spinner, Stat, Title } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { useLearnProgress } from '../learn/learnApi'
import { CallRows } from './CallRows'

/* ---------------------------------- Topics ---------------------------------- */

export function TopicsScreen() {
  const topics = useTopics()
  const nav = useNavigation<any>()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Screen>
      <Title sub="Pick a topic to practise. Each one comes with prompts you can open during a call if you get stuck.">Conversation topics</Title>
      {topics.isLoading ? <Spinner label="Loading topics" /> : topics.isError || !topics.data ? <ErrorState onRetry={() => topics.refetch()} /> : (
        <View style={{ gap: space.md }}>
          {topics.data.map((t) => {
            const expanded = open === t.slug
            return (
              <Panel key={t.slug}>
                <Text style={type.heading}>{t.name}</Text>
                {t.description ? <Text style={[type.small, { marginTop: 4 }]}>{t.description}</Text> : null}
                <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : t.slug)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.md }}>
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>Sample prompts</Text>
                  {expanded ? <ChevronUp size={18} color={colors.accent} /> : <ChevronDown size={18} color={colors.accent} />}
                </Pressable>
                {expanded ? (
                  <View style={{ marginTop: space.sm, gap: space.sm }}>
                    {t.prompts.map((p) => <Text key={p} style={[type.small, { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: space.md }]}>{p}</Text>)}
                  </View>
                ) : null}
                <Button label="Practise this topic" variant="secondary" onPress={() => nav.navigate('Tabs', { screen: 'Talk', params: { topic: t.slug } })} style={{ marginTop: space.lg }} />
              </Panel>
            )
          })}
        </View>
      )}
    </Screen>
  )
}

/* ---------------------------------- History --------------------------------- */

export function HistoryScreen() {
  const [page, setPage] = useState(0)
  const history = useHistory(page, 10)
  return (
    <Screen>
      <Title sub="Your past conversations. Leave feedback, or block and report someone after a call.">History</Title>
      {history.isLoading ? <Spinner /> : history.isError || !history.data ? <ErrorState onRetry={() => history.refetch()} /> :
        history.data.items.length === 0 ? <EmptyState title="No conversations yet" description="Your finished calls will appear here." /> : (
          <>
            <CallRows calls={history.data.items} />
            {history.data.totalPages > 1 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg }}>
                <Button label="Newer" variant="secondary" disabled={page === 0} onPress={() => setPage(page - 1)} />
                <Text style={type.small}>Page {page + 1} of {history.data.totalPages}</Text>
                <Button label="Older" variant="secondary" disabled={page + 1 >= history.data.totalPages} onPress={() => setPage(page + 1)} />
              </View>
            ) : null}
          </>
        )}
    </Screen>
  )
}

/* ---------------------------------- Progress -------------------------------- */

export function ProgressScreen() {
  const stats = useStats()
  const activity = useActivity(30)
  const nav = useNavigation<any>()

  if (stats.isLoading) return <Screen><Spinner label="Loading your progress" /></Screen>
  if (stats.isError || !stats.data) return <Screen><ErrorState onRetry={() => stats.refetch()} /></Screen>
  const s = stats.data

  return (
    <Screen>
      <Title sub="Your learning and your speaking practice, from your real results.">Progress</Title>
      <LearningProgress />
      <Text accessibilityRole="header" style={[type.heading, { marginTop: space.xl, marginBottom: space.md }]}>Speaking</Text>
      {s.completedCalls === 0 ? (
        <EmptyState title="Nothing to show yet" description="Your speaking time, streak and weekly practice appear here after your first completed call." action={<Button label="Find a partner" onPress={() => nav.navigate('Talk')} />} />
      ) : (
        <>
          <Panel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Stat label="Total speaking time" value={formatDuration(s.totalSeconds)} />
              <Stat label="Conversations" value={s.completedCalls} />
              <Stat label="Current streak" value={`${s.currentStreakDays} ${s.currentStreakDays === 1 ? 'day' : 'days'}`} hint={`Longest: ${s.longestStreakDays}`} />
              <Stat label="Last 7 days" value={formatDuration(s.weekSeconds)} hint={`Last 30 days: ${formatDuration(s.monthSeconds)}`} />
            </View>
          </Panel>
          <Panel style={{ marginTop: space.lg }}>
            <Text style={type.heading}>Daily practice</Text>
            <Text style={[type.small, { marginBottom: space.lg }]}>Minutes spoken per day, last 30 days (UTC).</Text>
            {activity.isLoading ? <Spinner /> : activity.data ? <ActivityBars data={activity.data} /> : <ErrorState onRetry={() => activity.refetch()} />}
          </Panel>
        </>
      )}
    </Screen>
  )
}

/** Minutes per day as plain bars: no chart library, no native dependency, fully accessible via one summary label. */
function ActivityBars({ data }: { data: DayPoint[] }) {
  const minutes = data.map((d) => Math.round(d.seconds / 60))
  const max = Math.max(1, ...minutes)
  const total = minutes.reduce((a, b) => a + b, 0)
  return (
    <View accessible accessibilityLabel={`${total} minutes practised over the last ${data.length} days. Busiest day ${max} minutes.`}>
      <View style={{ height: 140, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {minutes.map((m, i) => (
          <View key={data[i].date} style={{ flex: 1, height: m === 0 ? 2 : Math.max(4, (m / max) * 140), backgroundColor: m === 0 ? colors.line : colors.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={type.caption}>{shortDate(data[0]?.date)}</Text>
        <Text style={type.caption}>Peak {max} min</Text>
        <Text style={type.caption}>{shortDate(data[data.length - 1]?.date)}</Text>
      </View>
    </View>
  )
}

function shortDate(d?: string) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
}

const KIND_LABEL: Record<string, string> = { LESSON: 'Lesson test', LEVEL: 'Level test', REVISION: 'Revision' }

function LearningProgress() {
  const q = useLearnProgress()
  const nav = useNavigation<any>()
  if (q.isLoading) return <Spinner label="Loading learning progress" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />
  const p = q.data
  const started = p.recent.length > 0 || p.wordsSaved > 0
  return (
    <View accessibilityLabel="Learning">
      <Text accessibilityRole="header" style={[type.heading, { marginBottom: space.md }]}>Learning</Text>
      {!started ? (
        <EmptyState title="No learning results yet" description="Your lessons, test scores, words and streak appear here after your first lesson test." action={<Button label="Start learning" onPress={() => nav.navigate('Tabs', { screen: 'Learn' })} />} />
      ) : (
        <>
          <Panel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Stat label="Grammar lessons" value={`${p.grammarCompleted} of ${p.grammarTotal}`} />
              <Stat label="Phrasal verb lessons" value={`${p.phrasalCompleted} of ${p.phrasalTotal}`} />
              <Stat label="Words learned" value={`${p.wordsLearned} of ${p.wordsTotal}`} hint={`Saved: ${p.wordsSaved}`} />
              <Stat label="Phrasal verbs learned" value={`${p.phrasalVerbsLearned} of ${p.phrasalVerbsTotal}`} />
              <Stat label="Learning streak" value={`${p.learningStreakDays} ${p.learningStreakDays === 1 ? 'day' : 'days'}`} hint={`Practice days, last 30: ${p.practiceDaysLast30}`} />
              <Stat label="Average score" value={p.averagePercent === null ? 'None yet' : `${p.averagePercent}%`} hint="Last 20 tests" />
            </View>
            <Text style={[type.small, { marginTop: space.md }]}>A word or phrasal verb counts as learned after you recall it correctly in three separate reviews.</Text>
          </Panel>
          <Panel style={{ marginTop: space.lg }}>
            <Text style={type.heading}>Recent test scores</Text>
            {p.recent.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.sm }}>
                <Text style={[type.small, { flex: 1 }]}>{r.label} · {KIND_LABEL[r.kind] ?? r.kind} · {formatDate(r.takenAt)}</Text>
                <Text style={type.small}>{r.correct}/{r.total} · {r.percent}%</Text>
              </View>
            ))}
          </Panel>
          <Panel style={{ marginTop: space.lg }}>
            <Text style={type.heading}>Revision and weak areas</Text>
            {p.dueCount > 0 ? (
              <Pressable accessibilityRole="link" accessibilityLabel="Revise now" onPress={() => nav.navigate('Revision', {})} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={type.small}>{p.dueCount} {p.dueCount === 1 ? 'item is' : 'items are'} ready for revision. <Text style={{ color: colors.accent, fontWeight: '600' }}>Revise now</Text></Text>
              </Pressable>
            ) : null}
            {p.weakTopics.length > 0 ? (
              <>
                <Text style={[type.small, { marginTop: space.sm }]}>Topics where your answers were often wrong. Review them again:</Text>
                {p.weakTopics.map((t) => (
                  <Pressable key={t.lessonId} accessibilityRole="link" accessibilityLabel={`${t.title}, ${t.accuracyPercent}% correct`} onPress={() => nav.navigate('Lesson', { id: t.lessonId })} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{t.title} <Text style={[type.small, { fontWeight: '400' }]}>· {t.accuracyPercent}% correct</Text></Text>
                  </Pressable>
                ))}
              </>
            ) : p.dueCount === 0 ? <Text style={type.small}>No weak areas found and nothing due. Keep going.</Text> : null}
          </Panel>
        </>
      )}
    </View>
  )
}
