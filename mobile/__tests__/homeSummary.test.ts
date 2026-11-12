import { homeSummary } from '../src/lib/homeSummary'
import type { StatsSummary } from '../src/lib/types'

const base: StatsSummary = { totalSeconds: 5400, completedCalls: 7, currentStreakDays: 3, longestStreakDays: 5, weekSeconds: 1800, monthSeconds: 5400, practisedToday: false, englishLevel: 'B2' }

describe('homeSummary', () => {
  it('builds one line from real numbers', () => {
    expect(homeSummary(base).line).toBe('7 conversations · 1 h 30 min speaking · 3-day streak')
  })
  it('uses singular for one conversation and omits a zero streak', () => {
    expect(homeSummary({ ...base, completedCalls: 1, totalSeconds: 600, currentStreakDays: 0 }).line).toBe('1 conversation · 10 min speaking')
  })
  it('reports nothing for a new user, so no zeros are shown', () => {
    expect(homeSummary({ ...base, completedCalls: 0, totalSeconds: 0, currentStreakDays: 0 }).line).toBeNull()
    expect(homeSummary(undefined)).toEqual({ goalDone: false, line: null })
  })
  it('reports the goal only from what the server measured', () => {
    expect(homeSummary({ ...base, practisedToday: true }).goalDone).toBe(true)
    expect(homeSummary({ ...base, practisedToday: false }).goalDone).toBe(false)
  })
})
