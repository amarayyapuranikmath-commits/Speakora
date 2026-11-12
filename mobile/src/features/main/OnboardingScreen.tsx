import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError, api } from '../../lib/api'
import { COUNTRIES, GOALS, LANGUAGES, LEVELS, detectTimeZone, timeZones } from '../../lib/geo'
import { keys, useProfile, useTopics } from '../../lib/queries'
import type { EnglishLevel, Profile, ProfileInput } from '../../lib/types'
import { Alert, Button, Chip, PickerField, Screen, Spinner, TextField } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { useAuth } from '../auth/AuthContext'

const STEPS = ['About you', 'Your English', 'Interests']

export function OnboardingScreen() {
  const profile = useProfile()
  const topics = useTopics()
  if (profile.isLoading || topics.isLoading) return <Screen><Spinner label="Preparing your profile" /></Screen>
  if (profile.isError || !profile.data) return <Screen><Alert>We could not load your profile. Please restart the app.</Alert></Screen>
  return <Form initial={profile.data} topics={topics.data ?? []} />
}

function Form({ initial, topics }: { initial: Profile; topics: { slug: string; name: string }[] }) {
  const { updateUser } = useAuth()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({
    displayName: initial.displayName, country: initial.country ?? '', timeZone: initial.timeZone ?? detectTimeZone(),
    nativeLanguage: initial.nativeLanguage ?? '', englishLevel: (initial.englishLevel ?? '') as EnglishLevel | '',
    goals: initial.learningGoals, interests: initial.interests,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const toggle = (k: 'goals' | 'interests', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v])

  const save = useMutation({
    mutationFn: (input: ProfileInput) => api<Profile>('/api/profile/onboarding', { method: 'POST', body: input }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.profile, saved)
      updateUser({ onboardingCompleted: true, displayName: saved.displayName })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'We could not save your profile. Please try again.'),
  })

  const valid = [f.displayName.trim().length >= 2 && !!f.country && !!f.timeZone, !!f.nativeLanguage && !!f.englishLevel, f.interests.length > 0]

  function next() {
    if (!valid[step]) return setShow(true)
    setShow(false)
    if (step < 2) return setStep(step + 1)
    setError(null)
    save.mutate({
      displayName: f.displayName.trim(), country: f.country, timeZone: f.timeZone, nativeLanguage: f.nativeLanguage,
      englishLevel: f.englishLevel as EnglishLevel, learningGoals: f.goals, interests: f.interests,
    })
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.sm }} accessibilityLabel={`Step ${step + 1} of 3: ${STEPS[step]}`}>
        {STEPS.map((s, i) => <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.accent : colors.line }} />)}
      </View>
      <Text style={[type.caption, { marginBottom: space.xl }]}>{STEPS[step]}</Text>
      {error ? <Alert>{error}</Alert> : null}

      {step === 0 && (
        <>
          <Text accessibilityRole="header" style={[type.title, { marginBottom: space.sm }]}>Let’s set up your profile</Text>
          <Text style={[type.small, { fontSize: 16, marginBottom: space.xl }]}>This helps us find partners you will enjoy talking to. You can change it any time.</Text>
          <TextField label="Display name" value={f.displayName} onChangeText={(t) => set('displayName', t)} maxLength={40} error={show && f.displayName.trim().length < 2 ? 'Use at least 2 characters.' : undefined} />
          <PickerField label="Country" value={f.country} options={COUNTRIES} onChange={(v) => set('country', v)} error={show && !f.country ? 'Choose your country.' : undefined} />
          <PickerField label="Time zone" value={f.timeZone} options={timeZones()} onChange={(v) => set('timeZone', v)} />
        </>
      )}

      {step === 1 && (
        <>
          <Text accessibilityRole="header" style={[type.title, { marginBottom: space.sm }]}>Your English</Text>
          <Text style={[type.small, { fontSize: 16, marginBottom: space.xl }]}>Be honest: you will be matched with people at a similar level.</Text>
          <PickerField label="Native language" value={f.nativeLanguage} options={LANGUAGES} onChange={(v) => set('nativeLanguage', v)} error={show && !f.nativeLanguage ? 'Choose your native language.' : undefined} />
          <Text style={[type.label, { marginBottom: space.sm }]}>English level</Text>
          <View style={{ borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface }}>
            {LEVELS.map((l, i) => (
              <Pressable
                key={l.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: f.englishLevel === l.value }}
                onPress={() => set('englishLevel', l.value)}
                style={{ padding: space.md, flexDirection: 'row', gap: space.md, backgroundColor: f.englishLevel === l.value ? colors.accentSoft : colors.surface, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: f.englishLevel === l.value ? colors.accent : colors.lineStrong, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  {f.englishLevel === l.value ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.label}>{l.label}</Text>
                  <Text style={type.small}>{l.description}</Text>
                </View>
              </Pressable>
            ))}
          </View>
          {show && !f.englishLevel ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, fontWeight: '600', marginTop: 6 }]}>Choose your level.</Text> : null}
        </>
      )}

      {step === 2 && (
        <>
          <Text accessibilityRole="header" style={[type.title, { marginBottom: space.sm }]}>What do you like to talk about?</Text>
          <Text style={[type.small, { fontSize: 16, marginBottom: space.xl }]}>Pick at least one. We use it to suggest topics and pair you with people who share them.</Text>
          <Text style={[type.label, { marginBottom: space.md }]}>Conversation interests</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {topics.map((t) => <Chip key={t.slug} label={t.name} selected={f.interests.includes(t.slug)} onPress={() => toggle('interests', t.slug)} />)}
          </View>
          {show && f.interests.length === 0 ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, fontWeight: '600', marginTop: 6 }]}>Choose at least one interest.</Text> : null}
          <Text style={[type.label, { marginTop: space.xl, marginBottom: space.md }]}>Learning goals (optional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {GOALS.map((g) => <Chip key={g.value} label={g.label} selected={f.goals.includes(g.value)} onPress={() => toggle('goals', g.value)} />)}
          </View>
        </>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xxl, gap: space.md }}>
        {step > 0 ? <Button label="Back" variant="ghost" onPress={() => { setShow(false); setStep(step - 1) }} /> : <View />}
        <Button label={step === 2 ? 'Finish' : 'Continue'} onPress={next} loading={save.isPending} style={{ flex: 1, maxWidth: 220 }} />
      </View>
    </Screen>
  )
}
