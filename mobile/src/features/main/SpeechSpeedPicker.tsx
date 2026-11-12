import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ApiError } from '../../lib/api'
import { SPEECH_SPEEDS, createSpeaker, speechSpeedOf, type Speaker, type SpeechSpeed } from '../../lib/speech'
import { Chip } from '../../ui/components'
import { colors, space, type } from '../../ui/theme'
import { saveSpeechSpeed, tutorKeys, type TutorPrefs } from './tutorApi'

export const SPEED_SAMPLE = 'This is how the tutor will sound. I will speak clearly, with a short pause after each sentence.'

/**
 * Slow / Normal / Fast for the tutor's voice. The choice is saved to the account and used everywhere the tutor speaks (voice
 * conversations and "read replies aloud"). "Hear a sample" speaks one short text at the chosen speed so the learner can judge it.
 * Changing the speed never changes how quickly replies are written, only how fast they are read aloud.
 */
export function SpeechSpeedPicker({ prefs, canSpeak }: { prefs: TutorPrefs | undefined; canSpeak: boolean }) {
  const queryClient = useQueryClient()
  const speed = speechSpeedOf(prefs?.speechSpeed)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const sample = useRef<Speaker | null>(null)

  useEffect(() => () => { sample.current?.stop() }, [])

  async function choose(next: SpeechSpeed) {
    if (next === speed) return
    setError(null)
    sample.current?.stop()
    setPlaying(false)
    const before = queryClient.getQueryData<TutorPrefs>(tutorKeys.preferences)
    queryClient.setQueryData<TutorPrefs>(tutorKeys.preferences, (old) => ({ explanationLanguage: old?.explanationLanguage ?? null, ...old, speechSpeed: next }))
    try {
      await saveSpeechSpeed(next)
    } catch (e) {
      queryClient.setQueryData(tutorKeys.preferences, before)
      setError(e instanceof ApiError ? e.message : 'Your speed choice could not be saved. Please try again.')
    }
  }

  function toggleSample() {
    if (playing) {
      sample.current?.stop()
      setPlaying(false)
      return
    }
    const s = createSpeaker(() => setPlaying(false), () => setPlaying(false), speed)
    sample.current = s
    setPlaying(true)
    s.push(SPEED_SAMPLE + ' ')
    s.finish()
  }

  return (
    <View>
      <Text style={type.label}>Speaking speed</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.md }}>
        {(Object.keys(SPEECH_SPEEDS) as SpeechSpeed[]).map((k) => <Chip key={k} label={SPEECH_SPEEDS[k].label} selected={speed === k} onPress={() => void choose(k)} />)}
      </View>
      {canSpeak ? (
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Stop the sample' : 'Hear a sample'} onPress={toggleSample} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>{playing ? 'Stop the sample' : 'Hear a sample'}</Text>
        </Pressable>
      ) : null}
      <Text style={type.caption}>How fast the tutor reads aloud. Saved to your account. It does not change how quickly replies are written.</Text>
      {error ? <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  )
}
