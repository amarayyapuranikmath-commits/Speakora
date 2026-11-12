import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { COUNTRIES, GOALS, LANGUAGES, LEVELS, timeZones } from '../../lib/geo'
import { keys, useBlocked, useProfile, useTopics } from '../../lib/queries'
import type { EnglishLevel, Profile, ProfileInput } from '../../lib/types'
import { usePreferenceUpdates } from '../../lib/usePreferenceUpdates'
import { passwordProblem } from '../../lib/validation'
import { Alert, Button, Chip, EmptyState, ErrorState, Panel, PickerField, RowList, Screen, Spinner, TextField, Title, Toggle } from '../../ui/components'
import { colors, space, type, useKeptState, type ThemePreference } from '../../ui/theme'
import { useTheme } from '../../ui/ThemeContext'
import { useAuth } from '../auth/AuthContext'
import { useCall } from '../call/CallContext'
import { savePreferredLanguage, tutorKeys, type TutorPrefs } from './tutorApi'
import { SpeechSpeedPicker } from './SpeechSpeedPicker'
import { checkSupport } from '../../lib/speech'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai', label: 'AI tutor' },
  { id: 'blocked', label: 'Blocked' },
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsScreen() {
  // Kept when the theme changes (which rebuilds the screen), so choosing a theme does not send you back to Profile.
  const [tab, setTab] = useKeptState<TabId>('settings-tab', 'profile')
  return (
    <Screen>
      <Title>Settings</Title>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: space.xl }} contentContainerStyle={{ gap: space.sm }}>
        {TABS.map((t) => <Chip key={t.id} label={t.label} selected={tab === t.id} onPress={() => setTab(t.id)} />)}
      </ScrollView>
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'account' && <AccountSettings />}
      {tab === 'privacy' && <PrivacySettings />}
      {tab === 'notifications' && <NotificationSettings />}
      {tab === 'appearance' && <AppearanceSettings />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'blocked' && <BlockedSettings />}
    </Screen>
  )
}

/* ---------------------------------- Profile --------------------------------- */

function ProfileSettings() {
  const profile = useProfile()
  if (profile.isLoading) return <Spinner />
  if (profile.isError || !profile.data) return <ErrorState onRetry={() => profile.refetch()} />
  return <ProfileForm initial={profile.data} />
}

function ProfileForm({ initial }: { initial: Profile }) {
  const { updateUser } = useAuth()
  const queryClient = useQueryClient()
  const topics = useTopics()
  const [f, setF] = useState({
    displayName: initial.displayName, country: initial.country ?? '', timeZone: initial.timeZone ?? '',
    nativeLanguage: initial.nativeLanguage ?? '', englishLevel: (initial.englishLevel ?? '') as EnglishLevel | '',
    goals: initial.learningGoals, interests: initial.interests,
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setSaved(false); setF((s) => ({ ...s, [k]: v })) }
  const toggle = (k: 'goals' | 'interests', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v])
  const zones = timeZones()
  const zoneOptions = initial.timeZone && !zones.some((z) => z.value === initial.timeZone) ? [{ value: initial.timeZone, label: initial.timeZone }, ...zones] : zones

  const save = useMutation({
    mutationFn: (input: ProfileInput) => api<Profile>('/api/profile', { method: 'PUT', body: input }),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.profile, p)
      updateUser({ displayName: p.displayName })
      setSaved(true)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'We could not save your profile. Please try again.'),
  })

  const nameOk = f.displayName.trim().length >= 2 && f.displayName.trim().length <= 40
  const complete = nameOk && !!f.country && !!f.timeZone && !!f.nativeLanguage && !!f.englishLevel && f.interests.length > 0

  function submit() {
    setError(null)
    setSaved(false)
    if (!complete) return setShow(true)
    save.mutate({ displayName: f.displayName.trim(), country: f.country, timeZone: f.timeZone, nativeLanguage: f.nativeLanguage, englishLevel: f.englishLevel as EnglishLevel, learningGoals: f.goals, interests: f.interests })
  }

  return (
    <View>
      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="success">Profile saved.</Alert> : null}
      <TextField label="Display name" hint="Shown to people you speak with." value={f.displayName} onChangeText={(t) => set('displayName', t)} maxLength={40} error={show && !nameOk ? 'Use 2 to 40 characters.' : undefined} />
      <PickerField label="Country" value={f.country} options={COUNTRIES} onChange={(v) => set('country', v)} error={show && !f.country ? 'Choose your country.' : undefined} />
      <PickerField label="Time zone" value={f.timeZone} options={zoneOptions} onChange={(v) => set('timeZone', v)} />
      <PickerField label="Native language" value={f.nativeLanguage} options={LANGUAGES} onChange={(v) => set('nativeLanguage', v)} error={show && !f.nativeLanguage ? 'Choose your native language.' : undefined} />
      <PickerField label="English level" value={f.englishLevel} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} onChange={(v) => set('englishLevel', v as EnglishLevel)} error={show && !f.englishLevel ? 'Choose your level.' : undefined} />
      <Text style={[type.label, { marginBottom: space.sm }]}>Conversation interests</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
        {(topics.data ?? []).map((t) => <Chip key={t.slug} label={t.name} selected={f.interests.includes(t.slug)} onPress={() => toggle('interests', t.slug)} />)}
      </View>
      {show && f.interests.length === 0 ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontWeight: '600', marginBottom: space.md }}>Choose at least one interest.</Text> : null}
      <Text style={[type.label, { marginBottom: space.sm }]}>Learning goals</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xl }}>
        {GOALS.map((g) => <Chip key={g.value} label={g.label} selected={f.goals.includes(g.value)} onPress={() => toggle('goals', g.value)} />)}
      </View>
      <Button label="Save changes" onPress={submit} loading={save.isPending} />
    </View>
  )
}

