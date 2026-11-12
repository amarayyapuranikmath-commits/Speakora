import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { TextAreaField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/feedback'
import { ApiError, api } from '../../lib/api'

export function FeedbackForm({ callId, onDone }: { callId: string; onDone?: () => void }) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(0)
  const [respectful, setRespectful] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = useMutation({
    mutationFn: () =>
      api(`/api/calls/${callId}/feedback`, {
        method: 'POST',
        body: { rating, partnerWasRespectful: respectful, comment: comment.trim() || null },
      }),
    onSuccess: () => {
      setSubmitted(true)
      void queryClient.invalidateQueries({ queryKey: ['calls'] })
      onDone?.()
    },
    onError: (e) => {
      // A duplicate means feedback is already saved, which is the state the user wants.
      if (e instanceof ApiError && e.code === 'FEEDBACK_EXISTS') setSubmitted(true)
    },
  })

  if (submitted) return <Alert tone="success">Thanks. Your feedback has been saved.</Alert>

  const errorMessage = submit.error instanceof ApiError && submit.error.code !== 'FEEDBACK_EXISTS' ? submit.error.message : submit.isError ? 'We could not save your feedback.' : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (rating > 0) submit.mutate()
      }}
      className="space-y-5"
    >
      {errorMessage && <Alert>{errorMessage}</Alert>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How was the conversation?</legend>
        <div role="radiogroup" aria-label="Rating" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} out of 5`}
              onClick={() => setRating(n)}
              className="rounded-control p-1.5 text-line-strong hover:text-amber-500"
            >
              <Star className={`size-7 ${n <= rating ? 'fill-amber-400 text-amber-500' : ''}`} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Was your partner respectful?</legend>
        <div className="flex gap-2">
          {[
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={respectful === o.value}
              onClick={() => setRespectful(respectful === o.value ? null : o.value)}
              className={`h-9 rounded-control border px-4 text-sm ${respectful === o.value ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-strong text-muted hover:text-ink'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <TextAreaField label="Comments (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Anything that would help us improve matching?" />
      <Button type="submit" disabled={rating === 0} loading={submit.isPending}>
        Submit feedback
      </Button>
    </form>
  )
}
