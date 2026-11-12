import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, getAccessToken, setAccessToken, setSessionLostHandler } from './api'
import { formatClock, formatDuration } from './format'
import { errorResponse, mockApi, session } from '../test/utils'

afterEach(() => {
  setAccessToken(null)
  setSessionLostHandler(null)
  vi.unstubAllGlobals()
})

describe('format', () => {
  it('formats call clocks', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('formats durations for humans', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(45)).toBe('45 sec')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(5400)).toBe('1 h 30 min')
    expect(formatDuration(7200)).toBe('2 h')
  })
})

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    setAccessToken('tok')
    mockApi({ 'GET /api/me': { id: 'u1' } })
    expect(await api('/api/me')).toEqual({ id: 'u1' })
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('turns error bodies into ApiError with field details', async () => {
    mockApi({ 'POST /api/x': () => errorResponse(400, 'VALIDATION_FAILED', 'Some fields are invalid.', { email: 'bad' }) })
    await expect(api('/api/x', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { email: 'bad' },
    })
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('expired')
    let attempts = 0
    const mock = mockApi({
      'GET /api/stats/summary': () => (++attempts === 1 ? errorResponse(401, 'UNAUTHENTICATED', 'no') : { totalSeconds: 5 }),
      'POST /api/auth/refresh': session(),
    })
    expect(await api('/api/stats/summary')).toEqual({ totalSeconds: 5 })
    expect(mock.calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
    expect(getAccessToken()).toBe('access-token')
  })

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('expired')
    const seen = new Set<string>()
    const mock = mockApi({
      'GET /api/a': () => (seen.has('a') ? { ok: 'a' } : (seen.add('a'), errorResponse(401, 'UNAUTHENTICATED', 'no'))),
      'GET /api/b': () => (seen.has('b') ? { ok: 'b' } : (seen.add('b'), errorResponse(401, 'UNAUTHENTICATED', 'no'))),
      'POST /api/auth/refresh': session(),
    })
    const [a, b] = await Promise.all([api('/api/a'), api('/api/b')])
    expect([a, b]).toEqual([{ ok: 'a' }, { ok: 'b' }])
    expect(mock.calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('reports a lost session when the refresh fails', async () => {
    setAccessToken('expired')
    const lost = vi.fn()
    setSessionLostHandler(lost)
    mockApi({
      'GET /api/me': () => errorResponse(401, 'UNAUTHENTICATED', 'no'),
      'POST /api/auth/refresh': () => errorResponse(401, 'UNAUTHENTICATED', 'no'),
    })
    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError)
    expect(lost).toHaveBeenCalledOnce()
    expect(getAccessToken()).toBeNull()
  })

  it('never retries unauthenticated endpoints with a refresh', async () => {
    const mock = mockApi({ 'POST /api/auth/login': () => errorResponse(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.') })
    await expect(api('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(mock.calls).toHaveLength(1)
  })

  it('handles 204 responses', async () => {
    mockApi({ 'POST /api/auth/logout': undefined })
    expect(await api('/api/auth/logout', { method: 'POST', auth: false })).toBeUndefined()
  })
})
