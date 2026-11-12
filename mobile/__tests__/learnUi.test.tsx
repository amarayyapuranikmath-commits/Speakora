import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace }), useRoute: () => ({ params: mockParams }) }))
jest.mock('../src/lib/api', () => ({ ApiError: class extends Error {}, api: (...args: unknown[]) => mockApi(...args) }))

const mockNavigate = jest.fn()
const mockReplace = jest.fn()
const mockApi = jest.fn()
let mockParams: Record<string, unknown> = {}

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LearnHomeScreen, LessonScreen, LevelTestScreen, RevisionScreen } from '../src/features/learn/LearnScreens'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const level = (n: number) => ({ level: n, title: `Title ${n}`, summary: 'S', total: 12, completed: 0, testPercent: null })
const overview = (over = {}) => ({
  subjects: [
    { id: 'grammar', title: 'Grammar', description: 'Structured lessons.', unit: 'lessons completed', total: 60, completed: 0, levels: [level(1)] },
    { id: 'vocabulary', title: 'Vocabulary', description: 'Words.', unit: 'words learned', total: 100, completed: 3, levels: [level(1)] },
    { id: 'phrasal', title: 'Phrasal verbs', description: 'Verbs.', unit: 'lessons completed', total: 30, completed: 0, levels: [level(1)] },
  ],
  next: { lessonId: 'g1.01', title: 'Basic sentence structure', subject: 'grammar', level: 1 }, dueCount: 0, ...over,
})
const lesson = {
  subject: 'grammar', id: 'g1.01', level: 1, levelTitle: 'Fundamentals', title: 'Basic sentence structure', explain: 'A sentence has a subject and a verb.',
  structures: ['Subject + Verb'], positive: ['Birds fly.'], negative: ['Birds do not fly here.'], questions: ['Do birds fly?'], reallife: ['I want a coffee.'],
  mistakes: [{ wrong: 'Drinks tea she.', right: 'She drinks tea.', why: 'Subject first.' }],
  exercises: [{ id: 'g1.01.e1', type: 'choice', prompt: 'Which is correct?', options: ['She reads.', 'Reads she.'] }],
  assessment: [{ id: 'g1.01.a1', type: 'choice', prompt: 'Pick one', options: ['A', 'B'] }, { id: 'g1.01.a2', type: 'fill', prompt: 'They ___ football.', options: [] }],
  status: 'NOT_STARTED', bestPercent: 0, attempts: 0, nextLessonId: 'g1.02',
}

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}>{ui}</QueryClientProvider></SafeAreaProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  return r
}
const flat = (node: unknown): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flat).join('')
  return flat((node as { children?: unknown }).children)
}
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const byLabel = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

function route(map: Record<string, unknown>) {
  mockApi.mockImplementation((path: string) => (path in map ? Promise.resolve(typeof map[path] === 'function' ? (map[path] as () => unknown)() : map[path]) : Promise.reject(new Error('no mock ' + path))))
}

beforeEach(() => {
  mockApi.mockReset()
  mockNavigate.mockClear()
  mockReplace.mockClear()
  mockParams = {}
})

