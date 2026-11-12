/** Shown only in design-review preview mode for sections that are not built yet. It never pretends the section works. */
export function NotAvailablePage({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-reading py-12">
      <h1 className="text-title">{name}</h1>
      <p className="mt-3 text-body text-muted">This section is not available yet. It is shown here only so the navigation can be reviewed.</p>
    </div>
  )
}
