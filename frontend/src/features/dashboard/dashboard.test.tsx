import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { AuthProvider } from '../auth/AuthContext'
import { errorResponse, mockApi, session } from '../../test/utils'
import { HistoryPage } from '../history/HistoryPage'
import { DashboardPage } from './DashboardPage'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

function renderWithAuth(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const stats = { totalSeconds: 5400, completedCalls: 7, currentStreakDays: 3, longestStreakDays: 5, weekSeconds: 1800, monthSeconds: 5400, practisedToday: true, englishLevel: 'B2' }
const call = (over = {}) => ({
  id: 'c1', partnerDisplayName: 'Sam', topicName: 'Travel', status: 'COMPLETED', endReason: 'ENDED',
  startedAt: '2026-11-08T10:00:00Z', durationSeconds: 600, feedbackSubmitted: false, ...over,
})

describe('DashboardPage (Home)', () => {
  const none = { 'GET /api/stats/activity': [], 'GET /api/calls': { items: [], page: 0, size: 5, totalElements: 0, totalPages: 0 } }

  it('is minimal: a welcome, today, one button and one line of real progress, with no stats grid, charts or feeds', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': stats, ...none })
    const { container } = renderWithAuth(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: /welcome back, ana/i })).toBeInTheDocument()
    expect(await screen.findByText(/7 conversations · 1 h 30 min speaking · 3-day streak/)).toBeInTheDocument()
    expect(screen.getByText('English level B2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See progress' })).toHaveAttribute('href', '/app/progress')
    // Not on Home any more: statistics grid, recent-conversations feed, charts, extra columns.
    expect(container.querySelector('dl')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Your numbers' })).toBeNull()
    expect(screen.queryByText('Recent conversations')).toBeNull()
    expect(container.querySelector('svg.recharts-surface, canvas')).toBeNull()
    expect(screen.getAllByRole('link').filter((l) => l.className.includes('bg-accent'))).toHaveLength(1) // exactly one primary action
  })

  it('invites the user to speak when they have not yet today', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': { ...stats, practisedToday: false }, ...none })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByText('Have one conversation today.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start speaking' })).toHaveAttribute('href', '/app/talk')
  })

  it('acknowledges the day once a conversation has been recorded', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': stats, ...none })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByText(/you have spoken today/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Talk again' })).toHaveAttribute('href', '/app/talk')
  })

  it('shows no zeros for a new user: no numbers, no streak, just the first step', async () => {
    mockApi({
      'POST /api/auth/refresh': session(),
      'GET /api/stats/summary': { ...stats, totalSeconds: 0, completedCalls: 0, currentStreakDays: 0, longestStreakDays: 0, weekSeconds: 0, monthSeconds: 0, practisedToday: false, englishLevel: null },
      ...none,
    })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByText('Your first conversation starts your progress.')).toBeInTheDocument()
    expect(screen.queryByText(/streak/i)).toBeNull()
    expect(screen.queryByText(/English level/)).toBeNull()
  })

  it('leaves out the streak when there is none', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': { ...stats, currentStreakDays: 0, practisedToday: false }, ...none })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByText('7 conversations · 1 h 30 min speaking')).toBeInTheDocument()
  })

  it('never shows verification, resend or password-recovery prompts, whatever the account state', async () => {
    mockApi({ 'POST /api/auth/refresh': session({ emailVerified: false }), 'GET /api/stats/summary': stats, ...none })
    const { container } = renderWithAuth(<DashboardPage />)
    await screen.findByRole('heading', { name: /welcome back, ana/i })
    expect(container.textContent).not.toMatch(/verify|verification|resend|one-time|OTP|forgot password|reset your password/i)
    expect(screen.queryByRole('button', { name: /resend/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /enter code|verify|forgot/i })).toBeNull()
  })

  it('still offers the main action, and a retry, when statistics fail: never fake numbers', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': () => errorResponse(500, 'INTERNAL_ERROR', 'boom'), ...none })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start speaking' })).toBeInTheDocument()
    expect(screen.queryByText(/conversations ·/)).toBeNull()
  })
})

