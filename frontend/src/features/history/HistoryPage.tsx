import { useState } from 'react'
import { Button, LinkButton } from '../../components/ui/Button'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { PageHeader } from '../../components/ui/Layout'
import { useHistory } from '../../lib/queries'
import { CallList } from './CallList'

export function HistoryPage() {
  const [page, setPage] = useState(0)
  const history = useHistory(page, 15)

  return (
    <>
      <PageHeader title="Call history" description="Your previous conversations. Only your partner’s display name is shown." />
      {history.isLoading ? (
        <Spinner label="Loading your calls" />
      ) : history.isError ? (
        <ErrorState onRetry={() => history.refetch()} />
      ) : history.data && history.data.items.length > 0 ? (
        <>
          <CallList calls={history.data.items} />
          {history.data.totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted">Page {page + 1} of {history.data.totalPages}</span>
              <Button variant="secondary" disabled={page + 1 >= history.data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </nav>
          )}
        </>
      ) : (
        <EmptyState
          title="No conversations yet"
          description="Once you finish a call it will appear here, along with its duration and feedback status."
          action={<LinkButton to="/app/talk">Find a partner</LinkButton>}
        />
      )}
    </>
  )
}
