import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { SPEECH_SPEEDS, createSpeaker, speechSpeedOf, voiceOutputSupported, type Speaker, type SpeechSpeed } from './voice'
import { saveSpeechSpeed, tutorKeys, type TutorPrefs } from './tutorApi'

export const SPEED_SAMPLE = 'This is how the tutor will sound. I will speak clearly, with a short pause after each sentence.'

/**
 * Slow / Normal / Fast for the tutor's voice, saved to the account and used wherever the tutor speaks. "Hear a sample" speaks one short text at the
 * chosen speed. It never changes how quickly replies are written, only how fast they are read aloud.
 */
export function SpeechSpeedControl({ prefs }: { prefs: TutorPrefs | undefined }) {
  const queryClient = useQueryClient()
  const speed = speechSpeedOf(prefs?.speechSpeed)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const sample = useRef<Speaker | null>(null)
  const canSpeak = voiceOutputSupported()

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
    const s = createSpeaker(() => setPlaying(false), speed)
    sample.current = s
    setPlaying(true)
    s.push(SPEED_SAMPLE + ' ')
    s.finish()
  }

  return (
    <div>
      <label htmlFor="tutor-speed" className="mb-1.5 block text-sm font-medium">Speaking speed</label>
      <div className="flex items-center gap-3">
        <select id="tutor-speed" value={speed} onChange={(e) => void choose(e.target.value as SpeechSpeed)} className="block h-10 w-40 rounded-control border border-field bg-surface px-3 text-sm">
          {(Object.keys(SPEECH_SPEEDS) as SpeechSpeed[]).map((k) => <option key={k} value={k}>{SPEECH_SPEEDS[k].label}</option>)}
        </select>
        {canSpeak && (
          <button type="button" onClick={toggleSample} className="h-10 rounded-control px-2 text-sm font-medium text-accent hover:underline">{playing ? 'Stop the sample' : 'Hear a sample'}</button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">How fast the tutor reads aloud. Saved to your account. It does not change how quickly replies are written.</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
