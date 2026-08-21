"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PresenceReporter } = require("../integration/presence-reporter");

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
function base(extra={}){return {appId:"sd.center",appName:"SD종합센터",rpc:async()=>({ok:true}),...extra};}

test("normalizes app id and sends immutable identity payload", async()=>{
  const calls=[]; const r=new PresenceReporter(base({appId:" SD.Center ",instanceId:"11111111-1111-4111-8111-111111111111",rpc:async(n,a)=>{calls.push([n,a]);return {ok:true};}}));
  await r.heartbeat();
  assert.equal(calls.length,1); assert.equal(calls[0][0],"sd_presence_v1_heartbeat"); assert.equal(calls[0][1].p_app_id,"sd.center");
});

test("coalesces concurrent heartbeats so timer cannot overlap requests", async()=>{
  const gate=deferred(); let count=0; const r=new PresenceReporter(base({rpc:async()=>{count++; return gate.promise;}}));
  const a=r.heartbeat(); const b=r.heartbeat();
  await Promise.resolve(); assert.equal(count,1);
  gate.resolve({ok:true}); await Promise.all([a,b]);
});

test("stop waits for an in-flight heartbeat before sending end", async()=>{
  const gate=deferred(); const calls=[];
  const r=new PresenceReporter(base({rpc:async(n)=>{calls.push(n); if(n==="sd_presence_v1_heartbeat") return gate.promise; return {ok:true};}}));
  const hb=r.heartbeat(); await Promise.resolve(); const stopping=r.stop(); await Promise.resolve();
  assert.deepEqual(calls,["sd_presence_v1_heartbeat"]);
  gate.resolve({ok:true}); await hb; await stopping;
  assert.deepEqual(calls,["sd_presence_v1_heartbeat","sd_presence_v1_end"]); assert.equal(r.ended,true);
});

test("stop is idempotent and never submits duplicate end events", async()=>{
  let ends=0; const r=new PresenceReporter(base({rpc:async(n)=>{if(n==="sd_presence_v1_end") ends++; return {ok:true};}}));
  await r.stop(); await r.stop(); assert.equal(ends,1);
});

test("an ended instance cannot be restarted or mutate metadata", async()=>{
  const r=new PresenceReporter(base()); await r.stop();
  await assert.rejects(()=>r.start(),/REPORTER_ENDED/); assert.throws(()=>r.updateMetadata({x:1}),/REPORTER_ENDED/);
});
