// Dark mode: the palette (contrast, same keys as light), the theme runtime, the provider (saved choice, System default, Android handoff),
// the Settings control, and a sweep over real screens for colours that did not follow the theme.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { Appearance } from 'react-native'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }))
jest.mock('../src/navigation/ProfileControl', () => ({ ProfileControl: () => null }))
jest.mock('../src/lib/storage', () => ({ saveThemePreference: jest.fn(async () => undefined), loadThemePreference: jest.fn(async () => 'system') }))
jest.mock('../src/lib/api', () => ({
  ApiError: class extends Error { status = 0; code = '' },
  api: (...args: unknown[]) => mockApi(...args),
}))
jest.mock('../src/features/main/tutorApi', () => ({ ...jest.requireActual('../src/features/main/tutorApi') }))
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { displayName: 'Anu', emailVerified: true }, signOut: jest.fn(), session: { user: { email: 'a@example.com' } } }) }))
jest.mock('../src/features/call/CallContext', () => ({ useCall: () => ({ phase: 'idle' }) }))
jest.mock('../src/lib/queries', () => ({
  useStats: () => ({ isLoading: false, isError: false, data: { totalSeconds: 5400, completedCalls: 7, currentStreakDays: 3, englishLevel: 'B2', practisedToday: false }, refetch: jest.fn() }),
  useActivity: () => ({ data: [{ date: '2026-11-01', seconds: 60, calls: 1 }, { date: '2026-11-02', seconds: 0, calls: 0 }] }),
  usePartners: () => ({ data: [{ ref: 'p1', displayName: 'Maria' }] }),
  keys: {}, useBlocked: () => ({ data: [] }), useProfile: () => ({ data: undefined, isLoading: true }), useTopics: () => ({ data: [] }),
}))
jest.mock('../src/features/learn/learnApi', () => ({
  useLearnProgress: () => ({ data: { grammarCompleted: 3, grammarTotal: 60, phrasalCompleted: 0, phrasalTotal: 89, wordsLearned: 4, wordsTotal: 294, dueCount: 2, next: { subject: 'grammar', level: 1, title: 'Basic sentence structure', lessonId: 'g1.01' } } }),
}))
const mockApi = jest.fn()

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { HomeScreen } from '../src/features/main/HomeScreen'
import { SettingsScreen } from '../src/features/main/SettingsScreen'
import { saveThemePreference } from '../src/lib/storage'
import { Alert, Button, Chip, EmptyState, Input, Panel, Screen, TextField, Title, Toggle } from '../src/ui/components'
import { ThemeBoundary, ThemeProvider, resolveScheme, useTheme } from '../src/ui/ThemeContext'
import { applyScheme, colors, currentScheme, justSwitchedTheme, palettes, themed, type, useKeptState } from '../src/ui/theme'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }

// ------------------------------------------------------------------------------------------------ helpers

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const flatStyle = (style: unknown) => Object.assign({}, ...([] as unknown[]).concat(style as never).flat(4).filter(Boolean))

type Json = { type?: string; props?: Record<string, unknown>; children?: unknown }
/** Every colour that is actually drawn: backgrounds, text and borders, from the rendered tree. */
function drawnColours(node: unknown, out: { bg: Set<string>; fg: Set<string>; border: Set<string> } = { bg: new Set(), fg: new Set(), border: new Set() }) {
  if (!node || typeof node === 'string') return out
  if (Array.isArray(node)) { node.forEach((n) => drawnColours(n, out)); return out }
  const n = node as Json
  const s = flatStyle(n.props?.style)
  if (typeof s.backgroundColor === 'string') out.bg.add(s.backgroundColor)
  if (typeof s.color === 'string') out.fg.add(s.color)
  for (const k of ['borderColor', 'borderTopColor', 'borderBottomColor']) if (typeof s[k] === 'string') out.border.add(s[k])
  drawnColours(n.children, out)
  return out
}

afterEach(() => { applyScheme('light'); jest.restoreAllMocks() })

