import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'

jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => null) }))
jest.mock('../src/lib/api', () => ({
  ApiError: class extends Error { status = 500 },
  api: (...a: unknown[]) => mockApi(...a),
}))
jest.mock('../src/lib/speech', () => ({
  ...jest.requireActual('../src/lib/speech'),
  createSpeaker: (idle: () => void, interrupted: () => void, speed: string) => mockSpeaker(idle, interrupted, speed),
}))
const mockApi = jest.fn()
const mockSpeaker = jest.fn()

import { tutorKeys } from '../src/features/main/tutorApi'
import { SPEED_SAMPLE, SpeechSpeedPicker } from '../src/features/main/SpeechSpeedPicker'

const flat = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : flat((n as { children?: unknown }).children))
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
const chip = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.label === label && typeof n.props.onPress === 'function')[0]
const button = (r: ReactTestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]

let client: QueryClient
async function render(prefs: { explanationLanguage: string | null; speechSpeed?: string } | undefined, canSpeak = true) {
  let r!: ReactTestRenderer.ReactTestRenderer
  client = new QueryClient()
  if (prefs) client.setQueryData(tutorKeys.preferences, prefs)
  const Host = () => {
    const [p, setP] = React.useState(prefs)
    React.useEffect(() => client.getQueryCache().subscribe(() => setP(client.getQueryData(tutorKeys.preferences))), [])
    return <SpeechSpeedPicker prefs={p} canSpeak={canSpeak} />
  }
  await act(async () => { r = ReactTestRenderer.create(<QueryClientProvider client={client}><Host /></QueryClientProvider>) })
  return r
}

beforeEach(() => {
  mockApi.mockReset().mockResolvedValue({ explanationLanguage: null })
  mockSpeaker.mockReset().mockImplementation((idle: () => void) => ({ push: jest.fn(), finish: jest.fn(() => idle()), stop: jest.fn() }))
})

describe('Speaking speed setting', () => {
  it('offers Slow, Normal and Fast, with Normal chosen when nothing was saved', async () => {
    const r = await render({ explanationLanguage: null })
    for (const l of ['Slow', 'Normal', 'Fast']) expect(chip(r, l)).toBeTruthy()
    expect(chip(r, 'Normal').props.selected).toBe(true)
    expect(chip(r, 'Slow').props.selected).toBe(false)
  })

  it('shows the saved choice', async () => {
    const r = await render({ explanationLanguage: null, speechSpeed: 'SLOW' })
    expect(chip(r, 'Slow').props.selected).toBe(true)
    expect(chip(r, 'Normal').props.selected).toBe(false)
  })

  it('saves a new choice to the account at once and shows it', async () => {
    const r = await render({ explanationLanguage: 'Hindi', speechSpeed: 'NORMAL' })
    await act(async () => { chip(r, 'Slow').props.onPress() })
    await settle()
    expect(mockApi).toHaveBeenCalledWith('/api/coach/preferences/speech-speed', { method: 'PUT', body: { speechSpeed: 'SLOW' } })
    expect(chip(r, 'Slow').props.selected).toBe(true)
    expect(client.getQueryData<{ explanationLanguage: string }>(tutorKeys.preferences)?.explanationLanguage).toBe('Hindi') // the language is untouched
  })

  it('goes back to the earlier choice and says so when saving fails', async () => {
    mockApi.mockRejectedValue(new Error('offline'))
    const r = await render({ explanationLanguage: null, speechSpeed: 'NORMAL' })
    await act(async () => { chip(r, 'Fast').props.onPress() })
    await settle()
    expect(chip(r, 'Normal').props.selected).toBe(true)
    expect(flat(r.toJSON())).toContain('could not be saved')
  })

  it('does not call the server when the same speed is chosen again', async () => {
    const r = await render({ explanationLanguage: null, speechSpeed: 'NORMAL' })
    await act(async () => { chip(r, 'Normal').props.onPress() })
    expect(mockApi).not.toHaveBeenCalled()
  })

  it('plays a short sample at the chosen speed, and the sample can be stopped', async () => {
    mockSpeaker.mockImplementation(() => ({ push: jest.fn(), finish: jest.fn(), stop: jest.fn() })) // never finishes by itself
    const r = await render({ explanationLanguage: null, speechSpeed: 'SLOW' })
    act(() => button(r, 'Hear a sample').props.onPress())
    expect(mockSpeaker).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), 'SLOW')
    const speaker = mockSpeaker.mock.results[0].value
    expect(speaker.push).toHaveBeenCalledWith(SPEED_SAMPLE + ' ')
    expect(speaker.finish).toHaveBeenCalled()
    act(() => button(r, 'Stop the sample').props.onPress())
    expect(speaker.stop).toHaveBeenCalled()
    expect(button(r, 'Hear a sample')).toBeTruthy()
  })

  it('has no sample button on a phone that cannot speak, and says what the setting does and does not do', async () => {
    const r = await render({ explanationLanguage: null }, false)
    expect(button(r, 'Hear a sample')).toBeUndefined()
    expect(flat(r.toJSON())).toContain('It does not change how quickly replies are written')
  })
})
