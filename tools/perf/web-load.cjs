// Measures the website the way a visitor meets it: a fresh browser, an empty cache, the production build served like nginx serves it.
//   node tools/perf/web-load.cjs --base http://localhost:4180 --email perf.123@example.com --password Passw0rdOK1 [--runs 5] [--profile local|mobile] [--out result.json]
// Profiles: local = no throttling; mobile = what Lighthouse calls slow 4G on a mid-range phone (1.6 Mbps down, 750 kbps up, 150 ms latency, 4x slower CPU).
// Per scenario it reports the median of the runs of: first contentful paint, largest contentful paint, time until the page content is really on screen
// (not just the shell), cumulative layout shift, bytes transferred, JavaScript bytes, number of requests, and the API calls made (with duplicates).
const { chromium } = require('../../frontend/node_modules/@playwright/test')
const fs = require('fs')

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const base = arg('base', 'http://localhost:4180')
const email = arg('email'), password = arg('password')
const runs = Number(arg('runs', 5))
const profile = arg('profile', 'local')
const out = arg('out')
const only = arg('only', 'all') // load | nav | all
const settleMs = Number(arg('settle', 0)) // how long the person looks at the first screen before clicking (the page keeps loading meanwhile)

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

async function newPage(browser, storageState) {
  const context = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  if (profile === 'mobile') {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  const reqs = new Map()
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type, bytes: 0 }))
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength })
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 }
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  })
  return { context, page, reqs, cdp }
}

