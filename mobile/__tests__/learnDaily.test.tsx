import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace }), useRoute: () => ({ params: mockParams }) }))
jest.mock('../src/lib/api', () => ({ ApiError: class extends Error {}, api: (...args: unknown[]) => mockApi(...args) }))
jest.mock('../src/lib/speech', () => ({ speakOnce: (t: string) => mockSpeak(t), synthesisAvailable: () => Promise.resolve(true) }))

const mockNavigate = jest.fn()
const mockReplace = jest.fn()
const mockApi = jest.fn()
const mockSpeak = jest.fn()
let mockParams: Record<string, unknown> = {}

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DailyPracticeScreen, DailyScreen, LevelScreen, ThemeScreen } from '../src/features/learn/LearnScreens'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}>{ui}</QueryClientProvider></SafeAreaProvider>) })
  await settle()
  return r
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const byLabel = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
const has = (r: ReactTestRenderer.ReactTestRenderer, label: string) => !!byLabel(r, label)

function route(map: Record<string, unknown>) {
  mockApi.mockImplementation((path: string, opts?: unknown) => (path in map ? Promise.resolve(typeof map[path] === 'function' ? (map[path] as (o?: unknown) => unknown)(opts) : map[path]) : Promise.reject(new Error('no mock ' + path))))
}
const PREFS = (language: string | null = null) => ({ '/api/coach/preferences': { explanationLanguage: language } })

const plan = (over: Record<string, unknown> = {}) => ({
  day: 4, date: '2026-11-11', complete: false, partsDone: 1, partsTotal: 4,
  grammar: { lessonId: 'g1.04', title: 'Pronouns', level: 1, status: 'COMPLETED', bestPercent: 100, attempts: 1, done: true },
  words: { done: false, items: [{ id: 'v1.31', label: 'bag', meaning: 'something you carry things in', kn: 'ಚೀಲ', status: 'NEW' }, { id: 'v1.32', label: 'key', meaning: 'a small metal tool for a lock', kn: 'ಕೀಲಿ', status: 'LEARNING' }] },
  phrasal: { done: false, items: [{ id: 'p1.06', label: 'go out', meaning: 'to leave home for fun', kn: 'ಹೊರಗೆ ಹೋಗುವುದು', status: 'NEW' }] },
  revision: { dueCount: 0, done: true, needed: false },
  speaking: { prompt: 'Speak aloud for about one minute. Describe your morning routine.', coachMode: 'FREE_CONVERSATION', done: false },
  streakDays: 3, canLearnMore: false, remaining: { grammarLessons: 60, words: 400, phrasalVerbs: 100 }, ...over,
})

beforeEach(() => {
  mockApi.mockReset(); mockNavigate.mockClear(); mockReplace.mockClear(); mockSpeak.mockClear()
  mockParams = {}
})