/* ---------------------------------- Account --------------------------------- */

function AccountSettings() {
  const { user, logout } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  return (
    <View style={{ gap: space.lg }}>
      <Panel>
        <Text style={type.heading}>Email</Text>
        <Text style={{ marginTop: space.sm, color: colors.ink }}>{user?.email}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>This address is never shown to other users.</Text>
      </Panel>
      <ChangePassword />
      <Panel>
        <Text style={type.heading}>Sign out</Text>
        <Text style={[type.small, { marginBottom: space.md }]}>Sign out of this device.</Text>
        <Button label="Sign out" variant="secondary" loading={signingOut} onPress={() => { setSigningOut(true); void logout() }} />
      </Panel>
      <DeleteAccount />
    </View>
  )
}

function ChangePassword() {
  const { applySession } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [show, setShow] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: () => api<Parameters<typeof applySession>[0]>('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: async (session) => {
      await applySession(session)
      setCurrent('')
      setNext('')
      setShow(false)
      setDone(true)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'We could not change your password. Please try again.'),
  })
  const problem = passwordProblem(next)

  return (
    <Panel>
      <Text style={type.heading}>Change password</Text>
      <Text style={[type.small, { marginBottom: space.lg }]}>You will stay signed in on this device and be signed out everywhere else.</Text>
      {error ? <Alert>{error}</Alert> : null}
      {done ? <Alert tone="success">Password changed.</Alert> : null}
      <TextField label="Current password" secureTextEntry autoComplete="current-password" value={current} onChangeText={(t) => { setDone(false); setCurrent(t) }} error={show && !current ? 'Enter your current password.' : undefined} />
      <TextField label="New password" secureTextEntry autoComplete="new-password" value={next} onChangeText={(t) => { setDone(false); setNext(t) }} hint="At least 8 characters, with a letter and a number." error={show && problem ? problem : undefined} />
      <Button label="Change password" loading={change.isPending} onPress={() => { setError(null); setDone(false); if (!current || problem) return setShow(true); change.mutate() }} />
    </Panel>
  )
}

function DeleteAccount() {
  const { clearSession } = useAuth()
  const call = useCall()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => api('/api/account', { method: 'DELETE', body: { password } }),
    onSuccess: async () => {
      call.reset()
      await clearSession()
    },
  })

  return (
    <Panel>
      <Text style={type.heading}>Delete account</Text>
      <Text style={[type.small, { marginBottom: space.md }]}>Permanently removes your profile, preferences and sign-in. This cannot be undone.</Text>
      {!open ? <Button label="Delete my account" variant="danger" onPress={() => setOpen(true)} /> : (
        <View>
          {remove.isError ? <Alert>{remove.error instanceof ApiError ? remove.error.message : 'We could not delete your account.'}</Alert> : null}
          <Text style={[type.small, { marginBottom: space.md }]}>Your past calls stay in your former partners’ history under the name “Deleted user”. Enter your password to confirm.</Text>
          <TextField label="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Permanently delete" variant="danger" disabled={!password} loading={remove.isPending} onPress={() => remove.mutate()} style={{ flex: 1 }} />
            <Button label="Cancel" variant="ghost" onPress={() => { setOpen(false); setPassword('') }} />
          </View>
        </View>
      )}
    </Panel>
  )
}

