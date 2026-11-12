// Two backend instances (8096 and 8097) share one Redis database and one PostgreSQL schema.
// Each pair is split: user A is connected to instance 1, user B to instance 2. What happens when they Quick Match?
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const SC = fileURLToPath(new URL('./work', import.meta.url)) // secret, user list and per-run results (git-ignored)
const secret = fs.readFileSync(`${SC}/lt-secret.txt`, 'utf8')
const b64 = (b) => Buffer.from(b).toString('base64url')
const mint = (sub, use, ttl, role) => {
  const now = Math.floor(Date.now() / 1000)
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const bd = b64(JSON.stringify({ jti: crypto.randomUUID(), sub, use, ...(role ? { role } : {}), iat: now, exp: now + ttl }))
  return `${h}.${bd}.${crypto.createHmac('sha256', secret).update(`${h}.${bd}`).digest('base64url')}`
}
const rows = fs.readFileSync(`${SC}/lt-users.csv`, 'utf8').split('\n').map((l) => l.trim().split(',')).filter((p) => /^[0-9a-f-]{36}$/.test(p[0]))
const byLevel = {}
for (const [id, lvl] of rows.slice(5000)) (byLevel[lvl] ||= []).push(id) // a different slice from the other tests
const PAIRS = Number(process.argv[2] || 12)
const pairs = []
for (let i = 0; pairs.length < PAIRS; i++) { const lv = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'][i % 6]; const arr = byLevel[lv]; pairs.push([arr.pop(), arr.pop()]) }

const stats = { matchFoundA: 0, matchFoundB: 0, signalsToA: 0, signalsToB: 0, errors: {}, opened: 0 }
const sockets = []
async function connect(port, id, onMsg) {
  const r = await fetch(`http://localhost:${port}/api/ws/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${mint(id, 'access', 3600, 'USER')}`, 'Content-Type': 'application/json' }, body: '{}' })
  const { ticket } = await r.json()
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?ticket=${encodeURIComponent(ticket)}`)
  sockets.push(ws)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  stats.opened += 1
  ws.onmessage = (ev) => onMsg(JSON.parse(ev.data), ws)
  return ws
}
for (const [a, b] of pairs) { // one pair at a time: the only possible partner is on the OTHER instance
  const seen = { A: [], B: [] }
  const handler = (who) => (msg, ws) => {
    if (msg.type === 'error') stats.errors[msg.code] = (stats.errors[msg.code] || 0) + 1
    if (msg.type === 'match.found') {
      stats[`matchFound${who}`] += 1
      seen[who].push('match.found')
      if (msg.initiator) ws.send(JSON.stringify({ type: 'signal', callId: msg.callId, kind: 'offer', payload: { type: 'offer', sdp: 'x' } }))
    }
    if (msg.type === 'signal') { stats[`signalsTo${who}`] += 1; seen[who].push('signal') }
  }
  const wa = await connect(8096, a, handler('A'))
  const wb = await connect(8097, b, handler('B'))
  wa.send(JSON.stringify({ type: 'queue.join' }))
  await new Promise((r) => setTimeout(r, 300))
  wb.send(JSON.stringify({ type: 'queue.join' }))
  await new Promise((r) => setTimeout(r, 4500))
  console.log('pair', pairs.indexOf(pairs.find((p) => p[0] === a)) + 1, 'instance 1 user got:', seen.A.join(',') || 'nothing', '| instance 2 user got:', seen.B.join(',') || 'nothing')
  wa.send(JSON.stringify({ type: 'queue.cancel' })); wb.send(JSON.stringify({ type: 'queue.cancel' }))
  wa.close(); wb.close()
  await new Promise((r) => setTimeout(r, 300))
}
console.log(JSON.stringify({ pairs: pairs.length, usersConnected: stats.opened, 'match.found received by the user on instance 1 (8096)': stats.matchFoundA, 'match.found received by the user on instance 2 (8097)': stats.matchFoundB, 'offers delivered to instance 1 users': stats.signalsToA, 'offers delivered to instance 2 users': stats.signalsToB, errors: stats.errors }, null, 2))
sockets.forEach((s) => { try { s.close() } catch {} })
setTimeout(() => process.exit(0), 500)
