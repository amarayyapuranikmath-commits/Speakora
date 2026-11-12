import { CALL_DEBUG } from '../../config'

const t0 = Date.now()

/** Timestamped call diagnostics for logcat (`adb logcat -s ReactNativeJS`). Never logs SDP, tokens or audio. */
export function clog(tag: string, data?: unknown) {
  if (!CALL_DEBUG) return
  const t = ((Date.now() - t0) / 1000).toFixed(2).padStart(7)
  console.log(`[call ${t}s] ${tag}${data === undefined ? '' : ' ' + JSON.stringify(data)}`)
}

/** "candidate:1 1 udp 2122260223 10.45.222.77 54321 typ host ..." -> { type, proto, ip } */
export function describeCandidate(line: string | undefined | null) {
  if (!line) return null
  const p = line.split(' ')
  const typ = p.indexOf('typ')
  return { type: typ >= 0 ? p[typ + 1] : '?', proto: p[2], ip: p[4], port: p[5] }
}

interface Stat {
  type: string
  id: string
  [k: string]: unknown
}

/** One compact line summarising what the peer connection is actually doing right now. */
export function summariseStats(items: Stat[]) {
  const byId = new Map(items.map((s) => [s.id, s]))
  const cand = (id: unknown) => {
    const c = byId.get(String(id))
    return c ? `${c.candidateType}/${c.protocol}/${c.address ?? c.ip}:${c.port}` : '?'
  }
  const pairs = items
    .filter((s) => s.type === 'candidate-pair')
    .map((s) => ({ state: s.state, nom: s.nominated, sel: s.selected, local: cand(s.localCandidateId), remote: cand(s.remoteCandidateId), tx: s.bytesSent, rx: s.bytesReceived, rtt: s.currentRoundTripTime }))
  const out = items.find((s) => s.type === 'outbound-rtp' && (s.kind ?? s.mediaType) === 'audio')
  const inn = items.find((s) => s.type === 'inbound-rtp' && (s.kind ?? s.mediaType) === 'audio')
  return {
    pairs: pairs.filter((p) => p.state === 'succeeded' || p.nom || p.sel).concat(pairs.filter((p) => p.state === 'in-progress').slice(0, 2)),
    pairStates: pairs.reduce<Record<string, number>>((a, p) => ({ ...a, [String(p.state)]: (a[String(p.state)] ?? 0) + 1 }), {}),
    outbound: out ? { bytes: out.bytesSent, packets: out.packetsSent } : null,
    inbound: inn ? { bytes: inn.bytesReceived, packets: inn.packetsReceived, lost: inn.packetsLost, level: inn.audioLevel } : null,
  }
}
