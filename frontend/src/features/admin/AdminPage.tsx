import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field'
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { PageHeader } from '../../components/ui/Layout'
import { ApiError, api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { AccountStatus, AdminReport, AdminUser, PageResponse, SystemCheck, SystemReport } from '../../lib/types'

const REASON: Record<string, string> = {
  HARASSMENT: 'Harassment',
  HATE_OR_ABUSE: 'Hate or abuse',
  SEXUAL_CONTENT: 'Sexual content',
  SPAM_OR_SCAM: 'Spam or scam',
  UNDERAGE: 'Possibly under 18',
  OTHER: 'Other',
}

const STATUS_STYLE: Record<AccountStatus, string> = {
  ACTIVE: 'bg-success-soft text-success',
  SUSPENDED: 'bg-danger-soft text-danger',
  DELETED: 'bg-black/5 text-muted',
}

type Tab = 'reports' | 'users' | 'system'

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('reports')
  return (
    <>
      <PageHeader title="Moderation" description="Review reports and manage accounts. Every decision is recorded." />
      <div role="tablist" aria-label="Moderation sections" className="mb-8 flex gap-1 border-b border-line">
        {(['reports', 'users', 'system'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            id={`admin-tab-${t}`}
            aria-controls={`admin-panel-${t}`}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium capitalize ${tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'reports' ? <Reports /> : tab === 'users' ? <Users /> : <System />}
      </div>
    </>
  )
}

function Reports() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('OPEN')
  const [page, setPage] = useState(0)
  const [acting, setActing] = useState<{ report: AdminReport; action: 'SUSPEND' | 'DISMISS' } | null>(null)
  const reports = useQuery({
    queryKey: ['admin', 'reports', status, page],
    queryFn: () => api<PageResponse<AdminReport>>(`/api/admin/reports?status=${status}&page=${page}&size=15`),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <div className="mb-5 max-w-48">
        <SelectField label="Show" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="OPEN">Open</option>
          <option value="ACTIONED">Actioned</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="ALL">All</option>
        </SelectField>
      </div>
      {reports.isLoading ? (
        <Spinner label="Loading reports" />
      ) : reports.isError || !reports.data ? (
        <ErrorState onRetry={() => reports.refetch()} />
      ) : reports.data.items.length === 0 ? (
        <EmptyState title={status === 'OPEN' ? 'No open reports' : 'No reports here'} description="New reports from users appear here." />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
            {reports.data.items.map((r) => (
              <li key={r.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium">
                    {r.reportedName} <span className="font-normal text-muted">· {REASON[r.reason] ?? r.reason}</span>
                  </p>
                  <time dateTime={r.createdAt} className="text-sm text-muted">{formatDateTime(r.createdAt)}</time>
                </div>
                <p className="text-sm text-muted">
                  Reported by {r.reporterName}. {r.openReportsAgainst} open of {r.totalReportsAgainst} total against this user.
                  {r.reportedStatus && r.reportedStatus !== 'ACTIVE' && <> Account is <span className="font-medium lowercase">{r.reportedStatus}</span>.</>}
                </p>
                {r.details && <p className="border-l-2 border-line pl-3 text-sm">{r.details}</p>}
                {r.status === 'OPEN' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => setActing({ report: r, action: 'SUSPEND' })}>Suspend user</Button>
                    <Button variant="secondary" onClick={() => setActing({ report: r, action: 'DISMISS' })}>Dismiss</Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    {r.status === 'ACTIONED' ? 'Actioned' : 'Dismissed'}
                    {r.resolvedAt ? ` on ${formatDateTime(r.resolvedAt)}` : ''}
                    {r.resolutionNote ? `: ${r.resolutionNote}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {reports.data.totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted">Page {page + 1} of {reports.data.totalPages}</span>
              <Button variant="secondary" disabled={page + 1 >= reports.data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
      {acting && (
        <ResolveDialog
          report={acting.report}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null)
            void queryClient.invalidateQueries({ queryKey: ['admin'] })
          }}
        />
      )}
    </>
  )
}

function ResolveDialog({ report, action, onClose, onDone }: { report: AdminReport; action: 'SUSPEND' | 'DISMISS'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const resolve = useMutation({
    mutationFn: () => api(`/api/admin/reports/${report.id}/resolve`, { method: 'POST', body: { action, note: note.trim() || null } }),
    onSuccess: onDone,
  })
  const suspend = action === 'SUSPEND'
  return (
    <Dialog title={suspend ? `Suspend ${report.reportedName}?` : 'Dismiss this report?'} onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          resolve.mutate()
        }}
      >
        {resolve.isError && <Alert>{resolve.error instanceof ApiError ? resolve.error.message : 'That did not work. Please try again.'}</Alert>}
        <p className="text-sm text-muted">
          {suspend
            ? 'They will be signed out immediately, removed from any call or queue, and unable to sign in until unsuspended.'
            : 'The report is closed and the user is not affected.'}
        </p>
        <TextAreaField label={suspend ? 'Reason (shown to the user)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex gap-2">
          <Button type="submit" variant={suspend ? 'danger' : 'primary'} loading={resolve.isPending} disabled={suspend && note.trim().length === 0}>
            {suspend ? 'Suspend user' : 'Dismiss report'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

function Users() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(0)
  const [suspending, setSuspending] = useState<AdminUser | null>(null)
  const users = useQuery({
    queryKey: ['admin', 'users', submitted, status, page],
    queryFn: () => api<PageResponse<AdminUser>>(`/api/admin/users?q=${encodeURIComponent(submitted)}&status=${status}&page=${page}&size=15`),
    placeholderData: (prev) => prev,
  })
  const unsuspend = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}/unsuspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  })

  return (
    <>
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(q.trim())
          setPage(0)
        }}
      >
        <div className="min-w-56 flex-1">
          <TextField label="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-40">
          <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DELETED">Deleted</option>
          </SelectField>
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {unsuspend.isError && <div className="mb-4"><Alert>Could not unsuspend that account.</Alert></div>}
      {users.isLoading ? (
        <Spinner label="Loading users" />
      ) : users.isError || !users.data ? (
        <ErrorState onRetry={() => users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search or status." />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
            {users.data.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {u.displayName || 'No name'} {u.role === 'ADMIN' && <span className="ml-1 text-xs font-medium text-accent">Admin</span>}
                  </p>
                  <p className="truncate text-sm text-muted">{u.email}</p>
                  {u.status === 'SUSPENDED' && u.suspendedReason && <p className="mt-1 text-sm text-danger">Reason: {u.suspendedReason}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm text-muted">{u.openReportsAgainst} open / {u.totalReportsAgainst} reports</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[u.status]}`}>{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</span>
                  {u.status === 'ACTIVE' && u.role !== 'ADMIN' && <Button variant="secondary" onClick={() => setSuspending(u)}>Suspend</Button>}
                  {u.status === 'SUSPENDED' && (
                    <Button variant="secondary" loading={unsuspend.isPending && unsuspend.variables === u.id} onClick={() => unsuspend.mutate(u.id)}>Unsuspend</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {users.data.totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted">Page {page + 1} of {users.data.totalPages}</span>
              <Button variant="secondary" disabled={page + 1 >= users.data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
      {suspending && (
        <SuspendDialog
          user={suspending}
          onClose={() => setSuspending(null)}
          onDone={() => {
            setSuspending(null)
            void queryClient.invalidateQueries({ queryKey: ['admin'] })
          }}
        />
      )}
    </>
  )
}

function SuspendDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const suspend = useMutation({
    mutationFn: () => api(`/api/admin/users/${user.id}/suspend`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: onDone,
  })
  return (
    <Dialog title={`Suspend ${user.displayName || user.email}?`} onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          suspend.mutate()
        }}
      >
        {suspend.isError && <Alert>{suspend.error instanceof ApiError ? suspend.error.message : 'That did not work. Please try again.'}</Alert>}
        <p className="text-sm text-muted">They will be signed out immediately and removed from any call or queue.</p>
        <TextAreaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <div className="flex gap-2">
          <Button type="submit" variant="danger" loading={suspend.isPending} disabled={reason.trim().length === 0}>Suspend user</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

/* ------------------------------ System checks ------------------------------ */

function System() {
  const report = useQuery({ queryKey: ['admin', 'system'], queryFn: () => api<SystemReport>('/api/admin/system') })
  if (report.isLoading) return <Spinner label="Loading configuration" />
  if (report.isError || !report.data) return <ErrorState onRetry={() => report.refetch()} />
  const r = report.data
  const yes = (v: boolean) => (v ? 'Configured' : 'Not configured')

  return (
    <div className="max-w-2xl space-y-10">
      {r.warnings.length > 0 && (
        <section aria-labelledby="warnings-heading">
          <h2 id="warnings-heading" className="mb-3 text-base font-semibold">Needs attention</h2>
          <ul className="space-y-2">
            {r.warnings.map((w) => (
              <li key={w}><Alert tone="info">{w}</Alert></li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="services-heading">
        <h2 id="services-heading" className="mb-1 text-base font-semibold">Services</h2>
        <p className="mb-4 text-sm text-muted">Each test makes a real call with your real credentials. No secret is ever shown here.</p>
        <ul className="divide-y divide-line border-y border-line">
          <TestRow
            title="Email (SMTP)"
            status={`${yes(r.smtpConfigured)}${r.smtpConfigured ? `, sending as ${r.mailFrom}` : ''}`}
            action="Send test email"
            hint="Sends a message to your own address."
            run={() => api<SystemCheck>('/api/admin/system/test-email', { method: 'POST' })}
          />
          <TestRow
            title="AI speaking coach"
            status={`${yes(r.coachConfigured)}${r.coachConfigured ? `, model ${r.coachModel}` : ''}`}
            action="Test AI coach"
            hint="Sends one fixed sample sentence to the provider. No user text is used."
            run={() => api<SystemCheck>('/api/admin/system/test-coach', { method: 'POST' })}
          />
          <TestRow
            title="TURN relay"
            status={`${yes(r.turnConfigured)}${r.turnConfigured ? `, ${r.turnUrls.length} address(es)${r.forceRelay ? ', relay forced' : ''}` : ''}`}
            action="Test TURN"
            hint="Requests a relay address with the same time-limited credentials browsers receive, then releases it."
            run={() => api<SystemCheck>('/api/admin/system/test-turn', { method: 'POST' })}
          />
        </ul>
      </section>

      <section aria-labelledby="site-heading">
        <h2 id="site-heading" className="mb-3 text-base font-semibold">Site</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Public address</dt><dd className="truncate">{r.baseUrl}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">HTTPS</dt><dd>{r.https ? 'Yes' : 'No'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Secure sign-in cookie</dt><dd>{r.cookieSecure ? 'Yes' : 'No'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Allowed origins</dt><dd className="truncate">{r.corsOrigins.join(', ')}</dd></div>
        </dl>
      </section>
    </div>
  )
}

function TestRow({ title, status, action, hint, run }: { title: string; status: string; action: string; hint: string; run: () => Promise<SystemCheck> }) {
  const test = useMutation({ mutationFn: run })
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted">{status}</p>
        </div>
        <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>{action}</Button>
      </div>
      <p className="mt-1 text-xs text-subtle">{hint}</p>
      {test.data && <div className="mt-3"><Alert tone={test.data.ok ? 'success' : 'error'}>{test.data.detail}</Alert></div>}
      {test.isError && <div className="mt-3"><Alert>{test.error instanceof ApiError ? test.error.message : 'The test could not be run.'}</Alert></div>}
    </li>
  )
}
