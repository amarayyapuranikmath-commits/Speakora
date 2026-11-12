import { formatDuration } from './format'
import type { StatsSummary } from './types'

export interface HomeSummary {
  /** True when the user has already had a conversation today (measured by the server, never assumed). */
  goalDone: boolean
  /** One line of real numbers, or null when there is nothing to report yet (so a new user sees no zeros). */
  line: string | null
}

/** Everything Home needs from the statistics. Only recorded results are used; nothing is estimated or invented. */
export function homeSummary(stats: StatsSummary | undefined): HomeSummary {
  if (!stats) return { goalDone: false, line: null }
  if (stats.completedCalls === 0) return { goalDone: stats.practisedToday, line: null }
  const parts = [
    `${stats.completedCalls} ${stats.completedCalls === 1 ? 'conversation' : 'conversations'}`,
    `${formatDuration(stats.totalSeconds)} speaking`,
  ]
  if (stats.currentStreakDays > 0) parts.push(`${stats.currentStreakDays}-day streak`)
  return { goalDone: stats.practisedToday, line: parts.join(' · ') }
}
