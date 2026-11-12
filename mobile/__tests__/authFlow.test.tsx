import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    status: number; code: string; details: Record<string, string>; retryAfter: number
    constructor(status: number, code: string, message: string, details: Record<string, string> = {}, retryAfter = 0) { super(message); this.status = status; this.code = code; this.details = details; this.retryAfter = retryAfter }
  }
  return { ApiError, api: (...a: unknown[]) => mockApi(...a) }
})
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../src/features/auth/WelcomeScreen', () => ({ WelcomeScreen: () => null }))
const mockApi = jest.fn()
let mockAuth: { user: { email: string }; verificationEmailProblem: string | null; reloadUser: jest.Mock; logout: jest.Mock; login: jest.Mock; register: jest.Mock }

import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/lib/api'
import { ForgotScreen, RegisterScreen, ResetScreen } from '../src/features/auth/screens'
import { VerifyEmailScreen } from '../src/features/auth/VerifyEmailScreen'

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const text = (r: ReactTestRenderer.ReactTestRenderer) => flat(r.toJSON())
const press = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]
const field = (r: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const all = r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')
  return all[all.length - 1]
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
async function render(ui: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { r = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>) })
  return r
}

beforeEach(() => {
  mockApi.mockReset()
  mockApi.mockResolvedValue(undefined)
  mockAuth = { user: { email: 'ana@example.com' }, verificationEmailProblem: null, reloadUser: jest.fn().mockResolvedValue(undefined), logout: jest.fn(), login: jest.fn(), register: jest.fn() }
})

