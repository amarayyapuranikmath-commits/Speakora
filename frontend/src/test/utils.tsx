import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../features/auth/AuthContext'
import type { SessionResponse, UserSummary } from '../lib/types'

type Handler = unknown | ((req: { method: string; body: any; url: string }) => unknown | Response)

export interface FetchMock {
  calls: { method: string; url: string; body: any }[]
}

/** Installs a fetch mock keyed by "METHOD /path". Unhandled requests fail loudly so tests never pass by accident. */
export function mockApi(routes: Record<string, Handler>): FetchMock {
  const record: FetchMock = { calls: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      record.calls.push({ method, url, body })
      const path = url.split('?')[0]
      const key = `${method} ${url}` in routes ? `${method} ${url}` : `${method} ${path}`
      const handler = routes[key]
      if (!(key in routes)) {
        return new Response(JSON.stringify({ code: 'NOT_MOCKED', message: `No mock for ${method} ${url}` }), { status: 599 })
      }
      const result = await (typeof handler === 'function' ? (handler as (r: unknown) => unknown)({ method, body, url }) : handler) // a handler may be async (a slow server)
      if (result instanceof Response) return result
      return new Response(result === undefined ? null : JSON.stringify(result), {
        status: result === undefined ? 204 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return record
}

export function errorResponse(status: number, code: string, message: string, details: Record<string, string> = {}) {
  return new Response(JSON.stringify({ code, message, details }), { status, headers: { 'Content-Type': 'application/json' } })
}

export const testUser: UserSummary = { id: 'u1', email: 'ana@example.com', emailVerified: true, displayName: 'Ana', onboardingCompleted: true, role: 'USER' }

export function session(user: Partial<UserSummary> = {}): SessionResponse {
  return { accessToken: 'access-token', expiresInSeconds: 900, user: { ...testUser, ...user } }
}

export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
