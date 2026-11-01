'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net'),crypto=require('node:crypto');
const {start,APP,VERSION,MAX}=require('./bridge-sandbox.cjs');
function fixtures(){
 const known=new Map(),time={ms:1000};
 const ticket=(override={})=>{
  const t=crypto.randomBytes(32).toString('hex');
  const claim={appId:APP,runId:'test-run',deviceActive:true,revoked:false,
   serverVerified:true,expiresAtMs:9000,...override};
  known.set(t,claim);return {t,claim};
 };
 return {ticket,time,server:()=>start({ticketCheck:t=>known.get(t)||null,
  sessionCheck:c=>c.serverVerified===true&&c.revoked===false&&c.deviceActive===true,
  clock:()=>time.ms,idleMs:3000})};
}
async function client(addr){
 const socket=net.createConnection(addr);
 await new Promise((yes,no)=>{socket.once('connect',yes);socket.once('error',no)});
 let buf='',requests=[];
 socket.on('data',bytes=>{
  buf+=bytes.toString('utf8');let pos;
  while((pos=buf.indexOf('\n'))>=0){const line=buf.slice(0,pos);buf=buf.slice(pos+1);
   const req=requests.shift();if(req)req.yes(JSON.parse(line))}
 });
 socket.on('error',e=>{for(const r of requests.splice(0))r.no(e)});
 socket.on('close',()=>{for(const r of requests.splice(0))r.no(Error('SOCKET_CLOSED'))});
 return {send:msg=>new Promise((yes,no)=>{requests.push({yes,no});
   socket.write((typeof msg==='string'?msg:JSON.stringify(msg))+'\n')}),
  close:()=>socket.destroy()};
}
const hello=(ticket,extra={})=>({type:'HELLO',version:VERSION,appId:APP,ticket,...extra});
async function check(fn){
 const f=fixtures(),s=await f.server();
 try{await fn(f,s)}finally{await s.close()}
}
test('actual platform pipe transport handshake + ping',()=>check(async(f,s)=>{
 if(process.platform==='win32')assert.ok(s.address.startsWith('\\\\.\\pipe\\'));
 else assert.ok(s.address.endsWith('.sock'));
 const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket().t))).type,'HELLO_ACK');
 assert.equal((await c.send({type:'PING'})).type,'PONG')}finally{c.close()}
}));
test('untrusted request without HELLO fails',()=>check(async(_f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send({type:'GET_STATUS'})).reason,'HANDSHAKE_REQUIRED')}finally{c.close()}}));
test('broken JSON denied',()=>check(async(_f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send('{no')).reason,'INVALID_JSON')}finally{c.close()}}));
test('JSON array denied',()=>check(async(_f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send([])).reason,'INVALID_FRAME')}finally{c.close()}}));
test('invented ticket rejected',()=>check(async(_f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello('a'.repeat(64)))).reason,'TICKET_UNVERIFIED')}finally{c.close()}}));
test('wrong version rejected',()=>check(async(f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket().t,{version:2}))).reason,'HANDSHAKE_REQUIRED')}finally{c.close()}}));
test('cross-game client rejected',()=>check(async(f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket().t,{appId:'sd_slot'}))).reason,'HANDSHAKE_REQUIRED')}finally{c.close()}}));
test('cross-game server fixture rejected',()=>check(async(f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket({appId:'sd_slot'}).t))).reason,'TICKET_UNVERIFIED')}finally{c.close()}}));
test('revoked attestation rejected',()=>check(async(f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket({revoked:true}).t))).reason,'TICKET_UNVERIFIED')}finally{c.close()}}));
test('expired attestation rejected',()=>check(async(f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send(hello(f.ticket({expiresAtMs:1000}).t))).reason,'TICKET_UNVERIFIED')}finally{c.close()}}));
test('ticket reuse across pipes denied',()=>check(async(f,s)=>{
 const t=f.ticket().t,a=await client(s.address),b=await client(s.address);
 try{assert.equal((await a.send(hello(t))).ok,true);
 assert.equal((await b.send(hello(t))).reason,'TICKET_REPLAY')}finally{a.close();b.close()}
}));
test('disconnect + new ticket can reattach to mock',()=>check(async(f,s)=>{
 const a=await client(s.address);await a.send(hello(f.ticket().t));a.close();
 const b=await client(s.address);
 try{assert.equal((await b.send(hello(f.ticket().t))).ok,true)}finally{b.close()}
}));
test('revoked after handshake denies next operation',()=>check(async(f,s)=>{
 const x=f.ticket(),c=await client(s.address);
 try{await c.send(hello(x.t));x.claim.revoked=true;
 assert.equal((await c.send({type:'PING'})).reason,'SESSION_REVOKED_OR_EXPIRED')}finally{c.close()}
}));
test('expired during session denies next operation',()=>check(async(f,s)=>{
 const x=f.ticket(),c=await client(s.address);
 try{await c.send(hello(x.t));f.time.ms=9000;
 assert.equal((await c.send({type:'GET_STATUS'})).reason,'SESSION_REVOKED_OR_EXPIRED')}finally{c.close()}
}));
test('client wallet or world writes are never supported',()=>check(async(f,s)=>{
 for(const msg of [{type:'GRANT_COINS',amount:100000},{type:'SET_LOOT',count:1000}]){
  const c=await client(s.address);
  try{await c.send(hello(f.ticket().t));
   assert.equal((await c.send(msg)).reason,'COMMAND_NOT_ALLOWED')}finally{c.close()}
 }
}));
test('read only status is always disconnected',()=>check(async(f,s)=>{
 const c=await client(s.address);
 try{await c.send(hello(f.ticket().t));const status=await c.send({type:'GET_STATUS'});
 assert.equal(status.coreConnected,false);assert.equal(status.runEngineConnected,false);
 assert.equal(JSON.stringify(status).includes('wallet'),false)}finally{c.close()}
}));
test('oversize frame rejected',()=>check(async(_f,s)=>{const c=await client(s.address);
 try{assert.equal((await c.send('Z'.repeat(MAX+20))).reason,'FRAME_TOO_LARGE')}finally{c.close()}}));
test('client claimed PID/role cannot substitute server ticket',()=>check(async(_f,s)=>{
 const c=await client(s.address);
 try{assert.equal((await c.send(hello('invented-no-signed-session-secret-0123456789',
 {pid:1234,claimedAdmin:true}))).reason,'TICKET_UNVERIFIED')}finally{c.close()}
}));
