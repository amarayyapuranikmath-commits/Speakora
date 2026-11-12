// Load test for Quick Match + signalling against the ISOLATED backend (port 8096, schema loadtest, Redis db 6).
// Simulated users only. No media: this exercises auth, ticketing, WebSocket handling, the matchmaking queue, the database and signalling relay.
//   node load.mjs --users 100 --ramp 10000 --hold 4000 --rounds 1 --label t100
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

import { fileURLToPath } from 'node:url'
const SC = fileURLToPath(new URL('./work', import.meta.url)) // secret, user list and per-run results (git-ignored)
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const N = Number(arg('users', 100))
const RAMP = Number(arg('ramp', 10000))
const HOLD = Number(arg('hold', 4000))
const ROUNDS = Number(arg('rounds', 1))
const LABEL = arg('label', `t${N}`)
const MATCH_TIMEOUT = Number(arg('timeout', 60000))
const MIN_FREE_MB = Number(arg('minfree', 220))
const PORT = Number(arg('port', 8096))
const BASE = `http://localhost:${PORT}`
const WSURL = `ws://localhost:${PORT}/ws/signaling`
const secret = fs.readFileSync(`${SC}/lt-secret.txt`, 'utf8')

const b64 = (b) => Buffer.from(b).toString('base64url')
function mint(sub, use, ttl, role) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify({ jti: crypto.randomUUID(), sub, use, ...(role ? { role } : {}), iat: now, exp: now + ttl }))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const users = fs.readFileSync(`${SC}/lt-users.csv`, 'utf8').split('\n').map((l) => l.trim().split(',')).filter((p) => /^[0-9a-f-]{36}$/.test(p[0])).slice(0, N)
if (users.length < N) throw new Error(`only ${users.length} users seeded`)

const m = { ticketMs: [], ticketFail: {}, connectMs: [], connectFail: 0, joinToFound: [], afterBothQueued: [], relayRtt: [], pongMs: [], errors: {}, closes: {}, noMatch: 0, matched: 0, rounds: 0, callsEnded: 0, signalsRelayed: 0, queueTimeouts: 0 }
const inc = (o, k) => { o[k] = (o[k] || 0) + 1 }
const calls = new Map() // callId -> { joins: [], founds: [] }
let aborted = null
const sockets = []
const T0 = Date.now()