describe('HistoryPage', () => {
  it('lists calls with status, duration and feedback actions, never partner ids', async () => {
    mockApi({
      'POST /api/auth/refresh': session(),
      'GET /api/calls': {
        items: [call(), call({ id: 'c2', partnerDisplayName: 'Lee', feedbackSubmitted: true, topicName: null }), call({ id: 'c3', partnerDisplayName: 'Kim', status: 'FAILED', durationSeconds: null })],
        page: 0, size: 15, totalElements: 3, totalPages: 1,
      },
    })
    renderWithAuth(<HistoryPage />)
    expect(await screen.findByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByText('10 min')).toHaveLength(2) // Sam and Lee completed; Kim never connected
    expect(screen.getByText('Feedback sent')).toBeInTheDocument()
    expect(screen.getByText('Did not connect')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Leave feedback' })).toHaveLength(1)
  })

  it('shows an empty state', async () => {
    mockApi({ 'POST /api/auth/refresh': session(), 'GET /api/calls': { items: [], page: 0, size: 15, totalElements: 0, totalPages: 0 } })
    renderWithAuth(<HistoryPage />)
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find a partner' })).toBeInTheDocument()
  })
})

describe('DashboardPage layout and content', () => {
  const learn = {
    grammarCompleted: 3, grammarTotal: 60, phrasalCompleted: 0, phrasalTotal: 30, wordsLearned: 4, wordsSaved: 6, wordsTotal: 100, phrasalVerbsLearned: 0, phrasalVerbsTotal: 30,
    averagePercent: 78, recent: [], learningStreakDays: 2, practiceDaysLast30: 5, weakTopics: [], dueCount: 0,
    next: { lessonId: 'g1.04', title: 'Pronouns', subject: 'grammar', level: 1 },
  }
  const week = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, seconds: i === 6 || i === 3 ? 600 : 0, calls: i === 6 || i === 3 ? 1 : 0 }))
  const base = { 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': stats, 'GET /api/stats/activity': week, 'GET /api/learn/progress': learn }

  it('shows speaking today, the real next lesson with course progress, the tutor and four quick actions', async () => {
    mockApi(base)
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: 'Speak today' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Today’s lesson' })).toBeInTheDocument()
    expect(screen.getByText('Next grammar lesson · Grammar · Level 1')).toBeInTheDocument()
    expect(screen.getByText('Pronouns')).toBeInTheDocument()
    expect(screen.getByText('3 of 60 grammar lessons')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('heading', { name: 'Your AI English tutor' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a conversation' })).toHaveAttribute('href', '/app/coach')
    const quick = screen.getByRole('navigation', { name: 'Quick actions' })
    expect(within(quick).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/app/talk', '/app/learn/grammar', '/app/learn/vocabulary', '/app/learn/phrasal'])
    expect(within(quick).getByText('4 of 100 words learned')).toBeInTheDocument()
  })

  it('shows the last seven days from real data, and says how many had practice', async () => {
    mockApi(base)
    renderWithAuth(<DashboardPage />)
    const days = await screen.findByRole('list', { name: 'Last seven days' })
    expect(within(days).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getByText('Practised on 2 of the last 7 days.')).toBeInTheDocument()
  })

  it('has no learning column when there is nothing to continue and nothing to revise, and no invented practice days', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': { ...learn, next: null }, 'GET /api/stats/activity': week.map((d) => ({ ...d, seconds: 0, calls: 0 })) })
    renderWithAuth(<DashboardPage />)
    await screen.findByRole('heading', { name: 'Speak today' })
    expect(await screen.findByText('No speaking in the last 7 days yet.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Today’s lesson' })).toBeNull()
  })

  it('offers the first lesson to a new learner and never shows zeros as progress', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': { ...learn, grammarCompleted: 0, wordsLearned: 0, next: { lessonId: 'g1.01', title: 'Basic sentence structure', subject: 'grammar', level: 1 } } })
    renderWithAuth(<DashboardPage />)
    expect(await screen.findByRole('link', { name: 'Start learning' })).toHaveAttribute('href', '/app/learn/today')
    expect(screen.getByText('Not started')).toBeInTheDocument()
    expect(screen.getByText('A grammar lesson, new words, new phrasal verbs and a short speaking task.')).toBeInTheDocument()
  })
})
