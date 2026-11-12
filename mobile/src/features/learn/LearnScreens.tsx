import { useNavigation, useRoute } from '@react-navigation/native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Check, ChevronRight, Volume2 } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { api } from '../../lib/api'
import { speakOnce, synthesisAvailable } from '../../lib/speech'
import { Button, EmptyState, ErrorState, RowList, Screen, SectionTitle, Spinner, Title, Toggle } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import {
  SEPARABLE_LABEL, SUBJECT_TITLE, WORD_STATUS, invalidateLearn, isSubject, learnKeys, useDailyPlan, useLearnOverview, useSupportLanguage,
  type DailyPlan, type GrammarLessonView, type ItemRow, type LessonRow, type LessonView, type LevelView, type Mistake, type Outcome, type PhrasalLessonView,
  type PlanItem, type Quiz, type SubjectId, type ThemeSummary, type ThemeVerbs, type ThemeWords, type VocabularyLevelView, type WordRow, type WordView,
} from './learnApi'
import { PracticeList, QuizRunner } from './Quiz'

function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: total, now: done }} style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
      <View style={{ height: 6, width: total ? `${(done / total) * 100}%` : '0%', backgroundColor: colors.accent }} />
    </View>
  )
}

function Row({ title, subtitle, right, onPress, label }: { title: string; subtitle?: string; right?: string; onPress: () => void; label?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? [title, subtitle, right].filter(Boolean).join(', ')} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, backgroundColor: pressed ? 'rgba(0,0,0,0.04)' : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{title}</Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
        {right ? <Text style={type.small}>{right}</Text> : null}
      </View>
      <ChevronRight size={20} color={colors.muted} />
    </Pressable>
  )
}

/** Pronunciation: the phone's own English voice says the word. Shown only on phones that can speak. */
function SpeakButton({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    void synthesisAvailable().then((v) => { if (live) setOk(v) })
    return () => { live = false }
  }, [])
  if (!ok) return null
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Hear ${label ?? text}`} onPress={() => speakOnce(text)} hitSlop={6} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Volume2 size={19} color={colors.muted} />
    </Pressable>
  )
}

/** The Kannada meaning, shown only to learners who chose Kannada as their support language. */
function Kn({ text, show }: { text?: string; show: boolean }) {
  if (!show || !text) return null
  return <Text style={{ fontSize: 15, color: colors.ink }}>{text}</Text>
}

/* ------------------------------------------------------------------ the Learn tab */

export function LearnHomeScreen() {
  const nav = useNavigation<any>()
  const overview = useLearnOverview()
  const support = useSupportLanguage()
  const o = overview.data
  const today = o?.today
  return (
    <Screen>
      <Title sub="One lesson a day, in a fixed order. Your progress is recorded from the tests you really take.">Learn</Title>
      {overview.isLoading ? <Spinner label="Loading" /> : overview.isError || !o ? <ErrorState onRetry={() => overview.refetch()} /> : (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${!today ? 'Start today’s lesson' : today.complete ? 'Today’s lesson is complete' : today.partsDone === 0 ? 'Start today’s lesson' : 'Continue today’s lesson'}. ${today ? `Day ${today.day}, ${today.partsDone} of ${today.partsTotal} parts done` : ''}`}
            onPress={() => nav.navigate('Daily')}
            style={{ borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft, borderRadius: 12, padding: space.lg, marginBottom: space.lg }}>
            <Text style={type.small}>{today ? `Daily lesson · Day ${today.day}` : 'Daily lesson'}</Text>
            <Text style={type.heading}>{!today ? 'Start today’s lesson' : today.complete ? 'Today’s lesson is complete' : today.partsDone === 0 ? 'Start today’s lesson' : 'Continue today’s lesson'}</Text>
            <Text style={[type.small, { marginTop: 4 }]}>{today ? `${today.partsDone} of ${today.partsTotal} parts done` : 'A grammar lesson, new words, new phrasal verbs and a short speaking task.'}</Text>
            {today ? <View style={{ marginTop: space.md }}><ProgressBar done={today.partsDone} total={today.partsTotal} label="Today's progress" /></View> : null}
          </Pressable>
          {o.dueCount > 0 ? (
            <View style={{ marginBottom: space.lg }}>
              <RowList>
                <Row title="Revision" subtitle={`${o.dueCount} ${o.dueCount === 1 ? 'item is' : 'items are'} ready to review`} onPress={() => nav.navigate('Revision', {})} />
              </RowList>
            </View>
          ) : null}
          <RowList>
            {o.subjects.map((s) => (
              <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.completed === 0 ? 'Not started' : `${s.completed} of ${s.total} ${s.unit}`}`} onPress={() => nav.navigate('Subject', { subject: s.id })} style={{ paddingVertical: space.lg }}>
                <Text style={type.heading}>{s.title}</Text>
                <Text style={[type.small, { marginTop: 4 }]}>{s.description}</Text>
                <View style={{ marginTop: space.md }}><ProgressBar done={s.completed} total={s.total} label={`${s.title} progress`} /></View>
                <Text style={[type.small, { marginTop: space.sm }]}>{s.completed === 0 ? 'Not started' : `${s.completed} of ${s.total} ${s.unit}`}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Revision and progress. What you have learned, what needs revision and what is coming up." onPress={() => nav.navigate('Tabs', { screen: 'Progress' })} style={{ paddingVertical: space.lg }}>
              <Text style={type.heading}>Revision and progress</Text>
              <Text style={[type.small, { marginTop: 4 }]}>What you have learned, what needs revision and what is coming up.</Text>
            </Pressable>
          </RowList>
          {support.ready ? (
            <View style={{ marginTop: space.xl }}>
              <Toggle label="Show meanings in Kannada" description="Adds the Kannada meaning under each word and phrasal verb. It is the same language you choose for the AI coach to explain in." value={support.kannada} onChange={(v) => void support.setKannada(v)} />
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  )
}

/* ------------------------------------------------------------------ the daily lesson */

function Part({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <View accessibilityLabel={`${title}${done ? ', done' : ', not done yet'}`} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: space.lg, backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.accent : 'transparent', borderWidth: done ? 0 : 1, borderColor: colors.lineStrong }}>
          {done ? <Check size={16} color={colors.onAccent} /> : <Text style={{ fontSize: 14, color: colors.muted }}>{n}</Text>}
        </View>
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 17, fontWeight: '600', color: colors.ink }}>{title}</Text>
      </View>
      <View style={{ marginTop: space.md }}>{children}</View>
    </View>
  )
}

function Items({ items, kannada, open, onOpen }: { items: PlanItem[]; kannada: boolean; open: string | null; onOpen: (id: string | null) => void }) {
  const nav = useNavigation<any>()
  return (
    <View>
      {items.map((i) => (
        <View key={i.id} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === i.id }} accessibilityLabel={`${i.label}, ${WORD_STATUS[i.status]}. ${i.meaning}`} onPress={() => onOpen(open === i.id ? null : i.id)} style={{ flex: 1, minHeight: 56, justifyContent: 'center', paddingVertical: space.sm }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{i.label} <Text style={type.small}>{WORD_STATUS[i.status]}</Text></Text>
              <Text style={type.small}>{i.meaning}</Text>
              <Kn text={i.kn} show={kannada} />
            </Pressable>
            <SpeakButton text={i.label} />
          </View>
          {open === i.id ? (i.id.startsWith('v') ? <WordCard id={i.id} /> : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open the full lesson for ${i.label}`} onPress={() => nav.navigate('Lesson', { id: i.id })} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accent }}>Open the full lesson for {i.label}</Text>
            </Pressable>
          )) : null}
        </View>
      ))}
    </View>
  )
}