// A refresh token works once (reuse revokes the whole session), so every measured run gets its own sign-in. Logins are limited to 10 a minute: pace them.
let lastLogin = 0
async function freshState() {
  const wait = lastLogin + 7000 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastLogin = Date.now()
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (res.status !== 200) throw new Error('login for measurement failed: ' + res.status)
  const value = /refresh_token=([^;]+)/.exec(res.headers.get('set-cookie'))[1]
  return { cookies: [{ name: 'refresh_token', value, domain: new URL(base).hostname, path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Strict', expires: Math.floor(Date.now() / 1000) + 86400 }], origins: [] }
}

async function summary(page, reqs, readyMs) {
  const paint = await page.evaluate(() => ({ fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0, lcp: window.__perf.lcp, cls: window.__perf.cls }))
  const all = [...reqs.values()].filter((r) => !r.url.startsWith('data:'))
  const api = all.filter((r) => new URL(r.url).pathname.startsWith('/api/'))
  const calls = {}
  for (const r of api) { const k = r.method + ' ' + new URL(r.url).pathname; calls[k] = (calls[k] || 0) + 1 }
  return {
    ready: readyMs, fcp: paint.fcp, lcp: paint.lcp, cls: paint.cls,
    transferKB: all.reduce((s, r) => s + r.bytes, 0) / 1024,
    jsKB: all.filter((r) => r.type === 'Script').reduce((s, r) => s + r.bytes, 0) / 1024,
    requests: all.length, apiCalls: api.length, duplicateApiCalls: Object.values(calls).filter((n) => n > 1).reduce((s, n) => s + n - 1, 0), calls,
  }
}

async function main() {
  const browser = await chromium.launch()
  const results = {}
  const scenarios = [
    { name: 'landing page (visitor)', path: '/', anon: true, ready: (p) => p.getByRole('heading', { level: 1 }).first().waitFor() },
    { name: 'login page (visitor)', path: '/login', anon: true, ready: (p) => p.getByRole('button', { name: 'Sign in' }).waitFor() },
    { name: 'dashboard (signed in, cold)', path: '/app', ready: (p) => p.getByRole('heading', { name: /welcome back, perf/i }).waitFor() },
    { name: 'AI Coach (signed in, cold)', path: '/app/coach', ready: (p) => p.getByRole('heading', { level: 1, name: 'AI Coach' }).waitFor() },
    { name: 'Progress (signed in, cold)', path: '/app/progress', ready: (p) => p.getByRole('heading', { level: 1, name: 'Progress' }).waitFor() },
  ]
  for (const s of only === 'nav' ? [] : scenarios) {
    const rows = []
    for (let i = 0; i < runs; i++) {
      const { context, page, reqs } = await newPage(browser, s.anon ? undefined : await freshState())
      const t0 = Date.now()
      await page.goto(base + s.path, { waitUntil: 'commit' })
      await s.ready(page).catch((e) => { throw new Error(`scenario "${s.name}": ${e.message.split(/\r?\n/)[0]}`) })
      const readyMs = Date.now() - t0
      await page.waitForLoadState('networkidle')
      rows.push(await summary(page, reqs, readyMs))
      await context.close()
    }
    results[s.name] = rows
  }

  // in-app navigation: the app is loaded and warm, one click to another screen
  const nav = [
    { name: 'click Learn', link: /^Learn$/, ready: (p) => p.getByRole('heading', { level: 1, name: 'Learn' }).waitFor() },
    { name: 'click AI Coach', link: /^AI Coach$/, ready: (p) => p.getByRole('heading', { level: 1, name: 'AI Coach' }).waitFor() },
    { name: 'click Friends', link: /^Friends/, ready: (p) => p.getByRole('heading', { level: 1, name: 'Friends' }).waitFor() },
    { name: 'click Progress', link: /^Progress$/, ready: (p) => p.getByRole('heading', { level: 1, name: 'Progress' }).waitFor() },
    { name: 'click Home', link: /^Home$/, ready: (p) => p.getByRole('heading', { name: /welcome back, perf/i }).waitFor() },
  ]
  const navRows = Object.fromEntries(nav.map((n) => [n.name, []]))
  for (let i = 0; i < (only === 'load' ? 0 : runs); i++) {
    const { context, page, reqs } = await newPage(browser, await freshState())
    await page.goto(base + '/app', { waitUntil: 'commit' })
    await page.getByRole('heading', { name: /welcome back, perf/i }).waitFor()
    await page.waitForLoadState('networkidle')
    if (settleMs) { await page.waitForTimeout(settleMs); await page.waitForLoadState('networkidle') }
    for (const n of nav) {
      reqs.clear()
      const t0 = Date.now()
      await page.getByRole('link', { name: n.link }).first().click()
      await n.ready(page).catch((e) => { throw new Error(`navigation "${n.name}": ${e.message.split(/\r?\n/)[0]}`) })
      const ms = Date.now() - t0
      await page.waitForLoadState('networkidle')
      const apiCalls = [...reqs.values()].filter((r) => new URL(r.url).pathname.startsWith('/api/')).length
      const js = [...reqs.values()].filter((r) => r.type === 'Script').reduce((sum, r) => sum + r.bytes, 0) / 1024
      navRows[n.name].push({ ready: ms, apiCalls, jsKB: js })
    }
    await context.close()
  }
  await browser.close()

  const fmt = (n, d = 0) => n.toFixed(d)
  console.log(`\nPROFILE ${profile}   base ${base}   runs per scenario ${runs}   (median)\n`)
  console.log('scenario'.padEnd(34) + 'ready ms'.padStart(9) + 'FCP ms'.padStart(8) + 'LCP ms'.padStart(8) + 'CLS'.padStart(7) + 'transfer KB'.padStart(13) + 'JS KB'.padStart(8) + 'reqs'.padStart(6) + 'API'.padStart(5) + 'dup API'.padStart(8))
  const table = {}
  for (const [name, rows] of Object.entries(results)) {
    const m = (k) => median(rows.map((r) => r[k]))
    table[name] = { ready: m('ready'), fcp: m('fcp'), lcp: m('lcp'), cls: m('cls'), transferKB: m('transferKB'), jsKB: m('jsKB'), requests: m('requests'), apiCalls: m('apiCalls'), duplicateApiCalls: m('duplicateApiCalls'), calls: rows[0].calls }
    console.log(name.padEnd(34) + fmt(m('ready')).padStart(9) + fmt(m('fcp')).padStart(8) + fmt(m('lcp')).padStart(8) + fmt(m('cls'), 3).padStart(7) + fmt(m('transferKB')).padStart(13) + fmt(m('jsKB')).padStart(8) + fmt(m('requests')).padStart(6) + fmt(m('apiCalls')).padStart(5) + fmt(m('duplicateApiCalls')).padStart(8))
  }
  console.log('\nin-app navigation (app already loaded)           ready ms   API calls   JS KB fetched')
  const navTable = {}
  for (const [name, rows] of Object.entries(navRows)) {
    const m = (k) => median(rows.map((r) => r[k]))
    navTable[name] = { ready: m('ready'), apiCalls: m('apiCalls'), jsKB: m('jsKB') }
    console.log(name.padEnd(48) + fmt(m('ready')).padStart(8) + fmt(m('apiCalls')).padStart(11) + fmt(m('jsKB'), 1).padStart(15))
  }
  if (out) fs.writeFileSync(out, JSON.stringify({ profile, base, runs, scenarios: table, navigation: navTable }, null, 2))
}
main().catch((e) => { console.error('ERR', e.message.split('\n')[0]); process.exit(1) })
