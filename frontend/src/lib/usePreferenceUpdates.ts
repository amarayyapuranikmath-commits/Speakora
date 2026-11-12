import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { keys, usePreferences } from './queries'
import type { Preferences } from './types'

/** Reads preferences and saves changes optimistically (rolling back if the server rejects them). */
export function usePreferenceUpdates() {
  const queryClient = useQueryClient()
  const prefs = usePreferences()
  const mutation = useMutation({
    mutationFn: (next: Preferences) => api<Preferences>('/api/preferences', { method: 'PUT', body: next }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: keys.preferences })
      const previous = queryClient.getQueryData<Preferences>(keys.preferences)
      queryClient.setQueryData(keys.preferences, next)
      return { previous }
    },
    onError: (_e, _next, ctx) => ctx?.previous && queryClient.setQueryData(keys.preferences, ctx.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.preferences }),
  })
  return { prefs, mutation, change: (patch: Partial<Preferences>) => prefs.data && mutation.mutate({ ...prefs.data, ...patch }) }
}
