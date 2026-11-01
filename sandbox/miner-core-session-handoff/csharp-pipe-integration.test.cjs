"use strict";
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const path=require("node:path");
const {createCore}=require("./mock-core-session.cjs");
const {start,APP}=require("../center-named-pipe-bridge/bridge-sandbox.cjs");
async function invoke(exe,pipeName,ticket){
 return await new Promise((resolve,reject)=>{
  const child=spawn(exe,[pipeName],{stdio:["pipe","pipe","pipe"],windowsHide:true});
  let out="",err="";
  child.stdout.on("data",b=>out+=b);child.stderr.on("data",b=>err+=b);
  child.on("error",reject);
  child.on("close",code=>resolve({code,out,err}));
  child.stdin.end(ticket+"\n");
 });
}
async function run(){
 if(process.platform!=="win32")throw Error("WINDOWS_ONLY");
 const exe=path.resolve(".qa-core-session","MinerBridgeCSharpQa.exe");
 const state={revoked:false};
 const core=createCore({verify:()=>({trusted:true,app:APP,deviceActive:true,
  revoked:state.revoked,runOwned:true,buildApproved:true,
  exp:Date.now()+60000,run:"qa-run",device:"qa-device"})});
 const server=await start({
  ticketCheck:t=>{const v=core.redeem(t);return v?{
   appId:APP,runId:v.runId,deviceActive:true,revoked:false,expiresAtMs:v.expiresAtMs}:null},
  sessionCheck:v=>core.isActive({runId:v.runId,expiresAtMs:v.expiresAtMs})
 });
 try{
  const name=server.address.split("\\").at(-1);
  const ticket=core.issue({});
  const first=await invoke(exe,name,ticket);
  assert.equal(first.code,0,first.err);
  assert.match(first.out,/C_SHARP_OS_PIPE_MOCK_SESSION_OK_NO_CORE/);
  const replay=await invoke(exe,name,ticket);
  assert.equal(replay.code,2,replay.err);
  state.revoked=true;
  const denied=await invoke(exe,name,"a".repeat(64));
  assert.equal(denied.code,2,denied.err);
  console.log("PASS MOCK_CORE_TO_NODE_PIPE_TO_CSHARP_ONCE_REPLAY_DENIED");
 }finally{await server.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
