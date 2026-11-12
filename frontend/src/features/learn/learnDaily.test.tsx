import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { mockApi } from '../../test/utils'
import { DailyPage, DailyPracticePage, LessonPage, LevelPage, ThemePage } from './LearnPages'
import type { DailyPlan } from './learnApi'

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/learn/today" element={<DailyPage />} />
          <Route path="/app/learn/today/practice/:part" element={<DailyPracticePage />} />
          <Route path="/app/learn/lessons/:id" element={<LessonPage />} />
          <Route path="/app/learn/:subject/levels/:level" element={<LevelPage />} />
          <Route path="/app/learn/:subject/topics/:theme" element={<ThemePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const PREFS = (language: string | null = null) => ({ 'GET /api/coach/preferences': { explanationLanguage: language } })
const plan = (over: Partial<DailyPlan> = {}): DailyPlan => ({
  day: 4, date: '2026-11-11', complete: false, partsDone: 1, partsTotal: 4,
  grammar: { lessonId: 'g1.04', title: 'Pronouns', level: 1, status: 'COMPLETED', bestPercent: 100, attempts: 1, done: true },
  words: { done: false, items: [{ id: 'v1.31', label: 'bag', meaning: 'something you carry things in', kn: 'ಚೀಲ', status: 'NEW' }, { id: 'v1.32', label: 'key', meaning: 'a small metal tool for a lock', kn: 'ಕೀಲಿ', status: 'LEARNING' }] },
  phrasal: { done: false, items: [{ id: 'p1.06', label: 'go out', meaning: 'to leave home for fun', kn: 'ಹೊರಗೆ ಹೋಗುವುದು', status: 'NEW' }] },
  revision: { dueCount: 0, done: true, needed: false },
  speaking: { prompt: 'Speak aloud for about one minute. Describe your morning routine. Try to use the words bag, key and the phrasal verb "go out".', coachMode: 'FREE_CONVERSATION', done: false },
  streakDays: 3, canLearnMore: false, remaining: { grammarLessons: 60, words: 400, phrasalVerbs: 100 }, ...over,
})

describe('The daily lesson', () => {
  it('shows every part in order with its real state, the speaking task, and what is still to come', async () => {
    mockApi({ ...PREFS(), 'GET /api/learn/today': plan() })
    renderAt('/app/learn/today')
    expect(await screen.findByRole('heading', { name: 'Day 4' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 4 parts done/)).toBeInTheDocument()
    expect(screen.getByText(/Learning streak: 3 days/)).toBeInTheDocument()
    const grammar = screen.getByRole('region', { name: 'Grammar' })
    expect(within(grammar).getByText('Pronouns')).toBeInTheDocument()
    expect(within(grammar).getByText(/Passed · best score 100%/)).toBeInTheDocument()
    expect(within(grammar).getByRole('link', { name: 'Open the lesson again' })).toHaveAttribute('href', '/app/learn/lessons/g1.04')
    const words = screen.getByRole('region', { name: /New words/ })
    expect(within(words).getByText('bag')).toBeInTheDocument()
    expect(within(words).getByRole('link', { name: 'Take the vocabulary practice' })).toHaveAttribute('href', '/app/learn/today/practice/vocabulary')
    expect(screen.getByRole('region', { name: /New phrasal verbs/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Revision' })).toBeNull() // nothing is due, so no revision part is invented
    expect(screen.getByText(/Describe your morning routine/)).toBeInTheDocument()
    expect(screen.getByText(/The app does not listen to this/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Practise with the AI Coach' })).toHaveAttribute('href', '/app/coach?mode=FREE_CONVERSATION')
    expect(screen.getByText(/60 grammar lessons, 400 words and 100 phrasal verbs/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Learn more today' })).toBeNull()
  })

  it('the Kannada meaning appears only for a learner who chose Kannada', async () => {
    mockApi({ ...PREFS(), 'GET /api/learn/today': plan() })
    const first = renderAt('/app/learn/today')
    await screen.findByText('bag')
    expect(screen.queryByText('ಚೀಲ')).toBeNull()
    first.unmount()
    mockApi({ ...PREFS('Kannada'), 'GET /api/learn/today': plan() })
    renderAt('/app/learn/today')
    expect(await screen.findByText('ಚೀಲ')).toHaveAttribute('lang', 'kn')
    expect(screen.getByText('ಹೊರಗೆ ಹೋಗುವುದು')).toBeInTheDocument()
  })

  it('shows revision only when items are due, and the speaking task is marked done by the learner', async () => {
    let done = false
    const api = mockApi({
      ...PREFS(),
      'GET /api/learn/today': () => plan({ revision: { dueCount: 6, done: false, needed: true }, speaking: { prompt: 'Speak.', coachMode: 'FREE_CONVERSATION', done } }),
      'POST /api/learn/today/speaking': () => { done = true; return plan() },
    })
    renderAt('/app/learn/today')
    const revision = await screen.findByRole('region', { name: 'Revision' })
    expect(within(revision).getByText(/6 items are ready to review/)).toBeInTheDocument()
    expect(within(revision).getByRole('link', { name: 'Start revision' })).toHaveAttribute('href', '/app/learn/revision')
    await userEvent.click(screen.getByRole('button', { name: 'I practised this' }))
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/learn/today/speaking', body: undefined }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'I practised this' })).toBeNull())
  })

  it('a finished lesson offers more, and says so honestly when that is enough for today', async () => {
    let more = 0
    const api = mockApi({
      ...PREFS(),
      'GET /api/learn/today': () => (more ? plan({ day: 5, complete: false, partsDone: 0 }) : plan({ complete: true, partsDone: 4, canLearnMore: true })),
      'POST /api/learn/today/more': () => { more++; return plan({ day: 5, partsDone: 0 }) },
    })
    renderAt('/app/learn/today')
    expect(await screen.findByText('Well done. Today’s lesson is complete.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Learn more today' }))
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/learn/today/more', body: undefined }))
    expect(await screen.findByRole('heading', { name: 'Day 5' })).toBeInTheDocument()
  })

  it('without more to learn today it says that is plenty', async () => {
    mockApi({ ...PREFS(), 'GET /api/learn/today': plan({ complete: true, partsDone: 4, canLearnMore: false }) })
    renderAt('/app/learn/today')
    expect(await screen.findByText(/That is plenty for today/)).toBeInTheDocument()
  })

  it('shows an error with a retry when the lesson cannot be prepared', async () => {
    mockApi({ ...PREFS() })
    renderAt('/app/learn/today')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('Daily practice and the exercise types', () => {
  const quiz = {
    kind: 'DAILY', subject: 'vocabulary', level: 0,
    questions: [
      { id: 'm:4:vocabulary', type: 'match', prompt: 'Match each word with its meaning.', left: ['bag', 'key'], right: ['a small metal tool for a lock', 'something you carry things in'] },
      { id: 'v1.31:meaning', type: 'choice', prompt: 'Which one means: something you carry things in?', options: ['bag', 'key', 'door', 'plate'] },
      { id: 'v1.32:cloze', type: 'fill', prompt: 'Fill in the blank: I lost my ___.' },
    ],
  }

  it('matching, choosing and typing are graded together by the server and the real score is shown', async () => {
    const api = mockApi({
      'GET /api/learn/today/practice/vocabulary': quiz,
      'POST /api/learn/today/practice/vocabulary': {
        correct: 2, total: 3, percent: 67, passed: false, lessonCompleted: false,
        results: [
          { id: 'm:4:vocabulary', correct: true, yourAnswer: 'bag=>something you carry things in||key=>a small metal tool for a lock', correctAnswer: 'bag = something you carry things in; key = a small metal tool for a lock', why: 'Each one goes with its own meaning.' },
          { id: 'v1.31:meaning', correct: true, yourAnswer: 'bag', correctAnswer: 'bag', why: 'The answer is bag.' },
          { id: 'v1.32:cloze', correct: false, yourAnswer: 'ky', correctAnswer: 'key', why: 'I lost my key.' },
        ],
      },
    })
    renderAt('/app/learn/today/practice/vocabulary')
    const words = await screen.findByRole('list', { name: 'Words' })
    // A meaning can only be chosen after a word.
    expect(within(screen.getByRole('list', { name: 'Meanings' })).getAllByRole('button')[0]).toBeDisabled()
    await userEvent.click(within(words).getByRole('button', { name: /bag/ }))
    await userEvent.click(screen.getByRole('button', { name: 'something you carry things in' }))
    await userEvent.click(within(words).getByRole('button', { name: /key/ }))
    await userEvent.click(screen.getByRole('button', { name: 'a small metal tool for a lock' }))
    expect(within(words).getByRole('button', { name: /bag/ })).toHaveTextContent('something you carry things in')
    await userEvent.click(screen.getByLabelText('bag'))
    await userEvent.type(screen.getByLabelText(/Fill in the blank/), 'ky')
    await userEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(await screen.findByText('You scored 2 out of 3 (67%)')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      answers: [
        { id: 'm:4:vocabulary', answer: 'bag=>something you carry things in||key=>a small metal tool for a lock' },
        { id: 'v1.31:meaning', answer: 'bag' },
        { id: 'v1.32:cloze', answer: 'ky' },
      ],
    })
    expect(screen.getByText('key', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to today’s lesson' })).toHaveAttribute('href', '/app/learn/today')
  })

  it('word order: tap the words in the order of the sentence, tap one to take it back', async () => {
    const api = mockApi({
      'GET /api/learn/lessons/g1.01': {
        subject: 'grammar', id: 'g1.01', level: 1, levelTitle: 'Fundamentals', title: 'Basic sentence structure', definition: 'd', explain: 'e', details: ['a', 'b'], structures: ['s'],
        positive: ['p'], negative: ['n'], questions: ['q'], reallife: ['r'], mistakes: [], status: 'NOT_STARTED', bestPercent: 0, attempts: 0, nextLessonId: null,
        exercises: [{ id: 'g1.01.e5', type: 'reorder', prompt: 'Put the words in order to make a sentence.', words: ['reads', 'books', 'every', 'maria', 'day'] },
          { id: 'g1.01.e6', type: 'correct', prompt: 'Correct the sentence: Drinks tea she.' }],
        assessment: [{ id: 'g1.01.a1', type: 'choice', prompt: 'Pick', options: ['A', 'B'] }],
      },
      'POST /api/learn/check': { correct: true, correctAnswer: 'Maria reads books every day.', why: 'Subject, verb, object, time.' },
    })
    renderAt('/app/learn/lessons/g1.01')
    await userEvent.click(await screen.findByRole('tab', { name: 'Practice' }))
    const check = screen.getByRole('button', { name: 'Check answer 1' })
    expect(check).toBeDisabled()
    for (const w of ['maria', 'reads', 'books', 'every', 'day']) await userEvent.click(within(screen.getByLabelText('Words to use')).getByRole('button', { name: w }))
    expect(within(screen.getByLabelText('Your sentence')).getAllByRole('button').map((b) => b.textContent)).toEqual(['maria', 'reads', 'books', 'every', 'day'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove day' }))
    expect(within(screen.getByLabelText('Words to use')).getByRole('button', { name: 'day' })).toBeInTheDocument() // the word is back
    await userEvent.click(within(screen.getByLabelText('Words to use')).getByRole('button', { name: 'day' }))
    await userEvent.click(check)
    expect(await screen.findByText(/Correct\./)).toBeInTheDocument()
    expect(api.calls).toContainEqual({ method: 'POST', url: '/api/learn/check', body: { id: 'g1.01.e5', answer: 'maria reads books every day' } })
    // "Correct the sentence" is a text answer for the whole sentence.
    expect(screen.getByPlaceholderText('Write the whole corrected sentence')).toBeInTheDocument()
  })
})

describe('Topics and phrasal verbs', () => {
  it('a topic lists its words, with Kannada only when chosen', async () => {
    mockApi({
      ...PREFS('Kannada'),
      'GET /api/learn/vocabulary/themes/travel': {
        theme: { id: 'travel', title: 'Travel', total: 2, learned: 1 },
        words: [{ id: 'v1.30', word: 'ticket', pos: 'noun', meaning: 'a paper you buy to travel', kn: 'ಟಿಕೆಟ್', level: 1, theme: 'travel', status: 'LEARNED', saved: false, difficult: false }],
      },
    })
    renderAt('/app/learn/vocabulary/topics/travel')
    expect(await screen.findByRole('heading', { name: 'Travel' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2 learned.')).toBeInTheDocument()
    expect(await screen.findByText('ಟಿಕೆಟ್')).toBeInTheDocument()
  })

  it('a phrasal verb level shows meaning, separability and register, and can show only formal or informal ones', async () => {
    mockApi({
      ...PREFS(),
      'GET /api/learn/phrasal/levels/2': {
        subject: 'phrasal', level: { level: 2, title: 'Intermediate', summary: 'More verbs.', total: 3, completed: 0, testPercent: null },
        lessons: [
          { id: 'p2.01', title: 'give up', status: 'NEW', bestPercent: 0, attempts: 0, meaning: 'to stop trying', kn: 'ಬಿಟ್ಟುಬಿಡುವುದು', theme: 'everyday', register: 'neutral', separable: 'SEPARABLE' },
          { id: 'p2.32', title: 'hang out', status: 'LEARNING', bestPercent: 0, attempts: 0, meaning: 'to spend time with friends', kn: 'ಸ್ನೇಹಿತರೊಂದಿಗೆ ಸಮಯ ಕಳೆಯುವುದು', theme: 'relationships', register: 'informal', separable: 'NONE' },
          { id: 'p3.11', title: 'bring about', status: 'NEW', bestPercent: 0, attempts: 0, meaning: 'to cause', kn: 'ಉಂಟುಮಾಡುವುದು', theme: 'workplace', register: 'formal', separable: 'SEPARABLE' },
        ],
      },
    })
    renderAt('/app/learn/phrasal/levels/2')
    const list = await screen.findByRole('list', { name: 'Phrasal verbs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('hang out').closest('li')).toHaveTextContent('No object')
    expect(within(list).getByText('hang out').closest('li')).toHaveTextContent('Informal')
    expect(within(list).getByText('give up').closest('li')).toHaveTextContent('Separable')
    await userEvent.click(screen.getByRole('button', { name: 'Formal' }))
    expect(within(screen.getByRole('list', { name: 'Phrasal verbs' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Take the level test' })).toHaveAttribute('href', '/app/learn/tests/phrasal/2')
  })

  it('a phrasal verb lesson shows every meaning with its example, how it takes an object, and how it is used', async () => {
    mockApi({
      ...PREFS('Kannada'),
      'GET /api/learn/lessons/p1.09': {
        subject: 'phrasal', id: 'p1.09', level: 1, levelTitle: 'Beginner', verb: 'pick up', meaning: 'to lift, or to collect someone', kn: 'ಎತ್ತಿಕೊಳ್ಳುವುದು', note: 'Separable: pick it up.', separable: 'SEPARABLE',
        usage: 'pick up a friend from the airport', theme: 'everyday', register: 'neutral',
        senses: [{ meaning: 'to lift, or to collect someone', kn: 'ಎತ್ತಿಕೊಳ್ಳುವುದು', example: 'Please pick up your shoes.' }, { meaning: 'to learn a skill without much effort', kn: 'ಸಹಜವಾಗಿ ಕಲಿಯುವುದು', example: 'She picked up some Kannada.' }],
        examples: ['Please pick up your shoes.'], reallife: [], mistakes: [], assessment: [{ id: 'p1.09.a1', type: 'choice', prompt: 'What does it mean?', options: ['collect', 'drop'] }],
        status: 'NOT_STARTED', bestPercent: 0, attempts: 0, saved: false, nextLessonId: null,
      },
    })
    renderAt('/app/learn/lessons/p1.09')
    expect(await screen.findByRole('heading', { name: 'Meanings' })).toBeInTheDocument()
    expect(screen.getByText('Separable')).toBeInTheDocument()
    expect(screen.getByText('She picked up some Kannada.')).toBeInTheDocument()
    expect(await screen.findByText('ಸಹಜವಾಗಿ ಕಲಿಯುವುದು')).toBeInTheDocument()
    expect(screen.getByText(/pick up a friend from the airport/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Conversation practice' })).toBeNull() // not every verb has one, and none is invented
    expect(screen.queryByRole('heading', { name: 'Common mistakes' })).toBeNull()
  })
})
