import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native'
import { BOUNDARY_WAIT_MS, FINAL_WORDS_WAIT_MS, READY_TIMEOUT_MS, SPEECH_SPEEDS, checkSupport, createSpeaker, ensureMicrophone, firstWords, listen, listenTurn, speakable, speechSpeedOf, splitSentences, voiceErrorMessage } from '../src/lib/speech'

// A fake of the native module (SpeechModule.kt). Events are emitted the way the real module emits them.
const native = {
  status: jest.fn(),
  startListening: jest.fn(),
  stopListening: jest.fn(),
  cancelListening: jest.fn(),
  prepareSpeech: jest.fn(),
  speak: jest.fn(),
  stopSpeaking: jest.fn(),
}
const emit = (name: string, payload?: unknown) => DeviceEventEmitter.emit(name, payload)
const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  Platform.OS = 'android'
  ;(NativeModules as Record<string, unknown>).EsSpeech = native
  for (const f of Object.values(native)) f.mockReset()
  native.status.mockResolvedValue({ recognition: true, permission: true })
  native.startListening.mockResolvedValue(undefined)
  native.prepareSpeech.mockResolvedValue(true)
  native.speak.mockResolvedValue(undefined)
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true)
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted')
})
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })

describe('what the phone can do', () => {
  it('reports recognition and speech separately', async () => {
    native.status.mockResolvedValue({ recognition: false, permission: false })
    expect(await checkSupport()).toEqual({ recognition: false, synthesis: true })
  })
  it('reports nothing when the module is missing (an older build) instead of crashing', async () => {
    delete (NativeModules as Record<string, unknown>).EsSpeech
    expect(await checkSupport()).toEqual({ recognition: false, synthesis: false })
  })
  it('treats a failing speech engine as unsupported', async () => {
    native.prepareSpeech.mockRejectedValue(new Error('no engine'))
    expect((await checkSupport()).synthesis).toBe(false)
  })
})

describe('microphone permission', () => {
  it('does not ask again when already granted', async () => {
    expect(await ensureMicrophone()).toBe('granted')
    expect(PermissionsAndroid.request).not.toHaveBeenCalled()
  })
  it('asks once with an honest explanation', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false)
    expect(await ensureMicrophone()).toBe('granted')
    const rationale = (PermissionsAndroid.request as jest.Mock).mock.calls[0][1]
    expect(rationale.message).toMatch(/never records or stores audio/i)
  })
  it('tells a plain refusal from "never ask again"', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false)
    ;(PermissionsAndroid.request as jest.Mock).mockResolvedValueOnce('denied')
    expect(await ensureMicrophone()).toBe('denied')
    ;(PermissionsAndroid.request as jest.Mock).mockResolvedValueOnce('never_ask_again')
    expect(await ensureMicrophone()).toBe('blocked')
  })
})

