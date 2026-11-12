import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, getAccessToken, setAccessToken, setSessionLostHandler } from './api'

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let lost: ReturnType<typeof vi.fn>

beforeEach(() => { lost = vi.fn(); setSessionLostHandler(lost as () => void); setAccessToken('old-token') })
afterEach(() => { setSessionLostHandler(null); setAccessToken(null); vi.restoreAllMocks() })

function mockFetch(refresh: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/auth/refresh') return refresh()
    return json(401, { code: 'UNAUTHENTICATED', message: 'Please sign in again.' })
  })
}

describe('a failed session refresh', () => {
  it('signs the person out only when the server rejects the session (401)', async () => {
    mockFetch(() => json(401))
    await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
    expect(lost).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('does not sign anyone out when the server has a hiccup (503) or the network fails', async () => {
    mockFetch(() => json(503, { code: 'X', message: 'down' }))
    await expect(api('/api/me')).rejects.toBeInstanceOf(Error)
    expect(lost).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('old-token')

    mockFetch(() => { throw new TypeError('Failed to fetch') })
    await expect(api('/api/me')).rejects.toBeInstanceOf(Error)
    expect(lost).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('old-token')
  })

  it('a network failure after an earlier rejection is not mistaken for a rejection', async () => {
    mockFetch(() => json(401))
    await expect(api('/api/me')).rejects.toBeInstanceOf(Error)
    expect(lost).toHaveBeenCalledTimes(1)
    mockFetch(() => { throw new TypeError('Failed to fetch') })
    await expect(api('/api/me')).rejects.toBeInstanceOf(Error)
    expect(lost).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh between simultaneous requests', async () => {
    const spy = mockFetch(() => json(200, { accessToken: 'new', user: {} }))
    spy.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'new', user: {} })
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401)
    })
    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')])
    expect(spy.mock.calls.filter((c) => String(c[0]) === '/api/auth/refresh')).toHaveLength(1)
    expect(lost).not.toHaveBeenCalled()
  })
})