/* ------------------------- Privacy and notifications ------------------------ */

function PrivacySettings() {
  const { prefs, mutation, change } = usePreferenceUpdates()
  if (prefs.isLoading) return <Spinner />
  if (prefs.isError || !prefs.data) return <ErrorState onRetry={() => prefs.refetch()} />
  const p = prefs.data
  return (
    <Panel>
      <Text style={type.heading}>What partners can see</Text>
      <Text style={[type.small, { marginBottom: space.sm }]}>Your display name is always visible. Your email is never shared.</Text>
      {mutation.isError ? <Alert>That change could not be saved.</Alert> : null}
      <Toggle label="Show my country" description="Displayed to partners during a call." value={p.showCountry} onChange={(v) => change({ showCountry: v })} />
      <Toggle label="Show my English level" description="Displayed to partners during a call." value={p.showLevel} onChange={(v) => change({ showLevel: v })} />
      <Toggle label="Let friends ask me for a private call" description="Your friends can ask to talk with you privately. You always choose whether to accept. Turn this off to appear as not accepting calls." value={p.allowPartnerRequests} onChange={(v) => change({ allowPartnerRequests: v })} />
      <Toggle label="Prefer partners at a similar level" description="Matching widens the range if nobody close to your level is available." value={p.matchSimilarLevel} onChange={(v) => change({ matchSimilarLevel: v })} />
      <Toggle label="AI speaking coach" description="Lets you talk or type with an AI coach. Only the text of your conversation is sent to an AI provider, never call audio, and the conversation is not saved. You can turn this off at any time." value={p.aiCoachConsent} onChange={(v) => change({ aiCoachConsent: v })} />
    </Panel>
  )
}

function NotificationSettings() {
  const { prefs, mutation, change } = usePreferenceUpdates()
  if (prefs.isLoading) return <Spinner />
  if (prefs.isError || !prefs.data) return <ErrorState onRetry={() => prefs.refetch()} />
  return (
    <Panel>
      <Text style={type.heading}>Email notifications</Text>
      {mutation.isError ? <Alert>That change could not be saved.</Alert> : null}
      <Toggle label="Practice reminders" description="One email, in the early evening of your time zone, after a couple of days without a conversation. At most one a week." value={prefs.data.notifyEmailReminders} onChange={(v) => change({ notifyEmailReminders: v })} />
    </Panel>
  )
}

/* -------------------------------- Appearance -------------------------------- */

const THEME_CHOICES: { id: ThemePreference; label: string; hint?: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System default', hint: "Follows your phone's light or dark setting." },
]

/** Light (the default), Dark or System default. Saved on this phone and applied at once, everywhere in the app. */
function AppearanceSettings() {
  const { preference, scheme, setPreference } = useTheme()
  return (
    <View>
      <Text style={type.heading}>Theme</Text>
      <View style={{ marginTop: space.md }}>
        <RowList>
          {THEME_CHOICES.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: preference === c.id }}
              accessibilityLabel={c.hint ? `${c.label}. ${c.hint}` : c.label}
              onPress={() => setPreference(c.id)}
              style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.ink, fontWeight: preference === c.id ? '600' : '400' }}>{c.label}</Text>
                {c.hint ? <Text style={type.small}>{c.hint}</Text> : null}
              </View>
              {preference === c.id ? <Check size={20} color={colors.accent} /> : null}
            </Pressable>
          ))}
        </RowList>
      </View>
      <Text style={[type.caption, { marginTop: space.md }]}>
        {preference === 'system' ? `Your phone is using the ${scheme} theme right now.` : 'Saved on this phone.'}
      </Text>
    </View>
  )
}

/* --------------------------------- AI tutor --------------------------------- */

