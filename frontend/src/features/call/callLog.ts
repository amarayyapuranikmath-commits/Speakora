const t0 = Date.now()

/** Call diagnostics in the browser console: always in dev builds, in production after localStorage.callDebug = '1'. */
const enabled = (() => {
  try {
    return import.meta.env.DEV || localStorage.getItem('callDebug') === '1'
  } catch {
    return false
  }
})()

/** True when call diagnostics are on (dev build, or localStorage.callDebug = '1'). */
export const callDebugEnabled = enabled

export function clog(tag: string, data?: unknown) {
  if (!enabled) return
  const t = ((Date.now() - t0) / 1000).toFixed(2).padStart(7)
  console.info(`[call ${t}s] ${tag}${data === undefined ? '' : ' ' + JSON.stringify(data)}`)
}

export function describeCandidate(line: string | undefined | null) {
  if (!line) return null
  const p = line.split(' ')
  const typ = p.indexOf('typ')
  return { type: typ >= 0 ? p[typ + 1] : '?', proto: p[2], ip: p[4], port: p[5] }
}

export function summariseStats(items: Record<string, unknown>[]) {
  const byId = new Map(items.map((s) => [String(s.id), s]))
  const cand = (id: unknown) => {
    const c = byId.get(String(id))
    return c ? `${c.candidateType}/${c.protocol}/${c.address ?? c.ip}:${c.port}` : '?'
  }
  const pairs = items
    .filter((s) => s.type === 'candidate-pair')
    .map((s) => ({ state: s.state, nom: s.nominated, local: cand(s.localCandidateId), remote: cand(s.remoteCandidateId), tx: s.bytesSent, rx: s.bytesReceived, rtt: s.currentRoundTripTime }))
  const out = items.find((s) => s.type === 'outbound-rtp' && s.kind === 'audio')
  const inn = items.find((s) => s.type === 'inbound-rtp' && s.kind === 'audio')
  return {
    pairs: pairs.filter((p) => p.state === 'succeeded' || p.nom).concat(pairs.filter((p) => p.state === 'in-progress').slice(0, 2)),
    pairStates: pairs.reduce<Record<string, number>>((a, p) => ({ ...a, [String(p.state)]: (a[String(p.state)] ?? 0) + 1 }), {}),
    outbound: out ? { bytes: out.bytesSent, packets: out.packetsSent } : null,
    inbound: inn ? { bytes: inn.bytesReceived, packets: inn.packetsReceived, lost: inn.packetsLost, level: inn.audioLevel } : null,
  }
}