// ------------------------------------------------------------------------------------------------ the palette

describe('the dark palette', () => {
  const L = palettes.light
  const D = palettes.dark

  it('has exactly the same colours as the light palette, so nothing can be missing in one theme', () => {
    expect(Object.keys(D).sort()).toEqual(Object.keys(L).sort())
  })

  it('keeps the light theme exactly as it was', () => {
    expect(L.canvas).toBe('#FAFAF8')
    expect(L.surface).toBe('#FFFFFF')
    expect(L.ink).toBe('#14171A')
    expect(L.accent).toBe('#1D4ED8')
    expect(L.onAccent).toBe('#FFFFFF')
  })

  it.each([
    ['dark', D],
    ['light', L],
  ] as const)('%s: text is readable on every background it is used on (WCAG AA, 4.5:1; main text 7:1)', (_n, p) => {
    for (const bg of [p.canvas, p.surface]) {
      expect(contrast(p.ink, bg)).toBeGreaterThanOrEqual(7)
      for (const fg of [p.muted, p.subtle, p.accent, p.danger, p.success]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(p.muted, p.wash)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.ink, p.bubble)).toBeGreaterThanOrEqual(7)
    expect(contrast(p.accent, p.accentSoft)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.danger, p.dangerSoft)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.success, p.successSoft)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.warning, p.warningSoft)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5) // button labels
    expect(contrast(p.onAccent, p.danger)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.onAccent, p.ink)).toBeGreaterThanOrEqual(7) // the stop button
    expect(contrast(p.field, p.surface)).toBeGreaterThanOrEqual(3) // input borders
  })

  it('is not an inversion: the dark canvas is a near-black, not the light ink, and the accent is a lighter blue', () => {
    expect(lum(D.canvas)).toBeLessThan(0.02)
    expect(D.canvas).not.toBe(L.ink)
    expect(lum(D.accent)).toBeGreaterThan(lum(L.accent))
  })
})

// ------------------------------------------------------------------------------------------------ the runtime

describe('theme runtime', () => {
  it('applyScheme replaces the colours in use, and `type` and `themed` styles follow', () => {
    const card = themed(() => ({ backgroundColor: colors.surface, borderColor: colors.line }))
    expect(card.backgroundColor).toBe('#FFFFFF')
    expect(type.body.color).toBe('#14171A')
    expect(applyScheme('dark')).toBe(true)
    expect(currentScheme()).toBe('dark')
    expect(colors.canvas).toBe(palettes.dark.canvas)
    expect(card.backgroundColor).toBe(palettes.dark.surface)
    expect({ ...card }).toEqual({ backgroundColor: palettes.dark.surface, borderColor: palettes.dark.line })
    expect(type.body.color).toBe(palettes.dark.ink)
    expect(type.small.color).toBe(palettes.dark.muted)
    expect(applyScheme('dark')).toBe(false) // no change, nothing rebuilt
  })

  it('themed styles work inside style arrays, like a StyleSheet', () => {
    const s = themed(() => ({ a: { color: colors.ink }, b: { backgroundColor: colors.canvas } }))
    applyScheme('dark')
    expect(flatStyle([s.a, s.b])).toEqual({ color: palettes.dark.ink, backgroundColor: palettes.dark.canvas })
  })

  it("survives React Native's development freeze of style props (the 'trap result is configurable but target property is non-configurable' red screen)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const deepFreeze = require('react-native/Libraries/Utilities/deepFreezeAndThrowOnMutationInDev').default as (o: object) => void
    const s = themed(() => ({ card: { backgroundColor: colors.surface }, text: { color: colors.ink } }))
    expect(() => { deepFreeze({ style: s }); Object.keys(s); void { ...s }; Object.getOwnPropertyDescriptor(s, 'card'); JSON.stringify(s) }).not.toThrow()
    expect(Object.isSealed(s)).toBe(true) // not a Proxy: nothing for the freeze to contradict
    try { (s as { card: unknown }).card = {} } catch { /* strict mode throws */ }
    expect(s.card.backgroundColor).toBe(palettes.light.surface) // and it cannot be overwritten
    applyScheme('dark') // still follows the theme after having been frozen
    expect(s.card.backgroundColor).toBe(palettes.dark.surface)
    expect(s.text.color).toBe(palettes.dark.ink)
  })

  it('remembers a bit of UI state across a theme change, and only then', () => {
    jest.useFakeTimers({ now: Date.now() + 60_000 }) // well after any earlier switch in this file, so "just switched" is false
    let setter!: (v: string) => void
    const Probe = () => { const [v, set] = useKeptState('probe', 'first'); setter = set; return <>{v}</> }
    let r!: ReactTestRenderer.ReactTestRenderer
    act(() => { r = ReactTestRenderer.create(<Probe />) })
    act(() => setter('second'))
    expect(justSwitchedTheme()).toBe(false)
    act(() => r.unmount())
    act(() => { r = ReactTestRenderer.create(<Probe />) })
    expect(JSON.stringify(r.toJSON())).toBe('"first"') // an ordinary remount starts again
    act(() => setter('third'))
    applyScheme('dark') // the screens are rebuilt
    act(() => r.unmount())
    act(() => { r = ReactTestRenderer.create(<Probe />) })
    expect(JSON.stringify(r.toJSON())).toBe('"third"')
    jest.useRealTimers()
  })
})

