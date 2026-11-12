import { ArrowRight, BookOpen, Check, Languages, Layers, Mic } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LinkButton } from '../../components/ui/Button'
import { homeSummary } from '../../lib/homeSummary'
import { useActivity, useStats } from '../../lib/queries'
import type { DayPoint } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useLearnProgress, type LearnProgress } from '../learn/learnApi'

const SUBJECT_LABEL = { grammar: 'Grammar', vocabulary: 'Vocabulary', phrasal: 'Phrasal verbs' } as const

/**
 * Home: what to do next. Speaking today, the next lesson, the AI tutor and four ways in. Everything shown is a recorded result or a
 * plain fact about the course; nothing is estimated, and a new learner sees no zeros.
 */
export function DashboardPage() {
  const { user } = useAuth()
  const stats = useStats()
  const activity = useActivity(7)
  const learn = useLearnProgress()
  const { goalDone, line } = homeSummary(stats.data)
  const level = stats.data?.englishLevel
  const l = learn.data
  const hasLearning = !!l && (!!l.next || l.dueCount > 0)

  return (
    <div className="mx-auto max-w-app">
      <header className="pt-2">
        <h1 className="text-title">Welcome back, {user?.displayName}</h1>
        <p className="mt-1.5 text-body text-muted">
          {level && <span className="mr-3 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-small font-medium text-accent">English level {level}</span>}
          {message(goalDone, l)}
        </p>
      </header>

      <div className={`mt-10 grid gap-x-14 gap-y-12 border-t border-line pt-10 ${hasLearning ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}`}>
        <section aria-labelledby="speak-heading">
          <h2 id="speak-heading" className="text-heading">Speak today</h2>
          <p className="mt-2 flex items-center gap-2 text-small text-muted" role="status">
            <span className={`size-2 rounded-full ${goalDone ? 'bg-success' : 'bg-line-strong'}`} aria-hidden />
            {goalDone ? 'You have practised today.' : 'Not yet today.'}
          </p>
          {goalDone ? (
            <p className="mt-5 flex items-center gap-2 text-heading"><Check className="size-5 text-success" aria-hidden /> You have spoken today. Well done.</p>
          ) : (
            <p className="mt-5 text-heading">Have one conversation today.</p>
          )}
          <p className="mt-2 max-w-prose text-body text-muted">A short call is enough. Speaking regularly matters more than speaking for long.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <LinkButton to="/app/talk" size="lg">{goalDone ? 'Talk again' : 'Start speaking'}</LinkButton>
            <Link to="/app/partners" className="text-small font-medium text-muted hover:text-ink">Previous partners</Link>
          </div>
          <WeekStrip days={activity.data} />
          <div className="mt-6 border-t border-line pt-4 text-body">
            {stats.isLoading ? (
              <p className="text-muted" role="status">Loading…</p>
            ) : stats.isError ? (
              <p className="text-muted" role="alert">
                We could not load your progress.{' '}
                <button type="button" onClick={() => void stats.refetch()} className="font-medium text-accent hover:underline">Try again</button>
              </p>
            ) : line ? (
              <p>
                {line}
                <Link to="/app/progress" className="ml-3 whitespace-nowrap font-medium text-accent hover:underline">See progress</Link>
              </p>
            ) : (
              <p className="text-muted">Your first conversation starts your progress.</p>
            )}
          </div>
        </section>

        {hasLearning && l && <Continue learn={l} />}
      </div>

      <section aria-labelledby="tutor-heading" className="mt-14 rounded-panel bg-accent-soft px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="max-w-xl">
            <h2 id="tutor-heading" className="text-heading">Your AI English tutor</h2>
            <p className="mt-1.5 text-body text-muted">Ask a question, practise a conversation or get a sentence corrected. It explains in simple English and remembers what you have talked about.</p>
          </div>
          <LinkButton to="/app/coach" variant="secondary">Start a conversation</LinkButton>
        </div>
        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-small font-medium" aria-label="Ways to start">
          {[['GRAMMAR_TUTOR', 'Grammar help'], ['SENTENCE_CORRECTION', 'Correct my sentences'], ['INTERVIEW_PRACTICE', 'Interview practice'], ['ROLEPLAY', 'Roleplay a real situation']].map(([mode, label]) => (
            <li key={mode}><Link to={`/app/coach?mode=${mode}`} className="inline-flex items-center gap-1 text-accent hover:underline">{label} <ArrowRight className="size-3.5" aria-hidden /></Link></li>
          ))}
        </ul>
      </section>

      <nav aria-label="Quick actions" className="mt-14">
        <ul className="grid grid-cols-2 divide-line border-y border-line max-lg:[&>li:nth-child(n+3)]:border-t lg:grid-cols-4 lg:divide-x">
          <Quick to="/app/talk" icon={<Mic className="size-5" aria-hidden />} title="Speaking practice" hint="Quick Match or your friends" />
          <Quick to="/app/learn/grammar" icon={<BookOpen className="size-5" aria-hidden />} title="Grammar" hint={l ? `${l.grammarCompleted} of ${l.grammarTotal} lessons` : 'Five levels'} />
          <Quick to="/app/learn/vocabulary" icon={<Languages className="size-5" aria-hidden />} title="Vocabulary" hint={l ? `${l.wordsLearned} of ${l.wordsTotal} words learned` : 'Five levels'} />
          <Quick to="/app/learn/phrasal" icon={<Layers className="size-5" aria-hidden />} title="Phrasal verbs" hint={l ? `${l.phrasalVerbsLearned} of ${l.phrasalVerbsTotal} learned` : 'Three levels'} />
        </ul>
      </nav>
    </div>
  )
}

