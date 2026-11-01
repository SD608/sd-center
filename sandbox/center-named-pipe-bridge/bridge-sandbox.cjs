'use strict';
// Disposable IPC QA ONLY. NO live Center auth, Unity launch, Windows ACL/PID
// validation, Core API or economy write permissions.
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const MAX=4096,APP='miner-unity',VERSION=1; // AppId and protocol: DRAFT TEST ONLY.
const denied=reason=>({ok:false,state:'DENIED',reason});
function freshAddress(){const id=randomUUID();return process.platform==='win32'
 ? '\\\\.\\pipe\\sdcenter-miner-contract-'+id
 : path.join(os.tmpdir(),'sdcenter-miner-contract-'+id+'.sock');}
async function start({ticketCheck,sessionCheck,clock=Date.now,address=freshAddress(),idleMs=3500}={}){
 if(typeof ticketCheck!=='function'||typeof sessionCheck!=='function') throw Error('TRUSTED_TEST_VERIFIERS_REQUIRED');
 const tickets=new Set(),sockets=new Set();let stopped=false;
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.setTimeout(idleMs,()=>socket.destroy());
  let pending=Buffer.alloc(0),claims=null,authed=false,count=0,closing=false;
  const reply=(val,close=false)=>{if(socket.destroyed||closing)return;
   socket.write(JSON.stringify(val)+'\n');if(close){closing=true;socket.end()}};
  socket.on('data',chunk=>{
   if(closing)return;
   pending=Buffer.concat([pending,chunk]);
   if(pending.length>MAX){reply(denied('FRAME_TOO_LARGE'),true);return}
   while(!closing){
    const n=pending.indexOf(10);if(n<0)break;
    const frame=pending.subarray(0,n);pending=pending.subarray(n+1);
    if(frame.length>MAX||++count>64){reply(denied('MESSAGE_LIMIT'),true);break}
    let msg;try{msg=JSON.parse(frame.toString('utf8'))}catch{reply(denied('INVALID_JSON'),true);break}
    if(!msg||typeof msg!=='object'||Array.isArray(msg)){reply(denied('INVALID_FRAME'),true);break}
    if(!authed){
     if(msg.type!=='HELLO'||msg.version!==VERSION||msg.appId!==APP||
       typeof msg.ticket!=='string'||msg.ticket.length<24||msg.ticket.length>256){
       reply(denied('HANDSHAKE_REQUIRED'),true);break}
     if(tickets.has(msg.ticket)){reply(denied('TICKET_REPLAY'),true);break}
     let att;try{att=ticketCheck(msg.ticket)}catch{reply(denied('TICKET_UNVERIFIED'),true);break}
     if(!att||typeof att.then==='function'||att.appId!==APP||!att.runId||
       att.deviceActive!==true||att.revoked!==false||!Number.isFinite(att.expiresAtMs)||
       att.expiresAtMs<=clock()){reply(denied('TICKET_UNVERIFIED'),true);break}
     tickets.add(msg.ticket);claims=att;authed=true;
     reply({ok:true,type:'HELLO_ACK',mode:'MOCK_READ_ONLY',version:VERSION});continue;
    }
    let valid=false;try{valid=sessionCheck(claims)===true&&claims.expiresAtMs>clock()}catch{}
    if(!valid){reply(denied('SESSION_REVOKED_OR_EXPIRED'),true);break}
    if(msg.type==='PING')reply({ok:true,type:'PONG',mode:'MOCK_READ_ONLY'});
    else if(msg.type==='GET_STATUS')reply({ok:true,type:'STATUS',coreConnected:false,runEngineConnected:false});
    else reply(denied('COMMAND_NOT_ALLOWED'),true);
   }
  });
  socket.on('error',()=>{});
  socket.on('close',()=>sockets.delete(socket));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);
  server.listen(address,()=>{server.off('error',reject);resolve()})});
 return {address,close:async()=>{if(stopped)return;stopped=true;
  for(const s of sockets)s.destroy();
  await new Promise(resolve=>server.close(resolve))}};
}
module.exports={start,APP,VERSION,MAX};
