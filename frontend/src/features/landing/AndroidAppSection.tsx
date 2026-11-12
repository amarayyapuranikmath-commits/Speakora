import { Bell, Download, Headphones, Smartphone } from 'lucide-react'
import { AnchorButton } from '../../components/ui/Button'
import { brand } from '../../config/brand'

const BENEFITS = [
  { icon: Smartphone, title: 'Made for your phone', body: 'A focused app for finding a partner and talking, with the same account and progress as the website.' },
  { icon: Headphones, title: 'Phone-friendly audio', body: 'Switch between earpiece, loudspeaker and Bluetooth headsets without leaving the call.' },
  { icon: Bell, title: 'Stays with your call', body: 'A call notification keeps the conversation going while you check another app.' },
]

/** Decorative preview of the app's welcome screen (drawn in CSS and SVG, not a screenshot). */
function PhonePreview() {
  return (
    <div aria-hidden className="relative mx-auto w-[248px] shrink-0 rounded-[2.6rem] border-[7px] border-[#14171a] bg-[#14171a] shadow-[0_30px_60px_-20px_rgba(8,23,58,0.55)]">
      <div className="absolute left-1/2 top-2.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-[#14171a]" />
      <div className="overflow-hidden rounded-[2.1rem] bg-canvas">
        <div className="relative flex h-[238px] items-center justify-center bg-gradient-to-b from-[#08173a] via-[#12307a] to-accent pt-6">
          <svg viewBox="0 0 160 160" className="size-[170px]">
            <defs>
              <radialGradient id="pv-body" cx="36%" cy="30%" r="85%">
                <stop offset="0" stopColor="#7fa8ff" />
                <stop offset="0.5" stopColor="#1d4ed8" />
                <stop offset="1" stopColor="#08173a" />
              </radialGradient>
            </defs>
            <circle cx="80" cy="80" r="56" fill="url(#pv-body)" />
            {Array.from({ length: 9 }, (_, r) =>
              Array.from({ length: 9 }, (_, c) => {
                const x = 80 + (c - 4) * 11
                const y = 80 + (r - 4) * 11
                const d = Math.hypot(x - 80, y - 80)
                return d < 52 && (r * 3 + c * 5) % 7 < 4 ? <circle key={`${r}-${c}`} cx={x} cy={y} r={1.4 - d / 90} fill="#eaf2ff" opacity={0.85 - d / 90} /> : null
              }),
            )}
            <path d="M62 66Q112 26 104 94" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1" strokeDasharray="1 3.5" strokeLinecap="round" />
            <circle cx="62" cy="66" r="3" fill="#fff" stroke="#1d4ed8" strokeWidth="1.2" />
            <circle cx="104" cy="94" r="3" fill="#fff" stroke="#1d4ed8" strokeWidth="1.2" />
          </svg>
          <span className="absolute left-3 top-[58px] rounded-xl rounded-bl-sm border border-white/30 bg-white/15 px-2.5 py-1 text-[10px] font-medium text-white">Hello, how’s your day?</span>
          <span className="absolute bottom-6 right-3 rounded-xl rounded-br-sm border border-white/30 bg-white/15 px-2.5 py-1 text-[10px] font-medium text-white">Great, thanks! And you?</span>
        </div>
        <div className="relative -mt-6 rounded-t-3xl bg-canvas px-4 pb-5 pt-5">
          <p className="text-[17px] font-bold leading-tight tracking-tight text-ink">Speak English with the world.</p>
          <p className="mt-1.5 text-[10px] leading-snug text-muted">Real one-to-one conversations.</p>
          <div className="mt-3 flex h-8 items-center justify-center rounded-lg bg-accent text-[11px] font-semibold text-white">Start Speaking</div>
          <div className="mt-2 flex h-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-[11px] font-semibold text-ink">Sign In</div>
        </div>
      </div>
    </div>
  )
}

/** Shown ONLY when a real, public download address is configured: the page never advertises an app that cannot be installed. */
export function AndroidAppSection() {
  const url = brand.androidDownloadUrl
  if (!url) return null
  return (
    <section id="android-app" className="scroll-mt-20 overflow-hidden border-y border-line bg-surface">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-medium text-accent">Android app</p>
          <h2 className="mt-3 max-w-lg text-3xl font-semibold sm:text-4xl">Take your speaking practice with you.</h2>
          <p className="mt-4 max-w-lg text-muted">Same account, same partners, built for the phone in your pocket. Start a conversation wherever you have a few minutes.</p>
          <ul className="mt-8 space-y-5">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-9">
            {url ? (
              <>
                <AnchorButton href={url} download rel="noopener" size="lg">
                  <Download className="size-5" aria-hidden /> Download Android app
                </AnchorButton>
                <p className="mt-4 max-w-md text-sm text-subtle">
                  Direct download of the app file (APK) for Android 7.0 or newer on 64-bit phones. Your browser may ask you to allow installing apps from it. Installing is optional: the website works on your phone too.
                </p>
              </>
            ) : null}
          </div>
        </div>
        <PhonePreview />
      </div>
    </section>
  )
}
