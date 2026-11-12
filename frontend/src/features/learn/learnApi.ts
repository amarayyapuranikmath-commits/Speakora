import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { savePreferredLanguage, tutorKeys, type TutorPrefs } from '../coach/tutorApi'

export type SubjectId = 'grammar' | 'vocabulary' | 'phrasal'

export interface LevelSummary { level: number; title: string; summary: string; total: number; completed: number; testPercent: number | null }
export interface SubjectSummary { id: SubjectId; title: string; description: string; unit: string; total: number; completed: number; levels: LevelSummary[] }
export interface NextStep { lessonId: string; title: string; subject: SubjectId; level: number }
export interface LearnOverview { subjects: SubjectSummary[]; next: NextStep | null; dueCount: number; today?: TodaySummary | null }

export type ItemStatus = 'NEW' | 'LEARNING' | 'LEARNED'
export type Separable = 'SEPARABLE' | 'INSEPARABLE' | 'NONE'
export interface LessonRow {
  id: string; title: string; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | ItemStatus; bestPercent: number; attempts: number
  /** Phrasal verb rows only. */
  meaning?: string; kn?: string; theme?: string; register?: string; separable?: Separable
}
export interface LevelView { subject: SubjectId; level: LevelSummary; lessons: LessonRow[] }

export interface WordRow { id: string; word: string; pos: string; meaning: string; kn?: string; level: number; theme?: string; status: ItemStatus; saved: boolean; difficult: boolean }
export interface VocabularyLevelView { level: LevelSummary; words: WordRow[] }
export interface WordView extends WordRow {
  example: string; collocation?: string; note?: string; conversation?: string[]; synonyms: string[]; antonyms: string[]; build: string
}
export interface ThemeSummary { id: string; title: string; total: number; learned: number }
export interface ThemeWords { theme: ThemeSummary; words: WordRow[] }
export interface ThemeVerbs { theme: ThemeSummary; verbs: LessonRow[] }
export interface ItemRow { id: string; subject: SubjectId; label: string; meaning: string; status: ItemStatus; saved: boolean; difficult: boolean; nextReviewAt: string | null }

export interface Mistake { wrong: string; right: string; why: string }
/** choice: pick one; fill and correct: type the answer; reorder: put `words` in order; match: pair each of `left` with one of `right`. */
export interface QuestionView {
  id: string; type: 'choice' | 'fill' | 'correct' | 'reorder' | 'match'; prompt: string; options?: string[]; words?: string[]; left?: string[]; right?: string[]
}

export interface GrammarLessonView {
  subject: 'grammar'; id: string; level: number; levelTitle: string; title: string; definition: string; explain: string; details: string[]; structures: string[]
  positive: string[]; negative: string[]; questions: string[]; reallife: string[]; mistakes: Mistake[]; exercises: QuestionView[]; assessment: QuestionView[]
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; bestPercent: number; attempts: number; nextLessonId: string | null
}
export interface Sense { meaning: string; kn: string; example: string }
export interface PhrasalLessonView {
  subject: 'phrasal'; id: string; level: number; levelTitle: string; verb: string; meaning: string; kn?: string; note: string; separable?: Separable; usage?: string
  theme?: string; register?: string; senses?: Sense[]; examples: string[]; reallife: string[]; mistakes: Mistake[]; conversation?: { dialogue: string[]; task: string }
  assessment: QuestionView[]; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; bestPercent: number; attempts: number; saved: boolean; nextLessonId: string | null
}
export type LessonView = GrammarLessonView | PhrasalLessonView

export interface Quiz { kind: 'LEVEL' | 'REVISION' | 'DAILY'; subject: string; level: number; questions: QuestionView[] }
export interface AnswerIn { id: string; answer: string }
export interface QuestionResult { id: string; correct: boolean; yourAnswer: string; correctAnswer: string; why: string }
export interface Outcome { correct: number; total: number; percent: number; passed: boolean; lessonCompleted: boolean; results: QuestionResult[] }
export interface CheckResult { correct: boolean; correctAnswer: string; why: string }

