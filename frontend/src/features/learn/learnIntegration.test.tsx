import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../lib/api'
import { mockApi, renderApp, session } from '../../test/utils'
import { DashboardPage } from '../dashboard/DashboardPage'
import { ProgressPage } from '../progress/ProgressPage'
import type { LearnProgress } from './learnApi'

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

const stats = { totalSeconds: 600, completedCalls: 2, currentStreakDays: 1, longestStreakDays: 3, weekSeconds: 600, monthSeconds: 600, practisedToday: false, englishLevel: 'B1' }
const empty: LearnProgress = {
  grammarCompleted: 0, grammarTotal: 60, phrasalCompleted: 0, phrasalTotal: 30, wordsLearned: 0, wordsSaved: 0, wordsTotal: 100, phrasalVerbsLearned: 0, phrasalVerbsTotal: 30,
  averagePercent: null, recent: [], learningStreakDays: 0, practiceDaysLast30: 0, weakTopics: [], dueCount: 0, dueTomorrow: 0, dueThisWeek: 0, daysCompleted: 0, today: null,
  next: { lessonId: 'g1.01', title: 'Basic sentence structure', subject: 'grammar', level: 1 },
}
const active: LearnProgress = {
  ...empty, grammarCompleted: 3, wordsLearned: 4, wordsSaved: 6, phrasalVerbsLearned: 1, averagePercent: 78, learningStreakDays: 2, practiceDaysLast30: 5, dueCount: 3,
  recent: [{ kind: 'LESSON', subject: 'GRAMMAR', label: 'Nouns', percent: 80, correct: 4, total: 5, takenAt: '2026-11-09T10:00:00Z' }],
  weakTopics: [{ lessonId: 'g2.03', title: 'Present Perfect', level: 2, accuracyPercent: 40 }],
  next: { lessonId: 'g1.04', title: 'Pronouns', subject: 'grammar', level: 1 },
}
const base = { 'POST /api/auth/refresh': session(), 'GET /api/stats/summary': stats, 'GET /api/stats/activity': [] }

describe('Home', () => {
  it('offers one recommended lesson from the real course position', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': empty })
    renderApp(<DashboardPage />)
    expect(await screen.findByText('Basic sentence structure')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start learning' })).toHaveAttribute('href', '/app/learn/today') // the daily lesson, not a lone lesson
    expect(screen.queryByText(/ready for revision/)).toBeNull() // nothing due, nothing invented
  })

  it('continues the course and mentions revision only when items are due', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': active })
    renderApp(<DashboardPage />)
    expect(await screen.findByRole('link', { name: 'Start today’s lesson' })).toHaveAttribute('href', '/app/learn/today')
    expect(screen.getByText('Pronouns')).toBeInTheDocument() // the next grammar lesson
    expect(screen.getByText(/3 items are ready for revision/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revise now' })).toHaveAttribute('href', '/app/learn/revision')
  })

  it('shows no learning section at all when it cannot be loaded or everything is done', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': { ...empty, next: null } })
    renderApp(<DashboardPage />)
    await screen.findByText(/Welcome back/)
    expect(screen.queryByRole('heading', { name: 'Learn' })).toBeNull()
  })
})

describe('Progress', () => {
  it('shows an honest empty state for learning when nothing was done', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': empty })
    renderApp(<ProgressPage />)
    expect(await screen.findByText('No learning results yet')).toBeInTheDocument()
    expect(screen.queryByText('Average score')).toBeNull()
  })

  it('shows recorded results only: counts, streak, average, recent scores, weak areas and suggested revision', async () => {
    mockApi({ ...base, 'GET /api/learn/progress': active })
    renderApp(<ProgressPage />)
    const heading = await screen.findByRole('heading', { name: 'Learning' }, { timeout: 4000 })
    const section = heading.closest('section')!
    expect(within(section).getByText('3 of 60')).toBeInTheDocument()
    expect(within(section).getByText('4 of 100')).toBeInTheDocument()
    expect(within(section).getByText('1 of 30', { selector: 'dd, div, p, span' })).toBeInTheDocument()
    expect(within(section).getByText('2 days')).toBeInTheDocument()
    expect(within(section).getByText('78%')).toBeInTheDocument()
    expect(within(section).getByText('Nouns')).toBeInTheDocument()
    expect(within(section).getByText('4/5 · 80%')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Present Perfect' })).toHaveAttribute('href', '/app/learn/lessons/g2.03')
    expect(within(section).getByRole('link', { name: 'Revise now' })).toBeInTheDocument()
    // Speaking minutes still come from real calls.
    expect(screen.getByRole('heading', { name: 'Speaking' })).toBeInTheDocument()
  })
})
