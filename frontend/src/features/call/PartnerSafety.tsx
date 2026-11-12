import { useMutation } from '@tanstack/react-query'
import { Ban, Flag } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { SelectField, TextAreaField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'
import type { ReportReason } from '../../lib/types'

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harassment or bullying' },
  { value: 'HATE_OR_ABUSE', label: 'Hate speech or abuse' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual or inappropriate content' },
  { value: 'SPAM_OR_SCAM', label: 'Spam or scam' },
  { value: 'UNDERAGE', label: 'Appears to be under 18' },
  { value: 'OTHER', label: 'Something else' },
]

/**
 * Block and report someone. A previous partner is identified through a call you shared; a friend through their friend handle
 * (pass {@code friendRef}). Never by account id.
 */
export function PartnerSafety({ callId, friendRef, partnerName, onDone }: { callId?: string; friendRef?: string; partnerName: string; onDone?: () => void }) {
  const base = friendRef ? `/api/friends/${encodeURIComponent(friendRef)}` : `/api/calls/${callId}`
  const blockPath = friendRef ? `${base}/block` : `${base}/block-partner`
  const [mode, setMode] = useState<'none' | 'report'>('none')
  const [reason, setReason] = useState<ReportReason>('HARASSMENT')
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [done, setDone] = useState<string | null>(null)

  const block = useMutation({
    mutationFn: () => api(blockPath, { method: 'POST' }),
    onSuccess: () => {
      setDone(`${partnerName} is blocked. You will not be matched or connected again.`)
      onDone?.()
    },
  })
  const report = useMutation({
    mutationFn: () => api(`${base}/report`, { method: 'POST', body: { reason, details: details.trim() || null, alsoBlock } }),
    onSuccess: () => {
      setDone(alsoBlock ? 'Report sent and partner blocked. Thank you for keeping the community safe.' : 'Report sent. Thank you for keeping the community safe.')
      setMode('none')
      if (alsoBlock) onDone?.()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REPORT_EXISTS') {
        setDone(friendRef ? 'You have already reported this person.' : 'You have already reported this call.')
        setMode('none')
      }
    },
  })

  if (done) return <Alert tone="success">{done}</Alert>

  return (
    <div>
      {(block.isError || report.isError) && !(report.error instanceof ApiError && report.error.code === 'REPORT_EXISTS') && (
        <div className="mb-3"><Alert>That did not go through. Please try again.</Alert></div>
      )}
      {mode === 'none' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => block.mutate()} loading={block.isPending}>
            <Ban className="size-4" aria-hidden /> Block {partnerName}
          </Button>
          <Button variant="secondary" onClick={() => setMode('report')}>
            <Flag className="size-4" aria-hidden /> Report
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            report.mutate()
          }}
        >
          <SelectField label="What happened?" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </SelectField>
          <TextAreaField label="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-4 accent-accent" />
            Also block {partnerName}
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={report.isPending}>Send report</Button>
            <Button variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
