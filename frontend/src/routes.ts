import { createElement, lazy, type ComponentType } from 'react'

// The code-split screens, in one place, so a screen's code can be fetched BEFORE it is rendered.
// An `import()` is cached by the browser, so fetching early costs nothing when the screen is rendered later. React.lazy alone would
// still suspend once on its first render, even with the code already in memory, and React holds a shown fallback for ~300 ms before
// revealing the page. lazyScreen below skips that: once a screen's code has arrived it renders the component directly.

export const load = {
  safety: () => import('./features/landing/SafetyPage'),
  onboarding: () => import('./features/onboarding/OnboardingPage'),
  login: () => import('./features/auth/LoginPage'),
  register: () => import('./features/auth/RegisterPage'),
  forgotPassword: () => import('./features/auth/ForgotPasswordPage'),
  resetPassword: () => import('./features/auth/ResetPasswordPage'),
  verifyEmail: () => import('./features/auth/VerifyEmailPage'),
  topics: () => import('./features/topics/TopicsPage'),
  coach: () => import('./features/coach/CoachPage'),
  history: () => import('./features/history/HistoryPage'),
  progress: () => import('./features/progress/ProgressPage'),
  settings: () => import('./features/settings/SettingsPage'),
  admin: () => import('./features/admin/AdminPage'),
  partners: () => import('./features/partners/PartnersPage'),
  learn: () => import('./features/learn/LearnPages'),
  friends: () => import('./features/friends/FriendsPage'),
  chat: () => import('./features/friends/ChatPage'),
}

type Screen = keyof typeof load
type Loaded<S extends Screen> = Awaited<ReturnType<(typeof load)[S]>>

const arrived: Partial<Record<Screen, Record<string, unknown>>> = {}
const fetchScreen = (screen: Screen) => load[screen]().then((module) => (arrived[screen] = module as Record<string, unknown>))

/** A screen that is fetched when first needed (or earlier, see preloadRoute and prefetchAppScreens) and never suspends once fetched. */
export function lazyScreen<S extends Screen>(screen: S, name: keyof Loaded<S> & string): ComponentType {
  const Lazy = lazy(() => fetchScreen(screen).then((module) => ({ default: module[name] as ComponentType })))
  return function LazyScreen() {
    return createElement((arrived[screen]?.[name] as ComponentType | undefined) ?? Lazy)
  }
}

const forPath: [RegExp, Screen[]][] = [
  [/^\/login/, ['login']],
  [/^\/register/, ['register']],
  [/^\/forgot-password/, ['forgotPassword']],
  [/^\/reset-password/, ['resetPassword']],
  [/^\/verify-email/, ['verifyEmail']],
  [/^\/onboarding/, ['onboarding']],
  [/^\/safety/, ['safety']],
  [/^\/app\/friends\/[^/]+/, ['chat']],
  [/^\/app\/friends/, ['friends']],
  [/^\/app\/topics/, ['topics']],
  [/^\/app\/coach/, ['coach']],
  [/^\/app\/history/, ['history']],
  [/^\/app\/progress/, ['progress']],
  [/^\/app\/settings/, ['settings']],
  [/^\/app\/admin/, ['admin']],
  [/^\/app\/partners/, ['partners']],
  [/^\/app\/learn/, ['learn']],
]

const fetchScreens = (screens: Screen[]) => screens.forEach((s) => void fetchScreen(s).catch(() => {})) // a failed preload is retried when the screen is rendered

/** Starts fetching the screen the address bar points at, before the app has finished starting (called once from main.tsx). */
export function preloadRoute(pathname: string): void {
  for (const [pattern, screens] of forPath) {
    if (pattern.test(pathname)) {
      fetchScreens(screens)
      return
    }
  }
}

const idle = (fn: () => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 4000 })
  else setTimeout(fn, 1500)
}

/** Unless the person asked their browser to save data, fetch the main screens once the browser is idle so opening one is instant. */
function mayPrefetch(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !c?.saveData && !/^(slow-2g|2g)$/.test(c?.effectiveType ?? '')
}

/** The screens behind the main tabs: the ones a signed-in person is most likely to open next. The rest are rarely visited and load on demand. */
const MAIN_TABS: Screen[] = ['learn', 'coach', 'friends', 'progress']

/**
 * Signed in and settled on a screen: warm the other main tabs so opening one is instant. Gentle on purpose: it waits until the page has
 * finished loading its own data, then fetches one tab at a time while the browser is idle, so it never competes with what the person
 * is doing (on a slow connection a burst of prefetches made a click on a tab slower, not faster). Safe to call more than once.
 */
let appScreensRequested = false
export function prefetchAppScreens(): void {
  if (appScreensRequested || !mayPrefetch()) return
  appScreensRequested = true
  const next = (i: number) => {
    if (i >= MAIN_TABS.length) return
    fetchScreen(MAIN_TABS[i])
      .catch(() => {})
      .finally(() => idle(() => next(i + 1)))
  }
  const start = () => setTimeout(() => idle(() => next(0)), 1500)
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/** The sign-in and sign-up screens, for someone reading the landing page (the likely next click). */
export function prefetchAuthScreens(): void {
  if (!mayPrefetch()) return
  idle(() => fetchScreens(['login', 'register']))
}
