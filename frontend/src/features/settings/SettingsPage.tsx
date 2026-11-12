import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/feedback'
import { Chip, PageHeader, Panel } from '../../components/ui/Layout'
import { Toggle } from '../../components/ui/Toggle'
import { ApiError, api } from '../../lib/api'
import { COUNTRIES, GOALS, LANGUAGES, LEVELS, timeZones } from '../../lib/constants'
import { formatDate } from '../../lib/format'
import { keys, useBlocked, useProfile, useTopics } from '../../lib/queries'
import { usePreferenceUpdates } from '../../lib/usePreferenceUpdates'
import type { EnglishLevel, Profile, ProfileInput, SessionResponse } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { applyApiError } from '../auth/formErrors'
import { passwordSchema } from '../auth/schemas'
import { useCall } from '../call/CallContext'
import { SpeechSpeedControl } from '../coach/SpeechSpeedControl'
import { savePreferredLanguage, tutorKeys, type TutorPrefs } from '../coach/tutorApi'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'ai', label: 'AI tutor' },
  { id: 'blocked', label: 'Blocked users' },
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('profile')
  return (
    <>
      <PageHeader title="Settings" />
      <div
        role="tablist"
        aria-label="Settings sections"
        className="-mx-4 mb-8 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
        onKeyDown={(e) => {
          // Arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern, automatic activation).
          const i = TABS.findIndex((t) => t.id === tab)
          const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
          if (next < 0) return
          e.preventDefault()
          setTab(TABS[next].id)
          document.getElementById(`tab-${TABS[next].id}`)?.focus()
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium ${tab === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="max-w-2xl">
        {tab === 'profile' && <ProfileSettings />}
        {tab === 'account' && <AccountSettings />}
        {tab === 'privacy' && <PrivacySettings />}
        {tab === 'notifications' && <NotificationSettings />}
        {tab === 'ai' && <AiSettings />}
        {tab === 'blocked' && <BlockedSettings />}
      </div>
    </>
  )
}

/* ---------------------------------- Profile --------------------------------- */

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(40, 'Use at most 40 characters.'),
  country: z.string().min(1, 'Choose your country.'),
  timeZone: z.string().min(1, 'Choose your time zone.'),
  nativeLanguage: z.string().min(1, 'Choose your native language.'),
  englishLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], { error: 'Choose your level.' }),
})
type ProfileValues = z.infer<typeof profileSchema>

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
  const zones = useMemo(() => timeZones(), [])
  const [goals, setGoals] = useState(initial.learningGoals)
  const [interests, setInterests] = useState(initial.interests)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: initial.displayName,
      country: initial.country ?? '',
      timeZone: initial.timeZone ?? '',
      nativeLanguage: initial.nativeLanguage ?? '',
      englishLevel: initial.englishLevel ?? undefined,
    },
  })

  const save = useMutation({
    mutationFn: (input: ProfileInput) => api<Profile>('/api/profile', { method: 'PUT', body: input }),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.profile, p)
      updateUser({ displayName: p.displayName })
      setSaved(true)
    },
  })

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    setSaved(false)
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  async function onSubmit(values: ProfileValues) {
    setFormError(null)
    setSaved(false)
    try {
      await save.mutateAsync({ ...values, englishLevel: values.englishLevel as EnglishLevel, learningGoals: goals, interests })
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6" onChange={() => setSaved(false)}>
      {formError && <Alert>{formError}</Alert>}
      {saved && <Alert tone="success">Profile saved.</Alert>}
      <TextField label="Display name" hint="Shown to people you speak with." error={errors.displayName?.message} {...register('displayName')} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Country" error={errors.country?.message} {...register('country')}>
          <option value="">Select a country</option>
          {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </SelectField>
        <SelectField label="Time zone" error={errors.timeZone?.message} {...register('timeZone')}>
          {initial.timeZone && !zones.includes(initial.timeZone) && <option value={initial.timeZone}>{initial.timeZone}</option>}
          {zones.map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
        </SelectField>
        <SelectField label="Native language" error={errors.nativeLanguage?.message} {...register('nativeLanguage')}>
          <option value="">Select a language</option>
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </SelectField>
        <SelectField label="English level" error={errors.englishLevel?.message} {...register('englishLevel')}>
          <option value="">Select a level</option>
          {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </SelectField>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Conversation interests</legend>
        <div className="flex flex-wrap gap-2">
          {(topics.data ?? []).map((t) => (
            <Chip key={t.slug} selected={interests.includes(t.slug)} onClick={() => toggle(interests, setInterests, t.slug)}>{t.name}</Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Learning goals</legend>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <Chip key={g.value} selected={goals.includes(g.value)} onClick={() => toggle(goals, setGoals, g.value)}>{g.label}</Chip>
          ))}
        </div>
      </fieldset>
      <Button type="submit" loading={save.isPending} disabled={interests.length === 0}>Save changes</Button>
    </form>
  )
}

/* ---------------------------------- Account --------------------------------- */

const passwordForm = z.object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: passwordSchema })
type PasswordValues = z.infer<typeof passwordForm>

function AccountSettings() {
  const { user } = useAuth()
  return (
    <div className="space-y-6">
      <Panel title="Email">
        <p className="text-sm">{user?.email}</p>
        <p className="mt-1 text-sm text-muted">This address is never shown to other users.</p>
      </Panel>
      <ChangePassword />
      <DeleteAccount />
    </div>
  )
}

function ChangePassword() {
  const { applySession } = useAuth()
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordForm) })

  async function onSubmit(values: PasswordValues) {
    setFormError(null)
    setDone(false)
    try {
      const session = await api<SessionResponse>('/api/account/password', { method: 'POST', body: values })
      applySession(session)
      reset()
      setDone(true)
    } catch (e) {
      setFormError(applyApiError(e, setError))
    }
  }

  return (
    <Panel title="Change password" description="You will stay signed in on this device and be signed out everywhere else.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        {done && <Alert tone="success">Password changed.</Alert>}
        <TextField label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." error={errors.newPassword?.message} {...register('newPassword')} />
        <Button type="submit" loading={isSubmitting}>Change password</Button>
      </form>
    </Panel>
  )
}