export function DailyScreen() {
  const nav = useNavigation<any>()
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
      setError(e instanceof Error && e.message ? e.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      {q.isLoading ? <Spinner label="Preparing today’s lesson" /> : q.isError || !p ? <ErrorState onRetry={() => q.refetch()} /> : (
        <View style={{ gap: space.lg }}>
          <Title sub={`${p.complete ? 'You have finished this lesson.' : `${p.partsDone} of ${p.partsTotal} parts done. Do them in any order, at your own pace.`}${p.streakDays > 0 ? ` Learning streak: ${p.streakDays} ${p.streakDays === 1 ? 'day' : 'days'}.` : ''}`}>{`Day ${p.day}`}</Title>
          <ProgressBar done={p.partsDone} total={p.partsTotal} label="Lesson progress" />
          {p.grammar ? (
            <Part n={1} title="Grammar" done={p.grammar.done}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{p.grammar.title}</Text>
              <Text style={[type.small, { marginVertical: space.sm }]}>
                {p.grammar.status === 'COMPLETED' ? `Passed · best score ${p.grammar.bestPercent}%` : p.grammar.attempts > 0 ? `${p.grammar.attempts} ${p.grammar.attempts === 1 ? 'attempt' : 'attempts'} so far · best ${p.grammar.bestPercent}%. You need 70% to pass.` : 'Read the lesson, practise, then take the short test.'}
              </Text>
              <Button label={p.grammar.done ? 'Open the lesson again' : p.grammar.attempts > 0 ? 'Continue the lesson' : 'Start the lesson'} variant={p.grammar.done ? 'secondary' : 'primary'} onPress={() => nav.navigate('Lesson', { id: p.grammar!.lessonId })} />
            </Part>
          ) : null}
          {p.words.items.length > 0 ? (
            <Part n={2} title={`New words (${p.words.items.length})`} done={p.words.done}>
              <Items items={p.words.items} kannada={support.kannada} open={open} onOpen={setOpen} />
              <View style={{ marginTop: space.md }}><Button label={p.words.done ? 'Practise the words again' : 'Take the vocabulary practice'} variant={p.words.done ? 'secondary' : 'primary'} onPress={() => nav.navigate('DailyPractice', { part: 'vocabulary' })} /></View>
            </Part>
          ) : null}
          {p.phrasal.items.length > 0 ? (
            <Part n={3} title={`New phrasal verbs (${p.phrasal.items.length})`} done={p.phrasal.done}>
              <Items items={p.phrasal.items} kannada={support.kannada} open={open} onOpen={setOpen} />
              <View style={{ marginTop: space.md }}><Button label={p.phrasal.done ? 'Practise the phrasal verbs again' : 'Take the phrasal verb practice'} variant={p.phrasal.done ? 'secondary' : 'primary'} onPress={() => nav.navigate('DailyPractice', { part: 'phrasal' })} /></View>
            </Part>
          ) : null}
          {p.revision.needed ? (
            <Part n={4} title="Revision" done={p.revision.done}>
              <Text style={{ fontSize: 16, color: colors.ink }}>{p.revision.dueCount > 0 ? `${p.revision.dueCount} ${p.revision.dueCount === 1 ? 'item is' : 'items are'} ready to review. Items you got right come back later; the ones you missed come back sooner.` : 'You have revised everything that was due.'}</Text>
              <View style={{ marginTop: space.md }}><Button label={p.revision.done ? 'Revise again' : 'Start revision'} variant={p.revision.done ? 'secondary' : 'primary'} onPress={() => nav.navigate('Revision', {})} /></View>
            </Part>
          ) : null}
          <Part n={5} title="Speaking" done={p.speaking.done}>
            <Text style={{ fontSize: 16, lineHeight: 23, color: colors.ink }}>{p.speaking.prompt}</Text>
            <Text style={[type.small, { marginVertical: space.sm }]}>The app does not listen to this. You say it aloud, or practise it with the AI Coach, then mark it done yourself.</Text>
            <View style={{ gap: space.sm }}>
              <Button label="Practise with the AI Coach" variant="secondary" onPress={() => nav.navigate('Tabs', { screen: 'Coach', params: { mode: p.speaking.coachMode } })} />
              {!p.speaking.done ? <Button label="I practised this" onPress={() => void post('/api/learn/today/speaking')} loading={busy} /> : null}
            </View>
          </Part>
          {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
          <View accessibilityLabel="What comes next" style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.lg }}>
            {p.complete ? (
              <>
                <Text style={type.heading}>Well done. Today’s lesson is complete.</Text>
                <Text style={[type.small, { marginVertical: space.sm }]}>{p.canLearnMore ? 'You can stop here, or carry on with the next lesson in the course.' : 'That is plenty for today. The next lesson will be ready tomorrow.'}</Text>
                {p.canLearnMore ? <Button label="Learn more today" onPress={() => void post('/api/learn/today/more')} loading={busy} /> : null}
              </>
            ) : (
              <>
                <Text style={type.heading}>What comes next</Text>
                <Text style={[type.small, { marginTop: space.sm }]}>Finish the parts above. After that: the next grammar lesson, ten more new words and five more phrasal verbs.</Text>
              </>
            )}
            <Text style={[type.small, { marginTop: space.md }]}>Still to come in the course: {p.remaining.grammarLessons} grammar {p.remaining.grammarLessons === 1 ? 'lesson' : 'lessons'}, {p.remaining.words} words and {p.remaining.phrasalVerbs} phrasal verbs.</Text>
          </View>
        </View>
      )}
    </Screen>
  )
}

