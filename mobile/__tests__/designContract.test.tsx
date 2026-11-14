// Rules of the Android design that are easy to break by accident and that earlier broke the app on a real phone:
// invisible typed text (a light-only theme and explicit input colours) and the removed top header.
import fs from 'fs'
import path from 'path'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { HeaderPresentContext, Input, Screen, TextField } from '../src/ui/components'

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')
const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const flatStyle = (style: unknown) => Object.assign({}, ...([] as unknown[]).concat(style as never).flat(4).filter(Boolean))

async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>) })
  return r
}
const textInput = (r: ReactTestRenderer.ReactTestRenderer) => {
  const all = r.root.findAll((n) => n.props.underlineColorAndroid === 'transparent')
  return all[all.length - 1]
}

describe('typed text is always visible', () => {
  it('the Android theme has a light and a dark twin that the app switches between, and cannot be force-darkened by the phone', () => {
    const res = (...p: string[]) => read('android', 'app', 'src', 'main', 'res', ...p)
    const light = res('values', 'styles.xml')
    const dark = res('values-night', 'styles.xml')
    for (const styles of [light, dark]) {
      expect(styles).toContain('parent="Theme.AppCompat.DayNight.NoActionBar"')
      expect(styles).toContain('<item name="android:forceDarkAllowed">false</item>')
      expect(styles).toContain('android:textColorHint')
    }
    expect(light).toContain('<item name="android:windowBackground">#FFFAFAF8</item>')
    expect(dark).toContain('<item name="android:windowBackground">#FF0F1215</item>') // the dark palette's canvas
  })

  it('the saved theme is applied before the first screen and handed to Android, so native pieces match the app', () => {
    expect(read('App.tsx')).toContain('bootTheme(preference)')
    expect(read('App.tsx')).toContain("({ preference: 'light', system: 'light' })") // Light until a saved choice is read
    expect(read('src', 'ui', 'ThemeContext.tsx')).toContain("initialPreference = 'light'")
    // Native side: light until the app has read the saved choice, even on a phone set to dark.
    expect(read('android', 'app', 'src', 'main', 'java', 'com', 'englishspeakingmobile', 'MainActivity.kt')).toContain('AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)')
    expect(read('App.tsx')).toContain('loadThemePreference()')
    const provider = read('src', 'ui', 'ThemeContext.tsx')
    expect(provider).toContain("Appearance.setColorScheme('auto')") // System default
    expect(provider).toMatch(/Appearance\.setColorScheme\(next === 'system' \? 'auto' : next\)/)
  })

  it('every text box is the shared Input with explicit dark text, white background, visible placeholder, cursor and selection', async () => {
    const r = await render(<Input accessibilityLabel="x" placeholder="Type here" />)
    const el = textInput(r)
    const s = flatStyle(el.props.style)
    expect(s.color).toBe('#14171A')
    expect(s.backgroundColor).toBe('#FFFFFF')
    expect(el.props.placeholderTextColor).toBe('#656F79')
    expect(el.props.placeholderTextColor).not.toBe(s.color) // the hint is distinguishable from typed text
    expect(el.props.selectionColor).toBe('#1D4ED8')
    expect(el.props.cursorColor).toBe('#1D4ED8')
    expect(el.props.selectionHandleColor).toBe('#1D4ED8')
    expect(el.props.keyboardAppearance).toBe('light')
  })

  it('a caller can change the look but cannot accidentally drop the text colour', async () => {
    const r = await render(<Input accessibilityLabel="x" style={{ borderWidth: 1, minHeight: 100 }} />)
    const s = flatStyle(textInput(r).props.style)
    expect(s.minHeight).toBe(100)
    expect(s.color).toBe('#14171A')
  })

  it('TextField (login, sign-up, review my text, settings) uses the same Input', async () => {
    const r = await render(<TextField label="Email" value="" onChangeText={() => undefined} />)
    expect(flatStyle(textInput(r).props.style).color).toBe('#14171A')
  })

  it('no screen uses a bare TextInput: they all go through Input', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx$/.test(e.name) && !p.endsWith(path.join('ui', 'components.tsx')) && /<TextInput[\s>]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(path.join(__dirname, '..'), p))
      }
    }
    walk(path.join(__dirname, '..', 'src'))
    expect(offenders).toEqual([])
  })
})

describe('no top header', () => {
  it('the tab navigator has no header, hides its bar under the keyboard, and AppHeader is gone', () => {
    const nav = read('src', 'navigation', 'index.tsx')
    expect(nav).toContain('headerShown: false')
    expect(nav).toContain('tabBarHideOnKeyboard: true')
    expect(nav).not.toMatch(/AppHeader/)
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'navigation', 'AppHeader.tsx'))).toBe(false)
    expect(read('src', 'navigation', 'index.tsx')).not.toMatch(/Speakora/)
  })

  it('a tab screen clears the status bar itself, a screen under a navigation header does not do it twice', async () => {
    const top = (ui: React.ReactElement) => async () => {
      const r = await render(ui)
      const safe = r.root.findAll((n) => Array.isArray(n.props.edges))[0]
      return safe.props.edges as string[]
    }
    expect(await top(<Screen>{null}</Screen>)()).toContain('top')
    expect(await top(<HeaderPresentContext.Provider value><Screen>{null}</Screen></HeaderPresentContext.Provider>)()).not.toContain('top')
  })

  it('screens keep clear of the keyboard on Android as well as iOS', () => {
    expect(read('src', 'ui', 'components.tsx')).toMatch(/KeyboardAvoidingView style=\{\{ flex: 1 \}\} behavior="padding"/)
    expect(read('src', 'features', 'friends', 'ChatScreen.tsx')).toMatch(/KeyboardAvoidingView style=\{\{ flex: 1 \}\} behavior="padding"/)
    expect(read('src', 'features', 'main', 'TutorChat.tsx')).toMatch(/KeyboardAvoidingView[^>]*behavior="padding"/)
  })
})

describe('sign-up and password recovery flow', () => {
  it('email verification is optional: an unverified account is never held on the code screen', () => {
    const nav = read('src', 'navigation', 'index.tsx')
    expect(nav).not.toMatch(/emailVerified|VerifyEmailScreen/)
    expect(read('src', 'features', 'auth', 'VerifyEmailScreen.tsx')).not.toMatch(/Verify later|finishVerification/)
    expect(read('src', 'features', 'auth', 'AuthContext.tsx')).not.toMatch(/verificationPending|startVerification|finishVerification/)
  })

  it('the practice-reminder switch is disabled, with the reason, when the server has no email provider', () => {
    const settings = read('src', 'features', 'main', 'SettingsScreen.tsx')
    expect(settings).toMatch(/disabled=\{prefs\.data\.emailAvailable === false\}/)
    expect(settings).toMatch(/Email is not set up on this server/)
  })

  it('Home and Settings carry no verification, OTP or password-reset prompts', () => {
    for (const f of [['features', 'main', 'HomeScreen.tsx'], ['features', 'main', 'SettingsScreen.tsx']]) {
      expect(read('src', ...f)).not.toMatch(/Verify email|Verify later|Resend|one-time|OTP|Forgot password|reset code/i)
    }
  })

  it('password recovery is reached from the sign-in screen only', () => {
    expect(read('src', 'features', 'auth', 'screens.tsx')).toMatch(/Forgot password\?/)
    const others = ['features/main/HomeScreen.tsx', 'features/main/SettingsScreen.tsx', 'features/main/TutorChat.tsx'].map((f) => read('src', ...f.split('/')))
    for (const src of others) expect(src).not.toMatch(/Forgot/i)
  })
})
