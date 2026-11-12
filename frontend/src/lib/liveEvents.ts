/**
 * A tiny in-page channel for things the server pushes over the signalling socket that are not about the call itself: friend
 * changes and new messages. The call context emits; screens that show friends or messages subscribe and refetch.
 */
export type LiveEvent = { type: 'friends.changed' } | { type: 'message.new'; friendRef: string } | { type: 'resync' }

type Listener = (event: LiveEvent) => void

const listeners = new Set<Listener>()

export const liveEvents = {
  emit(event: LiveEvent) {
    listeners.forEach((l) => l(event))
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