export function DailyPracticeScreen() {
  const nav = useNavigation<any>()
  const { params } = useRoute<any>()
  const part: string = params?.part ?? ''
  const queryClient = useQueryClient()
  const valid = part === 'vocabulary' || part === 'phrasal'
  const quiz = useQuery({ queryKey: ['learn', 'test', 'daily', part], queryFn: () => api<Quiz>(`/api/learn/today/practice/${part}`), enabled: valid, gcTime: 0, staleTime: Infinity })
  if (!valid) return null
  return (
    <Screen>
      <Title sub={`A matching exercise, then one question for each new ${part === 'vocabulary' ? 'word' : 'phrasal verb'}. Your answers set when each one comes back for revision.`}>{part === 'vocabulary' ? 'Vocabulary practice' : 'Phrasal verb practice'}</Title>
      {quiz.isLoading ? <Spinner label="Preparing the practice" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> : (
        <QuizRunner
          questions={quiz.data.questions}
          passText="Good work. This part of today’s lesson is done."
          submit={async (answers) => {
            const o = await api<Outcome>(`/api/learn/today/practice/${part}`, { method: 'POST', body: { answers } })
            void invalidateLearn(queryClient)
            return o
          }}
          after={() => <Button label="Back to today’s lesson" onPress={() => nav.navigate('Daily')} />}
        />
      )}
    </Screen>
  )
}

