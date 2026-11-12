export type Quality = 'unknown' | 'good' | 'fair' | 'poor'

export interface StatsSample {
  packetLossPct: number | null
  rttMs: number | null
  jitterMs: number | null
  bitrateKbps: number | null
}

/**
 * Collapses raw WebRTC stats into a three-level indicator. Thresholds follow common VoIP guidance
 * (ITU-T G.114: <150 ms one-way delay is good; Opus tolerates a few percent loss thanks to FEC/PLC).
 */
export function assessQuality(s: StatsSample): Quality {
  const known = [s.packetLossPct, s.rttMs, s.jitterMs].filter((v) => v !== null)
  if (known.length === 0) return 'unknown'
  const loss = s.packetLossPct ?? 0
  const rtt = s.rttMs ?? 0
  const jitter = s.jitterMs ?? 0
  if (loss > 8 || rtt > 600 || jitter > 100) return 'poor'
  if (loss > 3 || rtt > 300 || jitter > 40) return 'fair'
  return 'good'
}

interface RawReport {
  type: string
  kind?: string
  mediaType?: string
  packetsLost?: number
  packetsReceived?: number
  jitter?: number
  bytesReceived?: number
  timestamp: number
  currentRoundTripTime?: number
  nominated?: boolean
  state?: string
  selected?: boolean
}

export interface StatsCursor {
  packetsLost: number
  packetsReceived: number
  bytesReceived: number
  timestamp: number
}

/** Derives a sample from two consecutive getStats() snapshots (loss and bitrate are measured over the interval). */
export function sampleFromReports(reports: Iterable<RawReport>, previous: StatsCursor | null): { sample: StatsSample; cursor: StatsCursor | null } {
  let inbound: RawReport | undefined
  let rtt: number | null = null
  for (const r of reports) {
    if (r.type === 'inbound-rtp' && (r.kind ?? r.mediaType) === 'audio') inbound = r
    if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded' && r.currentRoundTripTime != null) {
      rtt = r.currentRoundTripTime * 1000
    }
  }
  if (!inbound) return { sample: { packetLossPct: null, rttMs: rtt, jitterMs: null, bitrateKbps: null }, cursor: previous }

  const cursor: StatsCursor = {
    packetsLost: inbound.packetsLost ?? 0,
    packetsReceived: inbound.packetsReceived ?? 0,
    bytesReceived: inbound.bytesReceived ?? 0,
    timestamp: inbound.timestamp,
  }
  let loss: number | null = null
  let bitrate: number | null = null
  if (previous) {
    const lost = Math.max(0, cursor.packetsLost - previous.packetsLost)
    const received = Math.max(0, cursor.packetsReceived - previous.packetsReceived)
    const expected = lost + received
    loss = expected > 0 ? (lost / expected) * 100 : 0
    const seconds = (cursor.timestamp - previous.timestamp) / 1000
    if (seconds > 0) bitrate = ((cursor.bytesReceived - previous.bytesReceived) * 8) / seconds / 1000
  }
  return {
    sample: { packetLossPct: loss, rttMs: rtt, jitterMs: inbound.jitter != null ? inbound.jitter * 1000 : null, bitrateKbps: bitrate },
    cursor,
  }
}