describe('Verify email (after sign-up)', () => {
  it('says where the code was sent and asks only for the six digits', async () => {
    const r = await render(<VerifyEmailScreen />)
    expect(text(r)).toContain('ana@example.com')
    expect(text(r)).toContain('6-digit code')
    const f = field(r, '6-digit code')
    expect(f.props.keyboardType).toBe('number-pad')
    expect(f.props.maxLength).toBe(6)
    act(() => f.props.onChangeText('12a3-45 6'))
    expect(field(r, '6-digit code').props.value).toBe('123456') // letters and spaces are dropped
  })

  it('does not call the server for a code that cannot be right', async () => {
    const r = await render(<VerifyEmailScreen />)
    act(() => field(r, '6-digit code').props.onChangeText('123'))
    await act(async () => { press(r, 'Verify').props.onPress() })
    expect(text(r)).toContain('Enter the 6-digit code')
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('sends the code to the real endpoint and reloads the account, which then opens the app', async () => {
    const r = await render(<VerifyEmailScreen />)
    act(() => field(r, '6-digit code').props.onChangeText('482913'))
    await act(async () => { press(r, 'Verify').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/auth/verify-email-code', { method: 'POST', body: { code: '482913' } })
    expect(mockAuth.reloadUser).toHaveBeenCalled()
  })

  it('shows the server\'s message for a wrong code and stays on the screen', async () => {
    mockApi.mockRejectedValue(new ApiError(400, 'INVALID_CODE', 'That code is not right. Check it and try again.'))
    const r = await render(<VerifyEmailScreen />)
    act(() => field(r, '6-digit code').props.onChangeText('000000'))
    await act(async () => { press(r, 'Verify').props.onPress() })
    await settle()
    expect(text(r)).toContain('That code is not right')
    expect(mockAuth.reloadUser).not.toHaveBeenCalled() // still unverified, so the screen stays
  })

  it('offers a new code at once (no waiting time) and, while it is being sent, shows that it is sending', async () => {
    let release: (v?: unknown) => void = () => {}
    mockApi.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const r = await render(<VerifyEmailScreen />)
    expect(text(r)).not.toContain('You can ask for a new code in') // right after sign-up: no countdown first
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    expect(text(r)).toContain('Sending a new code…')
    expect(press(r, 'Send a new code').props.disabled).toBe(true) // and cannot be pressed twice while it is on its way
    await act(async () => { release(undefined) })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/auth/resend-verification', { method: 'POST' })
    expect(text(r)).toContain('A new code was sent to ana@example.com. Check your inbox and your spam folder. Earlier codes no longer work.')
  })

  it('can ask again straight away, every time: nothing is silently ignored', async () => {
    const r = await render(<VerifyEmailScreen />)
    for (let i = 0; i < 3; i++) {
      await act(async () => { press(r, 'Send a new code').props.onPress() })
      await settle()
    }
    expect(mockApi.mock.calls.filter((c) => c[0] === '/api/auth/resend-verification')).toHaveLength(3)
  })

  it('says clearly when the email service could not send the code, and never a success message after it', async () => {
    mockApi.mockRejectedValue(new ApiError(503, 'EMAIL_SEND_FAILED', 'We could not reach the email service. Please try again in a moment.'))
    const r = await render(<VerifyEmailScreen />)
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(text(r)).toContain('We could not reach the email service. Please try again in a moment.')
    expect(text(r)).not.toContain('A new code was sent')
    expect(press(r, 'Send a new code').props.disabled).toBe(false) // and it can be tried again
  })

  it('explains the limit when too many codes were asked for, with how long to wait', async () => {
    mockApi.mockRejectedValue(new ApiError(429, 'TOO_MANY_CODES', 'You have asked for several codes in a short time. To keep email delivery reliable, please wait about 15 minutes before asking again. The newest code you received still works.', {}, 900))
    const r = await render(<VerifyEmailScreen />)
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(text(r)).toContain('please wait about 15 minutes before asking again')
  })

  it('tells the person when the network is down instead of doing nothing', async () => {
    mockApi.mockRejectedValue(new Error('Network request failed'))
    const r = await render(<VerifyEmailScreen />)
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(text(r)).toContain('We could not send a new code. Please check your connection and try again.')
  })

  it('right after sign-up, says that the first email could not be sent and why, instead of claiming a code was sent', async () => {
    mockAuth.verificationEmailProblem = 'We could not send the email because our email service refused to accept it. This is a problem on our side, not yours. Please try again later.'
    const r = await render(<VerifyEmailScreen />)
    expect(text(r)).toContain('We could not send the code to ana@example.com.')
    expect(text(r)).toContain('not yours')
    expect(text(r)).not.toContain('We sent a 6-digit code')
    expect(press(r, 'Send a new code')).toBeDefined()
  })

  it('cannot be skipped: there is no "Verify later", only signing out if the address is wrong', async () => {
    const r = await render(<VerifyEmailScreen />)
    expect(press(r, 'Verify later')).toBeUndefined()
    expect(text(r)).not.toContain('Verify later')
    act(() => press(r, 'Use a different account').props.onPress())
    expect(mockAuth.logout).toHaveBeenCalled()
  })
})

describe('Forgot password', () => {
  const navigation = () => ({ navigate: jest.fn() })

  it('validates the address, asks the real endpoint, then moves on to the code screen whatever the answer', async () => {
    const nav = navigation()
    const r = await render(<ForgotScreen navigation={nav as never} route={{} as never} />)
    act(() => field(r, 'Email').props.onChangeText('not an email'))
    await act(async () => { press(r, 'Send code').props.onPress() })
    expect(text(r)).toContain('Enter a valid email address.')
    expect(mockApi).not.toHaveBeenCalled()

    act(() => field(r, 'Email').props.onChangeText(' ana@example.com '))
    await act(async () => { press(r, 'Send code').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/auth/forgot-password', { method: 'POST', body: { email: 'ana@example.com' }, auth: false })
    expect(nav.navigate).toHaveBeenCalledWith('Reset', { email: 'ana@example.com' })
  })

  it('shows a network failure instead of pretending the email was sent', async () => {
    mockApi.mockRejectedValue(new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.'))
    const nav = navigation()
    const r = await render(<ForgotScreen navigation={nav as never} route={{} as never} />)
    act(() => field(r, 'Email').props.onChangeText('ana@example.com'))
    await act(async () => { press(r, 'Send code').props.onPress() })
    await settle()
    expect(text(r)).toContain('Could not reach the server')
    expect(nav.navigate).not.toHaveBeenCalled()
  })
})

describe('Reset password with the emailed code', () => {
  const props = () => ({ navigation: { navigate: jest.fn() } as never, route: { params: { email: 'ana@example.com' } } as never })

  it('asks for the code and a new password that meets the rules, before calling the server', async () => {
    const r = await render(<ResetScreen {...props()} />)
    expect(text(r)).toContain('ana@example.com')
    await act(async () => { press(r, 'Change password').props.onPress() })
    expect(text(r)).toContain('Enter the 6-digit code from the email.')
    act(() => field(r, '6-digit code').props.onChangeText('123456'))
    act(() => field(r, 'New password').props.onChangeText('short'))
    await act(async () => { press(r, 'Change password').props.onPress() })
    expect(mockApi).not.toHaveBeenCalled()
    expect(field(r, 'New password').props.secureTextEntry).toBe(true)
  })

  it('changes the password through the real endpoint and tells the person what happened', async () => {
    const p = props()
    const r = await render(<ResetScreen {...p} />)
    act(() => field(r, '6-digit code').props.onChangeText('123456'))
    act(() => field(r, 'New password').props.onChangeText('BrandNewPass1'))
    await act(async () => { press(r, 'Change password').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/auth/reset-password-code', { method: 'POST', body: { email: 'ana@example.com', code: '123456', newPassword: 'BrandNewPass1' }, auth: false })
    expect(text(r)).toContain('Password changed')
    act(() => press(r, 'Sign in').props.onPress())
    expect((p.navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('Login')
  })

  it('shows the same plain message for a wrong, expired or unknown code', async () => {
    mockApi.mockRejectedValue(new ApiError(400, 'INVALID_CODE', 'That code is not right or has expired. Check it, or ask for a new one.'))
    const r = await render(<ResetScreen {...props()} />)
    act(() => field(r, '6-digit code').props.onChangeText('000000'))
    act(() => field(r, 'New password').props.onChangeText('BrandNewPass1'))
    await act(async () => { press(r, 'Change password').props.onPress() })
    await settle()
    expect(text(r)).toContain('not right or has expired')
    expect(text(r)).not.toContain('Password changed')
  })

  it('offers a new code at once, asks the same endpoint again, and answers in words that do not reveal whether the account exists', async () => {
    const r = await render(<ResetScreen {...props()} />)
    expect(text(r)).not.toContain('You can ask for a new code in')
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/auth/forgot-password', { method: 'POST', body: { email: 'ana@example.com' }, auth: false })
    expect(text(r)).toContain('If an account exists for ana@example.com, a new code was just sent. Check your inbox and your spam folder. Earlier codes no longer work.')
    await act(async () => { press(r, 'Send a new code').props.onPress() }) // and again straight away
    await settle()
    expect(mockApi.mock.calls.filter((c) => c[0] === '/api/auth/forgot-password')).toHaveLength(2)
  })

  it('shows the loading state while a new code is being sent', async () => {
    let release: (v?: unknown) => void = () => {}
    mockApi.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const r = await render(<ResetScreen {...props()} />)
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    expect(text(r)).toContain('Sending a new code…')
    await act(async () => { release(undefined) })
    await settle()
    expect(text(r)).not.toContain('Sending a new code…')
  })

  it('says clearly when the email service could not send the new code, or when the limit was reached', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(503, 'EMAIL_SEND_FAILED', 'The email service did not answer in time. Please try again in a moment.'))
    const r = await render(<ResetScreen {...props()} />)
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(text(r)).toContain('The email service did not answer in time. Please try again in a moment.')
    expect(text(r)).not.toContain('a new code was just sent')
    mockApi.mockRejectedValueOnce(new ApiError(429, 'TOO_MANY_CODES', 'You have asked for several codes in a short time. To keep email delivery reliable, please wait about 15 minutes before asking again. The newest code you received still works.', {}, 900))
    await act(async () => { press(r, 'Send a new code').props.onPress() })
    await settle()
    expect(text(r)).toContain('please wait about 15 minutes')
  })
})

describe('Sign-up sends the code to the address that was typed', () => {
  it('passes exactly the typed email (only trimmed) to the sign-up call, which is the address the code email goes to', async () => {
    mockAuth.register.mockResolvedValue({ id: 'u1' })
    const r = await render(<RegisterScreen navigation={{ navigate: jest.fn() } as never} route={{} as never} />)
    act(() => field(r, 'Display name').props.onChangeText('Ana'))
    act(() => field(r, 'Email').props.onChangeText('  Ana.Test@Other.Example '))
    act(() => field(r, 'Date of birth').props.onChangeText('1990-05-01'))
    act(() => field(r, 'Password').props.onChangeText('Passw0rdOK'))
    act(() => r.root.findAll((n) => n.props.accessibilityRole === 'checkbox')[0].props.onPress())
    await act(async () => { press(r, 'Create account').props.onPress() })
    await settle()
    expect(mockAuth.register).toHaveBeenCalledWith({ displayName: 'Ana', email: 'Ana.Test@Other.Example', dateOfBirth: '1990-05-01', password: 'Passw0rdOK' })
  })
})
