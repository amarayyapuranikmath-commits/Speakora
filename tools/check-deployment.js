#!/usr/bin/env node
// Security and configuration check for a DEPLOYED instance (no dependencies, Node 18+).
//   node tools/check-deployment.js https://speak.example.com
//   CHECK_EMAIL=you@example.com CHECK_PASSWORD=... node tools/check-deployment.js https://speak.example.com   (also checks cookie flags)
// Pointed at http://localhost it still runs; checks that only make sense over HTTPS are reported as SKIP.
const tls = require('tls')
const http = require('http')
const https = require('https')
const base = (process.argv[2] || '').replace(/\/$/, '')
if (!/^https?:\/\//.test(base)) { console.error('usage: node tools/check-deployment.js https://your.domain'); process.exit(2) }
const url = new URL(base)
const isHttps = url.protocol === 'https:'
const results = []
const add = (status, name, detail = '') => results.push({ status, name, detail })
const ok = (c, name, detail) => add(c ? 'PASS' : 'FAIL', name, c ? '' : detail)
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init })

async function main() {
  // --- transport
  if (isHttps) {
    try {
      const r = await fetch(`http://${url.host}/`, { redirect: 'manual' })
      ok([301, 302, 307, 308].includes(r.status) && (r.headers.get('location') || '').startsWith('https://'), 'plain HTTP redirects to HTTPS', `status ${r.status}`)
    } catch (e) { add('FAIL', 'plain HTTP redirects to HTTPS', 'port 80 not reachable: ' + e.cause?.code) }
    await new Promise((resolve) => {
      const s = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname }, () => {
        const cert = s.getPeerCertificate()
        const days = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000)
        ok(s.authorized, 'TLS certificate is valid and trusted', String(s.authorizationError))
        ok(days > 14, `certificate has more than 14 days left (${days})`, `expires ${cert.valid_to}`)
        ok(['TLSv1.3', 'TLSv1.2'].includes(s.getProtocol()), `modern TLS version (${s.getProtocol()})`, s.getProtocol())
        s.end(); resolve()
      })
      s.on('error', (e) => { add('FAIL', 'TLS handshake', e.message); resolve() })
    })
  } else {
    add('SKIP', 'HTTPS redirect, certificate and TLS version', 'base URL is http (fine for local development only)')
  }

  // --- page + headers
  const home = await get('/')
  ok(home.status === 200, 'home page loads', `status ${home.status}`)
  const h = (n) => (home.headers.get(n) || '')
  if (isHttps) ok(/max-age=\d{6,}/.test(h('strict-transport-security')), 'HSTS header (Strict-Transport-Security)', 'missing or too short')
  else add('SKIP', 'HSTS header', 'only meaningful over HTTPS')
  ok(/default-src 'self'/.test(h('content-security-policy')) && !/script-src[^;]*'unsafe-inline'/.test(h('content-security-policy')), 'Content-Security-Policy present and scripts are same-origin only', h('content-security-policy') || 'missing')
  ok(h('x-content-type-options').toLowerCase() === 'nosniff', 'X-Content-Type-Options: nosniff', 'missing')
  ok(/frame-ancestors 'none'/.test(h('content-security-policy')) || /deny|sameorigin/i.test(h('x-frame-options')), 'clickjacking protection (frame-ancestors / X-Frame-Options)', 'missing')
  ok(/microphone=\(self\)/.test(h('permissions-policy')), 'Permissions-Policy limits the microphone to this site', h('permissions-policy') || 'missing')
  ok(!/x-powered-by|server/i.test('') && !/spring|tomcat/i.test(h('server') + h('x-powered-by')), 'no framework/server version banner', h('server') + ' ' + h('x-powered-by'))

  // --- API behaviour
  const anon = await get('/api/me')
  ok(anon.status === 401, 'API rejects anonymous requests (401)', `status ${anon.status}`)
  const bad = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.invalid', password: 'wrong-password-1' }) })
  ok(bad.status === 401, 'wrong credentials give a generic 401', `status ${bad.status}`)
  const rid = bad.headers.get('x-request-id')
  ok(!!rid, 'responses carry an X-Request-Id for log correlation', 'missing')
  const cors = await get('/api/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })
  ok(!cors.headers.get('access-control-allow-origin'), 'CORS does not allow a foreign origin', 'allowed: ' + cors.headers.get('access-control-allow-origin'))
  const wsStatus = await new Promise((resolve) => {
    const req = (isHttps ? https : http).request(base + '/ws/signaling', { headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', origin: base }, timeout: 8000 })
    req.on('response', (res) => { res.resume(); resolve(res.statusCode) })
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101) })
    req.on('error', () => resolve(0))
    req.on('timeout', () => { req.destroy(); resolve(0) })
    req.end()
  })
  ok(wsStatus !== 101 && wsStatus !== 0, 'signalling WebSocket refuses a handshake without a ticket', `status ${wsStatus}`)

  // --- things that must not be public
  for (const p of ['/swagger-ui/index.html', '/v3/api-docs', '/actuator/env', '/actuator/prometheus', '/actuator/heapdump', '/.env']) {
    const r = await get(p)
    const body = r.status === 200 ? await r.text() : ''
    const leaked = r.status === 200 && !/<!doctype html/i.test(body)
    ok(!leaked, `${p} is not exposed`, `status ${r.status}, non-HTML content returned`)
  }

  // --- cookie flags (needs a real account)
  if (process.env.CHECK_EMAIL && process.env.CHECK_PASSWORD) {
    const r = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.CHECK_EMAIL, password: process.env.CHECK_PASSWORD }) })
    const cookie = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith('refresh_token='))
    ok(r.status === 200 && !!cookie, 'test sign-in works', `status ${r.status}`)
    if (cookie) {
      ok(/HttpOnly/i.test(cookie), 'refresh cookie is HttpOnly', cookie.replace(/=[^;]+/, '=***'))
      ok(/SameSite=Strict/i.test(cookie), 'refresh cookie is SameSite=Strict', '')
      ok(/Path=\/api\/auth/i.test(cookie), 'refresh cookie is scoped to /api/auth', '')
      if (isHttps) ok(/;\s*Secure/i.test(cookie), 'refresh cookie is Secure', 'COOKIE_SECURE is not true')
    }
  } else {
    add('SKIP', 'cookie flags', 'set CHECK_EMAIL and CHECK_PASSWORD to test them with a real account')
  }
}

main().catch((e) => add('FAIL', 'check crashed', e.message)).finally(() => {
  let failed = 0
  for (const r of results) {
    if (r.status === 'FAIL') failed++
    console.log(`${r.status.padEnd(4)}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`)
  }
  console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter((r) => r.status === 'SKIP').length} skipped`)
  process.exit(failed ? 1 : 0)
})