// ------------------------------------------------------------------------------------------------ the provider

describe('ThemeProvider', () => {
  let theme!: ReturnType<typeof useTheme>
  const Probe = () => { theme = useTheme(); return null }
  let changeListener: ((e: { colorScheme: 'light' | 'dark' | null | undefined }) => void) | null = null

  beforeEach(() => {
    changeListener = null
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined)
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light')
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation((l) => { changeListener = l as never; return { remove: jest.fn() } })
    ;(saveThemePreference as jest.Mock).mockClear()
  })

  const mount = (preference: 'system' | 'light' | 'dark', system: 'light' | 'dark') => {
    let r!: ReactTestRenderer.ReactTestRenderer
    act(() => { r = ReactTestRenderer.create(<ThemeProvider initialPreference={preference} initialSystem={system}><Probe /></ThemeProvider>) })
    return r
  }

  it('resolves System default to the phone, and Light or Dark to themselves', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark')
    expect(resolveScheme('system', 'light')).toBe('light')
    expect(resolveScheme('dark', 'light')).toBe('dark')
    expect(resolveScheme('light', 'dark')).toBe('light')
  })

  it('is Light by default, even on a phone set to dark: Dark and System default are used only when chosen', () => {
    let r!: ReactTestRenderer.ReactTestRenderer
    act(() => { r = ReactTestRenderer.create(<ThemeProvider initialSystem="dark"><Probe /></ThemeProvider>) })
    expect(theme.preference).toBe('light')
    expect(theme.scheme).toBe('light')
    expect(colors.canvas).toBe('#FAFAF8')
    act(() => { if (changeListener) changeListener({ colorScheme: 'dark' }) })
    expect(theme.scheme).toBe('light') // the phone changing does nothing until System default is chosen
    r.unmount()
  })

  it('opens in the saved theme before anything is drawn', () => {
    mount('dark', 'light')
    expect(theme.scheme).toBe('dark')
    expect(colors.canvas).toBe(palettes.dark.canvas)
  })

  it('System default follows the phone, and keeps following it while the app is open', () => {
    mount('system', 'dark')
    expect(theme.scheme).toBe('dark')
    act(() => changeListener!({ colorScheme: 'light' }))
    expect(theme.scheme).toBe('light')
    expect(colors.canvas).toBe(palettes.light.canvas)
    act(() => changeListener!({ colorScheme: 'dark' }))
    expect(theme.scheme).toBe('dark')
  })

  it('an explicit Light or Dark is not changed by the phone', () => {
    mount('light', 'light')
    act(() => changeListener!({ colorScheme: 'dark' }))
    expect(theme.scheme).toBe('light')
  })

  it('choosing a theme applies it at once, hands it to Android and saves it', () => {
    mount('system', 'light')
    act(() => theme.setPreference('dark'))
    expect(theme.preference).toBe('dark')
    expect(theme.scheme).toBe('dark')
    expect(colors.ink).toBe(palettes.dark.ink)
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark')
    expect(saveThemePreference).toHaveBeenLastCalledWith('dark')
    act(() => theme.setPreference('light'))
    expect(theme.scheme).toBe('light')
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('light')
    expect(saveThemePreference).toHaveBeenLastCalledWith('light')
  })

  it('going back to System default clears the override and then reads what the phone is set to', () => {
    jest.useFakeTimers()
    try {
      mount('dark', 'light')
      ;(Appearance.getColorScheme as jest.Mock).mockReturnValue('light')
      act(() => theme.setPreference('system'))
      expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('auto')
      expect(saveThemePreference).toHaveBeenLastCalledWith('system')
      act(() => { jest.advanceTimersByTime(200) })
      expect(theme.scheme).toBe('light')
    } finally { jest.useRealTimers() }
  })

  it('rebuilds what is inside ThemeBoundary when the theme changes, and not when only the preference label changes', () => {
    let mounts = 0
    const Child = () => { React.useEffect(() => { mounts += 1 }, []); return null }
    let r!: ReactTestRenderer.ReactTestRenderer
    act(() => { r = ReactTestRenderer.create(<ThemeProvider initialPreference="light" initialSystem="dark"><Probe /><ThemeBoundary><Child /></ThemeBoundary></ThemeProvider>) })
    expect(mounts).toBe(1)
    act(() => theme.setPreference('system')) // the phone is dark: that is a change of effective theme after the lookup
    act(() => theme.setPreference('dark'))
    const after = mounts
    act(() => theme.setPreference('light'))
    expect(mounts).toBe(after + 1)
    r.unmount()
  })
})

