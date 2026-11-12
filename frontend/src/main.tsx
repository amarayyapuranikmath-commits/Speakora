import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ApiError } from './lib/api'
import { AuthProvider } from './features/auth/AuthContext'
import { prefetchAuthScreens, preloadRoute } from './routes'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Retrying a 4xx never helps; transient network/5xx errors get one retry.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
})

// Fetch the screen the address bar points at now, not after sign-in has been checked and the router has rendered.
preloadRoute(location.pathname)
if (location.pathname === '/') prefetchAuthScreens() // someone reading the landing page will most likely open sign-in or sign-up next

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