/** One honest sentence for the day, chosen only from what is actually known. */
function message(goalDone: boolean, learn: LearnProgress | undefined): string {
  if (!goalDone) return 'A short conversation today keeps your English active.'
  if (learn?.next) return 'A short lesson is a good way to round off the day.'
  return 'Come back tomorrow to keep your practice going.'
}

function Continue({ learn: l }: { learn: LearnProgress }) {
  const started = l.grammarCompleted + l.phrasalCompleted > 0
  const next = l.next
  const done = next?.subject === 'phrasal' ? l.phrasalCompleted : l.grammarCompleted
  const total = next?.subject === 'phrasal' ? l.phrasalTotal : l.grammarTotal
  const unit = next?.subject === 'phrasal' ? 'phrasal verb lessons' : 'grammar lessons'
  return (
    <section aria-labelledby="learn-heading" className="lg:border-l lg:border-line lg:pl-14">
      <h2 id="learn-heading" className="text-heading">Today’s lesson</h2>
      <p className="mt-2 text-small text-muted">{l.today ? `Day ${l.today.day} · ${l.today.complete ? 'finished' : `${l.today.partsDone} of ${l.today.partsTotal} parts done`}` : 'A grammar lesson, new words, new phrasal verbs and a short speaking task.'}</p>
      {next && (
        <>
          <p className="mt-5 text-small text-muted">Next grammar lesson · {SUBJECT_LABEL[next.subject]} · Level {next.level}</p>
          <p className="mt-1 text-heading">{next.title}</p>
          <div className="mt-5 max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Course progress">
              <div className="h-full bg-accent transition-[width] duration-[var(--motion-slow)]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="mt-1.5 text-small text-muted">{done === 0 ? 'Not started' : `${done} of ${total} ${unit}`}</p>
          </div>
          <LinkButton to="/app/learn/today" variant="secondary" size="lg" className="mt-6">{!l.today || l.today.partsDone === 0 ? (started ? 'Start today’s lesson' : 'Start learning') : l.today.complete ? 'Review today’s lesson' : 'Continue today’s lesson'}</LinkButton>
        </>
      )}
      {l.dueCount > 0 && (
        <p className={`${next ? 'mt-6 border-t border-line pt-4' : 'mt-4'} text-body`}>
          {l.dueCount} {l.dueCount === 1 ? 'item is' : 'items are'} ready for revision.{' '}
          <Link to="/app/learn/revision" className="ml-1 font-medium text-accent hover:underline">Revise now</Link>
        </p>
      )}
    </section>
  )
}

/** The last seven days as seven marks: filled when there was speaking that day. Real days from the server, nothing implied. */
function WeekStrip({ days }: { days: DayPoint[] | undefined }) {
  if (!days || days.length === 0) return null
  const week = days.slice(-7)
  const practised = week.filter((d) => d.seconds > 0).length
  return (
    <div className="mt-7">
      <ul className="flex gap-2.5" aria-label="Last seven days">
        {week.map((d) => {
          const name = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
          return (
            <li key={d.date} className="flex flex-col items-center gap-1.5">
              <span className={`size-6 rounded-full border ${d.seconds > 0 ? 'border-accent bg-accent' : 'border-line-strong'}`} aria-hidden />
              <span className="text-caption text-subtle" aria-hidden>{name[0]}</span>
              <span className="sr-only">{name}: {d.seconds > 0 ? 'practised' : 'no practice'}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-small text-muted">{practised === 0 ? 'No speaking in the last 7 days yet.' : `Practised on ${practised} of the last 7 days.`}</p>
    </div>
  )
}

function Quick({ to, icon, title, hint }: { to: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <li className="border-line">
      <Link to={to} className="group flex h-full items-start gap-3 px-1 py-5 transition-colors duration-[var(--motion-fast)] hover:bg-black/[0.03] lg:px-5">
        <span className="mt-0.5 text-accent">{icon}</span>
        <span>
          <span className="block font-medium group-hover:text-accent">{title}</span>
          <span className="mt-0.5 block text-small text-muted">{hint}</span>
        </span>
      </Link>
    </li>
  )
}
