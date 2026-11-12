const dgram = require('dgram'), crypto = require('crypto')
const s = dgram.createSocket('udp4'); let done = false
// TURN Allocate request (type 0x0003) with REQUESTED-TRANSPORT = UDP (attr 0x0019, 4 bytes: 17,0,0,0)
const attr = Buffer.alloc(8); attr.writeUInt16BE(0x0019, 0); attr.writeUInt16BE(4, 2); attr.writeUInt8(17, 4)
const msg = Buffer.alloc(20); msg.writeUInt16BE(0x0003, 0); msg.writeUInt16BE(attr.length, 2); msg.writeUInt32BE(0x2112A442, 4); crypto.randomBytes(12).copy(msg, 8)
const pkt = Buffer.concat([msg, attr])
s.on('message', (m, r) => {
  done = true
  const type = m.readUInt16BE(0), len = m.readUInt16BE(2)
  console.log('reply type 0x' + type.toString(16), 'len', len)
  // walk attributes, print ids and error code/realm
  let off = 20
  while (off + 4 <= m.length) {
    const t = m.readUInt16BE(off), l = m.readUInt16BE(off + 2), v = m.slice(off + 4, off + 4 + l)
    if (t === 0x0009) console.log(' ERROR-CODE', v[2] * 100 + v[3], v.slice(4).toString())
    else if (t === 0x0014) console.log(' REALM', v.toString())
    else if (t === 0x0015) console.log(' NONCE', v.toString().slice(0, 16) + '...')
    else console.log(' attr 0x' + t.toString(16), 'len', l)
    off += 4 + l + ((4 - (l % 4)) % 4)
  }
  s.close()
})
s.send(pkt, 3478, '127.0.0.1')
setTimeout(() => { if (!done) { console.log('NO REPLY to Allocate within 3s'); s.close() } }, 3000)
