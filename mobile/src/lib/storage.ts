import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Keychain from 'react-native-keychain'

const REFRESH_SERVICE = 'english-speaking-partner.refresh'
const SERVER_KEY = 'server-url'

/** The refresh token is a credential: it goes in the Android Keystore (hardware-backed where available), not in plain storage. */
export async function saveRefreshToken(token: string) {
  await Keychain.setGenericPassword('refresh', token, {
    service: REFRESH_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    const entry = await Keychain.getGenericPassword({ service: REFRESH_SERVICE })
    return entry ? entry.password : null
  } catch {
    return null
  }
}

export async function clearRefreshToken() {
  try {
    await Keychain.resetGenericPassword({ service: REFRESH_SERVICE })
  } catch {
    // nothing stored
  }
}

/** Non-secret preference: the server address chosen in debug builds. */
export async function loadServerUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SERVER_KEY)
  } catch {
    return null
  }
}

export async function saveServerUrl(url: string) {
  await AsyncStorage.setItem(SERVER_KEY, url)
}

const THEME_KEY = 'theme-preference'
export type StoredTheme = 'system' | 'light' | 'dark'

/** The appearance the person chose in Settings. Light is the default: anything else, or nothing saved, means Light. Dark and System default apply only when chosen. */
export async function loadThemePreference(): Promise<StoredTheme> {
  try {
    const v = await AsyncStorage.getItem(THEME_KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

export async function saveThemePreference(theme: StoredTheme) {
  try {
    await AsyncStorage.setItem(THEME_KEY, theme)
  } catch {
    // The choice still applies until the app is closed.
  }
}
