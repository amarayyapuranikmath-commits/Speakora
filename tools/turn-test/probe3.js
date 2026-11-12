const dgram=require('dgram'),crypto=require('crypto')
const user=process.env.PROBE_USER, pass=process.env.PROBE_PASS, realmWanted='esp-test'
const pad=b=>Buffer.concat([b,Buffer.alloc((4-(b.length%4))%4)])
const attr=(t,v)=>{const h=Buffer.alloc(4);h.writeUInt16BE(t,0);h.writeUInt16BE(v.length,2);return Buffer.concat([h,pad(v)])}
const hdr=(len,tid)=>{const m=Buffer.alloc(20);m.writeUInt16BE(0x0003,0);m.writeUInt16BE(len,2);m.writeUInt32BE(0x2112A442,4);tid.copy(m,8);return m}
const transport=attr(0x0019,Buffer.from([17,0,0,0]))
const s=dgram.createSocket('udp4'); let step=0
function parse(m){const a={};let o=20;while(o+4<=m.length){const t=m.readUInt16BE(o),l=m.readUInt16BE(o+2);a[t]=m.slice(o+4,o+4+l);o+=4+l+((4-(l%4))%4)}return a}
s.on('message',m=>{const type=m.readUInt16BE(0),a=parse(m)
 if(step===0){step=1;const realm=a[0x0014],nonce=a[0x0015];console.log('1st reply 0x'+type.toString(16),'realm',realm&&realm.toString())
  const body=Buffer.concat([transport,attr(0x0006,Buffer.from(user)),attr(0x0014,realm),attr(0x0015,nonce)])
  const tid=crypto.randomBytes(12);const key=crypto.createHash('md5').update(user+':'+realm.toString()+':'+pass).digest()
  const h=hdr(body.length+24,tid);const mac=crypto.createHmac('sha1',key).update(Buffer.concat([h,body])).digest()
  s.send(Buffer.concat([hdr(body.length+24,tid),body,attr(0x0008,mac)]),3478,'127.0.0.1')}
 else{console.log('2nd reply type 0x'+type.toString(16), type===0x103?'ALLOCATE SUCCESS':(type===0x113?'ALLOCATE ERROR '+(a[9]?a[9][2]*100+a[9][3]+' '+a[9].slice(4):''):'?'));s.close()}})
const tid=crypto.randomBytes(12);s.send(Buffer.concat([hdr(transport.length,tid),transport]),3478,'127.0.0.1')
setTimeout(()=>{try{s.close()}catch{}},4000)
