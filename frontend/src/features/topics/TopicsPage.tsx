import { ChevronDown } from 'lucide-react'
import { LinkButton } from '../../components/ui/Button'
import { ErrorState, Spinner } from '../../components/ui/feedback'
import { PageHeader } from '../../components/ui/Layout'
import { useTopics } from '../../lib/queries'

export function TopicsPage() {
  const topics = useTopics()
  return (
    <>
      <PageHeader title="Conversation topics" description="Pick a topic to practise. Each one comes with prompts you can open during a call if you get stuck." />
      {topics.isLoading ? (
        <Spinner label="Loading topics" />
      ) : topics.isError || !topics.data ? (
        <ErrorState onRetry={() => topics.refetch()} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {topics.data.map((t) => (
            <li key={t.slug} className="flex flex-col rounded-panel border border-line bg-surface p-5">
              <h2 className="font-semibold">{t.name}</h2>
              {t.description && <p className="mt-1 text-sm text-muted">{t.description}</p>}
              <details className="group mt-4 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-accent">
                  Sample prompts
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="mt-3 space-y-2 text-muted">
                  {t.prompts.map((p) => (
                    <li key={p} className="border-l-2 border-line pl-3">{p}</li>
                  ))}
                </ul>
              </details>
              <div className="mt-5 flex-1 content-end">
                <LinkButton to={`/app/talk?topic=${encodeURIComponent(t.slug)}`} variant="secondary">Practise this topic</LinkButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