/* ------------------------------------------------------------------ subject, topics and levels */

function ThemeList({ subject }: { subject: 'vocabulary' | 'phrasal' }) {
  const nav = useNavigation<any>()
  const q = useQuery({ queryKey: learnKeys.themes(subject), queryFn: () => api<ThemeSummary[]>(`/api/learn/${subject}/themes`) })
  if (q.isLoading) return <Spinner label="Loading topics" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />
  return (
    <RowList>
      {q.data.filter((t) => t.total > 0).map((t) => (
        <Row key={t.id} title={t.title} subtitle={`${t.learned} of ${t.total} learned`} onPress={() => nav.navigate('Theme', { subject, theme: t.id })} />
      ))}
    </RowList>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 10, padding: 2, marginBottom: space.lg }}>
      {options.map(([id, text]) => (
        <Pressable key={id} accessibilityRole="tab" accessibilityLabel={text} accessibilityState={{ selected: value === id }} onPress={() => onChange(id)}
          style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8, backgroundColor: value === id ? colors.ink : 'transparent' }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: value === id ? colors.onAccent : colors.muted }}>{text}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function SubjectScreen() {
  const nav = useNavigation<any>()
  const { params } = useRoute<any>()
  const subject: string | undefined = params?.subject
  const overview = useLearnOverview()
  const [browse, setBrowse] = useState<'level' | 'topic'>('level')
  if (!isSubject(subject)) return null
  const data = overview.data?.subjects.find((s) => s.id === subject)
  const themed = subject === 'vocabulary' || subject === 'phrasal'
  return (
    <Screen>
      <Title>{SUBJECT_TITLE[subject]}</Title>
      <View style={{ marginBottom: space.xl }}>
        <RowList>
          {subject === 'vocabulary' ? (
            <>
              <Row title="Today's lesson" onPress={() => nav.navigate('Daily')} />
              <Row title="Revision" onPress={() => nav.navigate('Revision', { subject: 'vocabulary' })} />
              <Row title="Saved words" onPress={() => nav.navigate('WordList', { kind: 'saved' })} />
              <Row title="Difficult words" onPress={() => nav.navigate('WordList', { kind: 'difficult' })} />
            </>
          ) : null}
          {subject === 'phrasal' ? (
            <>
              <Row title="Today's lesson" onPress={() => nav.navigate('Daily')} />
              <Row title="Revision" onPress={() => nav.navigate('Revision', { subject: 'phrasal' })} />
              <Row title="Saved phrasal verbs" onPress={() => nav.navigate('WordList', { kind: 'phrasal-saved' })} />
            </>
          ) : null}
        </RowList>
      </View>
      {themed ? <Segmented label="Browse by" value={browse} options={[['level', 'By level'], ['topic', 'By topic']]} onChange={setBrowse} /> : null}
      {themed && browse === 'topic' ? <ThemeList subject={subject} /> : overview.isLoading ? <Spinner label="Loading levels" /> : !data ? <ErrorState onRetry={() => overview.refetch()} /> : (
        <RowList>
          {data.levels.map((l) => (
            <Pressable key={l.level} accessibilityRole="button" accessibilityLabel={`Level ${l.level}: ${l.title}. ${l.completed} of ${l.total} ${data.unit}`} onPress={() => nav.navigate('LearnLevel', { subject, level: l.level })} style={{ paddingVertical: space.lg }}>
              <Text style={type.heading}>Level {l.level}: {l.title}</Text>
              <Text style={[type.small, { marginTop: 4 }]}>{l.summary}</Text>
              <View style={{ marginTop: space.md }}><ProgressBar done={l.completed} total={l.total} label={`Level ${l.level} progress`} /></View>
              <Text style={[type.small, { marginTop: space.sm }]}>{l.completed} of {l.total} {data.unit}{l.testPercent !== null ? ` · Level test best ${l.testPercent}%` : ''}</Text>
            </Pressable>
          ))}
        </RowList>
      )}
    </Screen>
  )
}

const STATUS = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' } as const

export function LevelScreen() {
  const { params } = useRoute<any>()
  const subject: string | undefined = params?.subject
  const level = Number(params?.level)
  if (!isSubject(subject) || !Number.isInteger(level)) return null
  return subject === 'vocabulary' ? <VocabularyLevel level={level} /> : subject === 'phrasal' ? <PhrasalLevel level={level} /> : <GrammarLevel level={level} />
}

function LevelTestCard({ subject, level, text, score }: { subject: SubjectId; level: number; text: string; score: number | null }) {
  const nav = useNavigation<any>()
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={type.heading}>Level test</Text>
      <Text style={[type.small, { marginVertical: space.sm }]}>{text}{score !== null ? `. Your best score is ${score}%.` : '.'}</Text>
      <Button label="Take the level test" onPress={() => nav.navigate('LevelTest', { subject, level })} />
    </View>
  )
}

