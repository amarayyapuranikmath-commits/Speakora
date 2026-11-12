import { DEFAULT_API_URL } from '../config'
import { clearRefreshToken, getRefreshToken, saveRefreshToken } from './storage'
import type { UserSummary } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, string>
  /** Seconds the server asked us to wait (Retry-After), or 0. */
  readonly retryAfter: number

  constructor(status: number, code: string, message: string, details: Record<string, string> = {}, retryAfter = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

interface MobileSession {
  accessToken: string
  expiresInSeconds: number
  user: UserSummary
  refreshToken: string
}

// The access token lives only in memory. The refresh token lives in the Android Keystore (see storage.ts).
let baseUrl = DEFAULT_API_URL
let accessToken: string | null = null
let onSessionLost: (() => void) | null = null
let refreshing: Promise<MobileSession | null> | null = null

export const getBaseUrl = () => baseUrl
export const setBaseUrl = (url: string) => {
  baseUrl = url.replace(/\/$/, '')
}
export const getAccessToken = () => accessToken
export const setAccessToken = (t: string | null) => {
  accessToken = t
}
export const setSessionLostHandler = (h: (() => void) | null) => {
  onSessionLost = h
}

const CLIENT_HEADERS = { 'X-Client-Type': 'mobile' }

/**
 * React Native waits forever for a connection that never answers (for example when the phone and the server are on different
 * networks, or a hotspot drops), which would leave a screen loading for ever. Every request therefore gives up after this long and
 * becomes a clear "could not reach the server" error with a retry.
 */
export const REQUEST_TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit, ms = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json()
    const wait = Math.ceil(Number(res.headers?.get?.('retry-after')) || 0)
    return new ApiError(res.status, data.code ?? 'UNKNOWN', data.message ?? 'Something went wrong.', data.details ?? {}, wait)
  } catch {
    return new ApiError(res.status, 'UNKNOWN', 'Something went wrong. Please try again.')
  }
}

/** Stores a freshly issued session: the refresh token to the Keystore, the access token in memory. */
export async function storeSession(session: MobileSession) {
  setAccessToken(session.accessToken)
  await saveRefreshToken(session.refreshToken)
}

/** Exchanges the stored refresh token for a new session. Concurrent callers share one request. */
export function refreshSession(): Promise<MobileSession | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const token = await getRefreshToken()
        if (!token) return null
        const res = await fetchWithTimeout(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers: { ...CLIENT_HEADERS, 'X-Refresh-Token': token } })
        if (res.status === 401 || res.status === 403) {
          setAccessToken(null)
          await clearRefreshToken() // the server revoked it: never replay a dead token
          return null
        }
        if (!res.ok) return null // server trouble: keep the token and try again later
        const session = (await res.json()) as MobileSession
        await storeSession(session)
        return session
      } catch {
        return null // offline
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADERS }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`
  try {
    return await fetchWithTimeout(`${baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.')
  }
}

export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts)
  if (res.status === 401 && opts.auth !== false) {
    const session = await refreshSession()
    if (!session) {
      onSessionLost?.()
      throw await toError(res)
    }
    res = await send(path, opts)
  }
  if (!res.ok) throw await toError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
