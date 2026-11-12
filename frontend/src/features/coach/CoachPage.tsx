import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { PageHeader } from '../../components/ui/Layout'
import { api } from '../../lib/api'
import { usePreferenceUpdates } from '../../lib/usePreferenceUpdates'
import { TutorChat } from './TutorChat'
import type { CoachStatus } from '../../lib/types'

export function CoachPage() {
  const status = useQuery({ queryKey: ['coach', 'status'], queryFn: () => api<CoachStatus>('/api/coach/status') })
  if (status.isLoading) return <Spinner />
  if (status.isError || !status.data) return <ErrorState onRetry={() => status.refetch()} />

  return (
    <div className="mx-auto max-w-2xl">
      {status.data.available && status.data.consent ? (
        <h1 className="sr-only">AI Coach</h1>
      ) : (
        <PageHeader title="AI Coach" description="Talk to an English coach by voice or text." />
      )}
      {!status.data.available ? (
        <EmptyState title="The coach is not enabled" description="This server has no AI provider configured yet. Everything else works as normal." />
      ) : !status.data.consent ? (
        <Consent />
      ) : (
        <TutorChat />
      )}
    </div>
  )
}

function Consent() {
  const { prefs, mutation, change } = usePreferenceUpdates()
  const queryClient = useQueryClient()
  // Refresh the coach status only once the choice has really been saved; refreshing earlier would still see "no consent".
  useEffect(() => {
    if (mutation.isSuccess) void queryClient.invalidateQueries({ queryKey: ['coach'] })
  }, [mutation.isSuccess, queryClient])
  return (
    <div className="max-w-xl space-y-5">
      <h2 className="text-lg font-semibold">Before you start</h2>
      <ul className="list-disc space-y-2 pl-5 text-muted">
        <li>Your conversation is <strong className="font-semibold text-ink">not saved</strong>. It is kept only in this page while you talk, and it is gone when you end the session or leave the page. There is no history and no transcript or recording is stored.</li>
        <li>To write replies, the text of your conversation (typed, or recognised from your voice by your browser) is sent to an AI provider. The provider processes it to answer you; this app does not keep it.</li>
        <li>If you use voice input, your browser turns your speech into text and may send the audio to its own provider. The coach never hears your calls or your voice, and your calls are never recorded or analysed.</li>
        <li>Your learning progress, settings and account are kept as normal. You can turn the coach off at any time in Settings.</li>
      </ul>
      {mutation.isError && <Alert>That could not be saved. Please try again.</Alert>}
      <Button
        loading={mutation.isPending}
        disabled={!prefs.data}
        onClick={() => change({ aiCoachConsent: true })}
      >
        I agree, turn on the coach
      </Button>
      <p className="text-sm text-subtle">
        See <Link to="/safety" className="font-medium text-accent hover:underline">safety and privacy</Link>.
      </p>
    </div>
  )
}
