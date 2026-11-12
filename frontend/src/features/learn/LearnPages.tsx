import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bookmark, BookmarkCheck, Check, ChevronRight, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { speak, voiceOutputSupported } from '../coach/voice'
import {
  SEPARABLE_LABEL, SUBJECT_TITLE, WORD_STATUS, invalidateLearn, isSubject, learnKeys, useDailyPlan, useLearnOverview, useSupportLanguage,
  type DailyPlan, type GrammarLessonView, type ItemRow, type LessonRow, type LessonView, type LevelView, type Outcome, type PhrasalLessonView, type PlanItem,
  type Quiz, type SubjectId, type ThemeSummary, type ThemeVerbs, type ThemeWords, type VocabularyLevelView, type WordRow, type WordView,
} from './learnApi'
import { PracticeList, QuizRunner } from './Quiz'

const BACK = 'inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink'
const ROW = 'block rounded-panel border border-line bg-surface p-5 hover:border-line-strong'

function Back({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className={BACK}><ArrowLeft className="size-4" aria-hidden /> {children}</Link>
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
        <div className="h-full bg-accent" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
      </div>
    </div>
  )
}

/** Pronunciation: the device's own English voice says the word. Hidden when this browser cannot speak. */
function SpeakButton({ text, label }: { text: string; label?: string }) {
  if (!voiceOutputSupported()) return null
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); speak(text) }} aria-label={`Hear ${label ?? text}`} className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-black/5 hover:text-ink">
      <Volume2 className="size-4" aria-hidden />
    </button>
  )
}

/** The Kannada meaning, shown only to learners who chose Kannada as their support language. */
function Kn({ text, show }: { text?: string; show: boolean }) {
  if (!show || !text) return null
  return <span lang="kn" className="block text-sm">{text}</span>
}

/* ------------------------------------------------------------------ Learn home: today's lesson and the four subjects */

