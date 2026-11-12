import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real modules are never imported here: the loaders are replaced, so no screen's code runs and nothing is fetched.
import { lazyScreen, load, preloadRoute, prefetchAppScreens, prefetchAuthScreens } from './routes'

type Loader = (typeof load)[keyof typeof load]
const names = Object.keys(load) as (keyof typeof load)[]
const spies = {} as Record<keyof typeof load, ReturnType<typeof vi.fn>>

beforeEach(() => {
  for (const n of names) {
    spies[n] = vi.fn(async () => ({}))
    ;(load as Record<string, Loader>)[n] = spies[n] as unknown as Loader
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const requested = () => names.filter((n) => spies[n].mock.calls.length > 0)

describe('preloadRoute: the code for the page in the address bar is fetched at once', () => {
  it.each([
    ['/login', ['login']],
    ['/register', ['register']],
    ['/forgot-password', ['forgotPassword']],
    ['/reset-password', ['resetPassword']],
    ['/verify-email', ['verifyEmail']],
    ['/onboarding', ['onboarding']],
    ['/app/coach', ['coach']],
    ['/app/learn/vocabulary/levels/1', ['learn']],
    ['/app/friends', ['friends']],
    ['/app/friends/abc123', ['chat']],
    ['/app/progress', ['progress']],
    ['/app/settings', ['settings']],
  ])('%s fetches only %j', (path, expected) => {
    preloadRoute(path)
    expect(requested()).toEqual(expected)
  })

  it('fetches nothing for the home page, the dashboard or an unknown address (their code is in the main bundle or not needed)', () => {
    for (const path of ['/', '/app', '/app/talk', '/nowhere']) preloadRoute(path)
    expect(requested()).toEqual([])
  })

  it('survives a failed fetch: the screen asks again when it is rendered', async () => {
    spies.login.mockRejectedValueOnce(new Error('offline'))
    expect(() => preloadRoute('/login')).not.toThrow()
    await Promise.resolve()
  })
})

describe('lazyScreen: a screen whose code has arrived is rendered directly, without suspending', () => {
  const Page = () => <p>the page</p>

  it('shows the fallback while the code is on its way, then the screen', async () => {
    let arrive!: (m: Record<string, unknown>) => void
    spies.safety.mockReturnValue(new Promise((resolve) => { arrive = resolve }))
    const Safety = lazyScreen('safety', 'SafetyPage')
    render(<Suspense fallback={<p>loading</p>}><Safety /></Suspense>)
    expect(screen.getByText('loading')).toBeTruthy()
    await act(async () => { arrive({ SafetyPage: Page }) })
    expect(await screen.findByText('the page')).toBeTruthy()
  })

  it('does not suspend at all when the code was fetched earlier (no fallback, so no hold-back of the page)', async () => {
    spies.topics.mockResolvedValue({ TopicsPage: Page })
    preloadRoute('/app/topics') // a path whose screen is fetched ahead of rendering
    await act(async () => { await Promise.resolve() })
    const Topics = lazyScreen('topics', 'TopicsPage')
    const { container } = render(<Suspense fallback={<p>loading</p>}><Topics /></Suspense>)
    expect(container.textContent).toBe('the page') // on the very first render: not "loading", not empty
  })

  it('a screen rendered twice fetches its code once', async () => {
    spies.history.mockResolvedValue({ HistoryPage: Page })
    const History = lazyScreen('history', 'HistoryPage')
    const first = render(<Suspense fallback={<p>loading</p>}><History /></Suspense>)
    expect(await first.findByText('the page')).toBeTruthy()
    first.unmount()
    const second = render(<Suspense fallback={<p>loading</p>}><History /></Suspense>)
    expect(second.container.textContent).toBe('the page')
    expect(spies.history).toHaveBeenCalledTimes(1)
  })
})

describe('prefetching while idle', () => {
  it('does nothing when the browser asks to save data', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    prefetchAppScreens()
    prefetchAuthScreens()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requested()).toEqual([])
  })

  it('fetches the main tabs one at a time, after the page has had time to load its own data', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => setTimeout(fn, 0))
    let arrive!: () => void
    spies.learn.mockReturnValue(new Promise((resolve) => { arrive = () => resolve({}) })) // the first tab's code is slow to arrive
    prefetchAppScreens()
    expect(requested()).toEqual([]) // nothing at once: the page's own requests come first
    await vi.advanceTimersByTimeAsync(1400)
    expect(requested()).toEqual([]) // still waiting for the page to settle
    await vi.advanceTimersByTimeAsync(110)
    expect(requested()).toEqual(['learn'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requested()).toEqual(['learn']) // one at a time: nothing else is asked for while the first has not arrived
    await act(async () => { arrive() })
    await vi.advanceTimersByTimeAsync(100)
    expect([...requested()].sort()).toEqual(['coach', 'friends', 'learn', 'progress'])
    expect(spies.settings).not.toHaveBeenCalled() // rarely visited: left to load when opened
    prefetchAppScreens() // asking again does nothing
    await vi.advanceTimersByTimeAsync(5000)
    expect(spies.learn).toHaveBeenCalledTimes(1)
  })
})
