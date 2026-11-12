import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from './src/features/auth/AuthContext'
import { CallProvider } from './src/features/call/CallContext'
import { DEFAULT_API_URL } from './src/config'
import { ApiError, setBaseUrl } from './src/lib/api'
import { chooseServer } from './src/lib/serverSelect'
import { loadServerUrl, loadThemePreference, type StoredTheme } from './src/lib/storage'
import { Navigation } from './src/navigation'
import { ThemeBoundary, ThemeProvider, bootTheme } from './src/ui/ThemeContext'
import type { Scheme } from './src/ui/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Do not hammer the server on client errors; retry transient failures once.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
})

export default function App() {
  const [ready, setReady] = useState(false)
  // The appearance chosen in Settings, read before the first screen so the app never opens in the wrong theme.
  const [theme, setTheme] = useState<{ preference: StoredTheme; system: Scheme }>({ preference: 'light', system: 'light' })

  useEffect(() => {
    // Debug builds may point at a different server (set on the welcome screen), but a saved address that no longer answers (a phone
    // hotspot hands out a new subnet each time) must not win over the built-in default, which reaches the PC through the USB tunnel.
    // Release builds always use the baked-in address.
    ;(async () => {
      const preference = await loadThemePreference()
      setTheme({ preference, system: bootTheme(preference) })
      if (__DEV__) {
        setBaseUrl(await chooseServer(await loadServerUrl(), DEFAULT_API_URL))
      }
      setReady(true)
    })()
  }, [])

  if (!ready) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider initialPreference={theme.preference} initialSystem={theme.system}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CallProvider>
              <ThemeBoundary>
                <Navigation />
              </ThemeBoundary>
            </CallProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