function user(i) {
  const [id] = users[i]
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${(i & 255) || 1}`
  const s = { id, i, ws: null, joinAt: 0, round: 0, callId: null, initiator: false, offerAt: 0, done: false, matchTimer: null, ping: null }
  const sendWs = (obj) => { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(obj)) }
  const sdp = 'v=0\r\n' + 'a=candidate:'.padEnd(1400, 'x')
  const join = () => {
    s.joinAt = Date.now()
    s.callId = null
    s.round += 1
    m.rounds += 1
    sendWs({ type: 'queue.join' })
    clearTimeout(s.matchTimer)
    s.matchTimer = setTimeout(() => { if (!s.callId && !s.done) { m.noMatch += 1 } }, MATCH_TIMEOUT)
  }
  const finish = () => { s.done = true; clearTimeout(s.matchTimer); clearInterval(s.ping); try { s.ws && s.ws.close(1000) } catch {} }

  const start = async () => {
    let ticket
    const t0 = Date.now()
    try {
      const r = await fetch(`${BASE}/api/ws/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${mint(id, 'access', 3600, 'USER')}`, 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }, body: '{}' })
      m.ticketMs.push(Date.now() - t0)
      if (!r.ok) { inc(m.ticketFail, r.status); return }
      ticket = (await r.json()).ticket
    } catch (e) { inc(m.ticketFail, 'net:' + (e.cause?.code || e.message).slice(0, 30)); return }
    const c0 = Date.now()
    const ws = new WebSocket(`${WSURL}?ticket=${encodeURIComponent(ticket)}`)
    s.ws = ws
    sockets.push(ws)
    ws.onopen = () => { m.connectMs.push(Date.now() - c0) }
    ws.onerror = () => { if (!m.connectMs.length || ws.readyState !== 1) m.connectFail += 1 }
    ws.onclose = (e) => { inc(m.closes, e.code); clearInterval(s.ping) }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      switch (msg.type) {
        case 'connected':
          join()
          s.ping = setInterval(() => { s.pingAt = Date.now(); sendWs({ type: 'ping' }) }, 10000)
          break
        case 'pong': if (s.pingAt) m.pongMs.push(Date.now() - s.pingAt); break
        case 'match.found': {
          const now = Date.now()
          s.callId = msg.callId
          s.initiator = !!msg.initiator
          clearTimeout(s.matchTimer)
          m.matched += 1
          m.joinToFound.push(now - s.joinAt)
          const c = calls.get(msg.callId) || { joins: [], founds: [] }
          c.joins.push(s.joinAt); c.founds.push(now); calls.set(msg.callId, c)
          if (s.initiator) { s.offerAt = now; sendWs({ type: 'signal', callId: msg.callId, kind: 'offer', payload: { type: 'offer', sdp } }) }
          break
        }
        case 'signal':
          m.signalsRelayed += 1
          if (msg.kind === 'offer') {
            sendWs({ type: 'signal', callId: msg.callId, kind: 'answer', payload: { type: 'answer', sdp } })
            for (let k = 0; k < 6; k++) sendWs({ type: 'signal', callId: msg.callId, kind: 'candidate', payload: { candidate: `candidate:${k} 1 udp 2122260223 10.0.0.${k} 5000${k} typ host`, sdpMid: '0', sdpMLineIndex: 0 } })
            sendWs({ type: 'call.connected', callId: msg.callId })
          } else if (msg.kind === 'answer') {
            m.relayRtt.push(Date.now() - s.offerAt)
            for (let k = 0; k < 6; k++) sendWs({ type: 'signal', callId: msg.callId, kind: 'candidate', payload: { candidate: `candidate:${k} 1 udp 2122260223 10.1.0.${k} 6000${k} typ host`, sdpMid: '0', sdpMLineIndex: 0 } })
            sendWs({ type: 'call.connected', callId: msg.callId })
            setTimeout(() => sendWs({ type: 'call.end', callId: msg.callId }), HOLD)
          }
          break
        case 'call.state':
          if (['COMPLETED', 'ENDED', 'FAILED', 'CANCELLED', 'DISCONNECTED'].includes(msg.status) || msg.endReason) {
            m.callsEnded += 1
            if (s.round < ROUNDS && !s.done) setTimeout(join, 300 + Math.random() * 700)
            else finish()
          }
          break
        case 'queue.timeout': m.queueTimeouts += 1; finish(); break
        case 'error': inc(m.errors, msg.code || 'unknown'); break
        default: break
      }
    }
  }
  return { start, finish, s }
}

// ---- server-side numbers from the isolated backend's Prometheus endpoint (JVM, Tomcat and the database pool)
async function scrape() {
  try {
    const r = await fetch(`${BASE}/actuator/prometheus`)
    if (!r.ok) return null
    const out = {}
    for (const line of (await r.text()).split(String.fromCharCode(10))) {
      if (line.startsWith('#') || !line) continue
      const sp = line.lastIndexOf(' ')
      const key = line.slice(0, sp)
      const val = Number(line.slice(sp + 1))
      if (/^jvm_memory_used_bytes\{[^}]*area="heap"/.test(key)) out.heap = (out.heap || 0) + val
      else if (key === 'process_cpu_usage') out.cpu = val
      else if (key === 'system_cpu_usage') out.sys = val
      else if (key === 'jvm_threads_live_threads') out.threads = val
      else if (/^hikaricp_connections_active/.test(key)) out.hActive = val
      else if (/^hikaricp_connections_pending/.test(key)) out.hPending = val
      else if (/^hikaricp_connections\{/.test(key)) out.hTotal = val
      else if (/^hikaricp_connections_acquire_seconds_max/.test(key)) out.hAcquireMax = val
      else if (/^tomcat_threads_busy_threads/.test(key)) out.tBusy = val
      else if (/^tomcat_threads_current_threads/.test(key)) out.tCurrent = val
      else if (/^tomcat_sessions_active_current/.test(key)) out.wsSessions = val
    }
    return out
  } catch { return null }
}
const peak = { heapMb: 0, cpu: 0, sysCpu: 0, threads: 0, hikariActive: 0, hikariPending: 0, hikariAcquireMaxMs: 0, tomcatBusy: 0, tomcatCurrent: 0, minFreeMb: Infinity }
async function sample() {
  const free = os.freemem() / 1048576
  peak.minFreeMb = Math.min(peak.minFreeMb, free)
  if (free < MIN_FREE_MB && !aborted) { aborted = `free memory fell to ${Math.round(free)} MB (limit ${MIN_FREE_MB})`; console.log('ABORT:', aborted); stopAll() }
  const x = await scrape()
  if (!x) return
  if (x.heap) peak.heapMb = Math.max(peak.heapMb, x.heap / 1048576)
  if (x.cpu != null) peak.cpu = Math.max(peak.cpu, x.cpu)
  if (x.sys != null) peak.sysCpu = Math.max(peak.sysCpu, x.sys)
  if (x.threads) peak.threads = Math.max(peak.threads, x.threads)
  if (x.hActive != null) peak.hikariActive = Math.max(peak.hikariActive, x.hActive)
  if (x.hPending != null) peak.hikariPending = Math.max(peak.hikariPending, x.hPending)
  if (x.hAcquireMax != null) peak.hikariAcquireMaxMs = Math.max(peak.hikariAcquireMaxMs, x.hAcquireMax * 1000)
  if (x.tBusy != null) peak.tomcatBusy = Math.max(peak.tomcatBusy, x.tBusy)
  if (x.tCurrent != null) peak.tomcatCurrent = Math.max(peak.tomcatCurrent, x.tCurrent)
}
const stopAll = () => { for (const u of agents) u.finish() }

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null)
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: a.length ? Math.max(...a) : null })

const agents = users.map((_, i) => user(i))
const b0 = (await scrape()) || {}
const before = { heap: b0.heap, threads: b0.threads }
console.log(`[${LABEL}] ${N} users, ramp ${RAMP} ms, hold ${HOLD} ms, rounds ${ROUNDS}; free memory ${Math.round(os.freemem() / 1048576)} MB`)
const sampler = setInterval(sample, 2000)
agents.forEach((a, i) => setTimeout(() => { if (!aborted) a.start() }, (i / N) * RAMP))

// run until every user is finished or the overall limit passes
const LIMIT = RAMP + ROUNDS * (HOLD + 15000) + MATCH_TIMEOUT
await new Promise((resolve) => {
  const tick = setInterval(() => {
    const allDone = agents.every((a) => a.s.done || (a.s.ws === null && Date.now() - T0 > RAMP + 20000))
    if (allDone || aborted || Date.now() - T0 > LIMIT) { clearInterval(tick); resolve() }
  }, 500)
})
await sample()
clearInterval(sampler)

for (const c of calls.values()) if (c.joins.length === 2) m.afterBothQueued.push(Math.min(...c.founds) - Math.max(...c.joins))
const connected = agents.filter((a) => a.s.ws).length
stopAll()
await new Promise((r) => setTimeout(r, 1500))
const result = {
  label: LABEL, users: N, rampMs: RAMP, holdMs: HOLD, rounds: ROUNDS, aborted, wallSeconds: Math.round((Date.now() - T0) / 1000),
  ticket: { ...stats(m.ticketMs), failures: m.ticketFail },
  websocket: { opened: m.connectMs.length, connectFailures: m.connectFail, connect: stats(m.connectMs), closeCodes: m.closes, pong: stats(m.pongMs) },
  matching: { matchedUsers: m.matched, calls: calls.size, noMatchWithinTimeout: m.noMatch, joinToFound: stats(m.joinToFound), latencyAfterBothQueued: stats(m.afterBothQueued), queueTimeouts: m.queueTimeouts },
  signalling: { relayed: m.signalsRelayed, offerToAnswerRtt: stats(m.relayRtt), callsEnded: m.callsEnded, errors: m.errors },
  server: { heapBeforeMb: Math.round((before.heap || 0) / 1048576), heapPeakMb: Math.round(peak.heapMb), processCpuPeak: +peak.cpu.toFixed(2), systemCpuPeak: +peak.sysCpu.toFixed(2), threadsBefore: before.threads, threadsPeak: peak.threads, hikariActivePeak: peak.hikariActive, hikariPendingPeak: peak.hikariPending, hikariAcquireMaxMs: Math.round(peak.hikariAcquireMaxMs), tomcatThreadsBusyPeak: peak.tomcatBusy, tomcatThreadsCurrentPeak: peak.tomcatCurrent },
  machine: { minFreeMemMb: Math.round(peak.minFreeMb) },
}
fs.writeFileSync(`${SC}/result-${LABEL}.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
process.exit(0)
