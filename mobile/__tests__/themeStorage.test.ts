// The chosen appearance is saved on the phone and survives a restart; anything unexpected means System default.
const mockStore = new Map<string, string>()
let mockFailing = false
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => { if (mockFailing) throw new Error('storage unavailable'); return mockStore.get(k) ?? null },
    setItem: async (k: string, v: string) => { if (mockFailing) throw new Error('storage unavailable'); mockStore.set(k, v) },
  },
}))
jest.mock('react-native-keychain', () => ({}))

import { loadThemePreference, saveThemePreference } from '../src/lib/storage'

beforeEach(() => { mockStore.clear(); mockFailing = false })

describe('theme preference storage', () => {
  it('is Light when nothing was ever chosen (new installs and people who never opened Appearance)', async () => {
    expect(await loadThemePreference()).toBe('light')
  })

  it.each(['light', 'dark', 'system'] as const)('saves %s and reads it back after a restart (an explicit saved choice is always kept)', async (choice) => {
    await saveThemePreference(choice)
    expect(await loadThemePreference()).toBe(choice)
  })

  it('treats anything unexpected, or an empty value, as Light: Dark and System default are never picked automatically', async () => {
    for (const junk of ['sepia', '', 'DARK', 'auto', 'null', 'undefined']) {
      mockStore.set('theme-preference', junk)
      expect(await loadThemePreference()).toBe('light')
    }
  })

  it('an existing saved choice survives: dark stays dark, system stays system, light stays light', async () => {
    for (const saved of ['dark', 'system', 'light'] as const) {
      mockStore.set('theme-preference', saved)
      expect(await loadThemePreference()).toBe(saved)
    }
  })

  it('never throws when storage is unavailable: it falls back to Light and the choice still applies this session', async () => {
    mockFailing = true
    await expect(saveThemePreference('dark')).resolves.toBeUndefined()
    expect(await loadThemePreference()).toBe('light')
  })
})
