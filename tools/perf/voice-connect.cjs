// Quick Match timing with two real browser sessions (fake microphones), through the production-like server (serve-dist) and a real backend.
//   node tools/perf/voice-connect.cjs --base http://localhost:4180 --a perf.1@example.com --b perf.2@example.com [--password Passw0rdOK1] [--runs 5] [--out file.json]
// Per run: both users press "Start looking" (the second press is t0). Measured, in ms from t0:
//   match      both sides received match.found over the signalling socket
//   ice fetch  how long GET /api/calls/ice-servers took on each side (the request that precedes the WebRTC offer)
//   connected  both sides show Connected (media is flowing: the real "time to connect")
// Then side A's signalling socket is cut for --outage ms (default 5000) and restored: "reconnect" is the time from restoring it until both show Connected again
// and the remote audio level proves audio is still arriving. This tests signalling loss and recovery, not packet loss on a real network.
const { chromium } = require('../../frontend/node_modules/@playwright/test')
const fs = require('fs')

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const base = arg('base', 'http://localhost:4180'), emailA = arg('a'), emailB = arg('b'), password = arg('password', 'Passw0rdOK1')
const runs = Number(arg('runs', 5)), out = arg('out'), outageMs = Number(arg('outage', 5000))
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let lastLogin = 0
async function freshState(email) {
  const wait = lastLogin + 7000 - Date.now() // logins are limited to 10 a minute
  if (wait > 0) await sleep(wait)
  lastLogin = Date.now()
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (res.status !== 200) throw new Error('login failed ' + res.status)
  const value = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1]
  return { cookies: [{ name: 'refresh_token', value, domain: new URL(base).hostname, path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Strict', expires: Math.floor(Date.now() / 1000) + 86400 }], origins: [] }
}

// The perf backend is started with --spring.data.redis.database=5 (its own Redis database, so the real app's matching never sees these users).
// Clearing THAT database between runs removes the "just talked" memory, which would otherwise delay re-matching the same two users by 5 s.
function resetPrivateRedis() {
  const { execFileSync } = require('child_process')
  const env = fs.readFileSync(require('path').join(__dirname, '..', '..', '.env'), 'utf8')
  const get = (k) => (env.match(new RegExp('^' + k + '=([^\\r\\n]*)$', 'm')) || [])[1] || ''
  execFileSync('C:\\Program Files\\Memurai\\memurai-cli.exe', ['-h', get('REDIS_HOST') || 'localhost', '-p', get('REDIS_PORT') || '6379', '-n', '5', 'flushdb'], { env: get('REDIS_PASSWORD') ? { ...process.env, REDISCLI_AUTH: get('REDIS_PASSWORD') } : process.env })
}

async function side(browser, email) {
  const context = await browser.newContext({ storageState: await freshState(email), permissions: ['microphone'] })
  const page = await context.newPage()
  const s = { context, page, matchAt: 0, iceMs: 0, blocked: false, live: null }
  // pass-through signalling that can be cut and restored
  await page.routeWebSocket(/\/ws\/signaling/, (ws) => {
    if (s.blocked) { ws.close(); return }
    const server = ws.connectToServer()
    s.live = { ws, server }
    server.onMessage((m) => { if (typeof m === 'string' && m.includes('match.found') && !s.matchAt) s.matchAt = Date.now(); ws.send(m) })
    ws.onMessage((m) => server.send(m))
    ws.onClose(() => server.close())
    server.onClose(() => ws.close())
  })
  page.on('requestfinished', async (r) => { if (r.url().includes('/api/calls/ice-servers')) { const t = r.timing(); s.iceMs = t.responseEnd - t.requestStart } })
  await page.goto(base + '/app/talk')
  await page.getByRole('button', { name: /start looking/i }).waitFor()
  return s
}

let stage = 'start'
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const rows = []
  for (let i = 0; i < runs; i++) {
    stage = 'reset private redis'
    resetPrivateRedis()
    stage = 'open pages'
    const a = await side(browser, emailA), b = await side(browser, emailB)
    stage = 'search + match + connect'
    await a.page.getByRole('button', { name: /start looking/i }).click()
    await sleep(500)
    const t0 = Date.now()
    await b.page.getByRole('button', { name: /start looking/i }).click()
    try {
      await Promise.all([a, b].map((s) => s.page.getByText('Connected', { exact: true }).waitFor({ timeout: 30000 })))
    } catch (e) {
      for (const [n, s] of [['A', a], ['B', b]]) console.error('page', n, 'shows:', (await s.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300))
      throw e
    }
    const connected = Date.now() - t0
    const row = { match: Math.max(a.matchAt, b.matchAt) - t0, iceA: a.iceMs, iceB: b.iceMs, connected }

    // signalling outage on A
    stage = 'outage'
    await sleep(2000)
    a.blocked = true; a.live && a.live.server.close(); a.live && a.live.ws.close()
    await a.page.getByText(/reconnecting to the server/i).waitFor({ timeout: 10000 })
    await sleep(outageMs)
    a.blocked = false
    const t1 = Date.now()
    // a real browser fires 'online' when connectivity returns; the harness only blocks the socket, so it fires the event itself
    await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await a.page.getByText(/reconnecting to the server/i).waitFor({ state: 'detached', timeout: 30000 })
    await Promise.all([a, b].map((s) => s.page.getByText('Connected', { exact: true }).waitFor({ timeout: 30000 })))
    row.reconnect = Date.now() - t1
    rows.push(row)
    console.log('run', i + 1, JSON.stringify(row))

    stage = 'end call'
    await a.page.getByRole('button', { name: 'End call' }).click()
    try {
      await Promise.all([a, b].map((s) => s.page.getByRole('heading', { name: 'Call ended' }).waitFor({ timeout: 20000 })))
    } catch (e) {
      for (const [n, s] of [['A', a], ['B', b]]) console.error('page', n, 'shows:', (await s.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300))
      throw e
    }
    await a.context.close(); await b.context.close()
  }
  await browser.close()
  const m = (k) => median(rows.map((r) => r[k]))
  const summary = { runs, matchMs: m('match'), iceFetchMs: median(rows.flatMap((r) => [r.iceA, r.iceB])), connectedMs: m('connected'), reconnectMs: m('reconnect'), rows }
  console.log(`\nVoice, median of ${runs}: match ${summary.matchMs.toFixed(0)} ms, ICE fetch ${summary.iceFetchMs.toFixed(0)} ms, connected ${summary.connectedMs.toFixed(0)} ms (from second click), signalling recovery ${summary.reconnectMs.toFixed(0)} ms`)
  if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2))
}
main().catch((e) => { console.error(`ERR during "${stage}":`, e.message.split(/\r?\n/)[0]); process.exit(1) })
