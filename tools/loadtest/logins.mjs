// Registration and login cost on the isolated backend (password hashing). Distinct X-Forwarded-For per request so the per-IP limits do not mask the cost.
const BASE = 'http://localhost:8096'
const n = Number(process.argv[2] || 24)
const conc = Number(process.argv[3] || 6)
const pw = 'Passw0rdOK'
const stamp = Date.now()
const ip = (i) => `10.9.${(i >> 8) & 255}.${(i & 255) || 1}`
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
async function post(path, body, i) {
  const t = Date.now()
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(i) }, body: JSON.stringify(body) })
  await r.text()
  return { status: r.status, ms: Date.now() - t }
}
async function pool(count, fn) {
  const out = []
  let next = 0
  const t0 = Date.now()
  await Promise.all(Array.from({ length: conc }, async () => { while (next < count) { const i = next++; out.push(await fn(i)) } }))
  return { out, wall: Date.now() - t0 }
}
const reg = await pool(n, (i) => post('/api/auth/register', { email: `login${stamp}.${i}@loadtest.invalid`, password: pw, displayName: `Login ${i}`, dateOfBirth: '1990-05-01' }, i))
const log = await pool(n * 2, (i) => post('/api/auth/login', { email: `login${stamp}.${i % n}@loadtest.invalid`, password: pw }, 1000 + i))
const sum = (label, r) => {
  const ok = r.out.filter((x) => x.status < 300).length
  const ms = r.out.map((x) => x.ms)
  console.log(`${label}: ${r.out.length} requests, ok=${ok}, statuses=${JSON.stringify(r.out.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {}))}, p50=${pct(ms, 50)}ms p95=${pct(ms, 95)}ms max=${Math.max(...ms)}ms, throughput=${(r.out.length / (r.wall / 1000)).toFixed(1)}/s with ${conc} in parallel`)
}
sum('register', reg)
sum('login   ', log)
