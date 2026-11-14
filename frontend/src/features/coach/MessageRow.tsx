import { memo } from 'react'
import { RichText } from './RichText'

export interface Msg { key: string; role: 'user' | 'assistant'; content: string; streaming?: boolean; stopped?: boolean; note?: string }

/**
 * One message of the conversation. While a reply streams, only the reply that is growing gets a new object, so memo lets React skip every earlier
 * message (and their text formatting) on each arriving piece instead of redrawing the whole conversation.
 */
export const MessageRow = memo(function MessageRow({ m }: { m: Msg }) {
  if (m.note) return <p className="text-center text-xs text-muted">{m.note}</p>
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-panel bg-accent-soft px-3.5 py-2.5"><span className="sr-only">You: </span>{m.content}</p>
      </div>
    )
  }
  return (
    <div className="max-w-[92%] break-words">
      <p className="mb-1 text-xs font-medium text-muted">Coach</p>
      {m.streaming && !m.content ? (
        <p role="status" aria-label="The coach is thinking" className="flex gap-1 py-2"><span className="size-1.5 animate-pulse rounded-full bg-muted" /><span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" /><span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" /></p>
      ) : (
        <>
          <RichText text={m.content} />
          {m.streaming && <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-ink align-middle" />}
          {m.stopped && <p className="mt-1 text-xs text-muted">Stopped.</p>}
        </>
      )}
    </div>
  )
})
