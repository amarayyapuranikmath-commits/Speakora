import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { isAtLeast18, isEmail, parseDate, passwordProblem } from '../../lib/validation'
import { BrandRow } from '../../ui/BrandMark'
import { Alert, Button, Screen, TextField, Title } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { useAuth } from './AuthContext'

export type AuthStackParams = { Welcome: undefined; Login: undefined; Register: undefined; Forgot: undefined; Reset: { email: string } }
type Props<T extends keyof AuthStackParams> = NativeStackScreenProps<AuthStackParams, T>

export { WelcomeScreen } from './WelcomeScreen'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')

export function LoginScreen({ navigation }: Props<'Login'>) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const next: typeof errors = {}
    if (!isEmail(email)) next.email = email ? 'Enter a valid email address.' : 'Enter your email.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (e) {
      setFormError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <BrandRow />
      <Title sub="Sign in to keep practising.">Welcome back</Title>
      {formError ? <Alert>{formError}</Alert> : null}
      <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Forgot')} style={{ alignSelf: 'flex-end', marginBottom: space.lg }}>
        <Text style={{ color: colors.accent, fontWeight: '600' }}>Forgot password?</Text>
      </Pressable>
      <Button label="Sign in" onPress={submit} loading={busy} />
      <View style={{ marginTop: space.xl, alignItems: 'center' }}>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Register')}>
          <Text style={type.small}>New here? <Text style={{ color: colors.accent, fontWeight: '600' }}>Create an account</Text></Text>
        </Pressable>
      </View>
    </Screen>
  )
}

export function RegisterScreen({ navigation }: Props<'Register'>) {
  const { register } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [dob, setDob] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const next: Record<string, string> = {}
    if (displayName.trim().length < 2) next.displayName = 'Use at least 2 characters.'
    if (!isEmail(email)) next.email = 'Enter a valid email address.'
    if (!dob.trim()) next.dob = 'Enter your date of birth.'
    else if (!parseDate(dob)) next.dob = 'Use the format YYYY-MM-DD, for example 1990-05-21.'
    else if (!isAtLeast18(dob)) next.dob = 'You must be at least 18 years old to use this service.'
    const pw = passwordProblem(password)
    if (pw) next.password = pw
    if (!agree) next.agree = 'Please confirm to continue.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await register({ displayName: displayName.trim(), email: email.trim(), dateOfBirth: dob.trim(), password })
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.details).length) setErrors(e.details)
      else setFormError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <BrandRow />
      <Title sub="Free to start. You must be 18 or older.">Create your account</Title>
      {formError ? <Alert>{formError}</Alert> : null}
      <TextField label="Display name" hint="Partners will see this name." value={displayName} onChangeText={setDisplayName} error={errors.displayName} autoComplete="name" />
      <TextField label="Email" hint="Never shown to other users." value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <TextField label="Date of birth" hint="YYYY-MM-DD. Used only to confirm you are 18 or older." value={dob} onChangeText={setDob} error={errors.dob ?? errors.dateOfBirth} keyboardType="numbers-and-punctuation" maxLength={10} />
      <TextField label="Password" hint="At least 8 characters, with a letter and a number." value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="new-password" />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agree }}
        onPress={() => setAgree(!agree)}
        style={{ flexDirection: 'row', gap: space.md, marginBottom: space.sm }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: agree ? colors.accent : colors.lineStrong, backgroundColor: agree ? colors.accent : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          {agree ? <Text style={{ color: colors.onAccent, fontSize: 14, fontWeight: '700' }}>✓</Text> : null}
        </View>
        <Text style={[type.small, { flex: 1 }]}>I am 18 or older and I agree to follow the community guidelines: be respectful, no harassment or abuse.</Text>
      </Pressable>
      {errors.agree ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, fontWeight: '600', marginBottom: space.md }]}>{errors.agree}</Text> : null}
      <View style={{ marginTop: space.md }}><Button label="Create account" onPress={submit} loading={busy} /></View>
      <View style={{ marginTop: space.xl, alignItems: 'center' }}>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Login')}>
          <Text style={type.small}>Already have an account? <Text style={{ color: colors.accent, fontWeight: '600' }}>Sign in</Text></Text>
        </Pressable>
      </View>
    </Screen>
  )
}

export function ForgotScreen({ navigation }: Props<'Forgot'>) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!isEmail(email)) return setError('Enter a valid email address.')
    setError(null)
    setBusy(true)
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, auth: false })
      // The same screen follows whether or not the account exists, so this never reveals which addresses are registered.
      navigation.navigate('Reset', { email: email.trim() })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <BrandRow />
      <Title sub="Enter your email and we will send you a 6-digit code to choose a new password.">Reset your password</Title>
      {error ? <Alert>{error}</Alert> : null}
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Button label="Send code" onPress={submit} loading={busy} />
      <View style={{ marginTop: space.xl, alignItems: 'center' }}>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Login')}><Text style={{ color: colors.accent, fontWeight: '600' }}>Back to sign in</Text></Pressable>
      </View>
    </Screen>
  )
}

/** Step two of a password reset: the code from the email and the new password. */
export function ResetScreen({ navigation, route }: Props<'Reset'>) {
  const email = route.params.email
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ code?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [resent, setResent] = useState(false)
  const [sending, setSending] = useState(false)

  async function submit() {
    const next: typeof errors = {}
    if (!/^[0-9]{6}$/.test(code.trim())) next.code = 'Enter the 6-digit code from the email.'
    const pw = passwordProblem(password)
    if (pw) next.password = pw
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await api('/api/auth/reset-password-code', { method: 'POST', body: { email, code: code.trim(), newPassword: password }, auth: false })
      setDone(true)
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.details).length) setErrors({ code: e.details.code, password: e.details.newPassword })
      else setFormError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  /** A new code at any time: sent at once, only the newest works. The server's own message explains a failure or a limit. */
  async function resend() {
    setFormError(null)
    setResent(false)
    setSending(true)
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email }, auth: false })
      setResent(true)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'We could not send a new code. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <Screen>
        <BrandRow />
        <Title>Password changed</Title>
        <Alert tone="success">Your password has been changed and you were signed out everywhere else. Sign in with your new password.</Alert>
        <Button label="Sign in" onPress={() => navigation.navigate('Login')} />
      </Screen>
    )
  }
  return (
    <Screen>
      <BrandRow />
      <Title sub={`If an account exists for ${email}, we sent a 6-digit code to it. The code works for 30 minutes.`}>Check your email</Title>
      {formError ? <Alert>{formError}</Alert> : null}
      {resent ? <Alert tone="success">{`If an account exists for ${email}, a new code was just sent. Check your inbox and your spam folder. Earlier codes no longer work.`}</Alert> : null}
      <TextField label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))} error={errors.code} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
      <TextField label="New password" hint="At least 8 characters, with a letter and a number." value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="new-password" />
      <Button label="Change password" onPress={submit} loading={busy} />
      <View style={{ marginTop: space.lg, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Send a new code" accessibilityState={{ disabled: sending, busy: sending }} disabled={sending} onPress={() => void resend()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>{sending ? 'Sending a new code…' : 'Send a new code'}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Login')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.muted, fontWeight: '600' }}>Back to sign in</Text></Pressable>
      </View>
    </Screen>
  )
}