describe('The daily lesson (Android)', () => {
  it('shows every part with its real state, the speaking task and what is still to come, and opens each part', async () => {
    route({ ...PREFS(), '/api/learn/today': plan() })
    const r = await render(<DailyScreen />)
    const t = text(r)
    for (const s of ['Day 4', '1 of 4 parts done', 'Learning streak: 3 days', 'Pronouns', 'Passed · best score 100%', 'New words (2)', 'bag', 'New phrasal verbs (1)', 'go out', 'Describe your morning routine', 'The app does not listen to this', '60 grammar lessons, 400 words and 100 phrasal verbs']) expect(t).toContain(s)
    expect(t).not.toContain('Revision') // nothing is due, so no revision part
    expect(t).not.toContain('ಚೀಲ') // Kannada only when chosen
    act(() => byLabel(r, 'Open the lesson again').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Lesson', { id: 'g1.04' })
    act(() => byLabel(r, 'Take the vocabulary practice').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('DailyPractice', { part: 'vocabulary' })
    act(() => byLabel(r, 'Take the phrasal verb practice').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('DailyPractice', { part: 'phrasal' })
    act(() => byLabel(r, 'Practise with the AI Coach').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Coach', params: { mode: 'FREE_CONVERSATION' } })
    expect(has(r, 'Learn more today')).toBe(false)
  })

  it('shows Kannada meanings only for a learner who chose Kannada, and a word can be heard', async () => {
    route({ ...PREFS('Kannada'), '/api/learn/today': plan() })
    const r = await render(<DailyScreen />)
    expect(text(r)).toContain('ಚೀಲ')
    expect(text(r)).toContain('ಹೊರಗೆ ಹೋಗುವುದು')
    act(() => byLabel(r, 'Hear bag').props.onPress())
    expect(mockSpeak).toHaveBeenCalledWith('bag')
  })

  it('revision appears only when items are due, and the speaking task is marked done by the learner', async () => {
    let done = false
    route({
      ...PREFS(),
      '/api/learn/today': () => plan({ revision: { dueCount: 6, done: false, needed: true }, speaking: { prompt: 'Speak.', coachMode: 'FREE_CONVERSATION', done } }),
      '/api/learn/today/speaking': () => { done = true; return plan() },
    })
    const r = await render(<DailyScreen />)
    expect(text(r)).toContain('6 items are ready to review')
    act(() => byLabel(r, 'Start revision').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Revision', {})
    await act(async () => { byLabel(r, 'I practised this').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/learn/today/speaking', { method: 'POST' })
    expect(has(r, 'I practised this')).toBe(false)
  })

  it('a finished lesson offers more; when it is enough for today it says so', async () => {
    route({ ...PREFS(), '/api/learn/today': plan({ complete: true, partsDone: 4, canLearnMore: true }), '/api/learn/today/more': plan({ day: 5, partsDone: 0 }) })
    const r = await render(<DailyScreen />)
    expect(text(r)).toContain('Well done. Today’s lesson is complete.')
    await act(async () => { byLabel(r, 'Learn more today').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/learn/today/more', { method: 'POST' })
    route({ ...PREFS(), '/api/learn/today': plan({ complete: true, partsDone: 4, canLearnMore: false }) })
    expect(text(await render(<DailyScreen />))).toContain('That is plenty for today')
  })
})

describe('Daily practice and the exercise types (Android)', () => {
  const quiz = {
    kind: 'DAILY', subject: 'vocabulary', level: 0,
    questions: [
      { id: 'm:4:vocabulary', type: 'match', prompt: 'Match each word with its meaning.', left: ['bag', 'key'], right: ['a small metal tool for a lock', 'something you carry things in'] },
      { id: 'v1.31:meaning', type: 'choice', prompt: 'Which one means: something you carry things in?', options: ['bag', 'key', 'door', 'plate'] },
      { id: 'g1.01.e5', type: 'reorder', prompt: 'Put the words in order.', words: ['reads', 'books', 'maria'] },
      { id: 'g1.01.e6', type: 'correct', prompt: 'Correct the sentence: Drinks tea she.' },
    ],
  }

  it('matching, choosing, word order and a corrected sentence are all sent as answers and graded by the server', async () => {
    mockParams = { part: 'vocabulary' }
    route({
      '/api/learn/today/practice/vocabulary': (o?: { method?: string }) => (o?.method === 'POST'
        ? { correct: 3, total: 4, percent: 75, passed: true, lessonCompleted: false, results: [
          { id: 'm:4:vocabulary', correct: true, yourAnswer: 'x', correctAnswer: 'bag = a; key = b', why: 'Each one goes with its own meaning.' },
          { id: 'v1.31:meaning', correct: true, yourAnswer: 'bag', correctAnswer: 'bag', why: 'The answer is bag.' },
          { id: 'g1.01.e5', correct: true, yourAnswer: 'maria reads books', correctAnswer: 'Maria reads books.', why: 'Subject, verb, object.' },
          { id: 'g1.01.e6', correct: false, yourAnswer: 'Drinks tea she', correctAnswer: 'She drinks tea.', why: 'Subject first.' }] }
        : quiz),
    })
    const r = await render(<DailyPracticeScreen />)
    // A meaning can only be chosen after a word.
    expect(byLabel(r, 'Meaning something you carry things in').props.disabled).toBe(true)
    act(() => byLabel(r, 'Word bag').props.onPress())
    act(() => byLabel(r, 'Meaning something you carry things in').props.onPress())
    act(() => byLabel(r, 'Word key').props.onPress())
    act(() => byLabel(r, 'Meaning a small metal tool for a lock').props.onPress())
    expect(text(r)).toContain('something you carry things in')
    act(() => byLabel(r, 'bag').props.onPress())
    for (const w of ['maria', 'reads', 'books']) act(() => byLabel(r, w).props.onPress())
    expect(byLabel(r, 'Remove maria')).toBeDefined()
    expect(byLabel(r, 'Clear the sentence')).toBeDefined()
    const input = r.root.findAll((n) => n.props.accessibilityLabel === 'Answer 4' && typeof n.props.onChangeText === 'function')[0]
    expect(input.props.placeholder).toBe('Write the whole corrected sentence')
    act(() => input.props.onChangeText('Drinks tea she'))
    await act(async () => { byLabel(r, 'Submit answers').props.onPress() })
    await settle()
    expect(text(r)).toContain('You scored 3 out of 4 (75%)')
    expect(mockApi).toHaveBeenCalledWith('/api/learn/today/practice/vocabulary', {
      method: 'POST',
      body: { answers: [
        { id: 'm:4:vocabulary', answer: 'bag=>something you carry things in||key=>a small metal tool for a lock' },
        { id: 'v1.31:meaning', answer: 'bag' },
        { id: 'g1.01.e5', answer: 'maria reads books' },
        { id: 'g1.01.e6', answer: 'Drinks tea she' },
      ] },
    })
    act(() => byLabel(r, 'Back to today’s lesson').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Daily')
  })

  it('tapping a word in the sentence takes it back', async () => {
    mockParams = { part: 'vocabulary' }
    route({ '/api/learn/today/practice/vocabulary': { ...quiz, questions: [quiz.questions[2]] } })
    const r = await render(<DailyPracticeScreen />)
    act(() => byLabel(r, 'maria').props.onPress())
    act(() => byLabel(r, 'reads').props.onPress())
    act(() => byLabel(r, 'Remove maria').props.onPress())
    expect(byLabel(r, 'maria')).toBeDefined() // back among the words to use
    expect(byLabel(r, 'Remove reads')).toBeDefined()
  })
})

describe('Topics and phrasal verbs (Android)', () => {
  it('a topic lists its words, with Kannada only when chosen', async () => {
    mockParams = { subject: 'vocabulary', theme: 'travel' }
    route({
      ...PREFS('Kannada'),
      '/api/learn/vocabulary/themes/travel': { theme: { id: 'travel', title: 'Travel', total: 2, learned: 1 }, words: [{ id: 'v1.30', word: 'ticket', pos: 'noun', meaning: 'a paper you buy to travel', kn: 'ಟಿಕೆಟ್', level: 1, theme: 'travel', status: 'LEARNED', saved: false, difficult: false }] },
    })
    const r = await render(<ThemeScreen />)
    // The words and the language setting arrive in two requests: wait for the second, however busy the machine is, instead of a fixed pause.
    for (let i = 0; i < 100 && !text(r).includes('ಟಿಕೆಟ್'); i++) await settle()
    const t = text(r)
    expect(t).toContain('Travel')
    expect(t).toContain('1 of 2 learned.')
    expect(t).toContain('ಟಿಕೆಟ್')
  })

  it('a phrasal verb level shows meaning, separability and register, and filters by formal or informal', async () => {
    mockParams = { subject: 'phrasal', level: 2 }
    route({
      ...PREFS(),
      '/api/learn/phrasal/levels/2': {
        subject: 'phrasal', level: { level: 2, title: 'Intermediate', summary: 'More verbs.', total: 3, completed: 0, testPercent: null },
        lessons: [
          { id: 'p2.01', title: 'give up', status: 'NEW', bestPercent: 0, attempts: 0, meaning: 'to stop trying', kn: 'ಬಿಟ್ಟುಬಿಡುವುದು', theme: 'everyday', register: 'neutral', separable: 'SEPARABLE' },
          { id: 'p2.32', title: 'hang out', status: 'LEARNING', bestPercent: 0, attempts: 0, meaning: 'to spend time with friends', kn: 'x', theme: 'relationships', register: 'informal', separable: 'NONE' },
          { id: 'p3.11', title: 'bring about', status: 'NEW', bestPercent: 0, attempts: 0, meaning: 'to cause', kn: 'y', theme: 'workplace', register: 'formal', separable: 'SEPARABLE' },
        ],
      },
    })
    const r = await render(<LevelScreen />)
    let t = text(r)
    expect(t).toContain('give up')
    expect(t).toContain('Separable')
    expect(t).toContain('No object · Informal')
    act(() => byLabel(r, 'Formal').props.onPress())
    t = text(r)
    expect(t).toContain('bring about')
    expect(t).not.toContain('hang out')
    act(() => byLabel(r, 'Take the level test').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('LevelTest', { subject: 'phrasal', level: 2 })
  })
})
