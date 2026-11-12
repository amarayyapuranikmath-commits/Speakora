import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { BrandRow } from '../../ui/BrandMark'
import { Alert, Button, Screen, TextField, Title } from '../../ui/components'
import { colors, space } from '../../ui/theme'
import { useAuth } from './AuthContext'

/**
 * Shown right after signing up (or signing in with an address that is not verified yet): the app opens only once the emailed code is entered.
 * A new code can be asked for at any time; it is sent at once and only the newest works.
 */
export function VerifyEmailScreen() {
  const { user, reloadUser, logout, verificationEmailProblem } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(verificationEmailProblem)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)

  async function verify() {
    if (!/^[0-9]{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.')
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await api('/api/auth/verify-email-code', { method: 'POST', body: { code: code.trim() } })
      await reloadUser() // the account is now verified, so the app opens by itself
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setInfo(null)
    setSending(true)
    try {
      await api('/api/auth/resend-verification', { method: 'POST' })
      setInfo(`A new code was sent to ${user?.email}. Check your inbox and your spam folder. Earlier codes no longer work.`)
    } catch (e) {
      // The server says what went wrong: the email service could not send it, or too many codes were asked for in a short time (with how long to wait).
      setError(e instanceof ApiError ? e.message : 'We could not send a new code. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Screen>
      <BrandRow />
      <Title sub={verificationEmailProblem ? `We could not send the code to ${user?.email}.` : `We sent a 6-digit code to ${user?.email}. It works for 30 minutes. Check your inbox and your spam folder.`}>Verify your email</Title>
      {error ? <Alert>{error}</Alert> : null}
      {info ? <Alert tone="success">{info}</Alert> : null}
      <TextField label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
      <Button label="Verify" onPress={verify} loading={busy} />
      <View style={{ marginTop: space.lg, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Send a new code" accessibilityState={{ disabled: sending, busy: sending }} disabled={sending} onPress={() => void resend()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>{sending ? 'Sending a new code…' : 'Send a new code'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Use a different account" onPress={() => void logout()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.muted }}>Wrong address? Sign out</Text>
        </Pressable>
      </View>
    </Screen>
  )
}
