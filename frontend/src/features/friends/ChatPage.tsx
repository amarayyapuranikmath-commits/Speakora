import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MoreHorizontal, Phone, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Alert, Spinner } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { keys, useFriends, useMessages } from '../../lib/queries'
import type { ChatMessage, MessagePage } from '../../lib/types'
import { useCall } from '../call/CallContext'
import { PartnerSafety } from '../call/PartnerSafety'

const MAX_MESSAGE_LENGTH = 2000

/** A private conversation with one friend. Only reachable for accepted friends; the server checks that on every request. */
export function ChatPage() {
  const { ref = '' } = useParams()
  const friends = useFriends()
  const friend = friends.data?.friends.find((f) => f.ref === ref)

  if (friends.isLoading) return <Spinner label="Loading conversation" />
  if (!friend) {
    return (
      <div className="mx-auto max-w-reading">
        <Link to="/app/friends" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Friends</Link>
        <h1 className="mt-4 text-title">Conversation not available</h1>
        <p className="mt-2 text-muted">You can only message people who are your friends.</p>
      </div>
    )
  }
  return <Conversation friendRef={ref} name={friend.displayName} online={friend.online} />
}

function Conversation({ friendRef, name, online }: { friendRef: string; name: string; online: boolean }) {
  const call = useCall()
  const queryClient = useQueryClient()
  const latest = useMessages(friendRef)
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [options, setOptions] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const busy = call.phase !== 'idle' && call.phase !== 'ended'

  const messages = useMemo(() => {
    const seen = new Set<string>()
    return [...older, ...(latest.data?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  }, [older, latest.data])
  const hasEarlier = moreOlder ?? latest.data?.hasMore ?? false
  const lastId = messages.length ? messages[messages.length - 1].id : null

  // Reading the conversation marks it read; new messages that arrive while it is open are marked too.
  useEffect(() => {
    if (!latest.data) return
    void api(`/api/friends/${encodeURIComponent(friendRef)}/messages/read`, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: keys.friends }))
      .catch(() => undefined)
  }, [friendRef, lastId, latest.data, queryClient])

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [lastId])

  const send = useMutation({
    mutationFn: (body: string) => api<ChatMessage>(`/api/friends/${encodeURIComponent(friendRef)}/messages`, { method: 'POST', body: { body } }),
    onSuccess: () => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: keys.messages(friendRef) })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })
  const clear = useMutation({
    mutationFn: () => api(`/api/friends/${encodeURIComponent(friendRef)}/messages`, { method: 'DELETE' }),
    onSuccess: () => {
      setOlder([])
      setMoreOlder(null)
      setConfirmClear(false)
      setOptions(false)
      void queryClient.invalidateQueries({ queryKey: keys.messages(friendRef) })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })

  async function loadOlder() {
    const first = messages[0]
    if (!first) return
    setLoadingOlder(true)
    try {
      const page = await api<MessagePage>(`/api/friends/${encodeURIComponent(friendRef)}/messages?before=${encodeURIComponent(first.createdAt)}`)
      setOlder((cur) => [...page.messages, ...cur])
      setMoreOlder(page.hasMore)
    } finally {
      setLoadingOlder(false)
    }
  }

  const trimmed = text.trim()
  const sendError = send.error instanceof ApiError ? send.error : null
  function submit() {
    if (trimmed && !send.isPending) send.mutate(trimmed)
  }

  return (
    <div className="mx-auto flex max-w-reading flex-col">
      <Link to="/app/friends" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Friends
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <Avatar name={name} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-heading">{name}</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <span className={`size-2 rounded-full ${online ? 'bg-green-600' : 'bg-gray-400'}`} aria-hidden />
            {online ? 'Online' : 'Offline'}
          </p>
        </div>
        <Button onClick={() => void call.requestConnect(friendRef, name)} disabled={!online || busy || call.outgoing !== null} aria-label={`Call ${name}`}>
          <Phone className="size-4" aria-hidden /> Call
        </Button>
        <button
          onClick={() => setOptions((v) => !v)}
          aria-expanded={options}
          aria-label="Conversation options"
          className="rounded-control p-2 text-muted hover:bg-black/5 hover:text-ink"
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </button>
      </div>

      {(call.micError || call.notice) && (
        <div className="mt-4"><Alert tone={call.micError ? 'error' : 'info'}>{call.micError ? 'Microphone unavailable. Allow the microphone for this site, then try again.' : call.notice}</Alert></div>
      )}

      {options && (
        <div className="mt-4 space-y-4 rounded-panel border border-line bg-surface p-4">
          <PartnerSafety friendRef={friendRef} partnerName={name} onDone={() => void queryClient.invalidateQueries({ queryKey: keys.friends })} />
          {confirmClear ? (
            <div className="rounded-control bg-canvas p-3 text-sm">
              <p>Delete this conversation for you? {name} keeps their own copy.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => clear.mutate()} loading={clear.isPending}>Delete for me</Button>
                <Button variant="ghost" onClick={() => setConfirmClear(false)}>Keep</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>Delete conversation for me</Button>
          )}
        </div>
      )}

      <div className="mt-6 min-h-[40vh]">
        {latest.isLoading ? (
          <Spinner label="Loading messages" />
        ) : latest.isError ? (
          <Alert>We could not load this conversation. Please try again.</Alert>
        ) : (
          <>
            {hasEarlier && (
              <div className="mb-4 text-center">
                <Button variant="ghost" onClick={() => void loadOlder()} loading={loadingOlder}>Show earlier messages</Button>
              </div>
            )}
            {messages.length === 0 ? (
              <p className="py-12 text-center text-muted">No messages yet. Say hello to {name}.</p>
            ) : (
              <div role="log" aria-label={`Conversation with ${name}`} aria-live="polite">
              <ol className="space-y-3">
                {messages.map((m) => (
                  <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-panel px-3.5 py-2.5 ${m.mine ? 'bg-accent text-white' : 'border border-line bg-surface'}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-1 text-xs ${m.mine ? 'text-white/80' : 'text-muted'}`}>{m.mine ? 'You' : name} · {formatDateTime(m.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              </div>
            )}
            <div ref={bottom} />
          </>
        )}
      </div>

      <form
        className="sticky bottom-0 mt-6 border-t border-line bg-canvas pt-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {sendError && <div className="mb-3"><Alert>{sendError.status === 404 ? 'You can only message friends.' : sendError.status === 429 ? sendError.message : 'The message was not sent. Please try again.'}</Alert></div>}
        <label htmlFor="message-input" className="sr-only">Message to {name}</label>
        <div className="flex items-end gap-2">
          <textarea
            id="message-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            placeholder="Write a message"
            className="block w-full resize-none rounded-control border border-field bg-surface px-3 py-2 text-ink placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <Button type="submit" disabled={!trimmed} loading={send.isPending} aria-label="Send message">
            <Send className="size-4" aria-hidden /> Send
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Messages are stored on our servers so you can read them later. They are not end-to-end encrypted.
          {text.length > MAX_MESSAGE_LENGTH - 200 && <span className="ml-1 tabular-nums">{MAX_MESSAGE_LENGTH - text.length} characters left.</span>}
        </p>
      </form>
    </div>
  )
}