function GrammarLevel({ level }: { level: number }) {
  const nav = useNavigation<any>()
  const q = useQuery({ queryKey: learnKeys.level('grammar', level), queryFn: () => api<LevelView>(`/api/learn/grammar/levels/${level}`) })
  return (
    <Screen>
      {q.isLoading ? <Spinner label="Loading lessons" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <Title sub={q.data.level.summary}>{`Level ${level}: ${q.data.level.title}`}</Title>
          <LevelTestCard subject="grammar" level={level} text="Ten mixed questions from this level" score={q.data.level.testPercent} />
          <Text style={[type.label, { color: colors.muted, marginBottom: space.xs }]}>{q.data.lessons.length} lessons</Text>
          <RowList>
            {q.data.lessons.map((l, i) => (
              <Row key={l.id} title={`${i + 1}. ${l.title}`} right={`${STATUS[l.status as keyof typeof STATUS]}${l.attempts > 0 ? ` · best ${l.bestPercent}%` : ''}`} onPress={() => nav.navigate('Lesson', { id: l.id })} />
            ))}
          </RowList>
        </>
      )}
    </Screen>
  )
}

function VocabularyLevel({ level }: { level: number }) {
  const q = useQuery({ queryKey: learnKeys.level('vocabulary', level), queryFn: () => api<VocabularyLevelView>(`/api/learn/vocabulary/levels/${level}`) })
  return (
    <Screen>
      {q.isLoading ? <Spinner label="Loading words" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <Title sub={`${q.data.level.summary} Tap a word to see its meaning, examples and practice.`}>{`Level ${level}: ${q.data.level.title}`}</Title>
          <LevelTestCard subject="vocabulary" level={level} text="Ten questions on words from this level" score={q.data.level.testPercent} />
          <Text style={[type.label, { color: colors.muted, marginBottom: space.xs }]}>{q.data.words.length} words</Text>
          <Words words={q.data.words} />
        </>
      )}
    </Screen>
  )
}

