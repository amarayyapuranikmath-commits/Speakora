import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { formatDateTime, formatDuration } from '../../lib/format'
import type { CallStatus, CallSummary } from '../../lib/types'
import { FeedbackForm } from '../call/FeedbackForm'
import { PartnerSafety } from '../call/PartnerSafety'

const STATUS: Record<CallStatus, { label: string; style: string }> = {
  COMPLETED: { label: 'Completed', style: 'bg-success-soft text-success' },
  FAILED: { label: 'Did not connect', style: 'bg-danger-soft text-danger' },
  CANCELLED: { label: 'Ended early', style: 'bg-black/5 text-muted' },
  MATCH_FOUND: { label: 'Starting', style: 'bg-black/5 text-muted' },
  CONNECTING: { label: 'Connecting', style: 'bg-black/5 text-muted' },
  CONNECTED: { label: 'In progress', style: 'bg-accent-soft text-accent' },
  RECONNECTING: { label: 'In progress', style: 'bg-accent-soft text-accent' },
}

export function StatusBadge({ status }: { status: CallStatus }) {
  const s = STATUS[status]
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.style}`}>{s.label}</span>
}

/** Accessible list of calls with a per-row dialog for feedback, blocking and reporting. */
export function CallList({ calls }: { calls: CallSummary[] }) {
  const [active, setActive] = useState<{ call: CallSummary; mode: 'feedback' | 'safety' } | null>(null)

  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
        {calls.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{c.partnerDisplayName}</p>
              <p className="mt-0.5 text-sm text-muted">
                <time dateTime={c.startedAt}>{formatDateTime(c.startedAt)}</time>
                {c.topicName ? ` · ${c.topicName}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-sm tabular-nums text-muted">{c.status === 'COMPLETED' ? formatDuration(c.durationSeconds) : ''}</span>
              <StatusBadge status={c.status} />
              {c.status === 'COMPLETED' && (
                <>
                  {c.feedbackSubmitted ? (
                    <span className="text-sm text-subtle">Feedback sent</span>
                  ) : (
                    <Button variant="secondary" onClick={() => setActive({ call: c, mode: 'feedback' })}>Leave feedback</Button>
                  )}
                  <Button variant="ghost" onClick={() => setActive({ call: c, mode: 'safety' })}>Block or report</Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {active && (
        <Dialog title={active.mode === 'feedback' ? `Feedback for ${active.call.partnerDisplayName}` : `Block or report ${active.call.partnerDisplayName}`} onClose={() => setActive(null)}>
          {active.mode === 'feedback' ? (
            <FeedbackForm callId={active.call.id} onDone={() => setTimeout(() => setActive(null), 1200)} />
          ) : (
            <PartnerSafety callId={active.call.id} partnerName={active.call.partnerDisplayName} />
          )}
        </Dialog>
      )}
    </>
  )
}