// ------------------------------------------------------------------------------------------------ Settings

describe('Settings > Appearance', () => {
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
  const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
  let theme!: ReturnType<typeof useTheme>
  const Probe = () => { theme = useTheme(); return null }

  async function open() {
    mockApi.mockImplementation((p: string) => Promise.resolve(p === '/api/coach/preferences' ? { explanationLanguage: null } : []))
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined)
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light')
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation(() => ({ remove: jest.fn() }))
    let r!: ReactTestRenderer.ReactTestRenderer
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => {
      r = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}><ThemeProvider><Probe /><SettingsScreen /></ThemeProvider></QueryClientProvider></SafeAreaProvider>,
      )
    })
    await settle()
    await act(async () => { r.root.findAll((n) => n.props.label === 'Appearance' && typeof n.props.onPress === 'function')[0].props.onPress() })
    await settle()
    return r
  }
  const radio = (r: ReactTestRenderer.ReactTestRenderer, name: RegExp) => r.root.findAll((n) => n.props.accessibilityRole === 'radio' && name.test(String(n.props.accessibilityLabel)))[0]

  it('offers Light, Dark and System default (in that order), with Light selected until you choose', async () => {
    const r = await open()
    expect(flat(r.toJSON())).toContain('Theme')
    for (const label of [/^System default/, /^Light$/, /^Dark$/]) expect(radio(r, label)).toBeTruthy()
    const order = [...new Set(r.root.findAll((n) => n.props.accessibilityRole === 'radio').map((n) => String(n.props.accessibilityLabel).split('.')[0]))]
    expect(order).toEqual(['Light', 'Dark', 'System default'])
    expect(radio(r, /^Light$/).props.accessibilityState.selected).toBe(true)
    expect(radio(r, /^Dark$/).props.accessibilityState.selected).toBe(false)
    expect(radio(r, /^System default/).props.accessibilityState.selected).toBe(false)
    expect(theme.scheme).toBe('light')
    expect(theme.preference).toBe('light')
    expect(flat(r.toJSON())).toContain("Follows your phone's light or dark setting.")
  })

  it('choosing Dark switches the whole app to dark, saves it, and stays on this tab', async () => {
    const r = await open()
    await act(async () => { radio(r, /^Dark$/).props.onPress() })
    await settle()
    expect(theme.preference).toBe('dark')
    expect(theme.scheme).toBe('dark')
    expect(colors.canvas).toBe(palettes.dark.canvas)
    expect(saveThemePreference).toHaveBeenLastCalledWith('dark')
    expect(radio(r, /^Dark$/).props.accessibilityState.selected).toBe(true)
    expect(radio(r, /^System default/).props.accessibilityState.selected).toBe(false)
    expect(flat(r.toJSON())).toContain('Saved on this phone.')
    r.unmount()
  })

  it('System default does nothing until it is chosen, and then follows the phone', async () => {
    const r = await open()
    expect(theme.scheme).toBe('light')
    ;(Appearance.getColorScheme as jest.Mock).mockReturnValue('dark')
    jest.useFakeTimers()
    try {
      await act(async () => { radio(r, /^System default/).props.onPress() })
      await act(async () => { jest.advanceTimersByTime(300) })
      expect(theme.preference).toBe('system')
      expect(theme.scheme).toBe('dark') // the phone is dark and the person chose System default
      expect(saveThemePreference).toHaveBeenLastCalledWith('system')
    } finally { jest.useRealTimers() }
    r.unmount()
  })

  it('choosing Light puts the light theme back', async () => {
    const r = await open()
    await act(async () => { radio(r, /^Dark$/).props.onPress() })
    await act(async () => { radio(r, /^Light$/).props.onPress() })
    await settle()
    expect(theme.scheme).toBe('light')
    expect(colors.canvas).toBe('#FAFAF8')
    r.unmount()
  })
})

