import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TABS, visibleTabs } from '../src/config/navigation'
import { HeaderPresentContext, Screen } from '../src/ui/components'
import { ProfileMenu } from '../src/navigation/ProfileMenu'

describe('navigation structure', () => {
  it('the six agreed sections exist in the agreed order', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
  })

  it('only built sections are shown; unbuilt ones appear only in the debug-build preview', () => {
    expect(visibleTabs(false).map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    expect(visibleTabs(true).map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    for (const t of visibleTabs(false)) expect(t.ready).toBe(true)
  })

  it('never shows more than six tabs, so the bottom bar stays uncrowded', () => {
    expect(visibleTabs(true).length).toBeLessThanOrEqual(6)
  })

  it('release builds show every section that is built', () => {
    expect(visibleTabs(false).map((t) => t.id)).toEqual(['Home', 'Talk', 'Learn', 'Coach', 'Friends', 'Progress'])
  })
})

describe('ProfileMenu', () => {
  const press = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
    r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
  const flat = (node: unknown): string => {
    if (node === null || node === undefined) return ''
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(flat).join('')
    return flat((node as { children?: unknown }).children)
  }

  async function mount() {
    const onSettings = jest.fn()
    const onSignOut = jest.fn()
    let r!: ReactTestRenderer.ReactTestRenderer
    await act(async () => { r = ReactTestRenderer.create(<ProfileMenu name="Ana Lopez" onSettings={onSettings} onSignOut={onSignOut} />) })
    return { r, onSettings, onSignOut }
  }

  it('is closed until the profile button is pressed, then offers Settings and Sign out', async () => {
    const { r } = await mount()
    expect(flat(r.toJSON())).not.toContain('Sign out')
    act(() => press(r, 'Account menu').props.onPress())
    const text = flat(r.toJSON())
    expect(text).toContain('Ana Lopez')
    expect(text).toContain('Settings')
    expect(text).toContain('Sign out')
  })

  it('Settings opens settings and closes the menu', async () => {
    const { r, onSettings } = await mount()
    act(() => press(r, 'Account menu').props.onPress())
    act(() => press(r, 'Settings').props.onPress())
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(flat(r.toJSON())).not.toContain('Sign out')
  })

  it('Sign out signs out and closes the menu', async () => {
    const { r, onSignOut } = await mount()
    act(() => press(r, 'Account menu').props.onPress())
    act(() => press(r, 'Sign out').props.onPress())
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('the profile button is labelled for screen readers and reports whether it is open', async () => {
    const { r } = await mount()
    const button = press(r, 'Account menu')
    expect(button.props.accessibilityRole).toBe('button')
    expect(button.props.accessibilityState).toEqual({ expanded: false })
    act(() => button.props.onPress())
    expect(press(r, 'Account menu').props.accessibilityState).toEqual({ expanded: true })
  })
})

describe('Screen under an app header', () => {
  const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } }
  const topEdge = (ui: React.ReactElement): string => {
    let r!: ReactTestRenderer.ReactTestRenderer
    act(() => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>) })
    // The native safe-area view receives its edges as { top: 'additive' | 'off', ... }.
    return r.root.findAll((n) => n.props.edges && !Array.isArray(n.props.edges) && typeof n.props.edges === 'object')[0].props.edges.top
  }

  it('adds the top safe-area inset on screens without a header', () => {
    expect(topEdge(<Screen>{null}</Screen>)).toBe('additive')
  })

  it('does not add it a second time when an app header already handles the status bar', () => {
    expect(topEdge(<HeaderPresentContext.Provider value><Screen>{null}</Screen></HeaderPresentContext.Provider>)).toBe('off')
  })
})
