import { Link, Outlet } from 'react-router-dom'
import { LinkButton } from '../components/ui/Button'
import { Logo } from '../components/ui/Logo'
import { brand } from '../config/brand'
import { useAuth } from '../features/auth/AuthContext'

export function PublicLayout() {
  const { status } = useAuth()
  const signedIn = status === 'authenticated'
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="/#how-it-works" className="hidden rounded-control px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">How it works</a>
            <a href="/#features" className="hidden rounded-control px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">Features</a>
            <Link to="/safety" className="hidden rounded-control px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">Safety</Link>
            {signedIn ? (
              <LinkButton to="/app">Open app</LinkButton>
            ) : (
              <>
                <Link to="/login" className="rounded-control px-3 py-2 text-sm font-medium text-muted hover:text-ink">Log in</Link>
                <LinkButton to="/register">Get started</LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-muted">{brand.tagline}</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <Link to="/safety" className="hover:text-ink">Safety and privacy</Link>
            <Link to="/login" className="hover:text-ink">Log in</Link>
            <Link to="/register" className="hover:text-ink">Create account</Link>
            {brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="hover:text-ink">Contact</a>}
          </nav>
        </div>
        <div className="border-t border-line px-5 py-4 text-center text-xs text-subtle">
          © {brand.name}. For adults aged 18 and over.
        </div>
      </footer>
    </div>
  )
}