function DeleteAccount() {
  const { clearSession } = useAuth()
  const call = useCall()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => api('/api/account', { method: 'DELETE', body: { password } }),
    onSuccess: () => {
      call.reset()
      navigate('/', { replace: true })
      clearSession('user')
    },
  })

  return (
    <Panel title="Delete account" description="Permanently removes your profile, preferences and sign-in. This cannot be undone.">
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>Delete my account</Button>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            remove.mutate()
          }}
        >
          {remove.isError && <Alert>{remove.error instanceof ApiError ? remove.error.message : 'We could not delete your account.'}</Alert>}
          <p className="text-sm text-muted">Your past calls stay in your former partners’ history under the name “Deleted user”. Enter your password to confirm.</p>
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={remove.isPending} disabled={!password}>Permanently delete</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setPassword('') }}>Cancel</Button>
          </div>
        </form>
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
    <Panel title="What partners can see" description="Your display name is always visible. Your email is never shared.">
      {mutation.isError && <div className="mb-3"><Alert>That change could not be saved.</Alert></div>}
      <div className="divide-y divide-line">
        <Toggle label="Show my country" description="Displayed to partners during a call." checked={p.showCountry} onChange={(v) => change({ showCountry: v })} />
        <Toggle label="Show my English level" description="Displayed to partners during a call." checked={p.showLevel} onChange={(v) => change({ showLevel: v })} />
        <Toggle label="Let friends ask me for a private call" description="Your friends can ask to talk with you privately. You always choose whether to accept. Turn this off to appear as not accepting calls." checked={p.allowPartnerRequests} onChange={(v) => change({ allowPartnerRequests: v })} />
        <Toggle label="Prefer partners at a similar level" description="Matching widens the range if nobody close to your level is available." checked={p.matchSimilarLevel} onChange={(v) => change({ matchSimilarLevel: v })} />
        <Toggle
          label="AI speaking coach"
          description="Lets you talk or type with an AI coach. Only the text of your conversation is sent to an AI provider, never call audio, and the conversation is not saved. You can turn this off at any time."
          checked={p.aiCoachConsent}
          onChange={(v) => change({ aiCoachConsent: v })}
        />
      </div>
    </Panel>
  )
}

