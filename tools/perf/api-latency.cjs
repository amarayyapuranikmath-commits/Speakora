// Response time and payload size of the API endpoints the apps call most, measured over real HTTP against a running backend.
//   PERF_PASSWORD=<account password> node tools/perf/api-latency.cjs --base http://localhost:8090 --email perf.1@example.com [--n 30] [--out file.json]
// Each endpoint: 3 warm-up requests (not counted), then n timed requests, paced to stay far under the backend's 300 requests/minute/IP limit.
// Reports p50/p95/max in ms, the bytes that travel on the wire when the client asks for gzip, the uncompressed bytes, and whether the server compressed.
const http = require('http')
const zlib = require('zlib')
const fs = require('fs')

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const base = new URL(arg('base', 'http://localhost:8090'))
const email = arg('email'), password = process.env.PERF_PASSWORD
if (!password) { console.error('Set PERF_PASSWORD to the password of the throwaway perf account (it is read from the environment, never from the command line or this file).'); process.exit(2) }
const n = Number(arg('n', 30))
const out = arg('out')

function request(method, path, { token, body, gzip = true } = {}) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint()
    const headers = { 'Accept-Encoding': gzip ? 'gzip' : 'identity', 'X-Client-Type': 'mobile' }
    if (token) headers.Authorization = 'Bearer ' + token
    if (body) headers['Content-Type'] = 'application/json'
    const req = http.request({ host: base.hostname, port: base.port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        const wire = Buffer.concat(chunks)
        const plain = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(wire) : wire
        resolve({ status: res.statusCode, ms, wireBytes: wire.length, plainBytes: plain.length, encoding: res.headers['content-encoding'] || 'none', text: plain.toString('utf8') })
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const login = await request('POST', '/api/auth/login', { body: { email, password } })
  if (login.status !== 200) throw new Error('login failed: ' + login.status)
  const token = JSON.parse(login.text).accessToken
  const friends = JSON.parse((await request('GET', '/api/friends', { token })).text)
  const firstFriend = friends.friends && friends.friends[0] ? friends.friends[0].ref : null

  const endpoints = [
    '/api/me', '/api/profile', '/api/topics', '/api/preferences', '/api/stats/summary', '/api/stats/activity?days=30',
    '/api/friends', '/api/partners', '/api/learn/overview', '/api/learn/progress', '/api/learn/revision',
    '/api/learn/vocabulary/levels/1', '/api/learn/vocabulary/daily', '/api/learn/grammar/levels/1', '/api/learn/phrasal/levels/1',
    '/api/coach/status', '/api/coach/modes', '/api/coach/preferences', '/api/coach/conversations', '/api/calls', '/api/calls/ice-servers', '/api/blocks',
  ]
  if (firstFriend) endpoints.push(`/api/friends/${firstFriend}/messages`)

  const rows = []
  for (const path of endpoints) {
    for (let i = 0; i < 3; i++) { await request('GET', path, { token }); await sleep(250) }
    const times = []
    let last
    for (let i = 0; i < n; i++) { last = await request('GET', path, { token }); times.push(last.ms); await sleep(250) }
    const plainSize = (await request('GET', path, { token, gzip: false })).plainBytes
    rows.push({ path, status: last.status, p50: pct(times, 50), p95: pct(times, 95), max: Math.max(...times), wireBytes: last.wireBytes, plainBytes: plainSize, encoding: last.encoding })
    await sleep(250)
  }
  console.log(`API latency over HTTP, ${base.origin}, ${n} timed requests per endpoint after 3 warm-up (ms)\n`)
  console.log('endpoint'.padEnd(46) + 'status'.padStart(7) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + 'bytes'.padStart(10) + 'gz bytes'.padStart(10) + ' encoding')
  for (const r of rows) console.log(r.path.padEnd(46) + String(r.status).padStart(7) + r.p50.toFixed(1).padStart(8) + r.p95.toFixed(1).padStart(8) + r.max.toFixed(1).padStart(8) + String(r.plainBytes).padStart(10) + String(r.encoding === 'gzip' ? r.wireBytes : '-').padStart(10) + ' ' + r.encoding)
  if (out) fs.writeFileSync(out, JSON.stringify({ base: base.origin, n, rows }, null, 2))
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
