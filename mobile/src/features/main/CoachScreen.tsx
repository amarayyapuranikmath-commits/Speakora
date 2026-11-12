import { useIsFocused, useRoute } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { api } from '../../lib/api'
import { useCall } from '../call/CallContext'
import type { CoachStatus } from '../../lib/types'
import { useProfile } from '../../lib/queries'
import { usePreferenceUpdates } from '../../lib/usePreferenceUpdates'
import { TutorChat } from './TutorChat'
import { Alert, Button, EmptyState, ErrorState, Screen, Spinner, Title } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'

export function CoachScreen() {
  const { params } = useRoute<any>()
  const status = useQuery({ queryKey: ['coach', 'status'], queryFn: () => api<CoachStatus>('/api/coach/status') })
  // The conversation fills the screen like a messaging app, so it is not inside the scrolling page used by the other states.
  if (status.data?.available && status.data.consent) {
    return <CoachShell initialMode={params?.mode} topicId={params?.topic} />
  }
  return (
    <Screen>
      <Title sub="Talk to an English coach by voice or text.">AI Coach</Title>
      {status.isLoading ? <Spinner /> : status.isError || !status.data ? <ErrorState onRetry={() => status.refetch()} /> :
        !status.data.available ? <EmptyState title="The coach is not enabled" description="This server has no AI provider configured yet. Everything else works as normal." /> :
        <Consent />}
    </Screen>
  )
}

function CoachShell({ initialMode, topicId }: { initialMode?: string; topicId?: string }) {
  // Voice must not hold the microphone while another tab is showing or while a call is in progress.
  const focused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { phase } = useCall()
  const profile = useProfile()
  const inCall = phase !== 'idle' && phase !== 'ended'
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <TutorChat initialMode={initialMode} topicId={topicId} suspended={!focused || inCall} level={profile.data?.englishLevel ?? null} />
    </View>
  )
}

function Consent() {
  const { prefs, mutation, change } = usePreferenceUpdates()
  const queryClient = useQueryClient()
  // Refresh the coach status only once the choice has really been saved.
  useEffect(() => {
    if (mutation.isSuccess) void queryClient.invalidateQueries({ queryKey: ['coach'] })
  }, [mutation.isSuccess, queryClient])
  return (
    <View>
      <Text style={[type.heading, { marginBottom: space.md }]}>Before you start</Text>
      {[
        'Your conversation is not saved. It is kept only in the app while you talk, and it is gone when you end the session or close the app. There is no history, and no transcript or recording is stored.',
        'To write replies, the text of your conversation is sent to an AI provider, which processes it to answer you. This app does not keep it. If you use voice, your phone’s speech recognition may send audio to its own provider (usually Google).',
        'Your calls are never recorded or analysed. The coach never hears your calls or your voice.',
        'Your learning progress, settings and account are kept as normal. You can turn the coach off at any time in Settings.',
      ].map((t) => <Text key={t} style={[type.small, { fontSize: 15, lineHeight: 22, marginBottom: space.sm }]}>•  {t}</Text>)}
      {mutation.isError ? <Alert>That could not be saved. Please try again.</Alert> : null}
      <Button label="I agree, turn on the coach" loading={mutation.isPending} disabled={!prefs.data} onPress={() => change({ aiCoachConsent: true })} style={{ marginTop: space.lg }} />
    </View>
  )
}