function PhrasalList({ verbs }: { verbs: LessonRow[] }) {
  const nav = useNavigation<any>()
  const support = useSupportLanguage()
  return (
    <RowList>
      {verbs.map((v) => (
        <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.title}. ${v.meaning ?? ''}`} onPress={() => nav.navigate('Lesson', { id: v.id })} style={{ minHeight: 60, paddingVertical: space.md }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
            {v.title} <Text style={type.small}>{[v.separable ? SEPARABLE_LABEL[v.separable] : '', v.register && v.register !== 'neutral' ? (v.register === 'formal' ? 'Formal' : 'Informal') : '', WORD_STATUS[v.status as keyof typeof WORD_STATUS] ?? ''].filter(Boolean).join(' · ')}</Text>
          </Text>
          <Text style={type.small}>{v.meaning}</Text>
          <Kn text={v.kn} show={support.kannada} />
        </Pressable>
      ))}
    </RowList>
  )
}

function PhrasalLevel({ level }: { level: number }) {
  const q = useQuery({ queryKey: learnKeys.level('phrasal', level), queryFn: () => api<LevelView>(`/api/learn/phrasal/levels/${level}`) })
  const nav = useNavigation<any>()
  const [register, setRegister] = useState<'all' | 'formal' | 'informal'>('all')
  const verbs = (q.data?.lessons ?? []).filter((l) => register === 'all' || l.register === register)
  return (
    <Screen>
      {q.isLoading ? <Spinner label="Loading phrasal verbs" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <Title sub={`${q.data.level.summary} Tap a phrasal verb for its meanings, examples and practice.`}>{`Level ${level}: ${q.data.level.title}`}</Title>
          <View style={{ marginBottom: space.lg }}>
            <Text style={type.heading}>Level test</Text>
            <Text style={[type.small, { marginVertical: space.sm }]}>Ten questions on phrasal verbs from this level{q.data.level.testPercent !== null ? `. Your best score is ${q.data.level.testPercent}%.` : '.'}</Text>
            <Button label="Take the level test" onPress={() => nav.navigate('LevelTest', { subject: 'phrasal', level })} />
          </View>
          <Segmented label="Show" value={register} options={[['all', 'All'], ['formal', 'Formal'], ['informal', 'Informal']]} onChange={setRegister} />
          <PhrasalList verbs={verbs} />
        </>
      )}
    </Screen>
  )
}

export function ThemeScreen() {
  const { params } = useRoute<any>()
  const subject: string | undefined = params?.subject
  const theme: string = params?.theme ?? ''
  const ok = subject === 'vocabulary' || subject === 'phrasal'
  const q = useQuery({ queryKey: learnKeys.theme(subject ?? '', theme), queryFn: () => api<ThemeWords | ThemeVerbs>(`/api/learn/${subject}/themes/${theme}`), enabled: ok })
  if (!ok) return null
  return (
    <Screen>
      {q.isLoading ? <Spinner label="Loading" /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <Title sub={`${q.data.theme.learned} of ${q.data.theme.total} learned.`}>{q.data.theme.title}</Title>
          {subject === 'vocabulary' ? <Words words={(q.data as ThemeWords).words} /> : <PhrasalList verbs={(q.data as ThemeVerbs).verbs} />}
        </>
      )}
    </Screen>
  )
}

function Words({ words }: { words: WordRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const support = useSupportLanguage()
  return (
    <RowList>
      {words.map((w) => (
        <View key={w.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === w.id }} accessibilityLabel={`${w.word}, ${w.pos}, ${WORD_STATUS[w.status]}`} onPress={() => setOpen(open === w.id ? null : w.id)}
              style={{ flex: 1, minHeight: 60, paddingVertical: space.md }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{w.word} <Text style={type.small}>{w.pos} · {WORD_STATUS[w.status]}</Text></Text>
              <Text style={type.small}>{w.meaning}</Text>
              <Kn text={w.kn} show={support.kannada} />
            </Pressable>
            <SpeakButton text={w.word} />
          </View>
          {open === w.id ? <WordCard id={w.id} /> : null}
        </View>
      ))}
    </RowList>
  )
}

function WordCard({ id }: { id: string }) {
  const q = useQuery({ queryKey: learnKeys.word(id), queryFn: () => api<WordView>(`/api/learn/vocabulary/words/${id}`) })
  const support = useSupportLanguage()
  if (q.isLoading) return <Spinner label="Loading word" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />
  const w = q.data
  const part = (t: string, body: string) => <View><Text style={type.label}>{t}</Text><Text style={{ fontSize: 16, color: colors.ink }}>{body}</Text></View>
  return (
    <View style={{ paddingBottom: space.lg, gap: space.md }}>
      {part('Meaning', w.meaning)}
      <Kn text={w.kn} show={support.kannada} />
      <View><Text style={type.label}>Example</Text><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ flex: 1, fontSize: 16, color: colors.ink }}>{w.example}</Text><SpeakButton text={w.example} label="the example" /></View></View>
      {w.collocation ? part('Commonly used', w.collocation) : null}
      {w.note ? <Text style={{ fontSize: 15, color: colors.ink, backgroundColor: colors.accentSoft, padding: space.sm, borderRadius: 8 }}>{w.note}</Text> : null}
      {w.conversation && w.conversation.length > 0 ? part('In conversation', w.conversation.join('\n')) : null}
      {w.synonyms.length > 0 ? part('Similar', w.synonyms.join(', ')) : null}
      {w.antonyms.length > 0 ? part('Opposite', w.antonyms.join(', ')) : null}
      {part('Sentence practice', w.build)}
      <Text style={type.caption}>Pronunciation is spoken by your phone’s English voice. For an exact guide, check a dictionary’s audio.</Text>
      <SaveButton itemId={w.id} saved={w.saved} label={w.word} />
    </View>
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
  return <Button label={value ? `Saved: ${label}` : `Save ${label}`} variant="secondary" onPress={() => void toggle()} loading={busy} icon={value ? <BookmarkCheck size={18} color={colors.ink} /> : <Bookmark size={18} color={colors.ink} />} />
}

/* ------------------------------------------------------------------ saved and difficult items, tests, revision */

export function WordListScreen() {
  const { params } = useRoute<any>()
  const kind: 'saved' | 'difficult' | 'phrasal-saved' = params?.kind ?? 'saved'
  const subject = kind === 'phrasal-saved' ? 'phrasal' : 'vocabulary'
  const type_ = kind === 'difficult' ? 'difficult' : 'saved'
  const items = useQuery({ queryKey: learnKeys.collection(type_, subject), queryFn: () => api<ItemRow[]>(`/api/learn/collections/${type_}?subject=${subject}`) })
  const title = { saved: 'Saved words', difficult: 'Difficult words', 'phrasal-saved': 'Saved phrasal verbs' }[kind]
  const sub = kind === 'difficult' ? 'Words you have missed more often than you have recalled.' : undefined
  return (
    <Screen>
      <Title sub={sub}>{title}</Title>
      {items.isLoading ? <Spinner label="Loading" /> : items.isError ? <ErrorState onRetry={() => items.refetch()} /> :
        (items.data ?? []).length === 0 ? <EmptyState title={kind === 'difficult' ? 'No difficult words' : 'Nothing saved yet'} description={kind === 'difficult' ? 'Words appear here after you miss them more than once.' : 'Save a word or phrasal verb to review it here and in revision.'} /> : (
          <RowList>
            {(items.data ?? []).map((i) => (
              <View key={i.id} style={{ paddingVertical: space.md }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{i.label} <Text style={type.small}>{WORD_STATUS[i.status]}</Text></Text>
                <Text style={type.small}>{i.meaning}</Text>
              </View>
            ))}
          </RowList>
        )}
    </Screen>
  )
}

export function LevelTestScreen() {
  const { params } = useRoute<any>()
  const subject: string | undefined = params?.subject
  const level = Number(params?.level)
  const queryClient = useQueryClient()
  const valid = isSubject(subject) && Number.isInteger(level)
  const quiz = useQuery({ queryKey: ['learn', 'test', subject, level], queryFn: () => api<Quiz>(`/api/learn/tests/${subject}/${level}`), enabled: valid, gcTime: 0, staleTime: Infinity })
  if (!valid) return null
  return (
    <Screen>
      <Title sub="Answer each question, then submit. You need 70% to pass.">{`${SUBJECT_TITLE[subject as SubjectId]} level ${level} test`}</Title>
      {quiz.isLoading ? <Spinner label="Preparing your test" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> : (
        <QuizRunner questions={quiz.data.questions} submit={async (answers) => {
          const o = await api<Outcome>(`/api/learn/tests/${subject}/${level}`, { method: 'POST', body: { answers } })
          void invalidateLearn(queryClient)
          return o
        }} />
      )}
    </Screen>
  )
}

export function RevisionScreen() {
  const { params } = useRoute<any>()
  const subject: string | undefined = params?.subject
  const queryClient = useQueryClient()
  const quiz = useQuery({ queryKey: ['learn', 'revision', subject ?? null], queryFn: () => api<Quiz>(`/api/learn/revision${subject ? `?subject=${subject}` : ''}`), gcTime: 0, staleTime: Infinity })
  return (
    <Screen>
      <Title sub="Items you saved or were tested on, due for review. Correct answers push the next review further away; wrong ones bring it closer.">Revision</Title>
      {quiz.isLoading ? <Spinner label="Preparing revision" /> : quiz.isError || !quiz.data ? <ErrorState onRetry={() => quiz.refetch()} /> :
        quiz.data.questions.length === 0 ? <EmptyState title="Nothing to review right now" description="Words and phrasal verbs come back here on a schedule after you practise them, save them or take a test." /> : (
          <QuizRunner questions={quiz.data.questions} passText="Good work. Items you got right will come back later." submit={async (answers) => {
            const o = await api<Outcome>('/api/learn/revision', { method: 'POST', body: { answers } })
            void invalidateLearn(queryClient)
            return o
          }} />
        )}
    </Screen>
  )
}

/* ------------------------------------------------------------------ a lesson */

type Tab = 'learn' | 'practice' | 'test'

export function LessonScreen() {
  const nav = useNavigation<any>()
  const { params } = useRoute<any>()
  const id: string = params?.id ?? ''
  const q = useQuery({ queryKey: learnKeys.lesson(id), queryFn: () => api<LessonView>(`/api/learn/lessons/${id}`) })
  const [tab, setTab] = useState<Tab>('learn')
  const queryClient = useQueryClient()
  if (q.isLoading) return <Screen><Spinner label="Loading lesson" /></Screen>
  if (q.isError || !q.data) return <Screen><ErrorState onRetry={() => q.refetch()} /></Screen>
  const lesson = q.data
  const grammar = lesson.subject === 'grammar'
  const tabs: [Tab, string][] = grammar ? [['learn', 'Learn'], ['practice', 'Practice'], ['test', 'Test']] : [['learn', 'Learn'], ['test', 'Test']]
  return (
    <Screen>
      <Title sub={lesson.status === 'COMPLETED' ? `Completed · best score ${lesson.bestPercent}%` : `Level ${lesson.level}: ${lesson.levelTitle}`}>{grammar ? lesson.title : lesson.verb}</Title>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Ask the AI tutor about this lesson" onPress={() => nav.navigate('Tabs', { screen: 'Coach', params: { mode: grammar ? 'GRAMMAR_TUTOR' : 'PHRASAL_VERB_COACH', topic: lesson.id } })} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accent }}>Ask the AI tutor about this {grammar ? 'lesson' : 'phrasal verb'}</Text>
        </Pressable>
        {!grammar ? <SpeakButton text={(lesson as PhrasalLessonView).verb} /> : null}
      </View>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: space.lg }}>
        {tabs.map(([t, label]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, borderBottomWidth: 2, borderBottomColor: tab === t ? colors.accent : 'transparent' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: tab === t ? colors.ink : colors.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'learn' ? (grammar ? <GrammarLearn l={lesson as GrammarLessonView} /> : <PhrasalLearn l={lesson as PhrasalLessonView} />) : null}
      {tab === 'practice' && grammar ? <PracticeList questions={(lesson as GrammarLessonView).exercises} /> : null}
      {tab === 'test' ? (
        <View>
          <Text style={[type.small, { marginBottom: space.md }]}>Answer every question, then submit. You need 70% to complete this lesson.</Text>
          <QuizRunner
            questions={lesson.assessment}
            passText={lesson.nextLessonId ? 'Lesson completed.' : 'Lesson completed. That is the last one for now.'}
            submit={async (answers) => {
              const o = await api<Outcome>(`/api/learn/lessons/${id}/assessment`, { method: 'POST', body: { answers } })
              void invalidateLearn(queryClient)
              return o
            }}
            after={(o) => (
              <View style={{ gap: space.sm }}>
                {o.passed && lesson.nextLessonId ? <Button label="Next lesson" onPress={() => nav.replace('Lesson', { id: lesson.nextLessonId })} /> : null}
                <Button label="Back to today’s lesson" variant="secondary" onPress={() => nav.navigate('Daily')} />
              </View>
            )}
          />
        </View>
      ) : null}
    </Screen>
  )
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <View>
      <SectionTitle>{title}</SectionTitle>
      {items.map((s) => <Text key={s} style={{ fontSize: 16, lineHeight: 24, color: colors.ink, marginBottom: 4 }}>• {s}</Text>)}
    </View>
  )
}

function Mistakes({ items }: { items: Mistake[] }) {
  if (items.length === 0) return null
  return (
    <View>
      <SectionTitle>Common mistakes</SectionTitle>
      <View style={{ gap: space.lg }}>
        {items.map((m) => (
          <View key={m.wrong} style={{ borderLeftWidth: 3, borderLeftColor: colors.lineStrong, paddingLeft: space.md }}>
            <Text style={{ fontSize: 16, color: colors.ink }}><Text style={{ fontWeight: '600', color: colors.danger }}>Wrong: </Text>{m.wrong}</Text>
            <Text style={{ fontSize: 16, color: colors.ink }}><Text style={{ fontWeight: '600', color: colors.success }}>Right: </Text>{m.right}</Text>
            <Text style={[type.small, { marginTop: 4 }]}>{m.why}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function GrammarLearn({ l }: { l: GrammarLessonView }) {
  return (
    <View>
      {l.definition ? <Text accessibilityLabel={`In short: ${l.definition}`} style={{ fontSize: 17, lineHeight: 24, color: colors.ink, backgroundColor: colors.accentSoft, padding: space.md, borderRadius: 10, marginBottom: space.md }}>{l.definition}</Text> : null}
      <SectionTitle>Explanation</SectionTitle>
      <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>{l.explain}</Text>
      <Block title="More to know" items={l.details ?? []} />
      <Block title="Correct structures" items={l.structures} />
      <Block title="Positive examples" items={l.positive} />
      <Block title="Negative examples" items={l.negative} />
      <Block title="Question examples" items={l.questions} />
      <Block title="Real-life examples" items={l.reallife} />
      <Mistakes items={l.mistakes} />
    </View>
  )
}

function PhrasalLearn({ l }: { l: PhrasalLessonView }) {
  const support = useSupportLanguage()
  const senses = l.senses ?? []
  return (
    <View>
      <SectionTitle>{senses.length > 1 ? 'Meanings' : 'Meaning'}</SectionTitle>
      <Text style={type.small}>{[l.separable ? SEPARABLE_LABEL[l.separable] : '', l.register && l.register !== 'neutral' ? (l.register === 'formal' ? 'Formal' : 'Informal') : ''].filter(Boolean).join(' · ')}</Text>
      {senses.length > 0 ? senses.map((s, i) => (
        <View key={s.meaning} style={{ marginTop: space.md }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{senses.length > 1 ? `${i + 1}. ` : ''}{s.meaning}</Text>
          <Kn text={s.kn} show={support.kannada} />
          <Text style={type.small}>{s.example}</Text>
        </View>
      )) : <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>{l.meaning}</Text>}
      <Text style={[type.small, { marginTop: space.md }]}>{l.note}</Text>
      {l.usage ? <Text style={type.small}>Commonly used: {l.usage}</Text> : null}
      <Block title="Natural examples" items={l.examples} />
      <Block title="Real-life situations" items={l.reallife} />
      <Mistakes items={l.mistakes} />
      {l.conversation ? (
        <>
          <SectionTitle>Conversation practice</SectionTitle>
          <View style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: space.md, gap: 4 }}>{l.conversation.dialogue.map((line) => <Text key={line} style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>{line}</Text>)}</View>
          <Text style={{ fontSize: 16, color: colors.ink, marginVertical: space.md }}><Text style={{ fontWeight: '600' }}>Your turn: </Text>{l.conversation.task}</Text>
        </>
      ) : null}
      <SaveButton itemId={l.id} saved={l.saved} label={l.verb} />
    </View>
  )
}
