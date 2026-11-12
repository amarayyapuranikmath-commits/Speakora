import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Last-resort fallback so an unexpected rendering error never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-muted">The page hit an unexpected problem. Reloading usually fixes it. If you were in a call, your partner may need to be reconnected.</p>
        <a href="/" className="mt-6 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">
          Reload
        </a>
      </div>
    )
  }
}