describe('listening', () => {
  it('delivers partial text, then one final result, and stops listening to events', async () => {
    const partial = jest.fn(); const result = jest.fn(); const error = jest.fn()
    await listen({ onPartial: partial, onResult: result, onError: error })
    emit('speechReady')
    emit('speechPartial', { text: 'I want' })
    emit('speechResult', { text: ' I want to practise ' })
    emit('speechResult', { text: 'late duplicate' })
    emit('speechError', { code: 'network' })
    expect(native.startListening).toHaveBeenCalledWith('en-US')
    expect(partial).toHaveBeenCalledWith('I want')
    expect(result).toHaveBeenCalledTimes(1)
    expect(result).toHaveBeenCalledWith('I want to practise')
    expect(error).not.toHaveBeenCalled()
  })

  it('asks the phone to finish when the learner stops', async () => {
    const h = await listen({ onResult: jest.fn(), onError: jest.fn() })
    h.stop()
    expect(native.stopListening).toHaveBeenCalled()
  })

  it('cancel delivers nothing afterwards', async () => {
    const result = jest.fn(); const error = jest.fn()
    const h = await listen({ onResult: result, onError: error })
    h.cancel()
    emit('speechResult', { text: 'too late' })
    emit('speechError', { code: 'failed' })
    expect(native.cancelListening).toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('a refused microphone never starts the recogniser', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false)
    ;(PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied')
    const error = jest.fn()
    await listen({ onResult: jest.fn(), onError: error })
    expect(error).toHaveBeenCalledWith('denied')
    expect(native.startListening).not.toHaveBeenCalled()
  })

  it('a permanently blocked microphone points to the settings', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false)
    ;(PermissionsAndroid.request as jest.Mock).mockResolvedValue('never_ask_again')
    const error = jest.fn()
    await listen({ onResult: jest.fn(), onError: error })
    expect(error).toHaveBeenCalledWith('permission')
    expect(voiceErrorMessage('permission')).toMatch(/settings/i)
  })

  it('reports a network failure from the speech service once', async () => {
    const error = jest.fn()
    await listen({ onResult: jest.fn(), onError: error })
    emit('speechError', { code: 'network' })
    emit('speechError', { code: 'network' })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('network')
    expect(voiceErrorMessage('network')).toMatch(/internet/i)
  })

  it('treats a service that never becomes ready (offline phone) as a network failure instead of waiting forever', async () => {
    jest.useFakeTimers()
    const error = jest.fn()
    const pending = listen({ onResult: jest.fn(), onError: error })
    await jest.advanceTimersByTimeAsync(0)
    await pending
    jest.advanceTimersByTime(READY_TIMEOUT_MS + 10)
    expect(error).toHaveBeenCalledWith('network')
    expect(native.cancelListening).toHaveBeenCalled()
  })

  it('does not time out once the service is ready', async () => {
    jest.useFakeTimers()
    const error = jest.fn()
    const pending = listen({ onResult: jest.fn(), onError: error })
    await jest.advanceTimersByTimeAsync(0)
    await pending
    emit('speechReady')
    jest.advanceTimersByTime(READY_TIMEOUT_MS * 3)
    expect(error).not.toHaveBeenCalled()
  })

  it('reports a start failure from the native side, and an unavailable service', async () => {
    native.startListening.mockRejectedValueOnce({ code: 'unavailable' })
    const error = jest.fn()
    await listen({ onResult: jest.fn(), onError: error })
    expect(error).toHaveBeenCalledWith('unavailable')
    delete (NativeModules as Record<string, unknown>).EsSpeech
    const error2 = jest.fn()
    await listen({ onResult: jest.fn(), onError: error2 })
    expect(error2).toHaveBeenCalledWith('unavailable')
  })

  it('has a plain message for every error code', () => {
    for (const code of ['permission', 'denied', 'no-speech', 'no-match', 'network', 'audio', 'busy', 'language', 'unavailable', 'failed', 'anything-else']) {
      expect(voiceErrorMessage(code).length).toBeGreaterThan(20)
    }
  })
})

