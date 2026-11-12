import { Phone } from 'lucide-react'
import { Suspense, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui/feedback'
import { Logo } from '../components/ui/Logo'
import { useAuth } from '../features/auth/AuthContext'
import { CallProvider, useCall } from '../features/call/CallContext'
import { RequestLayer } from '../features/partners/RequestLayer'
import { useFriends } from '../lib/queries'
import { useLiveUpdates } from '../lib/useLiveUpdates'
import { prefetchAppScreens } from '../routes'
import { ProfileMenu } from './ProfileMenu'
import { TopTabs } from './TopTabs'

export function AppLayout() {
  return (
    <CallProvider>
      <Shell />
    </CallProvider>
  )
}

function Shell() {
  const { logout, user } = useAuth()
  const call = useCall()
  const navigate = useNavigate()

  async function signOut() {
    call.reset()
    // Leave the protected area first: clearing the session while still inside it would bounce to /login.
    navigate('/', { replace: true })
    await logout()
  }

  useLiveUpdates()
  // Once the app is up, fetch the main screens while the browser is idle so opening one is instant.
  useEffect(() => prefetchAppScreens(), [])
  const friends = useFriends()
  // Something to act on: unread messages plus requests waiting for an answer.
  const friendsBadge = (friends.data?.friends.reduce((n, f) => n + f.unread, 0) ?? 0) + (friends.data?.incoming.length ?? 0)

  const { pathname } = useLocation()
  const onTalkPage = pathname.startsWith('/app/talk')
  const { ensureLink, phase } = call

  // Stay connected while signed in: that is how previous partners can reach you and how you see who is online.
  useEffect(() => {
    void ensureLink()
  }, [ensureLink])

  // A call that begins while you are on another page (a random match, or someone accepting your request) takes you to it.
  useEffect(() => {
    if ((phase === 'starting' || phase === 'connecting') && !onTalkPage) navigate('/app/talk')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const inCall = call.phase === 'connecting' || call.phase === 'connected' || call.phase === 'reconnecting' || call.phase === 'searching'

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-app flex-wrap items-center gap-x-8 px-2 sm:px-6 lg:h-14 lg:flex-nowrap">
          <div className="order-1 flex h-14 items-center pl-2 sm:pl-0 lg:h-auto">
            <Logo to="/app" />
          </div>
          <TopTabs badges={{ friends: friendsBadge }} />
          <ProfileMenu name={user?.displayName ?? 'Account'} isAdmin={user?.role === 'ADMIN'} onSignOut={signOut} />
        </div>
      </header>

      <RequestLayer />

      {inCall && !onTalkPage && (
        <Link to="/app/talk" className="block bg-accent text-white">
          <span className="mx-auto flex max-w-app items-center gap-2 px-4 py-2 text-sm font-medium sm:px-6">
            <Phone className="size-4" aria-hidden />
            {call.phase === 'searching' ? 'Still looking for a partner. Return to search' : `In a call with ${call.partner?.displayName}. Return to call`}
          </span>
        </Link>
      )}

      <main id="main" className="mx-auto w-full max-w-app flex-1 px-4 pt-8 pb-16 sm:px-6">
        {/*
          Its own boundary, outside the keyed element: while a screen's code loads, the header and tabs stay on screen instead of the whole
          app becoming a spinner, and a navigation keeps showing the old page until the new one is ready (a boundary that is re-created on
          every navigation would flash a spinner each time).
        */}
        <Suspense fallback={<Spinner />}>
          <div key={pathname} className="page-in">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  )
}
