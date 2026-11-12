import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

const mockNavigate = jest.fn()
let mockStats: { isLoading: boolean; isError: boolean; data?: Record<string, unknown>; refetch: jest.Mock }
let mockUser: Record<string, unknown>

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }))
jest.mock('../src/navigation/ProfileControl', () => ({ ProfileControl: () => null }))
jest.mock('../src/lib/api', () => ({ api: jest.fn() }))
jest.mock('../src/lib/queries', () => ({ useStats: () => mockStats, useActivity: () => ({ data: mockWeek }), usePartners: () => ({ data: mockPartners }) }))
let mockPartners: { ref: string; displayName: string }[] | undefined
let mockWeek: { date: string; seconds: number; calls: number }[] | undefined
jest.mock('../src/features/learn/learnApi', () => ({ useLearnProgress: () => ({ data: mockLearn }) }))
let mockLearn: Record<string, unknown> | undefined
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { HomeScreen, greeting } from '../src/features/main/HomeScreen'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const stats = { totalSeconds: 5400, completedCalls: 7, currentStreakDays: 3, longestStreakDays: 5, weekSeconds: 1800, monthSeconds: 5400, practisedToday: false, englishLevel: 'B2' }

const flat = (node: unknown): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flat).join('')
  return flat((node as { children?: unknown }).children)
}

async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><HomeScreen /></SafeAreaProvider>) })
  return r
}
const press = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]

beforeEach(() => {
  mockNavigate.mockClear()
  mockUser = { displayName: 'Anu', emailVerified: true }
  mockStats = { isLoading: false, isError: false, data: stats, refetch: jest.fn() }
  mockLearn = undefined
  mockWeek = undefined
  mockPartners = undefined
})

