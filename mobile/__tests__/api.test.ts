const store: { token: string | null } = { token: null }

jest.mock('../src/lib/storage', () => ({
  getRefreshToken: jest.fn(async () => store.token),
  saveRefreshToken: jest.fn(async (t: string) => { store.token = t }),
  clearRefreshToken: jest.fn(async () => { store.token = null }),
  loadServerUrl: jest.fn(async () => null),
  saveServerUrl: jest.fn(async () => undefined),
}))

import { ApiError, REQUEST_TIMEOUT_MS, api, getAccessToken, refreshSession, setAccessToken, setBaseUrl, setSessionLostHandler } from '../src/lib/api'

const session = (token: string, refresh = 'refresh-2') => ({ accessToken: token, expiresInSeconds: 900, refreshToken: refresh, user: { id: '1', email: 'a@b.co', emailVerified: true, displayName: 'A', onboardingCompleted: true, role: 'USER' } })
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })

let calls: { url: string; init: RequestInit }[] = []
function mockFetch(...responses: (Response | Error)[]) {
  calls = []
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request ' + url)
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
}

beforeEach(() => {
  store.token = null
  setAccessToken(null)
  setBaseUrl('http://server.test/')
  setSessionLostHandler(null)
})

describe('api client', () => {
  it('marks every request as coming from the mobile app and sends the bearer token', async () => {
    setAccessToken('access-1')
    mockFetch(json(200, { ok: true }))
    await expect(api('/api/profile')).resolves.toEqual({ ok: true })
    expect(calls[0].url).toBe('http://server.test/api/profile')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['X-Client-Type']).toBe('mobile')
    expect(headers.Authorization).toBe('Bearer access-1')
  })

  it('does not attach a token to unauthenticated calls and sends JSON bodies', async () => {
    setAccessToken('access-1')
    mockFetch(json(200, session('x')))
    await api('/api/auth/login', { method: 'POST', body: { email: 'a@b.co' }, auth: false })
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
    expect(calls[0].init.body).toBe('{"email":"a@b.co"}')
  })

  it('turns server error bodies into ApiError with code and field details', async () => {
    mockFetch(json(400, { code: 'VALIDATION', message: 'Check the form.', details: { email: 'Invalid' } }))
    const err = await api('/api/x', { method: 'POST', body: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION', message: 'Check the form.', details: { email: 'Invalid' } })
  })

  it('reports an unreachable server as a NETWORK error, not a crash', async () => {
    mockFetch(new TypeError('Network request failed'))
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 })
  })

  it('returns undefined for 204 responses', async () => {
    setAccessToken('t')
    mockFetch(json(204))
    await expect(api('/api/blocks/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('refreshes once on 401, stores the rotated refresh token and retries the request', async () => {
    store.token = 'refresh-1'
    setAccessToken('expired')
    mockFetch(json(401, { code: 'UNAUTHORIZED', message: 'x' }), json(200, session('fresh', 'refresh-2')), json(200, { name: 'Ada' }))
    await expect(api('/api/profile')).resolves.toEqual({ name: 'Ada' })
    expect(calls[1].url).toContain('/api/auth/refresh')
    expect((calls[1].init.headers as Record<string, string>)['X-Refresh-Token']).toBe('refresh-1')
    expect((calls[2].init.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
    expect(store.token).toBe('refresh-2')
  })

  it('signs the user out and discards the dead refresh token when the server rejects it', async () => {
    store.token = 'revoked'
    setAccessToken('expired')
    const lost = jest.fn()
    setSessionLostHandler(lost)
    mockFetch(json(401, { code: 'UNAUTHORIZED', message: 'Session expired.' }), json(401, { code: 'UNAUTHORIZED', message: 'x' }))
    await expect(api('/api/profile')).rejects.toMatchObject({ status: 401 })
    expect(lost).toHaveBeenCalledTimes(1)
    expect(store.token).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('keeps the refresh token when the server is merely having trouble (5xx) or offline', async () => {
    store.token = 'refresh-1'
    mockFetch(json(503))
    expect(await refreshSession()).toBeNull()
    expect(store.token).toBe('refresh-1')
    mockFetch(new TypeError('offline'))
    expect(await refreshSession()).toBeNull()
    expect(store.token).toBe('refresh-1')
  })

  it('shares a single refresh request between concurrent callers', async () => {
    store.token = 'refresh-1'
    mockFetch(json(200, session('fresh')))
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
  })

  it('does not call refresh at all when there is no stored token', async () => {
    mockFetch()
    expect(await refreshSession()).toBeNull()
    expect(calls).toHaveLength(0)
  })
})


describe('requests that never get an answer', () => {
  afterEach(() => jest.useRealTimers())

  /** A server that accepts the connection and then says nothing, like a dropped hotspot. It only ends when the client aborts. */
  function silentServer() {
    globalThis.fetch = jest.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
  }

  it('gives up after the timeout with a clear network error instead of loading for ever', async () => {
    jest.useFakeTimers()
    silentServer()
    const pending = api('/api/profile').catch((e) => e)
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 100)
    const error = await pending
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK' })
    expect(error.message).toMatch(/could not reach the server/i)
  })

  it('a silent server during the session refresh ends it as "offline" and keeps the stored token', async () => {
    jest.useFakeTimers()
    store.token = 'refresh-1'
    silentServer()
    const pending = refreshSession()
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 100)
    await expect(pending).resolves.toBeNull()
    expect(store.token).toBe('refresh-1') // not revoked: it can be used again when the network is back
  })
})