export function LearnHome() {
  const overview = useLearnOverview()
  const support = useSupportLanguage()
  const o = overview.data
  const today = o?.today
  return (
    <div className="mx-auto max-w-reading">
      <h1 className="text-title">Learn</h1>
      <p className="mt-2 text-muted">One lesson a day, in a fixed order. Your progress is recorded from the tests you really take.</p>
      {overview.isLoading ? <Spinner label="Loading" /> : overview.isError || !o ? <div className="mt-8"><ErrorState onRetry={() => overview.refetch()} /></div> : (
        <>
          <Link to="/app/learn/today" className="mt-8 block rounded-panel border border-accent/40 bg-accent-soft p-5 hover:border-accent">
            <span className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm text-muted">{today ? `Daily lesson · Day ${today.day}` : 'Daily lesson'}</span>
                <span className="block text-heading">{!today ? 'Start today’s lesson' : today.complete ? 'Today’s lesson is complete' : today.partsDone === 0 ? 'Start today’s lesson' : 'Continue today’s lesson'}</span>
                <span className="mt-1 block text-sm text-muted">{today ? `${today.partsDone} of ${today.partsTotal} parts done` : 'A grammar lesson, new words, new phrasal verbs and a short speaking task.'}</span>
              </span>
              <ChevronRight className="size-5 text-accent" aria-hidden />
            </span>
            {today && <span className="mt-4 block"><Progress done={today.partsDone} total={today.partsTotal} label="Today's progress" /></span>}
          </Link>
          {o.dueCount > 0 && (
            <Link to="/app/learn/revision" className="mt-3 flex items-center justify-between rounded-panel border border-line bg-surface p-4 hover:border-line-strong">
              <span>
                <span className="block text-subheading">Revision</span>
                <span className="block text-sm text-muted">{o.dueCount} {o.dueCount === 1 ? 'item is' : 'items are'} ready to review</span>
              </span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Link>
          )}
          <ul className="mt-8 space-y-3">
            {o.subjects.map((s) => (
              <li key={s.id}>
                <Link to={`/app/learn/${s.id}`} className={ROW}>
                  <span className="flex items-center justify-between">
                    <span className="text-heading">{s.title}</span>
                    <ChevronRight className="size-5 text-muted" aria-hidden />
                  </span>
                  <span className="mt-1 block text-muted">{s.description}</span>
                  <span className="mt-4 block"><Progress done={s.completed} total={s.total} label={`${s.title} progress`} /></span>
                  <span className="mt-2 block text-sm text-muted">{s.completed === 0 ? 'Not started' : `${s.completed} of ${s.total} ${s.unit}`}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link to="/app/progress" className={ROW}>
                <span className="flex items-center justify-between">
                  <span className="text-heading">Revision and progress</span>
                  <ChevronRight className="size-5 text-muted" aria-hidden />
                </span>
                <span className="mt-1 block text-muted">What you have learned, what needs revision and what is coming up.</span>
              </Link>
            </li>
          </ul>
          {support.ready && (
            <div className="mt-8 border-t border-line pt-2">
              <Toggle label="Show meanings in Kannada" description="Adds the Kannada meaning under each word and phrasal verb. It is the same language you choose for the AI coach to explain in." checked={support.kannada} onChange={(v) => void support.setKannada(v)} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ The daily lesson */

function Part({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-panel border border-line bg-surface p-5">
      <h2 className="flex items-center gap-3 text-subheading">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm ${done ? 'bg-accent text-white' : 'border border-line-strong text-muted'}`} aria-hidden>
          {done ? <Check className="size-4" /> : n}
        </span>
        {title}
        <span className="sr-only">{done ? ' (done)' : ' (not done yet)'}</span>
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const LinkButton = ({ to, children, secondary }: { to: string; children: React.ReactNode; secondary?: boolean }) => (
  <Link to={to} className={`inline-flex h-10 items-center rounded-control px-4 text-sm font-medium ${secondary ? 'border border-line-strong hover:bg-black/5' : 'bg-accent text-white hover:bg-accent-hover'}`}>{children}</Link>
)

function ItemList({ items, kannada, open, onOpen }: { items: PlanItem[]; kannada: boolean; open: string | null; onOpen: (id: string | null) => void }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.id} className="py-2.5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id} className="min-w-0 flex-1 text-left">
              <span className="font-semibold">{i.label}</span> <span className="text-sm text-muted">{WORD_STATUS[i.status]}</span>
              <span className="block text-sm text-muted">{i.meaning}</span>
              <Kn text={i.kn} show={kannada} />
            </button>
            <SpeakButton text={i.label} />
          </div>
          {open === i.id && (i.id.startsWith('v') ? <WordCard id={i.id} /> : <p className="mt-2 text-sm"><Link to={`/app/learn/lessons/${i.id}`} className="font-medium text-accent hover:underline">Open the full lesson for {i.label}</Link></p>)}
        </li>
      ))}
    </ul>
  )
}

export function DailyPage() {
  const q = useDailyPlan()
  const support = useSupportLanguage()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p: DailyPlan | undefined = q.data

  async function post(path: string) {
    setBusy(true)
    setError(null)
    try {
      await api<DailyPlan>(path, { method: 'POST' })
      await invalidateLearn(queryClient)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn">Learn</Back>
      {q.isLoading ? <div className="mt-8"><Spinner label="Preparing today’s lesson" /></div> : q.isError || !p ? <div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div> : (
        <>
          <h1 className="mt-4 text-title">Day {p.day}</h1>
          <p className="mt-2 text-muted">
            {p.complete ? 'You have finished this lesson.' : `${p.partsDone} of ${p.partsTotal} parts done. Do them in any order, at your own pace.`}
            {p.streakDays > 0 ? ` Learning streak: ${p.streakDays} ${p.streakDays === 1 ? 'day' : 'days'}.` : ''}
          </p>
          <div className="mt-3"><Progress done={p.partsDone} total={p.partsTotal} label="Lesson progress" /></div>

          <div className="mt-8 space-y-4">
            {p.grammar && (
              <Part n={1} title="Grammar" done={p.grammar.done}>
                <p className="font-medium">{p.grammar.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {p.grammar.status === 'COMPLETED' ? `Passed · best score ${p.grammar.bestPercent}%` : p.grammar.attempts > 0 ? `${p.grammar.attempts} ${p.grammar.attempts === 1 ? 'attempt' : 'attempts'} so far · best ${p.grammar.bestPercent}%. You need 70% to pass.` : 'Read the lesson, practise, then take the short test.'}
                </p>
                <div className="mt-3"><LinkButton to={`/app/learn/lessons/${p.grammar.lessonId}`} secondary={p.grammar.done}>{p.grammar.done ? 'Open the lesson again' : p.grammar.attempts > 0 ? 'Continue the lesson' : 'Start the lesson'}</LinkButton></div>
              </Part>
            )}
            {p.words.items.length > 0 && (
              <Part n={2} title={`New words (${p.words.items.length})`} done={p.words.done}>
                <ItemList items={p.words.items} kannada={support.kannada} open={open} onOpen={setOpen} />
                <div className="mt-3"><LinkButton to="/app/learn/today/practice/vocabulary" secondary={p.words.done}>{p.words.done ? 'Practise the words again' : 'Take the vocabulary practice'}</LinkButton></div>
              </Part>
            )}
            {p.phrasal.items.length > 0 && (
              <Part n={3} title={`New phrasal verbs (${p.phrasal.items.length})`} done={p.phrasal.done}>
                <ItemList items={p.phrasal.items} kannada={support.kannada} open={open} onOpen={setOpen} />
                <div className="mt-3"><LinkButton to="/app/learn/today/practice/phrasal" secondary={p.phrasal.done}>{p.phrasal.done ? 'Practise the phrasal verbs again' : 'Take the phrasal verb practice'}</LinkButton></div>
              </Part>
            )}
            {p.revision.needed && (
              <Part n={4} title="Revision" done={p.revision.done}>
                <p>{p.revision.dueCount > 0 ? `${p.revision.dueCount} ${p.revision.dueCount === 1 ? 'item is' : 'items are'} ready to review. Items you got right come back later; the ones you missed come back sooner.` : 'You have revised everything that was due.'}</p>
                <div className="mt-3"><LinkButton to="/app/learn/revision" secondary={p.revision.done}>{p.revision.done ? 'Revise again' : 'Start revision'}</LinkButton></div>
              </Part>
            )}
            <Part n={5} title="Speaking" done={p.speaking.done}>
              <p>{p.speaking.prompt}</p>
              <p className="mt-2 text-sm text-muted">The app does not listen to this. You say it aloud, or practise it with the AI Coach, then mark it done yourself.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LinkButton to={`/app/coach?mode=${p.speaking.coachMode}`} secondary>Practise with the AI Coach</LinkButton>
                {!p.speaking.done && <Button onClick={() => void post('/api/learn/today/speaking')} loading={busy}>I practised this</Button>}
              </div>
            </Part>
          </div>

          {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
          <section aria-label="What comes next" className="mt-8 rounded-panel border border-line bg-surface p-5">
            {p.complete ? (
              <>
                <h2 className="text-subheading">Well done. Today’s lesson is complete.</h2>
                <p className="mt-1 text-sm text-muted">{p.canLearnMore ? 'You can stop here, or carry on with the next lesson in the course.' : 'That is plenty for today. The next lesson will be ready tomorrow.'}</p>
                {p.canLearnMore && <div className="mt-3"><Button onClick={() => void post('/api/learn/today/more')} loading={busy}>Learn more today</Button></div>}
              </>
            ) : (
              <>
                <h2 className="text-subheading">What comes next</h2>
                <p className="mt-1 text-sm text-muted">Finish the parts above. After that: the next grammar lesson, ten more new words and five more phrasal verbs.</p>
              </>
            )}
            <p className="mt-3 text-sm text-muted">Still to come in the course: {p.remaining.grammarLessons} grammar {p.remaining.grammarLessons === 1 ? 'lesson' : 'lessons'}, {p.remaining.words} words and {p.remaining.phrasalVerbs} phrasal verbs.</p>
          </section>
        </>
      )}
    </div>
  )
}

export function DailyPracticePage() {
  const { part = '' } = useParams()
  const queryClient = useQueryClient()
  const valid = part === 'vocabulary' || part === 'phrasal'
  const quiz = useQuery({ queryKey: ['learn', 'test', 'daily', part], queryFn: () => api<Quiz>(`/api/learn/today/practice/${part}`), enabled: valid, gcTime: 0, staleTime: Infinity })
  if (!valid) return <Navigate to="/app/learn/today" replace />
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn/today">Today’s lesson</Back>
      <h1 className="mt-4 text-title">{part === 'vocabulary' ? 'Vocabulary practice' : 'Phrasal verb practice'}</h1>
      <p className="mt-2 text-muted">A matching exercise, then one question for each new {part === 'vocabulary' ? 'word' : 'phrasal verb'}. Your answers set when each one comes back for revision.</p>
      <div className="mt-6">
        {quiz.isLoading ? <Spinner label="Preparing the practice" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> : (
          <QuizRunner
            questions={quiz.data.questions}
            passText="Good work. This part of today’s lesson is done."
            submit={async (answers) => {
              const o = await api<Outcome>(`/api/learn/today/practice/${part}`, { method: 'POST', body: { answers } })
              void invalidateLearn(queryClient)
              return o
            }}
          >
            {() => <Link to="/app/learn/today" className="inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">Back to today’s lesson</Link>}
          </QuizRunner>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ A subject: its levels and topics */

type Browse = 'level' | 'topic'

function ThemeList({ subject }: { subject: 'vocabulary' | 'phrasal' }) {
  const q = useQuery({ queryKey: learnKeys.themes(subject), queryFn: () => api<ThemeSummary[]>(`/api/learn/${subject}/themes`) })
  if (q.isLoading) return <Spinner label="Loading topics" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />
  return (
    <ul className="mt-6 space-y-3" aria-label="Topics">
      {q.data.filter((t) => t.total > 0).map((t) => (
        <li key={t.id}>
          <Link to={`/app/learn/${subject}/topics/${t.id}`} className="block rounded-panel border border-line bg-surface p-4 hover:border-line-strong">
            <span className="flex items-center justify-between">
              <span className="text-subheading">{t.title}</span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </span>
            <span className="mt-1 block text-sm text-muted">{t.learned} of {t.total} learned</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function SubjectPage() {
  const { subject } = useParams()
  const overview = useLearnOverview()
  const [browse, setBrowse] = useState<Browse>('level')
  if (!isSubject(subject)) return <Navigate to="/app/learn" replace />
  const data = overview.data?.subjects.find((s) => s.id === subject)
  const themed = subject === 'vocabulary' || subject === 'phrasal'
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn">Learn</Back>
      <h1 className="mt-4 text-title">{SUBJECT_TITLE[subject]}</h1>
      {subject === 'vocabulary' && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Vocabulary tools">
          {[['/app/learn/today', "Today's lesson"], ['/app/learn/revision?subject=vocabulary', 'Revision'], ['/app/learn/vocabulary/saved', 'Saved words'], ['/app/learn/vocabulary/difficult', 'Difficult words']].map(([to, label]) => (
            <li key={to}><Link to={to} className="block rounded-panel border border-line bg-surface p-4 font-medium hover:border-line-strong">{label}</Link></li>
          ))}
        </ul>
      )}
      {subject === 'phrasal' && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Phrasal verb tools">
          {[['/app/learn/today', "Today's lesson"], ['/app/learn/revision?subject=phrasal', 'Revision'], ['/app/learn/phrasal/saved', 'Saved phrasal verbs']].map(([to, label]) => (
            <li key={to}><Link to={to} className="block rounded-panel border border-line bg-surface p-4 font-medium hover:border-line-strong">{label}</Link></li>
          ))}
        </ul>
      )}
      {themed && (
        <div role="group" aria-label="Browse by" className="mt-8 inline-flex rounded-control border border-line-strong p-0.5 text-sm font-medium">
          {([['level', 'By level'], ['topic', 'By topic']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={browse === id} onClick={() => setBrowse(id)} className={`rounded-[7px] px-4 py-1.5 ${browse === id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      )}
      {themed && browse === 'topic' ? <ThemeList subject={subject} /> : overview.isLoading ? <Spinner label="Loading levels" /> : !data ? <div className="mt-8"><ErrorState onRetry={() => overview.refetch()} /></div> : (
        <ul className="mt-8 space-y-3" aria-label="Levels">
          {data.levels.map((l) => (
            <li key={l.level}>
              <Link to={`/app/learn/${subject}/levels/${l.level}`} className={ROW}>
                <span className="flex items-center justify-between">
                  <span className="text-subheading">Level {l.level}: {l.title}</span>
                  <ChevronRight className="size-5 text-muted" aria-hidden />
                </span>
                <span className="mt-1 block text-sm text-muted">{l.summary}</span>
                <span className="mt-3 block"><Progress done={l.completed} total={l.total} label={`Level ${l.level} progress`} /></span>
                <span className="mt-2 block text-sm text-muted">{l.completed} of {l.total} {data.unit}{l.testPercent !== null ? ` · Level test best ${l.testPercent}%` : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ A level: its lessons, words or phrasal verbs */

export function LevelPage() {
  const { subject, level } = useParams()
  const n = Number(level)
  if (!isSubject(subject) || !Number.isInteger(n)) return <Navigate to="/app/learn" replace />
  return subject === 'vocabulary' ? <VocabularyLevel level={n} /> : subject === 'phrasal' ? <PhrasalLevel level={n} /> : <GrammarLevel level={n} />
}

const STATUS_LABEL = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' } as const

function LevelTest({ subject, level, text, score }: { subject: SubjectId; level: number; text: string; score: number | null }) {
  return (
    <div className="mt-8 rounded-panel border border-line bg-surface p-5">
      <h2 className="text-subheading">Level test</h2>
      <p className="mt-1 text-sm text-muted">{text}{score !== null ? `. Your best score is ${score}%.` : '.'}</p>
      <Link to={`/app/learn/tests/${subject}/${level}`} className="mt-4 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">Take the level test</Link>
    </div>
  )
}

function GrammarLevel({ level }: { level: number }) {
  const q = useQuery({ queryKey: learnKeys.level('grammar', level), queryFn: () => api<LevelView>(`/api/learn/grammar/levels/${level}`) })
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn/grammar">Grammar</Back>
      {q.isLoading ? <Spinner label="Loading lessons" /> : q.isError || !q.data ? <div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div> : (
        <>
          <h1 className="mt-4 text-title">Level {level}: {q.data.level.title}</h1>
          <p className="mt-2 text-muted">{q.data.level.summary}</p>
          <ol className="mt-8 space-y-2" aria-label="Lessons">
            {q.data.lessons.map((l, i) => (
              <li key={l.id}>
                <Link to={`/app/learn/lessons/${l.id}`} className="flex items-center gap-4 rounded-panel border border-line bg-surface px-4 py-3 hover:border-line-strong">
                  <span className="w-6 text-sm tabular-nums text-muted">{i + 1}</span>
                  <span className="flex-1 font-medium">{l.title}</span>
                  <span className={`flex items-center gap-1 text-sm ${l.status === 'COMPLETED' ? 'text-success' : 'text-muted'}`}>
                    {l.status === 'COMPLETED' && <Check className="size-4" aria-hidden />}
                    {STATUS_LABEL[l.status as keyof typeof STATUS_LABEL]}{l.attempts > 0 ? ` · best ${l.bestPercent}%` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <LevelTest subject="grammar" level={level} text="Ten mixed questions from this level" score={q.data.level.testPercent} />
        </>
      )}
    </div>
  )
}

function VocabularyLevel({ level }: { level: number }) {
  const q = useQuery({ queryKey: learnKeys.level('vocabulary', level), queryFn: () => api<VocabularyLevelView>(`/api/learn/vocabulary/levels/${level}`) })
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn/vocabulary">Vocabulary</Back>
      {q.isLoading ? <Spinner label="Loading words" /> : q.isError || !q.data ? <div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div> : (
        <>
          <h1 className="mt-4 text-title">Level {level}: {q.data.level.title}</h1>
          <p className="mt-2 text-muted">{q.data.level.summary} Tap a word to see its meaning, examples and practice.</p>
          <WordList words={q.data.words} />
          <LevelTest subject="vocabulary" level={level} text="Ten questions on words from this level" score={q.data.level.testPercent} />
        </>
      )}
    </div>
  )
}

function RegisterBadge({ register }: { register?: string }) {
  if (!register || register === 'neutral') return null
  return <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{register === 'formal' ? 'Formal' : 'Informal'}</span>
}

function PhrasalList({ verbs }: { verbs: LessonRow[] }) {
  const support = useSupportLanguage()
  return (
    <ul className="mt-6 space-y-2" aria-label="Phrasal verbs">
      {verbs.map((v) => (
        <li key={v.id}>
          <Link to={`/app/learn/lessons/${v.id}`} className="flex items-start gap-3 rounded-panel border border-line bg-surface px-4 py-3 hover:border-line-strong">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{v.title}</span>{' '}
              {v.separable && <span className="text-sm text-muted">{SEPARABLE_LABEL[v.separable]}</span>} <RegisterBadge register={v.register} />
              <span className="block text-sm text-muted">{v.meaning}</span>
              <Kn text={v.kn} show={support.kannada} />
            </span>
            <span className="pt-0.5 text-sm text-muted">{WORD_STATUS[v.status as keyof typeof WORD_STATUS] ?? ''}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PhrasalLevel({ level }: { level: number }) {
  const q = useQuery({ queryKey: learnKeys.level('phrasal', level), queryFn: () => api<LevelView>(`/api/learn/phrasal/levels/${level}`) })
  const [register, setRegister] = useState<'all' | 'formal' | 'informal'>('all')
  const verbs = (q.data?.lessons ?? []).filter((l) => register === 'all' || l.register === register)
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn/phrasal">Phrasal verbs</Back>
      {q.isLoading ? <Spinner label="Loading phrasal verbs" /> : q.isError || !q.data ? <div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div> : (
        <>
          <h1 className="mt-4 text-title">Level {level}: {q.data.level.title}</h1>
          <p className="mt-2 text-muted">{q.data.level.summary} Tap a phrasal verb for its meanings, examples and practice.</p>
          <div role="group" aria-label="Show" className="mt-6 inline-flex rounded-control border border-line-strong p-0.5 text-sm font-medium">
            {([['all', 'All'], ['formal', 'Formal'], ['informal', 'Informal']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={register === id} onClick={() => setRegister(id)} className={`rounded-[7px] px-4 py-1.5 ${register === id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          <PhrasalList verbs={verbs} />
          <LevelTest subject="phrasal" level={level} text="Ten questions on phrasal verbs from this level" score={q.data.level.testPercent} />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ A topic: words or phrasal verbs on one subject */

export function ThemePage() {
  const { subject, theme = '' } = useParams()
  const words = subject === 'vocabulary'
  const q = useQuery({
    queryKey: learnKeys.theme(subject ?? '', theme),
    queryFn: () => api<ThemeWords | ThemeVerbs>(`/api/learn/${subject}/themes/${theme}`),
    enabled: subject === 'vocabulary' || subject === 'phrasal',
  })
  if (subject !== 'vocabulary' && subject !== 'phrasal') return <Navigate to="/app/learn" replace />
  return (
    <div className="mx-auto max-w-reading">
      <Back to={`/app/learn/${subject}`}>{SUBJECT_TITLE[subject]}</Back>
      {q.isLoading ? <Spinner label="Loading" /> : q.isError || !q.data ? <div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div> : (
        <>
          <h1 className="mt-4 text-title">{q.data.theme.title}</h1>
          <p className="mt-2 text-muted">{q.data.theme.learned} of {q.data.theme.total} learned.</p>
          {words ? <WordList words={(q.data as ThemeWords).words} /> : <PhrasalList verbs={(q.data as ThemeVerbs).verbs} />}
        </>
      )}
    </div>
  )
}

function WordList({ words }: { words: WordRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const support = useSupportLanguage()
  return (
    <ul className="mt-6 space-y-2" aria-label="Words">
      {words.map((w) => (
        <li key={w.id} className="rounded-panel border border-line bg-surface">
          <div className="flex items-center gap-2 pr-2">
            <button type="button" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{w.word}</span> <span className="text-sm text-muted">{w.pos}</span>
                <span className="block text-sm text-muted">{w.meaning}</span>
                <Kn text={w.kn} show={support.kannada} />
              </span>
              <span className="text-sm text-muted">{WORD_STATUS[w.status]}</span>
            </button>
            <SpeakButton text={w.word} />
          </div>
          {open === w.id && <WordCard id={w.id} />}
        </li>
      ))}
    </ul>
  )
}

function WordCard({ id }: { id: string }) {
  const q = useQuery({ queryKey: learnKeys.word(id), queryFn: () => api<WordView>(`/api/learn/vocabulary/words/${id}`) })
  const support = useSupportLanguage()
  if (q.isLoading) return <div className="px-4 pb-4"><Spinner label="Loading word" /></div>
  if (q.isError || !q.data) return <div className="px-4 pb-4"><ErrorState onRetry={() => q.refetch()} /></div>
  const w = q.data
  return (
    <div className="space-y-4 border-t border-line px-4 py-4">
      <div>
        <h3 className="text-sm font-medium text-muted">Meaning</h3>
        <p>{w.meaning}</p>
        <Kn text={w.kn} show={support.kannada} />
      </div>
      <div><h3 className="text-sm font-medium text-muted">Example</h3><p className="flex items-center gap-1">{w.example}<SpeakButton text={w.example} label="the example" /></p></div>
      {w.collocation && <div><h3 className="text-sm font-medium text-muted">Commonly used</h3><p>{w.collocation}</p></div>}
      {w.note && <p className="rounded-control bg-accent-soft px-3 py-2 text-sm">{w.note}</p>}
      {w.conversation && w.conversation.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted">In conversation</h3>
          {w.conversation.map((l) => <p key={l}>{l}</p>)}
        </div>
      )}
      {w.synonyms.length > 0 && <p><span className="text-sm font-medium text-muted">Similar: </span>{w.synonyms.join(', ')}</p>}
      {w.antonyms.length > 0 && <p><span className="text-sm font-medium text-muted">Opposite: </span>{w.antonyms.join(', ')}</p>}
      <div><h3 className="text-sm font-medium text-muted">Sentence practice</h3><p>{w.build}</p><p className="mt-1 text-sm"><Link to="/app/coach?mode=SENTENCE_CORRECTION" className="font-medium text-accent hover:underline">Check your sentence with the AI Coach</Link></p></div>
      {voiceOutputSupported() && <p className="text-xs text-muted">Pronunciation is spoken by your device’s English voice. For an exact guide, check a dictionary’s audio.</p>}
      <SaveButton itemId={w.id} saved={w.saved} label={w.word} />
    </div>
  )
}

function SaveButton({ itemId, saved, label }: { itemId: string; saved: boolean; label: string }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(saved)
  const [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try {
      await api(`/api/learn/items/${itemId}/saved`, { method: 'PUT', body: { saved: !value } })
      setValue(!value)
      void invalidateLearn(queryClient)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="secondary" onClick={() => void toggle()} loading={busy} aria-pressed={value}>
      {value ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}
      {value ? `Saved: ${label}` : `Save ${label}`}
    </Button>
  )
}

/* ------------------------------------------------------------------ Saved and difficult items */

function WordCollectionPage({ kind }: { kind: 'saved' | 'difficult' | 'phrasal-saved' }) {
  const subject = kind === 'phrasal-saved' ? 'phrasal' : 'vocabulary'
  const type = kind === 'difficult' ? 'difficult' : 'saved'
  const items = useQuery({ queryKey: learnKeys.collection(type, subject), queryFn: () => api<ItemRow[]>(`/api/learn/collections/${type}?subject=${subject}`) })
  const title = { saved: 'Saved words', difficult: 'Difficult words', 'phrasal-saved': 'Saved phrasal verbs' }[kind]
  return (
    <div className="mx-auto max-w-reading">
      <Back to={`/app/learn/${subject}`}>{SUBJECT_TITLE[subject as SubjectId]}</Back>
      <h1 className="mt-4 text-title">{title}</h1>
      {kind === 'difficult' && <p className="mt-2 text-muted">Words you have missed more often than you have recalled.</p>}
      {items.isLoading ? <Spinner label="Loading" /> : items.isError ? <div className="mt-8"><ErrorState onRetry={() => items.refetch()} /></div> :
        (items.data ?? []).length === 0 ? (
          <div className="mt-8"><EmptyState title={kind === 'difficult' ? 'No difficult words' : 'Nothing saved yet'} description={kind === 'difficult' ? 'Words appear here after you miss them more than once.' : 'Save a word or phrasal verb to review it here and in revision.'} /></div>
        ) : (
          <ul className="mt-6 space-y-2">
            {(items.data ?? []).map((i) => (
              <li key={i.id} className="rounded-panel border border-line bg-surface px-4 py-3">
                <span className="font-semibold">{i.label}</span> <span className="text-sm text-muted">{WORD_STATUS[i.status]}</span>
                <span className="block text-sm text-muted">{i.meaning}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/* ------------------------------------------------------------------ Tests and revision */

export function LevelTestPage() {
  const { subject, level } = useParams()
  const n = Number(level)
  const queryClient = useQueryClient()
  const valid = isSubject(subject) && Number.isInteger(n)
  const quiz = useQuery({ queryKey: ['learn', 'test', subject, n], queryFn: () => api<Quiz>(`/api/learn/tests/${subject}/${n}`), enabled: valid, gcTime: 0, staleTime: Infinity })
  if (!valid) return <Navigate to="/app/learn" replace />
  return (
    <div className="mx-auto max-w-reading">
      <Back to={`/app/learn/${subject}/levels/${n}`}>Level {n}</Back>
      <h1 className="mt-4 text-title">{SUBJECT_TITLE[subject]} level {n} test</h1>
      <p className="mt-2 text-muted">Answer each question, then submit. You need 70% to pass.</p>
      <div className="mt-6">
        {quiz.isLoading ? <Spinner label="Preparing your test" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> : (
          <QuizRunner
            questions={quiz.data.questions}
            submit={async (answers) => {
              const o = await api<Outcome>(`/api/learn/tests/${subject}/${n}`, { method: 'POST', body: { answers } })
              void invalidateLearn(queryClient)
              return o
            }}
          />
        )}
      </div>
    </div>
  )
}

export function RevisionPage() {
  const [params] = useSearchParams()
  const subject = params.get('subject')
  const queryClient = useQueryClient()
  const quiz = useQuery({ queryKey: ['learn', 'revision', subject], queryFn: () => api<Quiz>(`/api/learn/revision${subject ? `?subject=${subject}` : ''}`), gcTime: 0, staleTime: Infinity })
  return (
    <div className="mx-auto max-w-reading">
      <Back to="/app/learn">Learn</Back>
      <h1 className="mt-4 text-title">Revision</h1>
      <p className="mt-2 text-muted">Items you saved or were tested on, due for review. Correct answers push the next review further away; wrong ones bring it closer.</p>
      <div className="mt-6">
        {quiz.isLoading ? <Spinner label="Preparing revision" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> :
          quiz.data.questions.length === 0 ? <EmptyState title="Nothing to review right now" description="Words and phrasal verbs come back here on a schedule after you practise them, save them or take a test." /> : (
            <QuizRunner
              questions={quiz.data.questions}
              passText="Good work. Items you got right will come back later."
              submit={async (answers) => {
                const o = await api<Outcome>('/api/learn/revision', { method: 'POST', body: { answers } })
                void invalidateLearn(queryClient)
                return o
              }}
            />
          )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ A lesson (grammar or phrasal verb) */

type Tab = 'learn' | 'practice' | 'test'

export function LessonPage() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: learnKeys.lesson(id), queryFn: () => api<LessonView>(`/api/learn/lessons/${id}`) })
  const [tab, setTab] = useState<Tab>('learn')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  if (q.isLoading) return <Spinner label="Loading lesson" />
  if (q.isError || !q.data) return <div className="mx-auto max-w-reading"><Back to="/app/learn">Learn</Back><div className="mt-8"><ErrorState onRetry={() => q.refetch()} /></div></div>
  const lesson = q.data
  const grammar = lesson.subject === 'grammar'
  const title = grammar ? lesson.title : lesson.verb
  const tabs: [Tab, string][] = grammar ? [['learn', 'Learn'], ['practice', 'Practice'], ['test', 'Test']] : [['learn', 'Learn'], ['test', 'Test']]

  return (
    <div className="mx-auto max-w-reading">
      <Back to={`/app/learn/${lesson.subject}/levels/${lesson.level}`}>Level {lesson.level}: {lesson.levelTitle}</Back>
      <h1 className="mt-4 flex items-center gap-2 text-title">{title}{!grammar && <SpeakButton text={lesson.verb} />}</h1>
      {lesson.status === 'COMPLETED' && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-success"><Check className="size-4" aria-hidden /> Completed · best score {lesson.bestPercent}%</p>}
      <p className="mt-2 text-sm"><Link to={`/app/coach?mode=${grammar ? 'GRAMMAR_TUTOR' : 'PHRASAL_VERB_COACH'}&topic=${lesson.id}`} className="font-medium text-accent hover:underline">Ask the AI tutor about this {grammar ? 'lesson' : 'phrasal verb'}</Link></p>
      <div role="tablist" aria-label="Lesson sections" className="mt-6 flex gap-1 border-b border-line">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6">
        {tab === 'learn' && (grammar ? <GrammarLearn l={lesson} /> : <PhrasalLearn l={lesson as PhrasalLessonView} />)}
        {tab === 'practice' && grammar && <PracticeList questions={(lesson as GrammarLessonView).exercises} />}
        {tab === 'test' && (
          <>
            <p className="mb-4 text-muted">Answer every question, then submit. You need 70% to complete this lesson.</p>
            <QuizRunner
              questions={lesson.assessment}
              passText={lesson.nextLessonId ? 'Lesson completed.' : 'Lesson completed. That is the last one for now.'}
              submit={async (answers) => {
                const o = await api<Outcome>(`/api/learn/lessons/${id}/assessment`, { method: 'POST', body: { answers } })
                void invalidateLearn(queryClient)
                return o
              }}
            >
              {(o) => (
                <div className="flex flex-wrap gap-2">
                  {o.passed && lesson.nextLessonId && <Button onClick={() => { setTab('learn'); navigate(`/app/learn/lessons/${lesson.nextLessonId}`) }}>Next lesson</Button>}
                  <Link to="/app/learn/today" className="inline-flex h-10 items-center rounded-control border border-line-strong px-4 text-sm font-medium hover:bg-black/5">Back to today’s lesson</Link>
                </div>
              )}
            </QuizRunner>
          </>
        )}
      </div>
    </div>
  )
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="text-subheading">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">{items.map((s) => <li key={s}>{s}</li>)}</ul>
    </section>
  )
}

function Mistakes({ items }: { items: GrammarLessonView['mistakes'] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="text-subheading">Common mistakes</h2>
      <ul className="mt-2 space-y-3">
        {items.map((m) => (
          <li key={m.wrong} className="rounded-panel border border-line bg-surface p-4">
            <p><span className="text-sm font-medium text-danger">Wrong: </span>{m.wrong}</p>
            <p><span className="text-sm font-medium text-success">Right: </span>{m.right}</p>
            <p className="mt-1 text-sm text-muted">{m.why}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GrammarLearn({ l }: { l: GrammarLessonView }) {
  return (
    <div className="space-y-8">
      {l.definition && <p className="rounded-panel border border-accent/40 bg-accent-soft p-4 text-lg leading-snug"><span className="sr-only">In short: </span>{l.definition}</p>}
      <section><h2 className="text-subheading">Explanation</h2><p className="mt-2">{l.explain}</p></section>
      <Block title="More to know" items={l.details ?? []} />
      <Block title="Correct structures" items={l.structures} />
      <Block title="Positive examples" items={l.positive} />
      <Block title="Negative examples" items={l.negative} />
      <Block title="Question examples" items={l.questions} />
      <Block title="Real-life examples" items={l.reallife} />
      <Mistakes items={l.mistakes} />
    </div>
  )
}

function PhrasalLearn({ l }: { l: PhrasalLessonView }) {
  const support = useSupportLanguage()
  const senses = l.senses ?? []
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-subheading">{senses.length > 1 ? 'Meanings' : 'Meaning'}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {l.separable && <span className="rounded-full border border-line px-2.5 py-0.5 text-sm">{SEPARABLE_LABEL[l.separable]}</span>}
          <RegisterBadge register={l.register} />
        </div>
        {senses.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {senses.map((s, i) => (
              <li key={s.meaning} className="rounded-panel border border-line bg-surface p-4">
                <p className="font-medium">{senses.length > 1 ? `${i + 1}. ` : ''}{s.meaning}</p>
                <Kn text={s.kn} show={support.kannada} />
                <p className="mt-1 text-sm text-muted">{s.example}</p>
              </li>
            ))}
          </ol>
        ) : <p className="mt-2">{l.meaning}</p>}
        <p className="mt-3 text-sm text-muted">{l.note}</p>
        {l.usage && <p className="mt-2 text-sm"><span className="font-medium text-muted">Commonly used: </span>{l.usage}</p>}
      </section>
      <Block title="Natural examples" items={l.examples} />
      <Block title="Real-life situations" items={l.reallife} />
      <Mistakes items={l.mistakes} />
      {l.conversation && (
        <section>
          <h2 className="text-subheading">Conversation practice</h2>
          <div className="mt-2 rounded-panel border border-line bg-surface p-4">
            {l.conversation.dialogue.map((line) => <p key={line}>{line}</p>)}
          </div>
          <p className="mt-3"><span className="font-medium">Your turn: </span>{l.conversation.task}</p>
        </section>
      )}
      <SaveButton itemId={l.id} saved={l.saved} label={l.verb} />
    </div>
  )
}

export const SavedWordsPage = () => <WordCollectionPage kind="saved" />
export const DifficultWordsPage = () => <WordCollectionPage kind="difficult" />
export const SavedPhrasalPage = () => <WordCollectionPage kind="phrasal-saved" />

// Kept so a bookmarked link to the old "today's words" page still lands somewhere useful.
export const TodayWordsPage = () => <Navigate to="/app/learn/today" replace />
