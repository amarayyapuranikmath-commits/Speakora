// Serves frontend/dist the way production nginx does (see frontend/nginx.conf), so measurements reflect production and not the dev server:
//   - gzip for css / js / json / svg / html (not for images and fonts, which are already compressed)
//   - /assets/*  Cache-Control: public, max-age=31536000, immutable      everything else  Cache-Control: no-cache
//   - /api and /ws proxied to the backend (same origin, so the SameSite=Strict refresh cookie works)
//   - unknown paths fall back to index.html (single-page app)
// Usage: [DIST_DIR=path] node tools/perf/serve-dist.cjs [port] [backend]      default 4180 http://localhost:8090
const http = require('http')
const fs = require('fs')
const net = require('net')
const path = require('path')
const zlib = require('zlib')

const port = Number(process.argv[2] || 4180)
const backend = new URL(process.argv[3] || 'http://localhost:8090')
const root = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(__dirname, '..', '..', 'frontend', 'dist') // DIST_DIR: serve another build, e.g. a baseline for an A/B comparison
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
const gzipped = new Set(['.html', '.js', '.css', '.json', '.svg'])

function proxy(req, res) {
  const upstream = http.request({ host: backend.hostname, port: backend.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers)
    r.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  // a browser that closes a page mid-request must not take the server down
  req.on('error', () => upstream.destroy())
  res.on('error', () => upstream.destroy())
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') return proxy(req, res)
  let file = path.join(root, decodeURIComponent(req.url.split('?')[0]))
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
  const ext = path.extname(file)
  const body = fs.readFileSync(file)
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }
  if (gzipped.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const z = zlib.gzipSync(body, { level: 1 }) // nginx's default gzip level
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': z.length, Vary: 'Accept-Encoding' })
    return res.end(z)
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length })
  res.end(body)
})
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(backend.port, backend.hostname, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n')
    up.write(head)
    socket.pipe(up).pipe(socket)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})
process.on('uncaughtException', (e) => console.error('ignored', e.code || e.message))
server.listen(port, () => console.log(`serving frontend/dist on http://localhost:${port}, API and signalling proxied to ${backend.origin}`))
