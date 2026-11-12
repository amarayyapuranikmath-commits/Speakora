import type { SessionResponse } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, string>

  constructor(status: number, code: string, message: string, details: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// The access token lives only in memory; the refresh token is an httpOnly cookie the browser manages.
let accessToken: string | null = null
let onSessionLost: (() => void) | null = null
let refreshing: Promise<SessionResponse | null> | null = null
/** True only when the server answered the last refresh with a rejection (the session is really over), not when the network or the server failed. */
let lastRefreshRejected = false

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

/** After a refresh returned null: true if the server rejected the session (sign the person out), false if it was only a network or server failure. */
export const sessionWasRejected = () => lastRefreshRejected

export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Set false for endpoints that must not carry (or retry with) a bearer token. */
  auth?: boolean
  signal?: AbortSignal
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json()
    return new ApiError(res.status, data.code ?? 'UNKNOWN', data.message ?? 'Something went wrong.', data.details ?? {})
  } catch {
    return new ApiError(res.status, 'UNKNOWN', 'Something went wrong. Please try again.')
  }
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. Resolves to null when it could not (see sessionWasRejected). */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          // 400/401/403: the refresh cookie is missing, expired or revoked: the session is over. Anything else (a 5xx, a gateway error, 429)
          // is a hiccup: keep the access token and the signed-in state and let the next request try again.
          lastRefreshRejected = res.status === 400 || res.status === 401 || res.status === 403
          if (lastRefreshRejected) setAccessToken(null)
          return null
        }
        lastRefreshRejected = false
        const session = (await res.json()) as SessionResponse
        setAccessToken(session.accessToken)
        return session
      } catch {
        lastRefreshRejected = false // the network failed: that says nothing about the session
        return null
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'include',
    signal: opts.signal,
  })
}

/**
 * Like {@link api} but hands back the response itself (for streamed replies). It signs the request, refreshes the session once on a
 * 401 and turns a failed status into an ApiError; reading the body is up to the caller.
 */
export async function apiRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
  let res = await send(path, opts)
  if (res.status === 401 && opts.auth !== false) {
    const session = await refreshSession()
    if (!session) {
      if (lastRefreshRejected) onSessionLost?.() // a network or server failure must not sign anyone out
      throw await toError(res)
    }
    res = await send(path, opts)
  }
  if (!res.ok) throw await toError(res)
  return res
}

export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts)
  if (res.status === 401 && opts.auth !== false) {
    const session = await refreshSession()
    if (!session) {
      if (lastRefreshRejected) onSessionLost?.() // a network or server failure must not sign anyone out
      throw await toError(res)
    }
    res = await send(path, opts)
  }
  if (!res.ok) throw await toError(res)
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