describe('Home', () => {
  it('is minimal: a welcome, today, one button and one line of real progress, with no stats grid or feed', async () => {
    const t = flat((await render()).toJSON())
    for (const s of [', Anu', 'English level B2', 'Have one conversation today.', '7 conversations · 1 h 30 min speaking · 3-day streak']) expect(t).toContain(s)
    for (const gone of ['Completed calls', 'Speaking time', 'Recent conversations', 'View all', 'Find a speaking partner']) expect(t).not.toContain(gone)
  })

  it('the main button opens Talk, and See progress opens Progress', async () => {
    const r = await render()
    act(() => press(r, 'Start speaking').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Talk')
    act(() => press(r, 'See progress').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Progress')
  })

  it('acknowledges the day once a conversation has been recorded', async () => {
    mockStats = { ...mockStats, data: { ...stats, practisedToday: true } }
    const r = await render()
    expect(flat(r.toJSON())).toContain('You have spoken today. Well done.')
    expect(press(r, 'Talk again')).toBeDefined()
  })

  it('shows no zeros for a new user', async () => {
    mockStats = { ...mockStats, data: { ...stats, completedCalls: 0, totalSeconds: 0, currentStreakDays: 0, englishLevel: null } }
    const t = flat((await render()).toJSON())
    expect(t).toContain('Your first conversation starts your progress.')
    expect(t).not.toMatch(/streak|English level/)
  })

  it('still offers the main action and a retry when statistics fail, with no invented numbers', async () => {
    mockStats = { isLoading: false, isError: true, data: undefined, refetch: jest.fn() }
    const r = await render()
    const t = flat(r.toJSON())
    expect(t).toContain('We could not load your progress.')
    expect(t).not.toContain('conversations ·')
    expect(press(r, 'Start speaking')).toBeDefined()
  })

  it('never shows an email verification notice or a resend button: verification has its own screen', async () => {
    mockUser = { displayName: 'Anu', emailVerified: false }
    const r = await render()
    expect(flat(r.toJSON())).not.toMatch(/verify your email|Resend/i)
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Resend email').length).toBe(0)
  })

  it('greets by the time of day', () => {
    expect([greeting(3), greeting(8), greeting(14), greeting(20)]).toEqual(['Hello', 'Good morning', 'Good afternoon', 'Good evening'])
  })

  it('shows previous partners only when there are some, and opens them', async () => {
    let r = await render()
    expect(press(r, 'Previous partners')).toBeUndefined()
    mockPartners = [{ ref: 'a', displayName: 'Ana' }, { ref: 'b', displayName: 'Raj' }]
    r = await render()
    act(() => press(r, 'Previous partners').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Partners')
  })
})

describe('Home learning', () => {
  const learn = { grammarCompleted: 0, phrasalCompleted: 0, dueCount: 0, next: { lessonId: 'g1.01', title: 'Basic sentence structure', subject: 'grammar', level: 1 } }

  it('offers the first lesson to a new learner and no revision line when nothing is due', async () => {
    mockLearn = learn
    const r = await render()
    const t = flat(r.toJSON())
    expect(t).toContain('Basic sentence structure')
    expect(t).toContain('Start learning')
    expect(t).not.toContain('ready for revision')
    act(() => press(r, 'Start learning').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Lesson', { id: 'g1.01' })
  })

  it('continues the course and links to revision only when items are due', async () => {
    mockLearn = { ...learn, grammarCompleted: 3, dueCount: 2, next: { lessonId: 'g1.04', title: 'Pronouns', subject: 'grammar', level: 1 } }
    const r = await render()
    expect(flat(r.toJSON())).toContain('2 items are ready for revision')
    act(() => press(r, 'Continue learning').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Lesson', { id: 'g1.04' })
    act(() => press(r, 'Revise now').props.onPress())
    expect(mockNavigate).toHaveBeenCalledWith('Revision', {})
  })

  it('shows no continue-learning section when the data is missing or the course is finished', async () => {
    mockLearn = { ...learn, next: null }
    const t = flat((await render()).toJSON())
    expect(t).not.toMatch(/Continue learning|Start learning/)
  })
})

describe('Home layout', () => {
  it('shows the last seven days from real data and says how many had practice', async () => {
    mockWeek = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, seconds: i === 6 || i === 3 ? 600 : 0, calls: 1 }))
    const r = await render()
    expect(flat(r.toJSON())).toContain('Practised on 2 of the last 7 days.')
  })

  it('invents no practice days when there are none, and shows no strip without data', async () => {
    mockWeek = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, seconds: 0, calls: 0 }))
    expect(flat((await render()).toJSON())).toContain('No speaking in the last 7 days yet.')
    mockWeek = undefined
    const t = flat((await render()).toJSON())
    expect(t).not.toContain('last 7 days')
  })

  it('offers the AI Coach, Friends and the three subjects, each going to the right place', async () => {
    mockLearn = { grammarCompleted: 3, grammarTotal: 60, phrasalCompleted: 0, phrasalTotal: 89, wordsLearned: 4, wordsTotal: 294, dueCount: 0, next: null }
    const r = await render()
    const t = flat(r.toJSON())
    expect(t).toContain('AI Coach')
    act(() => press(r, 'AI Coach, Talk or type with an AI tutor. Your conversation is not saved.').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Coach', {})
    act(() => press(r, 'Friends, Message and call people you have spoken with.').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Friends')
    act(() => press(r, 'Grammar, 3 of 60 lessons').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Subject', { subject: 'grammar' })
    act(() => press(r, 'Vocabulary, 4 of 294 words learned').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Subject', { subject: 'vocabulary' })
    act(() => press(r, 'Phrasal verbs, 0 of 89 lessons').props.onPress())
    expect(mockNavigate).toHaveBeenLastCalledWith('Subject', { subject: 'phrasal' })
  })

  it('uses the real counts only: without learning data the subjects show no numbers', async () => {
    const r = await render()
    const t = flat(r.toJSON())
    expect(t).not.toMatch(/\d+ of \d+/)
  })
})
