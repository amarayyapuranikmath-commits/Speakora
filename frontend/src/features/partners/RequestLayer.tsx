import { Phone, X } from 'lucide-react'
import { useEffect } from 'react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { useCountdown } from '../../lib/useCountdown'
import { useCall } from '../call/CallContext'
import { resultMessage } from './partnerText'

/**
 * Everything about private-call requests that must be visible on any page: the prompt when a friend asks to talk to you, the
 * "asking…" bar while you wait for an answer, and what happened to the request you sent.
 */
export function RequestLayer() {
  const call = useCall()
  return (
    <>
      {call.incoming && <IncomingDialog />}
      {call.outgoing && <OutgoingBar />}
      {call.requestResult && !call.outgoing && <ResultBar />}
    </>
  )
}

function IncomingDialog() {
  const call = useCall()
  const req = call.incoming!
  const left = useCountdown(req.expiresAt)
  const { from } = req
  const details = [from.englishLevel ? `English ${from.englishLevel}` : null, from.country ?? null].filter(Boolean).join(' · ')

  useEffect(() => {
    if (left === 0) call.declineRequest()
  }, [left, call])

  return (
    <Dialog title="A friend wants to talk" onClose={call.declineRequest}>
      <div className="flex items-center gap-4">
        <Avatar name={from.displayName} size={56} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{from.displayName}</p>
          {details && <p className="text-sm text-muted">{details}</p>}
        </div>
      </div>
      <p className="mt-4 text-sm text-muted" role="status">
        {from.displayName} would like to talk with you now. Nothing starts unless you accept.
        {left !== null && <span className="ml-1 tabular-nums">Answer within {left}s.</span>}
      </p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={call.declineRequest}>Not now</Button>
        <Button onClick={() => void call.acceptRequest()}>
          <Phone className="size-4" aria-hidden /> Accept and talk
        </Button>
      </div>
    </Dialog>
  )
}

function OutgoingBar() {
  const call = useCall()
  const out = call.outgoing!
  const left = useCountdown(out.expiresAt)
  return (
    <div className="border-b border-accent/20 bg-accent-soft" role="status">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6">
        <span className="min-w-0 truncate">
          <span className="font-medium">Asking {out.partnerName} to talk…</span>
          {left !== null && <span className="ml-2 tabular-nums text-muted">{left}s</span>}
        </span>
        <Button variant="secondary" onClick={call.cancelRequest} disabled={!out.requestId}>Cancel</Button>
      </div>
    </div>
  )
}

function ResultBar() {
  const call = useCall()
  const message = resultMessage(call.requestResult!)
  useEffect(() => {
    if (!message) call.dismissRequestResult()
  }, [message, call])
  if (!message) return null
  return (
    <div className="border-b border-line bg-surface" role="status">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6">
        <span>{message}</span>
        <button onClick={call.dismissRequestResult} aria-label="Dismiss" className="-m-1.5 rounded-control p-1.5 text-muted hover:bg-black/5 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
