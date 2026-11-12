import { formatClock, formatDuration } from '../src/lib/format'
import { COUNTRIES, LANGUAGES, LEVELS, countryName, detectTimeZone, timeZones } from '../src/lib/geo'
import { assessQuality, sampleFromReports } from '../src/lib/quality'
import { isAtLeast18, isEmail, parseDate, passwordProblem } from '../src/lib/validation'

describe('validation', () => {
  it('matches the server password rule', () => {
    expect(passwordProblem('short1')).toMatch(/at least 8/)
    expect(passwordProblem('12345678')).toMatch(/letter/)
    expect(passwordProblem('abcdefgh')).toMatch(/number/)
    expect(passwordProblem('a'.repeat(70) + '12345')).toMatch(/at most 72/)
    expect(passwordProblem('abcdefg1')).toBeNull()
  })

  it('checks emails and calendar dates', () => {
    expect(isEmail('a@b.co')).toBe(true)
    expect(isEmail('a@b')).toBe(false)
    expect(parseDate('2000-02-30')).toBeNull()
    expect(parseDate('2000-02-29')).not.toBeNull()
    expect(parseDate('01/02/2000')).toBeNull()
  })

  it('enforces the 18+ rule on the exact birthday', () => {
    const today = new Date(Date.UTC(2026, 5, 15))
    expect(isAtLeast18('2008-06-15', today)).toBe(true)
    expect(isAtLeast18('2008-06-16', today)).toBe(false)
    expect(isAtLeast18('not a date', today)).toBe(false)
  })
})

describe('formatting', () => {
  it('formats clocks and durations', () => {
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-5)).toBe('0:00')
    expect(formatDuration(45)).toBe('45 sec')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(5400)).toBe('1 h 30 min')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('geo lists (Hermes has no Intl.DisplayNames, so they are static)', () => {
  it('has unique codes and resolves country names', () => {
    expect(new Set(COUNTRIES.map((c) => c.value)).size).toBe(COUNTRIES.length)
    expect(new Set(LANGUAGES.map((c) => c.value)).size).toBe(LANGUAGES.length)
    expect(countryName('de')).toBe(COUNTRIES.find((c) => c.value === 'DE')?.label)
    expect(countryName(null)).toBe('')
    expect(LEVELS.map((l) => l.value)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  })

  it('offers time zones including the detected one', () => {
    const zones = timeZones().map((z) => z.value)
    expect(zones.length).toBeGreaterThan(20)
    expect(detectTimeZone()).toBeTruthy()
  })
})

describe('call quality', () => {
  it('maps loss, rtt and jitter to a three-level indicator', () => {
    expect(assessQuality({ packetLossPct: null, rttMs: null, jitterMs: null, bitrateKbps: null })).toBe('unknown')
    expect(assessQuality({ packetLossPct: 0.5, rttMs: 80, jitterMs: 5, bitrateKbps: 30 })).toBe('good')
    expect(assessQuality({ packetLossPct: 4, rttMs: 80, jitterMs: 5, bitrateKbps: 30 })).toBe('fair')
    expect(assessQuality({ packetLossPct: 1, rttMs: 700, jitterMs: 5, bitrateKbps: 30 })).toBe('poor')
  })

  it('derives loss and bitrate from two consecutive stats snapshots', () => {
    const first = sampleFromReports([{ type: 'inbound-rtp', kind: 'audio', packetsLost: 0, packetsReceived: 100, bytesReceived: 8000, timestamp: 1000, jitter: 0.01 }], null)
    expect(first.sample.packetLossPct).toBeNull()
    const second = sampleFromReports(
      [
        { type: 'inbound-rtp', kind: 'audio', packetsLost: 5, packetsReceived: 195, bytesReceived: 16000, timestamp: 3000, jitter: 0.02 },
        { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.12, timestamp: 3000 },
      ],
      first.cursor,
    )
    expect(second.sample.packetLossPct).toBeCloseTo(5, 5)
    expect(second.sample.rttMs).toBeCloseTo(120, 5)
    expect(second.sample.jitterMs).toBeCloseTo(20, 5)
    expect(second.sample.bitrateKbps).toBeCloseTo(32, 5)
  })
})