// ------------------------------------------------------------------------------------------------ nothing is left in the light colours

describe('dark mode on real screens', () => {
  const L = Object.values(palettes.light)
  const light = new Set(L.filter((v) => v.startsWith('#')).map((v) => v.toUpperCase()))
  const darkValues = new Set(Object.values(palettes.dark).map((v) => v.toUpperCase()))
  // Colours that are the same in both themes on purpose (white on a coloured fill, or the always-navy welcome art) are not leaks.
  const leaks = (set: Set<string>, kind: 'bg' | 'fg' | 'border') =>
    [...set].map((v) => v.toUpperCase()).filter((v) => light.has(v) && (kind === 'bg' ? true : !darkValues.has(v)))

  async function render(ui: React.ReactElement) {
    let r!: ReactTestRenderer.ReactTestRenderer
    await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>) })
    return r
  }

  it('the shared controls draw only dark-theme colours: screen, title, panel, button, input, toggle, chip, alerts, empty state', async () => {
    applyScheme('dark')
    const r = await render(
      <Screen>
        <Title sub="Subtitle">Title</Title>
        <Panel><TextField label="Email" value="" onChangeText={() => undefined} error="Enter an email" /></Panel>
        <Input accessibilityLabel="free" />
        <Button label="Primary" onPress={() => undefined} />
        <Button label="Secondary" variant="secondary" onPress={() => undefined} />
        <Button label="Delete" variant="danger" onPress={() => undefined} />
        <Toggle label="A toggle" value onChange={() => undefined} />
        <Chip label="Chip" selected onPress={() => undefined} />
        <Alert>Something went wrong</Alert>
        <Alert tone="success">Saved</Alert>
        <Alert tone="info">Note</Alert>
        <EmptyState title="Nothing yet" description="Come back later" />
      </Screen>,
    )
    const c = drawnColours(r.toJSON())
    expect(leaks(c.bg, 'bg')).toEqual([])
    expect(leaks(c.fg, 'fg')).toEqual([])
    expect(leaks(c.border, 'border')).toEqual([])
    expect(c.bg.has(palettes.dark.canvas)).toBe(true)
    expect(c.fg.has(palettes.dark.ink)).toBe(true)
    // Button labels are dark on the bright accent, and the input is light text on the dark field.
    expect(c.fg.has(palettes.dark.onAccent)).toBe(true)
    const input = r.root.findAll((n) => n.props.underlineColorAndroid === 'transparent' && n.props.accessibilityLabel === 'free')[0]
    expect(input.props.keyboardAppearance).toBe('dark')
    expect(flatStyle(input.props.style)).toMatchObject({ color: palettes.dark.ink, backgroundColor: palettes.dark.surface })
    expect(input.props.placeholderTextColor).toBe(palettes.dark.subtle)
    expect(input.props.cursorColor).toBe(palettes.dark.accent)
  })

  it('Home draws only dark-theme colours, and its text is readable on the dark canvas', async () => {
    applyScheme('dark')
    const r = await render(<HomeScreen />)
    const c = drawnColours(r.toJSON())
    expect(leaks(c.bg, 'bg')).toEqual([])
    expect(leaks(c.fg, 'fg')).toEqual([])
    expect(leaks(c.border, 'border')).toEqual([])
    // (onAccent is the label colour on the bright accent button, not text on the canvas: its contrast is checked in the palette test)
    for (const fg of c.fg) if (fg.startsWith('#') && fg !== palettes.dark.onAccent) expect([fg, contrast(fg, palettes.dark.canvas) >= 4.5]).toEqual([fg, true])
  })

  it('the same screen in light still draws only light-theme colours (the light theme is preserved)', async () => {
    const r = await render(<HomeScreen />)
    const c = drawnColours(r.toJSON())
    const darkOnly = (set: Set<string>) => [...set].filter((v) => Object.entries(palettes.dark).some(([k, d]) => d.toUpperCase() === v.toUpperCase() && palettes.light[k as keyof typeof palettes.light] !== d))
    expect(darkOnly(c.bg)).toEqual([])
    expect(darkOnly(c.fg)).toEqual([])
    expect(c.bg.has('#FAFAF8')).toBe(true)
  })
})

