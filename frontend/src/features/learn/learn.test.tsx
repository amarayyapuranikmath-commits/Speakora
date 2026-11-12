import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { mockApi } from '../../test/utils'
import { LearnHome, LessonPage, LevelPage, LevelTestPage, RevisionPage, SubjectPage } from './LearnPages'
import type { GrammarLessonView, LearnOverview, Outcome, PhrasalLessonView } from './learnApi'

const PREFS = { 'GET /api/coach/preferences': { explanationLanguage: null } }

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/learn" element={<LearnHome />} />
          <Route path="/app/learn/revision" element={<RevisionPage />} />
          <Route path="/app/learn/lessons/:id" element={<LessonPage />} />
          <Route path="/app/learn/tests/:subject/:level" element={<LevelTestPage />} />
          <Route path="/app/learn/:subject" element={<SubjectPage />} />
          <Route path="/app/learn/:subject/levels/:level" element={<LevelPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const level = (n: number, over = {}) => ({ level: n, title: `Title ${n}`, summary: 'Summary', total: 12, completed: 0, testPercent: null, ...over })
const overview = (over: Partial<LearnOverview> = {}): LearnOverview => ({
  subjects: [
    { id: 'grammar', title: 'Grammar', description: 'Structured lessons.', unit: 'lessons completed', total: 60, completed: 0, levels: [level(1), level(2)] },
    { id: 'vocabulary', title: 'Vocabulary', description: 'Words.', unit: 'words learned', total: 100, completed: 3, levels: [level(1, { total: 20, completed: 3 })] },
    { id: 'phrasal', title: 'Phrasal verbs', description: 'Verbs.', unit: 'lessons completed', total: 30, completed: 0, levels: [level(1, { total: 10 })] },
  ],
  next: { lessonId: 'g1.01', title: 'Basic sentence structure', subject: 'grammar', level: 1 },
  dueCount: 0,
  today: null,
  ...over,
})

const grammarLesson = (over: Partial<GrammarLessonView> = {}): GrammarLessonView => ({
  subject: 'grammar', id: 'g1.01', level: 1, levelTitle: 'Fundamentals', title: 'Basic sentence structure', definition: 'A sentence is a complete idea.', explain: 'A sentence has a subject and a verb.',
  details: ['The subject comes first.', 'End with a full stop.'],
  structures: ['Subject + Verb'], positive: ['Birds fly.'], negative: ['Birds do not fly here.'], questions: ['Do birds fly?'], reallife: ['I want a coffee.'],
  mistakes: [{ wrong: 'Drinks tea she.', right: 'She drinks tea.', why: 'Subject first.' }],
  exercises: [{ id: 'g1.01.e1', type: 'choice', prompt: 'Which is correct?', options: ['She reads.', 'Reads she.'] }],
  assessment: [
    { id: 'g1.01.a1', type: 'choice', prompt: 'Pick one', options: ['A', 'B'] },
    { id: 'g1.01.a2', type: 'fill', prompt: 'They ___ football.', options: [] },
  ],
  status: 'NOT_STARTED', bestPercent: 0, attempts: 0, nextLessonId: 'g1.02', ...over,
})

describe('Learn home', () => {
  it('leads with today’s lesson, then offers the subjects and revision and progress, with real progress', async () => {
    mockApi({ ...PREFS, 'GET /api/learn/overview': overview() })
    renderAt('/app/learn')
    expect(await screen.findByRole('link', { name: /Start today’s lesson/ })).toHaveAttribute('href', '/app/learn/today')
    const list = screen.getAllByRole('list')[0]
    expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/app/learn/grammar', '/app/learn/vocabulary', '/app/learn/phrasal', '/app/progress'])
    expect(screen.getAllByText('Not started')).toHaveLength(2) // grammar and phrasal: nothing done yet
    expect(screen.getByText('3 of 100 words learned')).toBeInTheDocument()
    expect(screen.queryByText(/ready to review/)).toBeNull() // nothing is due, so no revision card is invented
  })

  it('shows how far today’s lesson is, and continues it', async () => {
    mockApi({ ...PREFS, 'GET /api/learn/overview': overview({ today: { day: 3, complete: false, partsDone: 2, partsTotal: 4 } }) })
    renderAt('/app/learn')
    const card = await screen.findByRole('link', { name: /Continue today’s lesson/ })
    expect(card).toHaveTextContent('Daily lesson · Day 3')
    expect(card).toHaveTextContent('2 of 4 parts done')
    expect(screen.getByRole('progressbar', { name: "Today's progress" })).toHaveAttribute('aria-valuenow', '2')
  })

  it('a finished lesson says so, and Kannada meanings are a simple switch that saves the language choice', async () => {
    let language: string | null = null
    const api = mockApi({
      'GET /api/coach/preferences': () => ({ explanationLanguage: language }),
      'PUT /api/coach/preferences': ({ body }: { body: { explanationLanguage: string | null } }) => { language = body.explanationLanguage; return { explanationLanguage: language } },
      'GET /api/learn/overview': overview({ today: { day: 1, complete: true, partsDone: 4, partsTotal: 4 } }),
    })
    renderAt('/app/learn')
    expect(await screen.findByText('Today’s lesson is complete')).toBeInTheDocument()
    const toggle = await screen.findByRole('switch', { name: 'Show meanings in Kannada' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/coach/preferences', body: { explanationLanguage: 'Kannada' } }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Show meanings in Kannada' })).toHaveAttribute('aria-checked', 'true'))
  })

  it('shows a revision card only when items are due', async () => {
    mockApi({ ...PREFS, 'GET /api/learn/overview': overview({ dueCount: 4 }) })
    renderAt('/app/learn')
    expect(await screen.findByRole('link', { name: /ready to review/ })).toHaveTextContent('4 items are ready to review')
  })
})

