const dgram = require('dgram'), crypto = require('crypto')
const s = dgram.createSocket('udp4')
// STUN Binding Request (RFC 5389): type 0x0001, length 0, magic cookie, 12-byte transaction id
const msg = Buffer.alloc(20); msg.writeUInt16BE(0x0001, 0); msg.writeUInt16BE(0, 2); msg.writeUInt32BE(0x2112A442, 4); crypto.randomBytes(12).copy(msg, 8)
s.on('message', (m, r) => { console.log('reply from', r.address + ':' + r.port, 'type 0x' + m.readUInt16BE(0).toString(16), 'len', m.length); s.close() })
s.send(msg, 3478, '127.0.0.1')
setTimeout(() => { console.log('NO REPLY within 3s'); s.close() }, 3000)
