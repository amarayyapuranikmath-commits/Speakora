import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Appearance, StatusBar } from 'react-native'
import { saveThemePreference } from '../lib/storage'
import { applyScheme, type Scheme, type ThemePreference } from './theme'

/**
 * The theme: Light (the default), Dark or System default. Dark and System default are used only when the person chose them in Settings;
 * with nothing saved the app is Light, whatever the phone is set to.
 *
 * - The choice is saved on the phone (storage.ts) and read before the first screen is drawn, so the app never opens in the wrong theme.
 * - System default follows the phone's own appearance setting and follows it while the app is open.
 * - The choice is also passed to Android (Appearance.setColorScheme), so native pieces (dialogs, the text selection menu, the keyboard) match.
 * - When the effective theme changes, the screens are rebuilt (ThemeBoundary) so every colour is read again; navigation, sign-in and an
 *   active call are kept, and ThemeBoundary's users restore what the person was looking at (see Navigation and useKeptState).
 */

const toScheme = (value: string | null | undefined): Scheme => (value === 'dark' ? 'dark' : 'light')

export function resolveScheme(preference: ThemePreference, system: Scheme): Scheme {
  return preference === 'system' ? system : preference
}

/**
 * Called once before the app draws anything: tells Android which theme to use and returns what the phone itself is set to.
 * (The phone's own setting can only be read while no override is active, so any override is cleared first.)
 */
export function bootTheme(preference: ThemePreference): Scheme {
  try { Appearance.setColorScheme('auto') } catch { /* not supported: the app still follows its own palette */ }
  const system = toScheme(Appearance.getColorScheme())
  if (preference !== 'system') {
    try { Appearance.setColorScheme(preference) } catch { /* as above */ }
  }
  return system
}

interface ThemeValue {
  preference: ThemePreference
  /** The theme actually in use. */
  scheme: Scheme
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeValue>({ preference: 'light', scheme: 'light', setPreference: () => undefined })

export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ initialPreference = 'light', initialSystem = 'light', children }: { initialPreference?: ThemePreference; initialSystem?: Scheme; children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(initialPreference)
  const [system, setSystem] = useState<Scheme>(initialSystem)
  const preferenceRef = useRef(preference)
  preferenceRef.current = preference

  const scheme = resolveScheme(preference, system)
  // Before the children are drawn, so they read the right colours. Idempotent, so a repeated render does no harm.
  applyScheme(scheme)

  // Follow the phone's setting while "System default" is chosen. (While Light or Dark is chosen, Android reports that choice back, not the phone's.)
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (preferenceRef.current === 'system') setSystem(toScheme(colorScheme))
    })
    return () => sub.remove()
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === preferenceRef.current) return
    preferenceRef.current = next
    try { Appearance.setColorScheme(next === 'system' ? 'auto' : next) } catch { /* see bootTheme */ }
    setPref(next)
    void saveThemePreference(next)
    if (next === 'system') {
      // Android reports the phone's own setting a moment after the override is cleared.
      setTimeout(() => { if (preferenceRef.current === 'system') setSystem(toScheme(Appearance.getColorScheme())) }, 150)
    }
  }, [])

  const value = useMemo(() => ({ preference, scheme, setPreference }), [preference, scheme, setPreference])
  return (
    <ThemeContext.Provider value={value}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      {children}
    </ThemeContext.Provider>
  )
}

/** Rebuilds everything inside it when the effective theme changes, so every screen picks up the new colours. */
export function ThemeBoundary({ children }: { children: ReactNode }) {
  const { scheme } = useTheme()
  return <Fragment key={scheme}>{children}</Fragment>
}
