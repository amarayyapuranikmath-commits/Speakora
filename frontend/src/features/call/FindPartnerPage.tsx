import { Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, LinkButton } from '../../components/ui/Button'
import { Alert, Spinner } from '../../components/ui/feedback'
import { Panel } from '../../components/ui/Layout'
import { formatDuration } from '../../lib/format'
import { useProfile, useTopics } from '../../lib/queries'
import { ActiveCall } from './ActiveCall'
import { useCall, useElapsed, type CallState } from './CallContext'
import { FeedbackForm } from './FeedbackForm'
import { PartnerSafety } from './PartnerSafety'

export function FindPartnerPage() {
  const call = useCall()
  switch (call.phase) {
    case 'starting':
      return <Spinner label="Starting your microphone" />
    case 'searching':
      return <Searching />
    case 'connecting':
    case 'connected':
    case 'reconnecting':
      return <ActiveCall />
    case 'ended':
      return <Ended />
    default:
      return <Idle />
  }
}

function MicProblem({ error }: { error: NonNullable<CallState['micError']> }) {
  const text = {
    denied: 'Microphone access is blocked. Allow the microphone for this site in your browser’s address bar or site settings, then try again.',
    'not-found': 'No microphone was found. Connect a microphone or headset and try again.',
    insecure: 'Voice calls need a secure connection (HTTPS). Open the site over HTTPS, or use localhost during development.',
    other: 'We could not start your microphone. Close other apps that might be using it and try again.',
  }[error]
  return (
    <Alert>
      <span className="font-medium">Microphone unavailable.</span> {text}
    </Alert>
  )
}

function Idle() {
  const call = useCall()
  const topics = useTopics()
  const profile = useProfile()
  const [params] = useSearchParams()
  const [topic, setTopic] = useState<string>(params.get('topic') ?? '')

  return (
    <div className="mx-auto max-w-reading">
      <h1 className="text-title">Find a speaking partner</h1>
      <p className="mt-2 text-muted">
        We will connect you with someone who is online now
        {profile.data?.englishLevel ? ` and prefer a similar level to your ${profile.data.englishLevel}` : ''}. Calls are voice only and are never recorded.
      </p>

      <div className="mt-8 space-y-4">
        {call.micError && <MicProblem error={call.micError} />}
        {call.notice && <Alert tone="info">{call.notice}</Alert>}
      </div>

      <fieldset className="mt-8">
        <legend className="text-sm font-medium">Topic <span className="font-normal text-subtle">(optional)</span></legend>
        <p className="mt-1 text-sm text-muted">Choosing a topic gives you conversation prompts. If your partner picks the same one, you will be matched on it. <Link to="/app/topics" className="font-medium text-accent hover:underline">See sample prompts</Link></p>
        {topics.isLoading ? (
          <Spinner label="Loading topics" />
        ) : (
          <div className="mt-4 divide-y divide-line border-y border-line">
            {[{ slug: '', name: 'Any topic', description: 'Talk about whatever comes up.' }, ...(topics.data ?? [])].map((t) => (
              <label
                key={t.slug || 'any'}
                className={`flex cursor-pointer items-start gap-3 px-2 py-3 transition-colors ${topic === t.slug ? 'bg-accent-soft' : 'hover:bg-black/[0.03]'}`}
              >
                <input type="radio" name="topic" checked={topic === t.slug} onChange={() => setTopic(t.slug)} className="mt-1 accent-accent" />
                <span>
                  <span className="block text-sm font-medium">{t.name}</span>
                  {t.description && <span className="block text-xs text-muted">{t.description}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="mt-8">
        <Button size="lg" className="w-full sm:w-auto" onClick={() => void call.start(topic || null)}>
          Start looking for a partner
        </Button>
      </div>

      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Link to="/app/partners" className="font-medium text-accent hover:underline">Previous partners</Link>
        <Link to="/app/history" className="font-medium text-accent hover:underline">Call history</Link>
      </p>

      <p className="mt-6 flex items-start gap-2 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          You can leave at any time, and block or report anyone. <Link to="/safety" className="font-medium text-accent hover:underline">Safety and privacy</Link>
        </span>
      </p>
    </div>
  )
}

function Searching() {
  const call = useCall()
  const [startedAt] = useState(() => Date.now())
  const elapsed = useElapsed(startedAt)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <Loader2 className="size-9 animate-spin text-accent" aria-hidden />
      <h1 className="mt-6 text-2xl font-semibold" role="status">Looking for a partner…</h1>
      <p className="mt-2 text-muted">This usually takes under a minute. Keep this page open.</p>
      <p className="mt-6 text-sm tabular-nums text-subtle">{elapsed}s</p>
      {call.link === 'reconnecting' && <p className="mt-3 text-sm text-warning" role="status">Reconnecting to the server…</p>}
      {call.notice && <p className="mt-3 text-sm text-danger" role="alert">{call.notice}</p>}
      <Button variant="secondary" className="mt-8" onClick={call.cancelSearch}>Cancel</Button>
    </div>
  )
}

function Ended() {
  const call = useCall()
  const info = call.endInfo
  const partnerName = call.partner?.displayName ?? 'your partner'
  const completed = info?.status === 'COMPLETED'

  let headline = 'Call ended'
  let detail: string | null = null
  if (info?.status === 'FAILED') {
    headline = 'We could not connect the call'
    detail = 'This can happen on restrictive networks or if a connection dropped during setup. You can try again.'
  } else if (info?.status === 'CANCELLED') {
    headline = 'The call did not start'
    detail = info.endReason === 'SKIPPED' ? `${partnerName} moved on before you connected.` : 'The connection was not established before the call ended.'
  } else if (info?.endReason === 'SKIPPED' && info.endedBy === 'partner') {
    detail = `${partnerName} chose to move on to a new partner.`
  } else if (info?.endReason === 'DISCONNECTED') {
    detail = `${partnerName} lost their connection.`
  }

  return (
    <div className="mx-auto max-w-reading space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[28px]">{headline}</h1>
        {completed && info?.durationSeconds != null && (
          <p className="mt-2 text-muted">You spoke with {partnerName} for {formatDuration(info.durationSeconds)}.</p>
        )}
        {detail && <p className="mt-2 text-muted">{detail}</p>}
      </div>

      {call.micError && <MicProblem error={call.micError} />}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => { call.dismissEnded(); void call.start(call.requestedTopic) }}>Find another partner</Button>
        <LinkButton to="/app" variant="secondary" size="lg" onClick={call.dismissEnded}>Back to dashboard</LinkButton>
      </div>
      <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Link to="/app/partners" className="font-medium text-accent hover:underline">Previous partners</Link>
        <Link to="/app/history" className="font-medium text-accent hover:underline">Call history</Link>
      </p>

      {completed && info && (
        <Panel title="How was your conversation?" description="Feedback is private and helps improve matching.">
          <FeedbackForm callId={info.callId} />
        </Panel>
      )}

      {completed && info && call.partner && (
        <Panel title="Safety" description="Something not right? You can block this person or send a report.">
          <PartnerSafety callId={info.callId} partnerName={partnerName} />
        </Panel>
      )}
    </div>
  )
}
