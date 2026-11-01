"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const net=require("node:net");
const {createCore,createCenter}=require("./mock-core-session.cjs");
const {start,APP,VERSION}=require("../center-named-pipe-bridge/bridge-sandbox.cjs");
function make(){
 const s={time:1000,revoked:false,active:true,owner:true,build:true,run:"run-1",device:"dev-1"};
 const authority=(request)=>({trusted:true,app:APP,deviceActive:s.active,
  revoked:s.revoked,runOwned:s.owner,buildApproved:s.build,exp:5000,
  run:s.run,device:s.device});
 const core=createCore({verify:authority,now:()=>s.time});
 return {s,core};
}
async function peer(addr,frame){
 const socket=net.createConnection(addr);
 let b="";
 try{
  await new Promise((ok,bad)=>{socket.once("connect",ok);socket.once("error",bad)});
  socket.on("data",chunk=>{b+=chunk.toString("utf8")});
  socket.write(JSON.stringify(frame)+"\n");
  for(let i=0;i<60&&!b.includes("\n");i++)await new Promise(r=>setTimeout(r,10));
  if(!b.includes("\n"))throw Error("TIMEOUT");
  return JSON.parse(b.slice(0,b.indexOf("\n")));
 }finally{socket.destroy()}
}
const hello=t=>({type:"HELLO",version:VERSION,appId:APP,ticket:t});
test("Core issues opaque random ticket without user or coin",()=>{
 const {core}=make();const x=core.issue({userId:"attacker",coins:999999});
 assert.match(x,/^[a-f0-9]{64}$/);assert.equal(x.includes("attacker"),false);
});
test("Core issued tickets are unique",()=>{
 const {core}=make();assert.notEqual(core.issue({}),core.issue({}));
});
test("same ticket redeemed once only",()=>{
 const {core}=make(),t=core.issue({});assert.equal(core.redeem(t)?.runId,"run-1");
 assert.equal(core.redeem(t),null);
});
test("invalid ticket rejected",()=>assert.equal(make().core.redeem("fake"),null));
test("no active device: no issuance",()=>{
 const {core,s}=make();s.active=false;assert.equal(core.issue({}),null);
});
test("revoked device: no issuance",()=>{
 const {core,s}=make();s.revoked=true;assert.equal(core.issue({}),null);
});
test("unowned Run: no issuance",()=>{
 const {core,s}=make();s.owner=false;assert.equal(core.issue({}),null);
});
test("unapproved build: no issuance",()=>{
 const {core,s}=make();s.build=false;assert.equal(core.issue({}),null);
});
test("expired authorization: no issuance",()=>{
 const {core,s}=make();s.time=5000;assert.equal(core.issue({}),null);
});
test("revoked after grant before redeem: fail closed",()=>{
 const {core,s}=make(),t=core.issue({});s.revoked=true;assert.equal(core.redeem(t),null);
});
test("Run moved after grant: fail closed",()=>{
 const {core,s}=make(),t=core.issue({});s.run="other-run";assert.equal(core.redeem(t),null);
});
test("expired after grant: fail closed",()=>{
 const {core,s}=make(),t=core.issue({});s.time=5000;assert.equal(core.redeem(t),null);
});
test("device moved after grant: fail closed",()=>{
 const {core,s}=make(),t=core.issue({});s.device="other-device";assert.equal(core.redeem(t),null);
});
test("replayed Center transfer blocked",async()=>{
 const a=[],center=createCenter({deliver:async v=>a.push(v)});
 const t=make().core.issue({});
 assert.equal(await center.transfer(t),true);
 assert.equal(await center.transfer(t),false);assert.deepEqual(a,[t]);
});
test("Center only exposes transfer and cannot issue server grant",()=>{
 const center=createCenter({deliver:async()=>{}});
 assert.equal(center.issue,undefined);assert.equal(center.mintCoins,undefined);
});
test("Center delivery failure returns false",async()=>{
 const c=createCenter({deliver:async()=>{throw Error("transport");}});
 assert.equal(await c.transfer("a".repeat(64)),false);
});
test("actual local IPC: Core ticket admitted once",async()=>{
 const {core}=make(),server=await start({
  ticketCheck:t=>{const c=core.redeem(t);return c?{
   appId:APP,runId:c.runId,deviceActive:true,revoked:false,expiresAtMs:c.expiresAtMs
  }:null},sessionCheck:claim=>core.isActive({runId:claim.runId,expiresAtMs:claim.expiresAtMs}),
  clock:()=>1000
 });
 try{
  const t=core.issue({}),one=await peer(server.address,hello(t)),two=await peer(server.address,hello(t));
  assert.equal(one.type,"HELLO_ACK");assert.equal(two.ok,false);
 }finally{await server.close()}
});
test("actual local IPC rejects unissued, client-fabricated ticket",async()=>{
 const {core}=make(),server=await start({
  ticketCheck:t=>{const c=core.redeem(t);return c?{
   appId:APP,runId:c.runId,deviceActive:true,revoked:false,expiresAtMs:c.expiresAtMs
  }:null},sessionCheck:()=>true,clock:()=>1000
 });
 try{assert.equal((await peer(server.address,hello("b".repeat(64)))).reason,"TICKET_UNVERIFIED")}
 finally{await server.close()}
});