describe('Subjects and levels', () => {
  it('lists levels with progress and a best test score', async () => {
    mockApi({ 'GET /api/learn/overview': overview({ subjects: [{ id: 'grammar', title: 'Grammar', description: '', unit: 'lessons completed', total: 24, completed: 5, levels: [level(1, { completed: 5, testPercent: 80 }), level(2)] }] }) })
    renderAt('/app/learn/grammar')
    expect(await screen.findByRole('link', { name: /Level 1: Title 1/ })).toHaveTextContent('5 of 12 lessons completed · Level test best 80%')
    expect(screen.getByRole('link', { name: /Level 2/ })).toHaveAttribute('href', '/app/learn/grammar/levels/2')
  })

  it('vocabulary has today’s lesson, revision, saved and difficult words, and can be browsed by level or by topic', async () => {
    mockApi({
      'GET /api/learn/overview': overview(),
      'GET /api/learn/vocabulary/themes': [{ id: 'everyday', title: 'Everyday conversation', total: 40, learned: 3 }, { id: 'travel', title: 'Travel', total: 0, learned: 0 }],
    })
    renderAt('/app/learn/vocabulary')
    const tools = await screen.findByRole('list', { name: 'Vocabulary tools' })
    expect(within(tools).getAllByRole('link').map((a) => a.textContent)).toEqual(["Today's lesson", 'Revision', 'Saved words', 'Difficult words'])
    expect(await screen.findByRole('list', { name: 'Levels' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'By topic' }))
    const topics = await screen.findByRole('list', { name: 'Topics' })
    expect(within(topics).getByRole('link', { name: /Everyday conversation/ })).toHaveAttribute('href', '/app/learn/vocabulary/topics/everyday')
    expect(within(topics).queryByText('Travel')).toBeNull() // an empty topic is not offered
  })

  it('a level lists its lessons in order with their status and offers the level test', async () => {
    mockApi({
      'GET /api/learn/grammar/levels/1': {
        subject: 'grammar', level: level(1),
        lessons: [{ id: 'g1.01', title: 'Basic sentence structure', status: 'COMPLETED', bestPercent: 100, attempts: 2 }, { id: 'g1.02', title: 'Parts of speech', status: 'NOT_STARTED', bestPercent: 0, attempts: 0 }],
      },
    })
    renderAt('/app/learn/grammar/levels/1')
    const lessons = await screen.findByRole('list', { name: 'Lessons' })
    const items = within(lessons).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Completed · best 100%')
    expect(items[1]).toHaveTextContent('Not started')
    expect(screen.getByRole('link', { name: 'Take the level test' })).toHaveAttribute('href', '/app/learn/tests/grammar/1')
  })

  it('a vocabulary level shows words that open into the full card, and words can be saved', async () => {
    const api = mockApi({
      'GET /api/learn/vocabulary/levels/1': { level: level(1, { total: 20 }), words: [{ id: 'v1.01', word: 'borrow', pos: 'verb', meaning: 'to take and give back', status: 'NEW', saved: false, difficult: false }] },
      'GET /api/learn/vocabulary/words/v1.01': {
        id: 'v1.01', level: 1, word: 'borrow', pos: 'verb', meaning: 'to take and give back', status: 'NEW', saved: false, difficult: false, example: 'Can I borrow your pen?',
        conversation: ['A: Can I borrow it?', 'B: Sure.'], synonyms: [], antonyms: ['lend'], build: 'Write a sentence.',
      },
      'PUT /api/learn/items/v1.01/saved': undefined,
    })
    renderAt('/app/learn/vocabulary/levels/1')
    await userEvent.click(await screen.findByRole('button', { name: /borrow/ }))
    expect(await screen.findByText('Can I borrow your pen?')).toBeInTheDocument()
    expect(screen.getByText('Opposite:')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save borrow' }))
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/learn/items/v1.01/saved', body: { saved: true } }))
    expect(await screen.findByRole('button', { name: 'Saved: borrow' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Grammar lesson', () => {
  it('shows every part of the lesson, one section at a time', async () => {
    mockApi({ 'GET /api/learn/lessons/g1.01': grammarLesson() })
    renderAt('/app/learn/lessons/g1.01')
    expect(await screen.findByRole('heading', { name: 'Basic sentence structure' })).toBeInTheDocument()
    for (const h of ['Explanation', 'Correct structures', 'Positive examples', 'Negative examples', 'Question examples', 'Real-life examples', 'Common mistakes']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    }
    expect(screen.getByText('Drinks tea she.')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Learn', 'Practice', 'Test'])
    expect(screen.queryByText('Pick one')).toBeNull() // the test is a separate section
  })

  it('practice gives instant feedback through the server and records nothing', async () => {
    const api = mockApi({
      'GET /api/learn/lessons/g1.01': grammarLesson(),
      'POST /api/learn/check': { correct: false, correctAnswer: 'She reads.', why: 'Subject first.' },
    })
    renderAt('/app/learn/lessons/g1.01')
    await userEvent.click(await screen.findByRole('tab', { name: 'Practice' }))
    const check = screen.getByRole('button', { name: 'Check answer 1' })
    expect(check).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Reads she.'))
    await userEvent.click(check)
    expect(await screen.findByText(/The answer is/)).toHaveTextContent('She reads.')
    expect(api.calls).toContainEqual({ method: 'POST', url: '/api/learn/check', body: { id: 'g1.01.e1', answer: 'Reads she.' } })
    expect(api.calls.some((c) => c.url.includes('assessment'))).toBe(false)
  })

  it('the test is graded by the server and shows the real score, the correct answers and the next lesson', async () => {
    const outcome: Outcome = {
      correct: 1, total: 2, percent: 50, passed: false, lessonCompleted: false,
      results: [
        { id: 'g1.01.a1', correct: true, yourAnswer: 'A', correctAnswer: 'A', why: 'Because.' },
        { id: 'g1.01.a2', correct: false, yourAnswer: 'plays', correctAnswer: 'play', why: 'They takes play.' },
      ],
    }
    const api = mockApi({ 'GET /api/learn/lessons/g1.01': grammarLesson(), 'POST /api/learn/lessons/g1.01/assessment': outcome })
    renderAt('/app/learn/lessons/g1.01')
    await userEvent.click(await screen.findByRole('tab', { name: 'Test' }))
    await userEvent.click(screen.getByLabelText('A'))
    await userEvent.type(screen.getByLabelText(/They ___ football/), 'plays')
    await userEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(await screen.findByText('You scored 1 out of 2 (50%)')).toBeInTheDocument()
    expect(screen.getByText(/Not a pass yet/)).toBeInTheDocument()
    expect(screen.getByText('play')).toBeInTheDocument()
    expect(api.calls).toContainEqual({
      method: 'POST', url: '/api/learn/lessons/g1.01/assessment', body: { answers: [{ id: 'g1.01.a1', answer: 'A' }, { id: 'g1.01.a2', answer: 'plays' }] },
    })
    expect(screen.queryByRole('button', { name: 'Next lesson' })).toBeNull()
  })

  it('offers the next lesson after a pass', async () => {
    mockApi({
      'GET /api/learn/lessons/g1.01': grammarLesson(),
      'POST /api/learn/lessons/g1.01/assessment': { correct: 2, total: 2, percent: 100, passed: true, lessonCompleted: true, results: [
        { id: 'g1.01.a1', correct: true, yourAnswer: 'A', correctAnswer: 'A', why: 'x' }, { id: 'g1.01.a2', correct: true, yourAnswer: 'play', correctAnswer: 'play', why: 'x' }] },
    })
    renderAt('/app/learn/lessons/g1.01')
    await userEvent.click(await screen.findByRole('tab', { name: 'Test' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(await screen.findByText('Lesson completed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next lesson' })).toBeInTheDocument()
  })
})

describe('Phrasal verb lesson', () => {
  const lesson: PhrasalLessonView = {
    subject: 'phrasal', id: 'p1.09', level: 1, levelTitle: 'Beginner', verb: 'pick up', meaning: 'to lift, or to collect someone', note: 'Separable.',
    examples: ['Please pick up your shoes.'], reallife: ['Can you pick the children up?'], mistakes: [{ wrong: 'Pick up it.', right: 'Pick it up.', why: 'Pronoun in the middle.' }],
    conversation: { dialogue: ['A: Can you pick me up?', 'B: Of course.'], task: 'Ask someone to pick you up.' },
    assessment: [{ id: 'p1.09.a1', type: 'choice', prompt: 'What does it mean?', options: ['collect', 'drop'] }],
    status: 'NOT_STARTED', bestPercent: 0, attempts: 0, saved: false, nextLessonId: 'p1.10',
  }

  it('has meaning, examples, real-life situations, mistakes, conversation practice and a test', async () => {
    mockApi({ 'GET /api/learn/lessons/p1.09': lesson })
    renderAt('/app/learn/lessons/p1.09')
    expect(await screen.findByRole('heading', { name: 'pick up' })).toBeInTheDocument()
    for (const h of ['Meaning', 'Natural examples', 'Real-life situations', 'Common mistakes', 'Conversation practice']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    expect(screen.getByText(/Ask someone to pick you up/)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Learn', 'Test'])
  })
})

describe('Level tests and revision', () => {
  it('a level test is drawn by the server and graded by the server', async () => {
    const api = mockApi({
      'GET /api/learn/tests/grammar/1': { kind: 'LEVEL', subject: 'grammar', level: 1, questions: [{ id: 'g1.03.a2', type: 'choice', prompt: 'Pick', options: ['x', 'y'] }] },
      'POST /api/learn/tests/grammar/1': { correct: 1, total: 1, percent: 100, passed: true, lessonCompleted: false, results: [{ id: 'g1.03.a2', correct: true, yourAnswer: 'x', correctAnswer: 'x', why: 'Because.' }] },
    })
    renderAt('/app/learn/tests/grammar/1')
    await userEvent.click(await screen.findByLabelText('x'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(await screen.findByText('You scored 1 out of 1 (100%)')).toBeInTheDocument()
    expect(api.calls).toContainEqual({ method: 'POST', url: '/api/learn/tests/grammar/1', body: { answers: [{ id: 'g1.03.a2', answer: 'x' }] } })
  })

  it('says plainly when there is nothing to revise', async () => {
    mockApi({ 'GET /api/learn/revision': { kind: 'REVISION', subject: 'all', level: 0, questions: [] } })
    renderAt('/app/learn/revision')
    expect(await screen.findByText('Nothing to review right now')).toBeInTheDocument()
  })

  it('shows an error with a retry when a lesson cannot be loaded', async () => {
    mockApi({})
    renderAt('/app/learn/lessons/g1.01')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
