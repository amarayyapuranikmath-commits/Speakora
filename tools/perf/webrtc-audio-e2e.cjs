// Real two-browser call: matching, signalling, ICE and AUDIO, then a second call without reloading either page.
//   PERF_PASSWORD=<password of both accounts> node tools/perf/webrtc-audio-e2e.cjs --base http://localhost:4180 --a one@example.com --b two@example.com
// Two Chromium sessions with fake microphones (a test tone) go through the production build (serve-dist.cjs) and a real backend. For each call this proves, from the
// browsers' own WebRTC statistics (not from the page text): the connection state, the kind of ICE path chosen (host, srflx or relay), that audio packets and bytes
// are really arriving on both sides and keep growing, and that the audio level of the received stream is above silence. Then the call is ended and a second one
// is started from the same pages ("Find another partner"), which is the "return to matchmaking without restarting" requirement.
// --devA / --devB "Pixel 7" emulate a phone (screen, touch, user agent) in Chromium. That is NOT Android Chrome and NOT a phone microphone: it only shows the
// phone layout and flows work. The real Android app and a real phone browser cannot be tested by this script.
const { chromium, devices } = require('../../frontend/node_modules/@playwright/test')

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const base = arg('base', 'http://localhost:4180'), emailA = arg('a'), emailB = arg('b'), password = process.env.PERF_PASSWORD
if (!password || !emailA || !emailB) { console.error('Usage: PERF_PASSWORD=... node webrtc-audio-e2e.cjs --base URL --a EMAIL --b EMAIL'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const devA = arg('devA'), devB = arg('devB')

async function state(email) {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (res.status !== 200) throw new Error('login failed ' + res.status)
  const value = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1]
  return { cookies: [{ name: 'refresh_token', value, domain: new URL(base).hostname, path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Strict', expires: Math.floor(Date.now() / 1000) + 86400 }], origins: [] }
}

async function open(browser, email, device) {
  await sleep(7000) // logins are limited to 10 a minute
  const context = await browser.newContext({ ...(device ? devices[device] : {}), storageState: await state(email), permissions: ['microphone'] })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__pcs = []
    const Native = window.RTCPeerConnection
    window.RTCPeerConnection = function (...args) { const pc = new Native(...args); window.__pcs.push(pc); return pc }
    window.RTCPeerConnection.prototype = Native.prototype
    Object.setPrototypeOf(window.RTCPeerConnection, Native)
  })
  await page.goto(base + '/app/talk')
  await page.getByRole('button', { name: /start looking/i }).waitFor()
  return { context, page }
}

/** The facts about the newest peer connection of a page, read from getStats(). */
const stats = (page) => page.evaluate(async () => {
  const pc = window.__pcs[window.__pcs.length - 1]
  if (!pc) return { error: 'no peer connection' }
  const report = await pc.getStats()
  let inbound = null, outbound = null, pair = null
  const byId = new Map()
  report.forEach((r) => byId.set(r.id, r))
  report.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'audio') inbound = r
    if (r.type === 'outbound-rtp' && r.kind === 'audio') outbound = r
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId)
  })
  const kind = (id) => (byId.get(id) || {}).candidateType
  return {
    connection: pc.connectionState, ice: pc.iceConnectionState,
    receivers: pc.getReceivers().filter((x) => x.track && x.track.kind === 'audio').map((x) => x.track.readyState),
    senders: pc.getSenders().filter((x) => x.track && x.track.kind === 'audio').map((x) => ({ state: x.track.readyState, enabled: x.track.enabled })),
    inPackets: inbound ? inbound.packetsReceived : 0, inBytes: inbound ? inbound.bytesReceived : 0, inLevel: inbound ? (inbound.audioLevel ?? null) : null,
    energy: inbound ? (inbound.totalAudioEnergy ?? null) : null, lost: inbound ? inbound.packetsLost : null,
    outPackets: outbound ? outbound.packetsSent : 0,
    path: pair ? `${kind(pair.localCandidateId)} -> ${kind(pair.remoteCandidateId)}` : 'none',
  }
})

async function oneCall(a, b, label) {
  const t0 = Date.now()
  await Promise.all([a, b].map((s) => s.page.getByText('Connected', { exact: true }).waitFor({ timeout: 40000 })))
  const connectedMs = Date.now() - t0
  await sleep(3000)
  const a1 = await stats(a.page), b1 = await stats(b.page)
  await sleep(3000)
  const a2 = await stats(a.page), b2 = await stats(b.page)
  const side = (n, s1, s2) => {
    const grows = s2.inPackets > s1.inPackets && s2.inBytes > s1.inBytes
    const audible = (s2.energy ?? 0) > (s1.energy ?? 0) || (s2.inLevel ?? 0) > 0.001
    console.log(`  ${n}: connection=${s2.connection} ice=${s2.ice} path=${s2.path} | received audio packets ${s1.inPackets} -> ${s2.inPackets}, bytes ${s1.inBytes} -> ${s2.inBytes}, level=${s2.inLevel} energy ${s1.energy} -> ${s2.energy} | sent packets ${s2.outPackets} | local mic track ${JSON.stringify(s2.senders)}`)
    return s2.connection === 'connected' && grows && audible
  }
  console.log(`${label}: both sides show Connected after ${connectedMs} ms from the second click`)
  const okA = side('A', a1, a2), okB = side('B', b1, b2)
  return { okA, okB, connectedMs, path: a2.path }
}

async function endBoth(a, b) {
  await a.page.getByRole('button', { name: 'End call' }).click()
  await Promise.all([a, b].map((s) => s.page.getByRole('heading', { name: 'Call ended' }).waitFor({ timeout: 20000 })))
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const a = await open(browser, emailA, devA), b = await open(browser, emailB, devB)
  await a.page.getByRole('button', { name: /start looking/i }).click()
  await sleep(500)
  await b.page.getByRole('button', { name: /start looking/i }).click()
  const first = await oneCall(a, b, 'call 1')
  await endBoth(a, b)
  console.log('call 1 ended cleanly on both sides')
  await sleep(6000) // the same two people are not matched again for a few seconds (by design)
  // second call from the SAME pages, nothing reloaded
  await a.page.getByRole('button', { name: /find another partner/i }).click()
  await sleep(500)
  await b.page.getByRole('button', { name: /find another partner/i }).click()
  const second = await oneCall(a, b, 'call 2 (same pages, no reload)')
  await endBoth(a, b)
  console.log('call 2 ended cleanly on both sides')
  await browser.close()
  const pass = first.okA && first.okB && second.okA && second.okB
  console.log(pass ? '\nRESULT: audio flowed in both directions in both calls' : '\nRESULT: FAILED (see lines above)')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error('ERROR:', e.message.split(/\r?\n/)[0]); process.exit(1) })