describe('Learn tab', () => {
  it('leads with today’s lesson, then shows the subjects with real progress, and no revision card when nothing is due', async () => {
    route({ '/api/learn/overview': overview({ today: null }) })
    const r = await render(<LearnHomeScreen />)
    const t = text(r)
    for (const s of ['Daily lesson', 'Start today’s lesson', 'Grammar', 'Vocabulary', 'Phrasal verbs', 'Not started', '3 of 100 words learned', 'Revision and progress']) expect(t).toContain(s)
    expect(t).not.toContain('ready to review')
    act(() => byLabel(r, 'Start today’s lesson. ').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Daily')
    act(() => byLabel(r, 'Vocabulary. 3 of 100 words learned').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Subject', { subject: 'vocabulary' })
  })

  it('shows a revision card only when items are due', async () => {
    route({ '/api/learn/overview': overview({ dueCount: 4 }) })
    expect(text(await render(<LearnHomeScreen />))).toContain('4 items are ready to review')
  })
})

describe('Lesson', () => {
  it('shows every part of a grammar lesson, one section at a time', async () => {
    mockParams = { id: 'g1.01' }
    route({ '/api/learn/lessons/g1.01': lesson })
    const r = await render(<LessonScreen />)
    const t = text(r)
    for (const s of ['Explanation', 'Correct structures', 'Positive examples', 'Negative examples', 'Question examples', 'Real-life examples', 'Common mistakes', 'Drinks tea she.']) expect(t).toContain(s)
    expect(t).not.toContain('Pick one')
    for (const tab of ['Learn', 'Practice', 'Test']) expect(byLabel(r, tab)).toBeDefined()
  })

  it('practice is checked by the server; the test is graded by the server and shows the real score', async () => {
    mockParams = { id: 'g1.01' }
    route({
      '/api/learn/lessons/g1.01': lesson,
      '/api/learn/check': { correct: false, correctAnswer: 'She reads.', why: 'Subject first.' },
      '/api/learn/lessons/g1.01/assessment': { correct: 1, total: 2, percent: 50, passed: false, lessonCompleted: false, results: [
        { id: 'g1.01.a1', correct: true, yourAnswer: 'A', correctAnswer: 'A', why: 'Because.' },
        { id: 'g1.01.a2', correct: false, yourAnswer: 'plays', correctAnswer: 'play', why: 'They takes play.' }] },
    })
    const r = await render(<LessonScreen />)
    act(() => byLabel(r, 'Practice').props.onPress())
    act(() => byLabel(r, 'Reads she.').props.onPress())
    await act(async () => { byLabel(r, 'Check answer 1').props.onPress() })
    await settle()
    expect(text(r)).toContain('The answer is She reads.')
    expect(mockApi).toHaveBeenCalledWith('/api/learn/check', { method: 'POST', body: { id: 'g1.01.e1', answer: 'Reads she.' } })

    act(() => byLabel(r, 'Test').props.onPress())
    act(() => byLabel(r, 'A').props.onPress())
    const input = r.root.findAll((n) => n.props.accessibilityLabel === 'Answer 2' && typeof n.props.onChangeText === 'function')[0]
    act(() => input.props.onChangeText('plays'))
    await act(async () => { byLabel(r, 'Submit answers').props.onPress() })
    await settle()
    expect(text(r)).toContain('You scored 1 out of 2 (50%)')
    expect(text(r)).toContain('Not a pass yet')
    expect(mockApi).toHaveBeenCalledWith('/api/learn/lessons/g1.01/assessment', { method: 'POST', body: { answers: [{ id: 'g1.01.a1', answer: 'A' }, { id: 'g1.01.a2', answer: 'plays' }] } })
    expect(byLabel(r, 'Next lesson')).toBeUndefined()
  })

  it('offers the next lesson after a pass', async () => {
    mockParams = { id: 'g1.01' }
    route({
      '/api/learn/lessons/g1.01': lesson,
      '/api/learn/lessons/g1.01/assessment': { correct: 2, total: 2, percent: 100, passed: true, lessonCompleted: true, results: [
        { id: 'g1.01.a1', correct: true, yourAnswer: 'A', correctAnswer: 'A', why: 'x' }, { id: 'g1.01.a2', correct: true, yourAnswer: 'play', correctAnswer: 'play', why: 'x' }] },
    })
    const r = await render(<LessonScreen />)
    act(() => byLabel(r, 'Test').props.onPress())
    await act(async () => { byLabel(r, 'Submit answers').props.onPress() })
    await settle()
    expect(text(r)).toContain('Lesson completed.')
    act(() => byLabel(r, 'Next lesson').props.onPress())
    expect(mockReplace).toHaveBeenCalledWith('Lesson', { id: 'g1.02' })
  })
})

describe('Level tests and revision', () => {
  it('a level test is drawn and graded by the server and the result is not wiped by a refetch', async () => {
    mockParams = { subject: 'grammar', level: 1 }
    route({
      '/api/learn/tests/grammar/1': { kind: 'LEVEL', subject: 'grammar', level: 1, questions: [{ id: 'g1.03.a2', type: 'choice', prompt: 'Pick', options: ['x', 'y'] }] },
    })
    mockApi.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return Promise.resolve({ correct: 1, total: 1, percent: 100, passed: true, lessonCompleted: false, results: [{ id: 'g1.03.a2', correct: true, yourAnswer: 'x', correctAnswer: 'x', why: 'Because.' }] })
      return Promise.resolve({ kind: 'LEVEL', subject: 'grammar', level: 1, questions: [{ id: 'g1.03.a2', type: 'choice', prompt: 'Pick', options: ['x', 'y'] }] })
    })
    const r = await render(<LevelTestScreen />)
    act(() => byLabel(r, 'x').props.onPress())
    await act(async () => { byLabel(r, 'Submit answers').props.onPress() })
    await settle()
    expect(text(r)).toContain('You scored 1 out of 1 (100%)')
  })

  it('says plainly when there is nothing to revise', async () => {
    route({ '/api/learn/revision': { kind: 'REVISION', subject: 'all', level: 0, questions: [] } })
    expect(text(await render(<RevisionScreen />))).toContain('Nothing to review right now')
  })
})
