import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('../src/lib/api', () => ({
  ApiError: class extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code } },
  api: (...args: unknown[]) => mockApi(...args),
}))
jest.mock('../src/features/main/tutorApi', () => ({
  ...jest.requireActual('../src/features/main/tutorApi'),
  savePreferredLanguage: (...a: unknown[]) => mockSave(...a),
}))
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ signOut: jest.fn(), session: { user: { email: 'a@example.com' } } }) }))
jest.mock('../src/features/call/CallContext', () => ({ useCall: () => ({ phase: 'idle' }) }))
jest.mock('../src/lib/storage', () => ({ saveThemePreference: jest.fn(), loadThemePreference: jest.fn() })) // Settings now has an Appearance tab, which reads the theme
const mockApi = jest.fn()
const mockSave = jest.fn()

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/lib/api'
import { SettingsScreen } from '../src/features/main/SettingsScreen'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const profile = { displayName: 'Ana', country: 'ES', timeZone: 'Europe/Madrid', nativeLanguage: 'es', englishLevel: 'B1', learningGoals: [], interests: ['travel'], onboardingCompleted: true }
let language: string | null = null

async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={client}><SettingsScreen /></QueryClientProvider></SafeAreaProvider>) })
  await settle()
  return r
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)) })
const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const chip = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.label === label && typeof n.props.onPress === 'function')[0]
const selected = (r: ReactTestRenderer.ReactTestRenderer, label: string) => chip(r, label).props.selected === true

async function openTab(r: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => { chip(r, 'AI tutor').props.onPress() })
  await settle()
}

beforeEach(() => {
  mockApi.mockReset(); mockSave.mockReset()
  language = null
  mockApi.mockImplementation((path: string) => Promise.resolve(path === '/api/coach/preferences' ? { explanationLanguage: language } : path === '/api/profile' ? profile : path === '/api/topics' ? [] : {}))
  mockSave.mockImplementation(async (v: string | null) => { language = v; return { explanationLanguage: v } })
})

describe('Settings: AI tutor (Android)', () => {
  it('is a section of Settings and shows Simple English as the default', async () => {
    const r = await render()
    await openTab(r)
    expect(text(r)).toContain('Explain in')
    expect(selected(r, 'Simple English')).toBe(true)
    for (const l of ['Kannada', 'Hindi', 'Telugu', 'Tamil', 'Another language']) expect(chip(r, l)).toBeTruthy()
  })

  it('does not ask the server for the language until the section is opened', async () => {
    await render()
    expect(mockApi.mock.calls.some((c) => c[0] === '/api/coach/preferences')).toBe(false)
  })

  it('choosing a language saves it to the account, and Simple English clears it', async () => {
    const r = await render()
    await openTab(r)
    await act(async () => { chip(r, 'Hindi').props.onPress() })
    await settle()
    expect(mockSave).toHaveBeenLastCalledWith('Hindi')
    expect(selected(r, 'Hindi')).toBe(true)
    await act(async () => { chip(r, 'Simple English').props.onPress() })
    await settle()
    expect(mockSave).toHaveBeenLastCalledWith(null)
    expect(selected(r, 'Simple English')).toBe(true)
  })

  it('another language is typed and saved with a button, not on every keystroke', async () => {
    const r = await render()
    await openTab(r)
    await act(async () => { chip(r, 'Another language').props.onPress() })
    const field = r.root.findAll((n) => n.props.accessibilityLabel === 'Language name' && typeof n.props.onChangeText === 'function')[0]
    act(() => field.props.onChangeText('Malayalam'))
    expect(mockSave).not.toHaveBeenCalled()
    await act(async () => { chip(r, 'Save language').props.onPress() })
    await settle()
    expect(mockSave).toHaveBeenCalledWith('Malayalam')
  })

  it('a saved other language is shown selected with its name in the box', async () => {
    language = 'Malayalam'
    const r = await render()
    await openTab(r)
    expect(selected(r, 'Another language')).toBe(true)
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Language name' && typeof n.props.onChangeText === 'function')[0].props.value).toBe('Malayalam')
  })

  it('shows the server message when a language is refused', async () => {
    mockSave.mockRejectedValue(new ApiError(400, 'INVALID_LANGUAGE', 'Use a plain language name.'))
    const r = await render()
    await openTab(r)
    await act(async () => { chip(r, 'Tamil').props.onPress() })
    await settle()
    expect(text(r)).toContain('Use a plain language name.')
  })
})
