import type { ReactNode } from 'react'

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Panel({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-panel border border-line bg-surface ${className ?? ''}`}>
      {(title || description) && (
        <header className="border-b border-line px-5 py-4 sm:px-6">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </header>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-subtle">{hint}</dd>}
    </div>
  )
}

/** Selectable pill used for interests and goals. */
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        selected ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-surface text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
