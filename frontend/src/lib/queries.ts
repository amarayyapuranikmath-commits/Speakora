import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { BlockedUser, CallSummary, DayPoint, FriendsOverview, MessagePage, PageResponse, PartnerSummary, Preferences, Profile, StatsSummary, Topic } from './types'

export const keys = {
  profile: ['profile'] as const,
  preferences: ['preferences'] as const,
  topics: ['topics'] as const,
  stats: ['stats', 'summary'] as const,
  activity: (days: number) => ['stats', 'activity', days] as const,
  history: (page: number, size: number) => ['calls', 'history', page, size] as const,
  blocked: ['blocks'] as const,
  partners: ['partners'] as const,
  friends: ['friends'] as const,
  messages: (ref: string) => ['messages', ref] as const,
}

export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<Profile>('/api/profile') })

export const usePreferences = () => useQuery({ queryKey: keys.preferences, queryFn: () => api<Preferences>('/api/preferences') })

export const useTopics = () =>
  useQuery({ queryKey: keys.topics, queryFn: () => api<Topic[]>('/api/topics'), staleTime: 10 * 60 * 1000 })

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api<StatsSummary>('/api/stats/summary') })

export const useActivity = (days: number) =>
  useQuery({ queryKey: keys.activity(days), queryFn: () => api<DayPoint[]>(`/api/stats/activity?days=${days}`) })

export const useHistory = (page = 0, size = 20) =>
  useQuery({
    queryKey: keys.history(page, size),
    queryFn: () => api<PageResponse<CallSummary>>(`/api/calls?page=${page}&size=${size}`),
    placeholderData: (prev) => prev,
  })

export const useBlocked = () => useQuery({ queryKey: keys.blocked, queryFn: () => api<BlockedUser[]>('/api/blocks') })

/** Previous partners (people met in random calls) and where each stands as a friend. */
export const usePartners = () =>
  useQuery({
    queryKey: keys.partners,
    queryFn: () => api<PartnerSummary[]>('/api/partners'),
    refetchOnWindowFocus: 'always',
  })

/** Friends, with who is online and unread counts, plus open requests. Live changes arrive over the socket; polling is the fallback. */
export const useFriends = () =>
  useQuery({
    queryKey: keys.friends,
    queryFn: () => api<FriendsOverview>('/api/friends'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: 'always',
  })

/** The newest page of a conversation. Older pages are fetched on demand by the chat screen. */
export const useMessages = (ref: string) =>
  useQuery({
    queryKey: keys.messages(ref),
    queryFn: () => api<MessagePage>(`/api/friends/${encodeURIComponent(ref)}/messages`),
    refetchInterval: 30_000,
  })
