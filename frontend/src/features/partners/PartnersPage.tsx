import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, MoreHorizontal, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { keys, usePartners } from '../../lib/queries'
import type { PartnerSummary } from '../../lib/types'
import { PartnerSafety } from '../call/PartnerSafety'

export function PartnersPage() {
  const partners = usePartners()

  return (
    <div className="mx-auto max-w-reading">
      <h1 className="text-title">Previous partners</h1>
      <p className="mt-2 text-muted">
        People you have had a conversation with. You can add someone as a friend. Friends can call and message you privately. You can
        still be matched with previous partners at random.
      </p>

      <div className="mt-8">
        {partners.isLoading ? (
          <Spinner label="Loading previous partners" />
        ) : partners.isError ? (
          <ErrorState onRetry={() => partners.refetch()} />
        ) : partners.data && partners.data.length > 0 ? (
          <ul className="space-y-3" aria-label="Previous partners">
            {partners.data.map((p) => (
              <PartnerRow key={p.ref} partner={p} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No previous partners yet"
            description="After a conversation of at least a few seconds, the person you talked to appears here."
            action={<Link to="/app/talk" className="font-medium text-accent hover:underline">Find someone to talk to</Link>}
          />
        )}
      </div>
    </div>
  )
}

function PartnerRow({ partner: p }: { partner: PartnerSummary }) {
  const queryClient = useQueryClient()
  const [more, setMore] = useState(false)
  const details = [p.englishLevel ? `English ${p.englishLevel}` : null, p.country].filter(Boolean).join(' · ')

  const add = useMutation({
    mutationFn: () => api('/api/friends/requests', { method: 'POST', body: { partnerRef: p.ref } }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.partners })
      void queryClient.invalidateQueries({ queryKey: keys.friends })
    },
  })
  const addError = add.error instanceof ApiError ? add.error : null

  return (
    <li className="rounded-panel border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        <Avatar name={p.displayName} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {p.displayName}
            {details && <span className="ml-2 text-sm font-normal text-muted">{details}</span>}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Last talked {formatDate(p.lastConversationAt)} · {p.conversations} {p.conversations === 1 ? 'conversation' : 'conversations'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FriendAction partner={p} onAdd={() => add.mutate()} adding={add.isPending} />
          <button
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-label={`More options for ${p.displayName}`}
            className="rounded-control p-2 text-muted hover:bg-black/5 hover:text-ink"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      {addError && (
        <div className="mt-3">
          <Alert>{addError.status === 429 ? addError.message : 'That did not go through. Please try again.'}</Alert>
        </div>
      )}
      {more && (
        <div className="mt-4 border-t border-line pt-4">
          <PartnerSafety callId={p.lastCallId} partnerName={p.displayName} onDone={() => void queryClient.invalidateQueries({ queryKey: keys.partners })} />
        </div>
      )}
    </li>
  )
}

function FriendAction({ partner: p, onAdd, adding }: { partner: PartnerSummary; onAdd: () => void; adding: boolean }) {
  if (p.friendStatus === 'FRIENDS') {
    return (
      <Link to="/app/friends" className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-accent hover:bg-black/5">
        <Check className="size-4" aria-hidden /> Friends
      </Link>
    )
  }
  if (p.friendStatus === 'REQUEST_SENT') {
    return <span className="inline-flex h-10 items-center px-3 text-sm text-muted" role="status">Request sent</span>
  }
  if (p.friendStatus === 'REQUEST_RECEIVED') {
    return (
      <Link to="/app/friends" className="inline-flex h-10 items-center rounded-control px-3 text-sm font-medium text-accent hover:bg-black/5">
        Respond to request
      </Link>
    )
  }
  return (
    <Button onClick={onAdd} loading={adding} disabled={!p.canAddFriend} aria-label={`Add friend ${p.displayName}`}>
      <UserPlus className="size-4" aria-hidden /> Add friend
    </Button>
  )
}
