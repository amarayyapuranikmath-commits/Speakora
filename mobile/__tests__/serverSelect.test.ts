import { chooseServer, isReachable } from '../src/lib/serverSelect'

const LAN = 'http://10.45.222.233:8080' // a saved hotspot address that is no longer valid
const TUNNEL = 'http://localhost:8080' // the built-in default, reached through `adb reverse`

const answering = (...urls: string[]) => jest.fn(async (u: string) => urls.includes(u))

describe('chooseServer', () => {
  it('uses the built-in default when the saved address has gone stale (the hotspot IP changed)', async () => {
    expect(await chooseServer(LAN, TUNNEL, answering(TUNNEL))).toBe(TUNNEL)
  })

  it('keeps the saved address while it still answers', async () => {
    expect(await chooseServer(LAN, TUNNEL, answering(LAN, TUNNEL))).toBe(LAN)
    expect(await chooseServer(LAN, TUNNEL, answering(LAN))).toBe(LAN)
  })

  it('uses the default when nothing was saved, without probing the same address twice', async () => {
    const probe = answering(TUNNEL)
    expect(await chooseServer(null, TUNNEL, probe)).toBe(TUNNEL)
    expect(await chooseServer(TUNNEL, TUNNEL, probe)).toBe(TUNNEL)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('keeps the developer\'s saved choice when the backend is down, so nothing is silently replaced', async () => {
    expect(await chooseServer(LAN, TUNNEL, answering())).toBe(LAN)
    expect(await chooseServer(null, TUNNEL, answering())).toBe(TUNNEL)
  })

  it('ignores a blank saved value and trailing slashes', async () => {
    expect(await chooseServer('  ', 'http://localhost:8080/', answering(TUNNEL))).toBe(TUNNEL)
  })

  it('probes the addresses at the same time, so the wait is one timeout and not two', async () => {
    const started: string[] = []
    const probe = jest.fn((u: string) => { started.push(u); return new Promise<boolean>((r) => setTimeout(() => r(u === TUNNEL), 10)) })
    await chooseServer(LAN, TUNNEL, probe)
    expect(started).toEqual([LAN, TUNNEL])
  })
})

describe('isReachable', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('is true when the health endpoint answers OK, and asks the health endpoint of that address', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true }))
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    expect(await isReachable('http://localhost:8080/')).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:8080/actuator/health')
  })

  it('is false on a refused or failed connection, and when the server answers with an error', async () => {
    ;(globalThis as { fetch: unknown }).fetch = jest.fn(async () => { throw new Error('Network request failed') })
    expect(await isReachable(LAN)).toBe(false)
    ;(globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false }))
    expect(await isReachable(LAN)).toBe(false)
  })

  it('gives up when nothing answers within the timeout', async () => {
    ;(globalThis as { fetch: unknown }).fetch = jest.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    expect(await isReachable(LAN, 20)).toBe(false)
  })
})
