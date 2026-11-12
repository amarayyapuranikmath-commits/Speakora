import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { LinkButton } from '../../components/ui/Button'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { PageHeader, Panel, Stat } from '../../components/ui/Layout'
import { formatDuration } from '../../lib/format'
import { formatDate } from '../../lib/format'
import { useActivity, useStats } from '../../lib/queries'
import { useLearnProgress, type LearnProgress } from '../learn/learnApi'

const ActivityChart = lazy(() => import('./ActivityChart'))

export function ProgressPage() {
  const stats = useStats()
  const activity = useActivity(30)

  if (stats.isLoading) return <Spinner label="Loading your progress" />
  if (stats.isError || !stats.data) return <ErrorState onRetry={() => stats.refetch()} />
  const s = stats.data

  return (
    <>
      <PageHeader title="Progress" description="Your learning and your speaking practice, from your real results." />
      <LearningProgress />
      <h2 className="mb-4 mt-12 text-heading">Speaking</h2>
      {s.completedCalls === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Your speaking time, streak and weekly practice appear here after your first completed call."
          action={<LinkButton to="/app/talk">Find a partner</LinkButton>}
        />
      ) : (
        <div className="space-y-6">
          <Panel>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat label="Total speaking time" value={formatDuration(s.totalSeconds)} />
              <Stat label="Conversations" value={s.completedCalls} />
              <Stat label="Current streak" value={`${s.currentStreakDays} ${s.currentStreakDays === 1 ? 'day' : 'days'}`} hint={`Longest: ${s.longestStreakDays}`} />
              <Stat label="Last 7 days" value={formatDuration(s.weekSeconds)} hint={`Last 30 days: ${formatDuration(s.monthSeconds)}`} />
            </dl>
          </Panel>
          <Panel title="Daily practice" description="Minutes spoken per day, last 30 days (UTC).">
            {activity.isLoading ? (
              <Spinner />
            ) : activity.data ? (
              <Suspense fallback={<Spinner />}>
                <ActivityChart data={activity.data} />
              </Suspense>
            ) : (
              <ErrorState onRetry={() => activity.refetch()} />
            )}
          </Panel>
        </div>
      )}
    </>
  )
}

const KIND_LABEL: Record<string, string> = { LESSON: 'Lesson test', LEVEL: 'Level test', REVISION: 'Revision', DAILY: 'Daily practice' }

function LearningProgress() {
  const q = useLearnProgress()
  if (q.isLoading) return <Spinner label="Loading learning progress" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />
  const p: LearnProgress = q.data
  const started = p.recent.length > 0 || p.wordsSaved > 0
  return (
    <section aria-labelledby="learning-heading" className="space-y-6">
      <h2 id="learning-heading" className="text-heading">Learning</h2>
      {!started ? (
        <EmptyState title="No learning results yet" description="Your lessons, test scores, words and streak appear here after your first lesson test." action={<LinkButton to="/app/learn">Start learning</LinkButton>} />
      ) : (
        <>
          <Panel>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat label="Grammar lessons" value={`${p.grammarCompleted} of ${p.grammarTotal}`} />
              <Stat label="Phrasal verb lessons" value={`${p.phrasalCompleted} of ${p.phrasalTotal}`} />
              <Stat label="Words learned" value={`${p.wordsLearned} of ${p.wordsTotal}`} hint={`Saved: ${p.wordsSaved}`} />
              <Stat label="Phrasal verbs learned" value={`${p.phrasalVerbsLearned} of ${p.phrasalVerbsTotal}`} />
              <Stat label="Learning streak" value={`${p.learningStreakDays} ${p.learningStreakDays === 1 ? 'day' : 'days'}`} hint={`Practice days, last 30: ${p.practiceDaysLast30}`} />
              <Stat label="Daily lessons finished" value={`${p.daysCompleted}`} hint={p.today ? `Today: ${p.today.partsDone} of ${p.today.partsTotal} parts` : undefined} />
              <Stat label="Average score" value={p.averagePercent === null ? 'None yet' : `${p.averagePercent}%`} hint="Last 20 tests" />
            </dl>
            <p className="mt-4 text-sm text-muted">A word or phrasal verb counts as learned after you recall it correctly in three separate reviews.</p>
          </Panel>

          <Panel title="Recent test scores">
            <ul className="divide-y divide-line">
              {p.recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span><span className="font-medium">{r.label}</span> <span className="text-muted">· {KIND_LABEL[r.kind] ?? r.kind} · {formatDate(r.takenAt)}</span></span>
                  <span className="tabular-nums">{r.correct}/{r.total} · {r.percent}%</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Revision and weak areas">
            {p.dueCount > 0 && <p className="text-sm">{p.dueCount} {p.dueCount === 1 ? 'item is' : 'items are'} ready for revision. <Link to="/app/learn/revision" className="font-medium text-accent hover:underline">Revise now</Link></p>}
            {(p.dueTomorrow > 0 || p.dueThisWeek > 0) && <p className={`text-sm text-muted ${p.dueCount > 0 ? 'mt-2' : ''}`}>Coming up for review: {p.dueTomorrow} tomorrow, {p.dueThisWeek} in the following days this week.</p>}
            {p.weakTopics.length > 0 ? (
              <>
                <p className={`text-sm text-muted ${p.dueCount > 0 ? 'mt-4' : ''}`}>Topics where your answers were often wrong. Review them again:</p>
                <ul className="mt-2 space-y-1.5">
                  {p.weakTopics.map((t) => (
                    <li key={t.lessonId} className="text-sm"><Link to={`/app/learn/lessons/${t.lessonId}`} className="font-medium text-accent hover:underline">{t.title}</Link> <span className="text-muted">· {t.accuracyPercent}% correct</span></li>
                  ))}
                </ul>
              </>
            ) : p.dueCount === 0 ? <p className="text-sm text-muted">No weak areas found and nothing due. Keep going.</p> : null}
          </Panel>
        </>
      )}
    </section>
  )
}
