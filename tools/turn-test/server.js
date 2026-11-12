// Local TURN server for TESTING ONLY. It implements coturn's "use-auth-secret" REST credentials:
//   username = "<expiry-epoch-seconds>:<userId>", password = base64(HMAC-SHA1(sharedSecret, username))
// so it validates that the backend's IceServerService produces credentials a real TURN implementation accepts,
// and that credentials really expire. Production must use coturn (infra/coturn/turnserver.conf) or a managed TURN provider.
const crypto = require('crypto')
const Turn = require('node-turn')

const secret = process.env.TURN_SHARED_SECRET
if (!secret) { console.error('TURN_SHARED_SECRET is required'); process.exit(1) }
const port = Number(process.env.TURN_PORT || 3478)
const stats = { allocations: 0, authFailures: 0 }

const credentials = new Proxy({}, {
  get(_t, username) {
    if (typeof username !== 'string') return undefined
    const expiry = Number(username.split(':')[0])
    if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) { stats.authFailures++; return undefined }   // expired or malformed
    return crypto.createHmac('sha1', secret).update(username).digest('base64')
  },
})

const server = new Turn({
  authMech: 'long-term',
  credentials,
  realm: 'esp-test',
  listeningPort: port,
  listeningIps: ['127.0.0.1'],
  relayIps: ['127.0.0.1'],
  minPort: 49300,
  maxPort: 49400,
  debugLevel: 'INFO',
  debug: (level, message) => {
    if (/allocat/i.test(String(message))) { stats.allocations++; console.log(`[turn] ${level} ${message}`) }
    else if (/fail|unauthor/i.test(String(message))) { stats.authFailures++ }
  },
})
server.start()
console.log(`TURN test server listening on 127.0.0.1:${port}`)
// Tiny stats endpoint so tests can assert that media really went through the relay.
require('http').createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(stats)) }).listen(port + 1, '127.0.0.1')
