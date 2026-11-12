import { describe, expect, it } from 'vitest'
import { assessQuality, sampleFromReports } from './quality'

describe('assessQuality', () => {
  it('is unknown without data', () => {
    expect(assessQuality({ packetLossPct: null, rttMs: null, jitterMs: null, bitrateKbps: null })).toBe('unknown')
  })
  it('rates a clean connection as good', () => {
    expect(assessQuality({ packetLossPct: 0.5, rttMs: 80, jitterMs: 8, bitrateKbps: 32 })).toBe('good')
  })
  it('downgrades on moderate loss, delay or jitter', () => {
    expect(assessQuality({ packetLossPct: 5, rttMs: 80, jitterMs: 8, bitrateKbps: 32 })).toBe('fair')
    expect(assessQuality({ packetLossPct: 0, rttMs: 350, jitterMs: 8, bitrateKbps: 32 })).toBe('fair')
    expect(assessQuality({ packetLossPct: 0, rttMs: 80, jitterMs: 55, bitrateKbps: 32 })).toBe('fair')
  })
  it('rates severe problems as poor', () => {
    expect(assessQuality({ packetLossPct: 12, rttMs: 80, jitterMs: 8, bitrateKbps: 32 })).toBe('poor')
    expect(assessQuality({ packetLossPct: 0, rttMs: 900, jitterMs: 8, bitrateKbps: 32 })).toBe('poor')
  })
})

describe('sampleFromReports', () => {
  const inbound = (lost: number, received: number, bytes: number, ts: number) => ({
    type: 'inbound-rtp', kind: 'audio', packetsLost: lost, packetsReceived: received, bytesReceived: bytes, jitter: 0.012, timestamp: ts,
  })
  const pair = { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.07, timestamp: 0 }

  it('has no loss or bitrate on the first sample but reports jitter and rtt', () => {
    const { sample, cursor } = sampleFromReports([inbound(0, 100, 4000, 1000), pair], null)
    expect(sample.packetLossPct).toBeNull()
    expect(sample.rttMs).toBeCloseTo(70)
    expect(sample.jitterMs).toBeCloseTo(12)
    expect(cursor?.packetsReceived).toBe(100)
  })

  it('measures loss and bitrate over the interval', () => {
    const first = sampleFromReports([inbound(0, 100, 4000, 1000)], null)
    const { sample } = sampleFromReports([inbound(5, 195, 12000, 3000)], first.cursor)
    expect(sample.packetLossPct).toBeCloseTo(5) // 5 lost of 100 expected
    expect(sample.bitrateKbps).toBeCloseTo(32) // 8000 bytes over 2 s
  })

  it('ignores video and handles a missing audio report', () => {
    const { sample } = sampleFromReports([{ type: 'inbound-rtp', kind: 'video', timestamp: 1 }], null)
    expect(sample.packetLossPct).toBeNull()
  })
})