describe('speaking', () => {
  it('splits a streamed reply into sentences as they complete', () => {
    expect(splitSentences('Hello there. How are')).toEqual({ sentences: ['Hello there.'], rest: 'How are' })
    expect(splitSentences('One!\nTwo? Three')).toEqual({ sentences: ['One!', 'Two?'], rest: 'Three' })
  })

  it('does not read markdown symbols or emoji aloud', () => {
    expect(speakable('**Good** job 🎉 — use `went`.')).toBe('Good job — use went.')
  })

  async function speakAll(pieces: string[]) {
    const idle = jest.fn(); const interrupted = jest.fn()
    const speaker = createSpeaker(idle, interrupted)
    pieces.forEach((p) => speaker.push(p))
    speaker.finish()
    await flush()
    return { idle, interrupted, speaker }
  }
  const spoken = () => native.speak.mock.calls.map((c) => c[1])

  it('starts speaking before the reply is complete, in order, and reports when everything was spoken', async () => {
    const { idle } = await speakAll(['Good question. ', 'Let me ex', 'plain. It is simple'])
    expect(spoken()).toEqual(['Good question.', 'Let me explain.', 'It is simple'])
    expect(idle).not.toHaveBeenCalled()
    const ids = native.speak.mock.calls.map((c) => c[0])
    ids.forEach((id) => emit('ttsDone', { id }))
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('counts a failed sentence as finished so the conversation does not stall', async () => {
    const { idle } = await speakAll(['One. ', 'Two.'])
    const ids = native.speak.mock.calls.map((c) => c[0])
    emit('ttsError', { id: ids[0] })
    emit('ttsDone', { id: ids[1] })
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('stop() is an interruption: it silences the phone and never reports completion', async () => {
    const { idle, speaker } = await speakAll(['First sentence. ', 'Second sentence.'])
    speaker.stop()
    expect(native.stopSpeaking).toHaveBeenCalled()
    native.speak.mock.calls.forEach((c) => emit('ttsDone', { id: c[0] }))
    speaker.push('More text. ')
    await flush()
    expect(idle).not.toHaveBeenCalled()
    expect(native.speak).toHaveBeenCalledTimes(2)
  })

  it('a call or another app taking the audio ends the speech and is reported', async () => {
    const { idle, interrupted } = await speakAll(['A sentence. ', 'Another one.'])
    emit('ttsInterrupted')
    expect(interrupted).toHaveBeenCalledTimes(1)
    native.speak.mock.calls.forEach((c) => emit('ttsDone', { id: c[0] }))
    expect(idle).not.toHaveBeenCalled()
  })

  it('without a speech engine nothing is spoken and the speaker still finishes', async () => {
    native.prepareSpeech.mockResolvedValue(false)
    const { idle } = await speakAll(['Hello there. ', 'Bye.'])
    expect(native.speak).not.toHaveBeenCalled()
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('a rejected speak() (another app has the audio) does not stall', async () => {
    native.speak.mockRejectedValue({ code: 'busy' })
    const { idle } = await speakAll(['Hello there.'])
    expect(idle).toHaveBeenCalledTimes(1)
  })
})

describe('speaking speed', () => {
  const sayOnce = async (speed?: 'SLOW' | 'NORMAL' | 'FAST') => {
    native.speak.mockClear()
    const speaker = speed ? createSpeaker(jest.fn(), jest.fn(), speed) : createSpeaker(jest.fn(), jest.fn())
    speaker.push('First sentence. ')
    speaker.push('Second sentence. ')
    speaker.finish()
    await flush()
    return native.speak.mock.calls
  }

  it('Normal is the default, and it is slower than the phone engine\'s own normal speed with a pause after each sentence', async () => {
    const calls = await sayOnce()
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c[3]).toBe(SPEECH_SPEEDS.NORMAL.rate)
      expect(c[3]).toBeLessThan(1)
      expect(c[4]).toBe(SPEECH_SPEEDS.NORMAL.pauseMs)
      expect(c[4]).toBeGreaterThanOrEqual(300)
    }
  })

  it('Slow is clearly slower with longer pauses, Fast is the engine speed with short ones', async () => {
    const slow = (await sayOnce('SLOW'))[0]
    const normal = (await sayOnce('NORMAL'))[0]
    const fast = (await sayOnce('FAST'))[0]
    expect(slow[3]).toBeLessThan(normal[3] as number)
    expect(normal[3]).toBeLessThan(fast[3] as number)
    expect(slow[4]).toBeGreaterThan(normal[4] as number)
    expect(normal[4]).toBeGreaterThan(fast[4] as number)
    expect(fast[3]).toBeLessThanOrEqual(1.0)
  })

  it('the same speed applies to every sentence of a reply, whatever the tutor mode', async () => {
    const calls = await sayOnce('SLOW')
    expect(new Set(calls.map((c) => c[3])).size).toBe(1)
    expect(new Set(calls.map((c) => c[4])).size).toBe(1)
  })

  it('stays natural: no speed is so slow that it sounds robotic or so fast that it rushes', () => {
    for (const s of Object.values(SPEECH_SPEEDS)) {
      expect(s.rate).toBeGreaterThanOrEqual(0.6)
      expect(s.rate).toBeLessThanOrEqual(1.0)
      expect(s.pauseMs).toBeLessThanOrEqual(1000)
    }
  })

  it('unknown saved values fall back to Normal', () => {
    expect(speechSpeedOf(undefined)).toBe('NORMAL')
    expect(speechSpeedOf(null)).toBe('NORMAL')
    expect(speechSpeedOf('ludicrous')).toBe('NORMAL')
    expect(speechSpeedOf('SLOW')).toBe('SLOW')
    expect(speechSpeedOf('FAST')).toBe('FAST')
  })

  it('stopping still silences the phone at once whatever the speed (interruption)', async () => {
    const speaker = createSpeaker(jest.fn(), jest.fn(), 'SLOW')
    speaker.push('A long sentence that is being read slowly. ')
    await flush()
    speaker.stop()
    expect(native.stopSpeaking).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------- whole turns

describe('listening for a whole turn', () => {
  beforeEach(() => jest.useFakeTimers())

  /** Lets the asynchronous start of a recording session run (permission check, native start). */
  const settle = async () => { await jest.advanceTimersByTimeAsync(0) }
  const turn = (level: string | null = 'B2') => {
    const log = { text: [] as string[], commits: [] as string[], errors: [] as [string, string][] }
    const t = listenTurn({ level, onText: (x) => log.text.push(x), onCommit: (x) => log.commits.push(x), onError: (c, h) => log.errors.push([c, h]) })
    return { t, log }
  }

  it('does not finish the turn when the phone ends the recording after a short silence: the words are kept and a new recording continues', async () => {
    const { log } = turn()
    await settle()
    expect(native.startListening).toHaveBeenCalledTimes(1)
    emit('speechPartial', { text: 'My name is Ravi and' })
    emit('speechResult', { text: 'My name is Ravi and' }) // the phone's own end-of-speech
    await jest.advanceTimersByTimeAsync(100)
    expect(native.startListening).toHaveBeenCalledTimes(2) // listening carried on, with one recording at a time
    expect(log.commits).toEqual([])
    emit('speechPartial', { text: 'I come from Mysore' })
    expect(log.text[log.text.length - 1]).toBe('My name is Ravi and I come from Mysore')
    await jest.advanceTimersByTimeAsync(6000)
    expect(native.stopListening).toHaveBeenCalled() // the turn is over: ask the phone to finish (not cancel), so the last words still arrive
    emit('speechResult', { text: 'I come from Mysore' })
    expect(log.commits).toEqual(['My name is Ravi and I come from Mysore'])
  })

  it('waits through a one second thinking pause and a restart, then finishes only after enough silence', async () => {
    const { log } = turn('B1')
    await settle()
    emit('speechPartial', { text: 'I think the best way to learn English is' })
    await jest.advanceTimersByTimeAsync(1000)
    expect(log.commits).toEqual([])
    expect(native.stopListening).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(2500)
    expect(log.commits).toEqual([])
    await jest.advanceTimersByTimeAsync(1500)
    expect(native.stopListening).toHaveBeenCalled()
  })

  it('does not lose the last words: it asks the phone to finish and uses what it has if the phone stays silent', async () => {
    const { log } = turn('B2')
    await settle()
    emit('speechPartial', { text: 'I live in Bangalore and I work as a teacher' })
    await jest.advanceTimersByTimeAsync(2350)
    expect(native.stopListening).toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(FINAL_WORDS_WAIT_MS + 50) // the phone never answers
    expect(log.commits).toEqual(['I live in Bangalore and I work as a teacher'])
    expect(native.cancelListening).toHaveBeenCalled()
  })

  it('the Done control finishes at once', async () => {
    const { t, log } = turn()
    await settle()
    emit('speechPartial', { text: 'I want to tell you about my' })
    t.finish()
    expect(native.stopListening).toHaveBeenCalled()
    emit('speechResult', { text: 'I want to tell you about my family' })
    expect(log.commits).toEqual(['I want to tell you about my family'])
  })

  it('"that is all" ends the turn quickly and is not sent', async () => {
    const { log } = turn()
    await settle()
    emit('speechPartial', { text: "I like tea that's all" })
    await jest.advanceTimersByTimeAsync(400)
    emit('speechResult', { text: "I like tea that's all" })
    expect(log.commits).toEqual(['I like tea'])
  })

  it('stops with a message after a few attempts in which nothing was heard', async () => {
    const { log } = turn()
    await settle()
    emit('speechError', { code: 'no-speech' })
    await jest.advanceTimersByTimeAsync(100)
    emit('speechError', { code: 'no-speech' })
    await jest.advanceTimersByTimeAsync(100)
    expect(log.errors).toEqual([['no-speech', '']])
    expect(native.startListening).toHaveBeenCalledTimes(2)
  })

  it('a silence in the middle of a turn that already has words does not end it', async () => {
    const { log } = turn()
    await settle()
    emit('speechPartial', { text: 'My plan for the weekend is' })
    emit('speechError', { code: 'no-speech' })
    await jest.advanceTimersByTimeAsync(100)
    emit('speechError', { code: 'no-speech' })
    await jest.advanceTimersByTimeAsync(100)
    expect(log.errors).toEqual([])
    expect(native.startListening).toHaveBeenCalledTimes(3)
  })

  it('a blocked microphone is reported with whatever was heard', async () => {
    const { log } = turn()
    await settle()
    emit('speechPartial', { text: 'Hello there' })
    emit('speechError', { code: 'permission' })
    expect(log.errors).toEqual([['permission', 'Hello there']])
  })

  it('a brief network failure is retried instead of ending the turn', async () => {
    const { log } = turn()
    await settle()
    emit('speechPartial', { text: 'I was saying that' })
    emit('speechError', { code: 'network' })
    await jest.advanceTimersByTimeAsync(900)
    expect(log.errors).toEqual([])
    expect(native.startListening).toHaveBeenCalledTimes(2)
    emit('speechError', { code: 'network' })
    await jest.advanceTimersByTimeAsync(900)
    emit('speechError', { code: 'network' })
    await jest.advanceTimersByTimeAsync(900)
    emit('speechError', { code: 'network' })
    expect(log.errors).toEqual([['network', 'I was saying that']])
  })

  it('cancelling delivers nothing and restarts nothing', async () => {
    const { t, log } = turn()
    await settle()
    emit('speechPartial', { text: 'Something I started to say' })
    t.cancel()
    emit('speechResult', { text: 'Something I started to say' })
    await jest.advanceTimersByTimeAsync(20_000)
    expect(log.commits).toEqual([])
    expect(native.cancelListening).toHaveBeenCalled()
    expect(native.startListening).toHaveBeenCalledTimes(1)
  })
})

describe('showing only what has been spoken', () => {
  const ttsStart = (i: number) => emit('ttsStart', { id: native.speak.mock.calls[i][0] })
  const ttsRange = (i: number, end: number) => emit('ttsRange', { id: native.speak.mock.calls[i][0], start: 0, end })
  const ttsDone = (i: number) => emit('ttsDone', { id: native.speak.mock.calls[i][0] })

  async function start(pieces: string[]) {
    jest.useFakeTimers()
    const shown: string[] = []
    const idle = jest.fn()
    const speaker = createSpeaker(idle, jest.fn(), 'NORMAL', { onReveal: (t) => shown.push(t) })
    pieces.forEach((p) => speaker.push(p))
    speaker.finish()
    await jest.advanceTimersByTimeAsync(0)
    return { speaker, shown, idle }
  }

  it('keeps the first words of a sentence with their spacing', () => {
    expect(firstWords('We use does with he and she.', 3)).toBe('We use does')
    expect(firstWords('Hello there', 0)).toBe('')
    expect(firstWords('Hello there', 9)).toBe('Hello there')
  })

  it('shows nothing until the phone starts speaking a sentence, and a later sentence only when it starts', async () => {
    const { shown } = await start(['Good question. ', 'We use does with he. '])
    expect(shown).toEqual([])
    ttsStart(0)
    await jest.advanceTimersByTimeAsync(BOUNDARY_WAIT_MS) // this engine reports no positions: the whole sentence is shown
    expect(shown[shown.length - 1]).toBe('Good question.')
    ttsDone(0)
    expect(shown[shown.length - 1]).toBe('Good question.') // the second sentence has not started
    ttsStart(1)
    await jest.advanceTimersByTimeAsync(0)
    expect(shown[shown.length - 1]).toBe('Good question. We use does with he.')
  })

  it('follows the engine word by word when it reports where it is', async () => {
    const { shown } = await start(['We use does with he. '])
    ttsStart(0)
    expect(shown[shown.length - 1]).toBe('')
    ttsRange(0, 2) // "We"
    expect(shown[shown.length - 1]).toBe('We')
    ttsRange(0, 11) // "We use does"
    expect(shown[shown.length - 1]).toBe('We use does')
    await jest.advanceTimersByTimeAsync(BOUNDARY_WAIT_MS * 3)
    expect(shown[shown.length - 1]).toBe('We use does') // it reported, so it is trusted
    ttsDone(0)
    expect(shown[shown.length - 1]).toBe('We use does with he.')
  })

  it('an interruption returns only what was spoken and nothing more is shown', async () => {
    const { speaker, shown, idle } = await start(['First sentence here. ', 'Second sentence here. '])
    ttsStart(0)
    await jest.advanceTimersByTimeAsync(BOUNDARY_WAIT_MS)
    const heard = speaker.stop()
    expect(heard).toBe('First sentence here.')
    const count = shown.length
    ttsDone(0)
    ttsStart(1)
    await jest.advanceTimersByTimeAsync(BOUNDARY_WAIT_MS * 2)
    expect(shown).toHaveLength(count)
    expect(idle).not.toHaveBeenCalled()
  })

  it('completion reports the whole reply as spoken', async () => {
    const { shown, idle } = await start(['Only sentence. '])
    ttsStart(0)
    ttsDone(0)
    expect(shown[shown.length - 1]).toBe('Only sentence.')
    expect(idle).toHaveBeenCalledTimes(1)
  })
})
