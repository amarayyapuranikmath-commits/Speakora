import { Mic, MicOff, PhoneOff, SkipForward, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'

interface ControlProps {
  label: string
  onClick: () => void
  icon: ReactNode
  pressed?: boolean
  tone?: 'default' | 'danger'
}

function Control({ label, onClick, icon, pressed, tone = 'default' }: ControlProps) {
  const style =
    tone === 'danger'
      ? 'bg-danger text-white hover:bg-[#8f1d13]'
      : pressed
        ? 'bg-ink text-white hover:bg-black'
        : 'border border-line-strong bg-surface text-ink hover:bg-canvas'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex w-18 flex-col items-center gap-2 rounded-panel px-2 py-3 text-xs font-medium transition-colors sm:w-22 ${style}`}
    >
      {icon}
      {label}
    </button>
  )
}

interface CallControlsProps {
  muted: boolean
  speakerOn: boolean
  onToggleMute: () => void
  onToggleSpeaker: () => void
  onSkip: () => void
  onEnd: () => void
}

/** Every control maps to a real action: mute toggles the mic track, speaker mutes playback, skip/end signal the server. */
export function CallControls({ muted, speakerOn, onToggleMute, onToggleSpeaker, onSkip, onEnd }: CallControlsProps) {
  return (
    <div role="group" aria-label="Call controls" className="flex flex-wrap items-center justify-center gap-3">
      <Control label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={onToggleMute} icon={muted ? <MicOff className="size-6" aria-hidden /> : <Mic className="size-6" aria-hidden />} />
      <Control label="Speaker" pressed={!speakerOn} onClick={onToggleSpeaker} icon={speakerOn ? <Volume2 className="size-6" aria-hidden /> : <VolumeX className="size-6" aria-hidden />} />
      <Control label="Skip" onClick={onSkip} icon={<SkipForward className="size-6" aria-hidden />} />
      <Control label="End call" tone="danger" onClick={onEnd} icon={<PhoneOff className="size-6" aria-hidden />} />
    </div>
  )
}
