import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { countryName, LEVEL_LABEL } from '../../lib/constants'
import { formatClock } from '../../lib/format'
import { useTopics } from '../../lib/queries'
import { CallControls } from './CallControls'
import { useCall, useElapsed } from './CallContext'
import { QualityIndicator } from './QualityIndicator'

const STATUS_TEXT = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Connection lost. Reconnecting…',
} as const

export function ActiveCall() {
  const call = useCall()
  const elapsed = useElapsed(call.phase === 'connected' || call.phase === 'reconnecting' ? call.connectedAt : null)
  const phase = call.phase === 'connecting' || call.phase === 'connected' || call.phase === 'reconnecting' ? call.phase : 'connecting'
  const partner = call.partner

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-6 text-center sm:py-12">
      <div aria-hidden className="flex size-24 items-center justify-center rounded-full bg-accent-soft text-3xl font-semibold text-accent">
        {partner?.displayName.slice(0, 1).toUpperCase()}
      </div>
      <h1 className="mt-5 text-2xl font-semibold">{partner?.displayName}</h1>
      <p className="mt-1 text-sm text-muted">
        {[partner?.country && countryName(partner.country), partner?.englishLevel && LEVEL_LABEL[partner.englishLevel]].filter(Boolean).join(' · ')}
      </p>

      <p className={`mt-6 text-sm font-medium ${phase === 'reconnecting' ? 'text-warning' : 'text-muted'}`} role="status" aria-live="polite">
        {STATUS_TEXT[phase]}
      </p>
      <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums" aria-label={`Call duration ${formatClock(elapsed)}`}>
        {call.connectedAt ? formatClock(elapsed) : '0:00'}
      </p>
      <div className="mt-3">
        <QualityIndicator quality={call.quality} />
      </div>

      <div className="mt-10">
        <CallControls
          muted={call.muted}
          speakerOn={call.speakerOn}
          onToggleMute={call.toggleMute}
          onToggleSpeaker={call.toggleSpeaker}
          onSkip={call.skip}
          onEnd={call.endCall}
        />
      </div>
      {call.microphones.length > 1 && (
        <div className="mt-6 w-full max-w-xs">
          <label htmlFor="mic-select" className="mb-1.5 block text-left text-xs font-medium text-muted">Microphone</label>
          <select
            id="mic-select"
            value={call.micId ?? ''}
            onChange={(e) => void call.selectMicrophone(e.target.value)}
            className="block h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {call.microphones.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      )}
      {call.link === 'reconnecting' && <p className="mt-4 text-sm text-warning" role="status">Reconnecting to the server. Your call audio continues if the connection holds.</p>}
      {call.muted && <p className="mt-4 text-sm text-muted" role="status">Your microphone is muted. Your partner cannot hear you.</p>}
      {call.notice && <p className="mt-4 text-sm text-danger" role="alert">{call.notice}</p>}

      <PromptHelper topicPrompts={call.topic?.prompts} topicName={call.topic?.name} />
    </div>
  )
}

/** Opt-in conversation starters. Collapsed by default so it never competes with the conversation. */
function PromptHelper({ topicPrompts, topicName }: { topicPrompts?: string[]; topicName?: string }) {
  const topics = useTopics()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const prompts = useMemo(() => {
    if (topicPrompts && topicPrompts.length > 0) return topicPrompts
    return (topics.data ?? []).find((t) => t.slug === 'general')?.prompts ?? []
  }, [topicPrompts, topics.data])

  if (prompts.length === 0) return null
  const prompt = prompts[((index % prompts.length) + prompts.length) % prompts.length]

  return (
    <div className="mt-12 w-full">
      {!open ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline">
          <Lightbulb className="size-4" aria-hidden /> Need something to talk about?
        </button>
      ) : (
        <div className="rounded-panel border border-line bg-surface p-5 text-left">
          <div className="flex items-center justify-between text-xs font-medium text-subtle">
            <span>{topicName ?? 'General discussion'}</span>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">Hide</button>
          </div>
          <p className="mt-3 text-lg leading-snug" aria-live="polite">{prompt}</p>
          <div className="mt-4 flex items-center gap-1">
            <button onClick={() => setIndex(index - 1)} aria-label="Previous prompt" className="rounded-control p-1.5 text-muted hover:bg-black/5"><ChevronLeft className="size-5" aria-hidden /></button>
            <button onClick={() => setIndex(index + 1)} aria-label="Next prompt" className="rounded-control p-1.5 text-muted hover:bg-black/5"><ChevronRight className="size-5" aria-hidden /></button>
            <span className="ml-1 text-xs text-subtle">{(((index % prompts.length) + prompts.length) % prompts.length) + 1} of {prompts.length}</span>
          </div>
        </div>
      )}
    </div>
  )
}
