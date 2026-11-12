import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('../src/lib/storage', () => ({ saveServerUrl: jest.fn(), loadServerUrl: jest.fn(async () => null), getRefreshToken: jest.fn(), saveRefreshToken: jest.fn(), clearRefreshToken: jest.fn() }))
jest.mock('react-native-svg', () => {
  const R = require('react')
  const { View } = require('react-native')
  const Stub = (props: { children?: React.ReactNode }) => R.createElement(View, null, props.children)
  return new Proxy({ __esModule: true, default: Stub }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : Stub) })
})
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo', () => ({
  __esModule: true,
  default: { isReduceMotionEnabled: jest.fn(async () => true), addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}))

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { WelcomeScreen } from '../src/features/auth/WelcomeScreen'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }

async function render(navigate: jest.Mock) {
  let r!: ReactTestRenderer.ReactTestRenderer
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <WelcomeScreen {...({ navigation: { navigate }, route: { key: 'w', name: 'Welcome' } } as unknown as React.ComponentProps<typeof WelcomeScreen>)} />
      </SafeAreaProvider>,
    )
  })
  return r
}

describe('welcome screen', () => {
  it('shows the product message and routes the two buttons into the existing auth flow', async () => {
    const navigate = jest.fn()
    const r = await render(navigate)
    const text = JSON.stringify(r.toJSON())
    expect(text).toContain('Speak English with the world.')
    expect(text).toContain('real one-to-one conversations')

    const press = (label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0].props.onPress()
    act(() => press('Start Speaking'))
    expect(navigate).toHaveBeenLastCalledWith('Register')
    act(() => press('Sign In'))
    expect(navigate).toHaveBeenLastCalledWith('Login')
  })
})
