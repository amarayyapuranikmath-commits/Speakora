import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { liveEvents } from './liveEvents'
import { keys } from './queries'

/** Keeps friends, previous partners and conversations fresh as the server pushes changes. Mount once, inside the app shell. */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      liveEvents.subscribe((event) => {
        void queryClient.invalidateQueries({ queryKey: keys.friends })
        void queryClient.invalidateQueries({ queryKey: keys.partners })
        if (event.type === 'message.new') void queryClient.invalidateQueries({ queryKey: keys.messages(event.friendRef) })
        if (event.type === 'resync') void queryClient.invalidateQueries({ queryKey: ['messages'] })
      }),
    [queryClient],
  )
}