const EXPLANATION_LANGUAGES = ['Kannada', 'Hindi', 'Telugu', 'Tamil'] as const

/** The language the tutor explains in. Saved to the account (the same setting the tutor's own options change), never guessed from location. */
function AiSettings() {
  const queryClient = useQueryClient()
  const prefs = useQuery({ queryKey: tutorKeys.preferences, queryFn: () => api<TutorPrefs>('/api/coach/preferences') })
  const saved = prefs.data?.explanationLanguage ?? null
  const choice = saved === null ? 'English' : (EXPLANATION_LANGUAGES as readonly string[]).includes(saved) ? saved : 'Other'
  const [other, setOther] = useState<string | null>(null)
  const [canSpeak, setCanSpeak] = useState(false)
  useEffect(() => { void checkSupport().then((s) => setCanSpeak(s.synthesis)).catch(() => setCanSpeak(false)) }, [])
  const save = useMutation({
    mutationFn: (value: string | null) => savePreferredLanguage(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tutorKeys.preferences }),
  })

  if (prefs.isLoading) return <Spinner />
  if (prefs.isError || !prefs.data) return <ErrorState onRetry={() => prefs.refetch()} />
  const showOther = choice === 'Other' || other !== null
  const typed = other ?? (choice === 'Other' ? saved ?? '' : '')
  const pick = (v: string) => {
    if (v === 'Other') { setOther(choice === 'Other' && saved ? saved : ''); return }
    setOther(null)
    save.mutate(v === 'English' ? null : v)
  }
  return (
    <Panel>
      <Text style={type.heading}>AI tutor</Text>
      <Text style={[type.small, { marginBottom: space.md }]}>How the tutor explains things. Your choice is saved to your account and used in the app and on the website. Simple English is the default, and English examples always stay in English.</Text>
      {save.isError ? <Alert>{save.error instanceof ApiError ? save.error.message : 'That change could not be saved.'}</Alert> : null}
      <Text style={[type.label, { marginBottom: space.sm }]}>Explain in</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
        {(['English', ...EXPLANATION_LANGUAGES, 'Other'] as const).map((l) => (
          <Chip key={l} label={l === 'English' ? 'Simple English' : l === 'Other' ? 'Another language' : l} selected={showOther ? l === 'Other' : choice === l} onPress={() => pick(l)} />
        ))}
      </View>
      {showOther ? (
        <>
          <TextField label="Language name" hint="For example: Malayalam" value={typed} onChangeText={setOther} maxLength={40} autoCapitalize="words" />
          <Button label="Save language" disabled={!typed.trim() || typed.trim() === saved} loading={save.isPending} onPress={() => save.mutate(typed.trim())} />
        </>
      ) : null}
      <View style={{ marginTop: space.xl }}><SpeechSpeedPicker prefs={prefs.data} canSpeak={canSpeak} /></View>
      <Text style={[type.caption, { marginTop: space.lg }]}>The AI coach itself is turned on or off under Privacy. Coach conversations are not saved: they exist only while you talk and are cleared when you end the session.</Text>
    </Panel>
  )
}

/* ---------------------------------- Blocked --------------------------------- */

function BlockedSettings() {
  const blocked = useBlocked()
  const queryClient = useQueryClient()
  const unblock = useMutation({
    mutationFn: (userId: string) => api(`/api/blocks/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.blocked }),
  })
  if (blocked.isLoading) return <Spinner />
  if (blocked.isError || !blocked.data) return <ErrorState onRetry={() => blocked.refetch()} />
  if (blocked.data.length === 0) return <EmptyState title="No blocked users" description="People you block during or after a call will appear here. You will never be matched with them." />
  return (
    <View>
      {unblock.isError ? <Alert>We could not unblock that person. Please try again.</Alert> : null}
      <Panel style={{ padding: 0 }}>
        {blocked.data.map((b, i) => (
          <View key={b.userId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <View style={{ flex: 1 }}>
              <Text style={type.label}>{b.displayName}</Text>
              <Text style={type.small}>Blocked {formatDate(b.blockedAt)}</Text>
            </View>
            <Button label="Unblock" variant="secondary" loading={unblock.isPending && unblock.variables === b.userId} onPress={() => unblock.mutate(b.userId)} style={{ minHeight: 40 }} />
          </View>
        ))}
      </Panel>
    </View>
  )
}
