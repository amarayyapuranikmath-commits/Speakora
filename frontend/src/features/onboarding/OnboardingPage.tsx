import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { Alert, Spinner } from '../../components/ui/feedback'
import { Chip } from '../../components/ui/Layout'
import { LogoMark } from '../../components/ui/Logo'
import { brand } from '../../config/brand'
import { COUNTRIES, GOALS, LANGUAGES, LEVELS, detectTimeZone, timeZones } from '../../lib/constants'
import { ApiError, api } from '../../lib/api'
import { keys, useProfile, useTopics } from '../../lib/queries'
import type { EnglishLevel, Profile, ProfileInput } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'

const STEPS = ['About you', 'Your English', 'Interests'] as const

export function OnboardingPage() {
  const profile = useProfile()
  const topics = useTopics()
  if (profile.isLoading || topics.isLoading) return <Spinner label="Preparing your profile" />
  if (profile.isError || !profile.data) return <Alert>We could not load your profile. Please refresh the page.</Alert>
  return <OnboardingForm initial={profile.data} topics={topics.data ?? []} />
}

function OnboardingForm({ initial, topics }: { initial: Profile; topics: { slug: string; name: string }[] }) {
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const zones = useMemo(() => timeZones(), [])
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [form, setForm] = useState({
    displayName: initial.displayName,
    country: initial.country ?? '',
    timeZone: initial.timeZone ?? detectTimeZone(),
    nativeLanguage: initial.nativeLanguage ?? '',
    englishLevel: (initial.englishLevel ?? '') as EnglishLevel | '',
    learningGoals: initial.learningGoals,
    interests: initial.interests,
  })

  const save = useMutation({
    mutationFn: (input: ProfileInput) => api<Profile>('/api/profile/onboarding', { method: 'POST', body: input }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.profile, saved)
      updateUser({ onboardingCompleted: true, displayName: saved.displayName })
      navigate('/app', { replace: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'We could not save your profile. Please try again.'),
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const toggle = (key: 'learningGoals' | 'interests', value: string) =>
    set(key, form[key].includes(value) ? form[key].filter((v) => v !== value) : [...form[key], value])

  const stepValid = [
    form.displayName.trim().length >= 2 && !!form.country && !!form.timeZone,
    !!form.nativeLanguage && !!form.englishLevel,
    form.interests.length > 0,
  ]

  function next() {
    if (!stepValid[step]) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    if (step < STEPS.length - 1) setStep(step + 1)
    else {
      setError(null)
      save.mutate({
        displayName: form.displayName.trim(),
        country: form.country,
        timeZone: form.timeZone,
        nativeLanguage: form.nativeLanguage,
        englishLevel: form.englishLevel as EnglishLevel,
        learningGoals: form.learningGoals,
        interests: form.interests,
      })
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-140 flex-col px-5 py-8 sm:py-12">
      <div className="flex items-center gap-2.5 font-semibold">
        <LogoMark />
        {brand.name}
      </div>

      <nav aria-label="Progress" className="mt-10">
        <ol className="flex gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <div className={`h-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-line'}`} />
              <span className={`mt-2 block text-xs ${i === step ? 'font-medium text-ink' : 'text-subtle'}`}>{label}</span>
            </li>
          ))}
        </ol>
      </nav>

      <form
        className="mt-8 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          next()
        }}
        noValidate
      >
        {error && <div className="mb-5"><Alert>{error}</Alert></div>}

        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold">Let’s set up your profile</h1>
              <p className="mt-2 text-muted">This helps us find partners you will enjoy talking to. You can change it any time.</p>
            </div>
            <TextField
              label="Display name"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              maxLength={40}
              error={showErrors && form.displayName.trim().length < 2 ? 'Use at least 2 characters.' : undefined}
            />
            <SelectField label="Country" value={form.country} onChange={(e) => set('country', e.target.value)} error={showErrors && !form.country ? 'Choose your country.' : undefined}>
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </SelectField>
            <SelectField label="Time zone" value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} hint="Detected from your device.">
              {!zones.includes(form.timeZone) && <option value={form.timeZone}>{form.timeZone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>
              ))}
            </SelectField>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Your English</h1>
              <p className="mt-2 text-muted">Be honest: you will be matched with people at a similar level.</p>
            </div>
            <SelectField
              label="Native language"
              value={form.nativeLanguage}
              onChange={(e) => set('nativeLanguage', e.target.value)}
              error={showErrors && !form.nativeLanguage ? 'Choose your native language.' : undefined}
            >
              <option value="">Select a language</option>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </SelectField>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">English level</legend>
              <div className="divide-y divide-line overflow-hidden rounded-control border border-line-strong bg-surface">
                {LEVELS.map((l) => (
                  <label key={l.value} className={`flex cursor-pointer items-start gap-3 px-4 py-3 ${form.englishLevel === l.value ? 'bg-accent-soft' : 'hover:bg-canvas'}`}>
                    <input type="radio" name="level" value={l.value} checked={form.englishLevel === l.value} onChange={() => set('englishLevel', l.value)} className="mt-1 accent-accent" />
                    <span>
                      <span className="block text-sm font-medium">{l.label}</span>
                      <span className="block text-sm text-muted">{l.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {showErrors && !form.englishLevel && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">Choose your level.</p>}
            </fieldset>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-semibold">What do you like to talk about?</h1>
              <p className="mt-2 text-muted">Pick at least one. We use this to suggest topics and pair you with people who share them.</p>
            </div>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Conversation interests</legend>
              <div className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <Chip key={t.slug} selected={form.interests.includes(t.slug)} onClick={() => toggle('interests', t.slug)}>
                    {t.name}
                  </Chip>
                ))}
              </div>
              {showErrors && form.interests.length === 0 && <p role="alert" className="mt-2 text-xs font-medium text-danger">Choose at least one interest.</p>}
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Learning goals <span className="font-normal text-subtle">(optional)</span></legend>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <Chip key={g.value} selected={form.learningGoals.includes(g.value)} onClick={() => toggle('learningGoals', g.value)}>
                    {g.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="mt-10 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => { setShowErrors(false); setStep(step - 1) }}>Back</Button>
          ) : <span />}
          <Button type="submit" size="lg" loading={save.isPending}>
            {step === STEPS.length - 1 ? 'Finish' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  )
}
