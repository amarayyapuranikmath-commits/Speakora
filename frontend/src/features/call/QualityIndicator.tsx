import type { Quality } from './quality'

const META: Record<Quality, { label: string; bars: number; color: string }> = {
  unknown: { label: 'Measuring connection', bars: 0, color: 'bg-line-strong' },
  good: { label: 'Good connection', bars: 3, color: 'bg-success' },
  fair: { label: 'Fair connection', bars: 2, color: 'bg-warning' },
  poor: { label: 'Poor connection', bars: 1, color: 'bg-danger' },
}

export function QualityIndicator({ quality }: { quality: Quality }) {
  const m = META[quality]
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status" aria-label={m.label}>
      <span className="flex h-4 items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i <= m.bars ? m.color : 'bg-line'}`} style={{ height: `${i * 33}%` }} />
        ))}
      </span>
      {m.label}
    </div>
  )
}
