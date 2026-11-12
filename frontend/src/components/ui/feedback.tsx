import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'error' | 'success' | 'info'
const tones: Record<Tone, { box: string; icon: ReactNode }> = {
  error: { box: 'bg-danger-soft text-danger', icon: <AlertCircle className="size-4 shrink-0" aria-hidden /> },
  success: { box: 'bg-success-soft text-success', icon: <CheckCircle2 className="size-4 shrink-0" aria-hidden /> },
  info: { box: 'bg-accent-soft text-accent', icon: <Info className="size-4 shrink-0" aria-hidden /> },
}

export function Alert({ tone = 'error', children }: { tone?: Tone; children: ReactNode }) {
  const t = tones[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-control px-3.5 py-3 text-sm ${t.box}`}>
      <span className="mt-0.5">{t.icon}</span>
      <div>{children}</div>
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-line-strong px-6 py-12 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-panel border border-line bg-surface px-6 py-10 text-center" role="alert">
      <p className="text-sm text-muted">{message ?? 'We could not load this. Please try again.'}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-sm font-medium text-accent hover:underline">
          Try again
        </button>
      )}
    </div>
  )
}
