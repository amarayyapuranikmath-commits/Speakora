// How many JDBC statements each request makes. Needs a backend started with Hibernate statistics, logging to a file:
//   java -jar backend/target/*.jar --spring.jpa.properties.hibernate.generate_statistics=true \
//        --logging.level.org.hibernate.engine.internal.StatisticalLoggingSessionEventListener=INFO > backend.log
//   PERF_PASSWORD=<account password> node tools/perf/sql-count.cjs --base http://localhost:8090 --log backend.log --email perf.1@example.com [--out file.json]
// One request at a time; the statements counted are the ones Hibernate logged between the request starting and finishing.
const fs = require('fs')
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const base = arg('base', 'http://localhost:8090'), logFile = arg('log'), email = arg('email'), password = process.env.PERF_PASSWORD, out = arg('out')
if (!password) { console.error('Set PERF_PASSWORD to the password of the throwaway perf account (it is read from the environment, never from the command line or this file).'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' }, body: JSON.stringify({ email, password }) })
  const token = (await login.json()).accessToken
  const get = (path) => fetch(base + path, { headers: { Authorization: 'Bearer ' + token, 'X-Client-Type': 'mobile' } })
  const friends = await (await get('/api/friends')).json()
  const ref = friends.friends && friends.friends[0] && friends.friends[0].ref
  const paths = ['/api/me', '/api/profile', '/api/stats/summary', '/api/stats/activity?days=30', '/api/friends', '/api/partners', '/api/learn/overview', '/api/learn/progress',
    '/api/learn/vocabulary/levels/1', '/api/coach/status', '/api/coach/preferences', '/api/coach/conversations', '/api/calls', '/api/blocks', '/api/topics', '/api/preferences']
  if (ref) paths.push(`/api/friends/${ref}/messages`)
  const rows = []
  for (const path of paths) {
    await sleep(400)
    const before = fs.statSync(logFile).size
    const res = await get(path)
    await res.arrayBuffer()
    await sleep(500)
    const fd = fs.openSync(logFile, 'r'), size = fs.fstatSync(fd).size - before, buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, before); fs.closeSync(fd)
    const text = buf.toString('utf8')
    const statements = [...text.matchAll(/spent executing (\d+) JDBC statements/g)].reduce((s, m) => s + Number(m[1]), 0)
    const sessions = (text.match(/Session Metrics/g) || []).length
    rows.push({ path: path.replace(ref || '\u0000', '{friend}'), status: res.status, statements, sessions })
  }
  console.log('JDBC statements per request'.padEnd(46) + 'status'.padStart(7) + 'statements'.padStart(12) + 'sessions'.padStart(10))
  for (const r of rows) console.log(r.path.padEnd(46) + String(r.status).padStart(7) + String(r.statements).padStart(12) + String(r.sessions).padStart(10))
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2))
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