// ---- the daily lesson
export interface PlanItem { id: string; label: string; meaning: string; kn?: string; status: ItemStatus }
export interface DailyPlan {
  day: number; date: string; complete: boolean; partsDone: number; partsTotal: number
  grammar: { lessonId: string; title: string; level: number; status: LessonRow['status']; bestPercent: number; attempts: number; done: boolean } | null
  words: { items: PlanItem[]; done: boolean }; phrasal: { items: PlanItem[]; done: boolean }
  revision: { dueCount: number; done: boolean; needed: boolean }; speaking: { prompt: string; coachMode: string; done: boolean }
  streakDays: number; canLearnMore: boolean; remaining: { grammarLessons: number; words: number; phrasalVerbs: number }
}
export interface TodaySummary { day: number; complete: boolean; partsDone: number; partsTotal: number }

export interface LearnProgress {
  grammarCompleted: number; grammarTotal: number; phrasalCompleted: number; phrasalTotal: number; wordsLearned: number; wordsSaved: number
  wordsTotal: number; phrasalVerbsLearned: number; phrasalVerbsTotal: number; averagePercent: number | null
  recent: { kind: string; subject: string; label: string; percent: number; correct: number; total: number; takenAt: string }[]
  learningStreakDays: number; practiceDaysLast30: number; weakTopics: { lessonId: string; title: string; level: number; accuracyPercent: number }[]
  dueCount: number; dueTomorrow: number; dueThisWeek: number; daysCompleted: number; next: NextStep | null; today: TodaySummary | null
}

export const learnKeys = {
  all: ['learn'] as const,
  overview: ['learn', 'overview'] as const,
  level: (subject: string, level: number) => ['learn', 'level', subject, level] as const,
  lesson: (id: string) => ['learn', 'lesson', id] as const,
  word: (id: string) => ['learn', 'word', id] as const,
  today: ['learn', 'today'] as const,
  themes: (subject: string) => ['learn', 'themes', subject] as const,
  theme: (subject: string, id: string) => ['learn', 'theme', subject, id] as const,
  collection: (type: string, subject: string) => ['learn', 'collection', type, subject] as const,
  progress: ['learn', 'progress'] as const,
}

/**
 * Refreshes what the learner sees after a result was recorded (progress, lesson status, due counts). The quiz that was just taken is
 * left alone: refetching it would replace the questions on screen and wipe the result being shown.
 */
export function invalidateLearn(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'learn' && q.queryKey[1] !== 'test' && q.queryKey[1] !== 'revision' })
}

export const useLearnOverview = () => useQuery({ queryKey: learnKeys.overview, queryFn: () => api<LearnOverview>('/api/learn/overview') })
export const useLearnProgress = () => useQuery({ queryKey: learnKeys.progress, queryFn: () => api<LearnProgress>('/api/learn/progress') })

export const SUBJECT_TITLE: Record<SubjectId, string> = { grammar: 'Grammar', vocabulary: 'Vocabulary', phrasal: 'Phrasal verbs' }

export function isSubject(s: string | undefined): s is SubjectId {
  return s === 'grammar' || s === 'vocabulary' || s === 'phrasal'
}

export const useDailyPlan = () => useQuery({ queryKey: learnKeys.today, queryFn: () => api<DailyPlan>('/api/learn/today') })

/**
 * Whether meanings are shown in Kannada as well. It is the same "Explain in" language the AI coach uses (Settings, and the coach's own settings),
 * so one choice applies everywhere. Any other language, or none, means English only.
 */
export function useSupportLanguage() {
  const queryClient = useQueryClient()
  const prefs = useQuery({ queryKey: tutorKeys.preferences, queryFn: () => api<TutorPrefs>('/api/coach/preferences'), staleTime: 60_000 })
  const kannada = prefs.data?.explanationLanguage === 'Kannada'
  async function setKannada(on: boolean) {
    await savePreferredLanguage(on ? 'Kannada' : null)
    await queryClient.invalidateQueries({ queryKey: tutorKeys.preferences })
  }
  return { kannada, setKannada, ready: prefs.isSuccess }
}

export const WORD_STATUS: Record<ItemStatus, string> = { NEW: 'New', LEARNING: 'Learning', LEARNED: 'Learned' }
export const SEPARABLE_LABEL: Record<Separable, string> = { SEPARABLE: 'Separable', INSEPARABLE: 'Not separable', NONE: 'No object' }
