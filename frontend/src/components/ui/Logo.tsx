import { Link } from 'react-router-dom'
import { brand } from '../../config/brand'

// The Speakora mark: a speech bubble holding an S made of two stacked arcs. Same geometry as design/logo/*.svg (built by
// design/build-logo.py) and the Android app's BrandMark, so the two platforms show one identity.
const BUBBLE = 'M18 4H46A14 14 0 0 1 60 18V38A14 14 0 0 1 46 52H28L13 61L18 52A14 14 0 0 1 4 38V18A14 14 0 0 1 18 4Z'
const S_TOP = 'M38.55 15.41A8 8 0 1 0 32 28'
const S_BOTTOM = 'M32 28A8 8 0 1 1 25.45 40.59'

/** `tone="dark"` is the white-bubble version for navy or other dark backgrounds. */
export function LogoMark({ className = 'size-8', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark'
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path d={BUBBLE} fill={dark ? '#fff' : 'var(--color-navy)'} />
      <path d={S_TOP} fill="none" stroke={dark ? 'var(--color-navy)' : '#fff'} strokeWidth="8" strokeLinecap="round" />
      <path d={S_BOTTOM} fill="none" stroke="#2f6bff" strokeWidth="8" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex min-w-0 items-center gap-2.5 rounded-control font-bold tracking-tight text-navy">
      <LogoMark />
      <span className="truncate text-[18px]">{brand.name}</span>
    </Link>
  )
}