function NotificationSettings() {
  const { prefs, mutation, change } = usePreferenceUpdates()
  if (prefs.isLoading) return <Spinner />
  if (prefs.isError || !prefs.data) return <ErrorState onRetry={() => prefs.refetch()} />
  const p = prefs.data
  return (
    <Panel title="Email notifications">
      {mutation.isError && <div className="mb-3"><Alert>That change could not be saved.</Alert></div>}
      <div className="divide-y divide-line">
        <Toggle
          label="Practice reminders"
          description="One email, in the early evening of your time zone, after a couple of days without a conversation. At most one a week."
          checked={p.notifyEmailReminders}
          onChange={(v) => change({ notifyEmailReminders: v })}
        />
      </div>
    </Panel>
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
  const save = useMutation({
    mutationFn: (value: string | null) => savePreferredLanguage(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tutorKeys.preferences }),
  })

  if (prefs.isLoading) return <Spinner />
  if (prefs.isError || !prefs.data) return <ErrorState onRetry={() => prefs.refetch()} />
  const typed = other ?? (choice === 'Other' ? saved ?? '' : '')
  return (
    <Panel title="AI tutor" description="How the tutor explains things. Your choice is saved to your account and used on the website and in the app.">
      {save.isError && <div className="mb-3"><Alert>{save.error instanceof ApiError ? save.error.message : 'That change could not be saved.'}</Alert></div>}
      <div className="grid gap-4">
        <SelectField
          label="Explain in"
          hint="Simple English is the default. English examples always stay in English."
          value={choice}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'Other') { setOther(saved && choice === 'Other' ? saved : ''); return }
            setOther(null)
            save.mutate(v === 'English' ? null : v)
          }}
        >
          <option value="English">Simple English</option>
          {EXPLANATION_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="Other">Another language</option>
        </SelectField>
        {(choice === 'Other' || other !== null) && (
          <TextField label="Language name" hint="For example: Malayalam. The tutor will explain in this language when it can." value={typed} maxLength={40}
            onChange={(e) => setOther(e.target.value)} onBlur={() => { if (other !== null && other.trim()) save.mutate(other.trim()) }} />
        )}
        <SpeechSpeedControl prefs={prefs.data} />
        <p className="text-sm text-muted">The AI coach itself is turned on or off under Privacy. Coach conversations are not saved: they exist only while you talk and are cleared when you end the session.</p>
      </div>
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
  if (blocked.data.length === 0) {
    return <EmptyState title="No blocked users" description="People you block during or after a call will appear here. You will never be matched with them." />
  }
  return (
    <>
    {unblock.isError && <div className="mb-3"><Alert>We could not unblock that person. Please try again.</Alert></div>}
    <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {blocked.data.map((b) => (
        <li key={b.userId} className="flex items-center justify-between gap-4 px-5 py-3.5">
          <div>
            <p className="font-medium">{b.displayName}</p>
            <p className="text-sm text-muted">Blocked {formatDate(b.blockedAt)}</p>
          </div>
          <Button variant="secondary" loading={unblock.isPending && unblock.variables === b.userId} onClick={() => unblock.mutate(b.userId)}>Unblock</Button>
        </li>
      ))}
    </ul>
    </>
  )
}