// ------------------------------------------------------------------------------------------------ guards for future code

describe('code rules that keep both themes working', () => {
  const src = path.join(__dirname, '..', 'src')
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []))

  it('no colour is read when a module loads (it would stay on the first theme): use themed(() => ...)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require('typescript') as typeof import('typescript')
    const offenders: string[] = []
    for (const f of files(src)) {
      if (/tokens\.generated|[\\/]theme\.ts$/.test(f)) continue
      const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (n: import('typescript').Node, inFn: boolean) => {
        const fn = ts.isFunctionLike(n) || ts.isClassLike(n)
        if (ts.isIdentifier(n) && (n.text === 'colors' || n.text === 'type') && !inFn) {
          const p = n.parent
          if ((ts.isPropertyAccessExpression(p) && p.expression === n) || ts.isSpreadAssignment(p) || ts.isSpreadElement(p)) offenders.push(`${path.relative(src, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`)
        }
        ts.forEachChild(n, (c) => visit(c, inFn || fn))
      }
      visit(sf, false)
    }
    expect(offenders).toEqual([])
  })

  it('no screen hard-codes a hex colour: only the welcome artwork, the brand mark, avatars and the star rating may', () => {
    const allowed = /(GlobalHero|WelcomeScreen|BrandMark|Avatar|CallForms|tokens\.generated)\.tsx?$/
    const offenders = files(src).filter((f) => !allowed.test(f) && /#[0-9A-Fa-f]{6}\b/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(src, f))
    expect(offenders).toEqual([])
  })

  it('text and icons on an accent or danger fill use onAccent, not white (white stays white in dark and would be too bright)', () => {
    const offenders = files(src).filter((f) => !/(GlobalHero|WelcomeScreen|BrandMark|Avatar|tokens\.generated|[\\/]theme\.ts|components\.tsx)$/.test(f) && /colors\.white/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(src, f))
    expect(offenders).toEqual([])
  })
})
