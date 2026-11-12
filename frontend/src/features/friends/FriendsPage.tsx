import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, MoreHorizontal, Phone } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { api } from '../../lib/api'
import { keys, useFriends } from '../../lib/queries'
import type { Friend, FriendRequest } from '../../lib/types'
import { useCall } from '../call/CallContext'
import { PartnerSafety } from '../call/PartnerSafety'

const details = (p: { englishLevel: string | null; country: string | null }) =>
  [p.englishLevel ? `English ${p.englishLevel}` : null, p.country].filter(Boolean).join(' · ')

export function FriendsPage() {
  const call = useCall()
  const friends = useFriends()
  const queryClient = useQueryClient()
  const busy = call.phase !== 'idle' && call.phase !== 'ended'
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.friends })
    void queryClient.invalidateQueries({ queryKey: keys.partners })
  }

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' | 'cancel' }) =>
      action === 'cancel' ? api(`/api/friends/requests/${id}`, { method: 'DELETE' }) : api(`/api/friends/requests/${id}/${action}`, { method: 'POST' }),
    onSettled: refresh,
  })

  const data = friends.data

  return (
    <div className="mx-auto max-w-reading">
      <h1 className="text-title">Friends</h1>
      <p className="mt-2 text-muted">
        Only friends can call or message you privately. Add people from your <Link to="/app/partners" className="font-medium text-accent hover:underline">previous partners</Link>.
      </p>

      <div className="mt-6 space-y-3">
        {call.micError && <Alert>Microphone unavailable. Allow the microphone for this site, then try again.</Alert>}
        {call.notice && <Alert tone="info">{call.notice}</Alert>}
        {respond.isError && <Alert>That did not go through. Please try again.</Alert>}
        {busy && (
          <Alert tone="info">
            You are in a call or searching right now. <Link to="/app/talk" className="font-medium underline">Go to call</Link>
          </Alert>
        )}
      </div>

      {friends.isLoading ? (
        <Spinner label="Loading friends" />
      ) : friends.isError || !data ? (
        <div className="mt-8"><ErrorState onRetry={() => friends.refetch()} /></div>
      ) : (
        <>
          {data.incoming.length > 0 && (
            <section className="mt-8" aria-labelledby="incoming-heading">
              <h2 id="incoming-heading" className="text-heading">Friend requests</h2>
              <ul className="mt-3 space-y-3">
                {data.incoming.map((r) => (
                  <RequestRow key={r.id} request={r}>
                    <Button onClick={() => respond.mutate({ id: r.id, action: 'accept' })} disabled={respond.isPending} aria-label={`Accept ${r.displayName}`}>Accept</Button>
                    <Button variant="secondary" onClick={() => respond.mutate({ id: r.id, action: 'decline' })} disabled={respond.isPending} aria-label={`Decline ${r.displayName}`}>Decline</Button>
                  </RequestRow>
                ))}
              </ul>
            </section>
          )}

          {data.outgoing.length > 0 && (
            <section className="mt-8" aria-labelledby="outgoing-heading">
              <h2 id="outgoing-heading" className="text-heading">Sent requests</h2>
              <ul className="mt-3 space-y-3">
                {data.outgoing.map((r) => (
                  <RequestRow key={r.id} request={r}>
                    <Button variant="secondary" onClick={() => respond.mutate({ id: r.id, action: 'cancel' })} disabled={respond.isPending} aria-label={`Cancel request to ${r.displayName}`}>Cancel</Button>
                  </RequestRow>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8" aria-labelledby="friends-heading">
            <h2 id="friends-heading" className="text-heading">Your friends</h2>
            {data.friends.length > 0 ? (
              <ul className="mt-3 space-y-3" aria-label="Friends">
                {data.friends.map((f) => (
                  <FriendRow key={f.ref} friend={f} callDisabled={busy || call.outgoing !== null} onChanged={refresh} />
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyState
                  title="No friends yet"
                  description="After a conversation, open Previous partners and choose Add friend. They need to accept before you can call or message each other."
                  action={<Link to="/app/partners" className="font-medium text-accent hover:underline">Open previous partners</Link>}
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function RequestRow({ request: r, children }: { request: FriendRequest; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-panel border border-line bg-surface p-4">
      <Avatar name={r.displayName} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{r.displayName}</p>
        {details(r) && <p className="truncate text-sm text-muted">{details(r)}</p>}
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  )
}

function FriendRow({ friend: f, callDisabled, onChanged }: { friend: Friend; callDisabled: boolean; onChanged: () => void }) {
  const call = useCall()
  const [more, setMore] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const remove = useMutation({
    mutationFn: () => api(`/api/friends/${encodeURIComponent(f.ref)}`, { method: 'DELETE' }),
    onSettled: onChanged,
  })

  return (
    <li className="rounded-panel border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        <Avatar name={f.displayName} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {f.displayName}
            {details(f) && <span className="ml-2 text-sm font-normal text-muted">{details(f)}</span>}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted" role="status">
            <span className={`size-2 rounded-full ${f.online ? 'bg-green-600' : 'bg-gray-400'}`} aria-hidden />
            {f.online ? 'Online' : 'Offline'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {f.unread > 0 && (
            <span className="inline-flex min-w-5 justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
              {f.unread}<span className="sr-only"> unread from {f.displayName}</span>
            </span>
          )}
          <Link
            to={`/app/friends/${encodeURIComponent(f.ref)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-control border border-line-strong px-3 text-sm font-medium hover:bg-black/5"
            aria-label={`Message ${f.displayName}`}
          >
            <MessageSquare className="size-4" aria-hidden /> Message
          </Link>
          <Button
            onClick={() => void call.requestConnect(f.ref, f.displayName)}
            disabled={!f.online || callDisabled}
            aria-label={`Call ${f.displayName}`}
          >
            <Phone className="size-4" aria-hidden /> Call
          </Button>
          <button
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-label={`More options for ${f.displayName}`}
            className="rounded-control p-2 text-muted hover:bg-black/5 hover:text-ink"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      {more && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <PartnerSafety friendRef={f.ref} partnerName={f.displayName} onDone={onChanged} />
          {confirmRemove ? (
            <div className="rounded-control bg-canvas p-3 text-sm">
              <p>Remove {f.displayName} from your friends? You will both lose your private conversation. You can still be matched at random.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => remove.mutate()} loading={remove.isPending}>Remove friend</Button>
                <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Keep</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove {f.displayName} from friends</Button>
          )}
        </div>
      )}
    </li>
  )
}
