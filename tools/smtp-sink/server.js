// Tiny SMTP sink for LOCAL TESTING ONLY: accepts any mail on :2525 (no TLS, no auth) and exposes what it received at
// http://127.0.0.1:2526/messages so tests can read the emails the backend really sent over SMTP.
const net = require('net'), http = require('http')
const messages = []
function decodeHeader(v) { return v.replace(/=\?UTF-8\?[QB]\?(.*?)\?=/gi, (_m, t) => t) }
net.createServer((sock) => {
  let buf = '', inData = false, mail = { from: '', to: [], raw: '' }
  const send = (l) => sock.write(l + '\r\n')
  send('220 smtp-sink ready')
  sock.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while (inData ? (i = buf.indexOf('\r\n.\r\n')) >= 0 : (i = buf.indexOf('\r\n')) >= 0) {
      if (inData) {
        mail.raw = buf.slice(0, i); buf = buf.slice(i + 5); inData = false
        const [head, ...rest] = mail.raw.split('\r\n\r\n'); const body = rest.join('\r\n\r\n')
        const header = (n) => (head.match(new RegExp('^' + n + ':\\s*(.*(?:\\r\\n[ \\t].*)*)', 'im')) || [])[1]?.replace(/\r\n[ \t]+/g, ' ')
        messages.push({ from: mail.from, to: mail.to, subject: decodeHeader(header('Subject') || ''), listUnsubscribe: header('List-Unsubscribe') || null, body: body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), receivedAt: new Date().toISOString() })
        mail = { from: '', to: [], raw: '' }; send('250 OK queued')
      } else {
        const line = buf.slice(0, i); buf = buf.slice(i + 2); const cmd = line.toUpperCase()
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) { sock.write('250-smtp-sink\r\n250 8BITMIME\r\n') }
        else if (cmd.startsWith('MAIL FROM')) { mail.from = (line.match(/<(.*?)>/) || [])[1] || ''; send('250 OK') }
        else if (cmd.startsWith('RCPT TO')) { mail.to.push((line.match(/<(.*?)>/) || [])[1] || ''); send('250 OK') }
        else if (cmd === 'DATA') { inData = true; send('354 End data with <CR><LF>.<CR><LF>') }
        else if (cmd === 'QUIT') { send('221 Bye'); sock.end() }
        else if (cmd === 'RSET' || cmd === 'NOOP') send('250 OK')
        else send('250 OK')
      }
    }
  })
  sock.on('error', () => {})
}).listen(2525, '127.0.0.1', () => console.log('smtp sink on 127.0.0.1:2525'))
http.createServer((req, res) => {
  if (req.method === 'DELETE') { messages.length = 0; res.statusCode = 204; return res.end() }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(messages))
}).listen(2526, '127.0.0.1')
