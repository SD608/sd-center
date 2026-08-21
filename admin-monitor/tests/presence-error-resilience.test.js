"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PresenceReporter, createSupabaseRpc, normalizeMetadata } = require("../integration/presence-reporter");
function base(extra={}){return {appId:"sd.center",appName:"SD종합센터",rpc:async()=>({ok:true}),...extra};}

test("initial heartbeat failure leaves reporter stopped and does not install timer", async()=>{
  let timers=0; const r=new PresenceReporter(base({rpc:async()=>{throw new Error("offline");},setIntervalFn:()=>{timers++; return 1;}}));
  await assert.rejects(()=>r.start(),/offline/); assert.equal(r.running,false); assert.equal(timers,0);
});

test("periodic heartbeat error is contained and later ticks can retry", async()=>{
  let timerFn; let calls=0; let errors=0;
  const r=new PresenceReporter(base({rpc:async()=>{calls++; if(calls===2) throw new Error("offline"); return {ok:true};},onError:()=>errors++,setIntervalFn:(fn)=>{timerFn=fn; return {unref(){}};},clearIntervalFn:()=>{}}));
  await r.start(); timerFn(); await new Promise(r=>setImmediate(r)); assert.equal(errors,1); timerFn(); await new Promise(r=>setImmediate(r)); assert.equal(calls,3); await r.stop();
});

test("failed graceful end is non-fatal so TTL can expire crashed/offline apps", async()=>{
  let errors=0; const r=new PresenceReporter(base({rpc:async(n)=>{if(n==="sd_presence_v1_end") throw new Error("offline"); return {ok:true};},onError:()=>errors++}));
  const result=await r.stop(); assert.equal(result,null); assert.equal(r.ended,false); assert.equal(errors,1);
});

test("metadata rejects arrays, cycles, and payloads over server limit", ()=>{
  assert.throws(()=>normalizeMetadata([]),/INVALID_METADATA/); const cycle={}; cycle.self=cycle; assert.throws(()=>normalizeMetadata(cycle),/INVALID_METADATA/); assert.throws(()=>normalizeMetadata({x:"a".repeat(5000)}),/INVALID_METADATA/);
});

test("constructor rejects invalid app identity before any network request", ()=>{
  assert.throws(()=>new PresenceReporter(base({appId:"bad id"})),/INVALID_APP_ID/); assert.throws(()=>new PresenceReporter(base({appName:""})),/INVALID_APP_NAME/); assert.throws(()=>new PresenceReporter(base({appVersion:"v".repeat(33)})),/INVALID_APP_VERSION/);
});

test("Supabase adapter returns data and raises connector errors", async()=>{
  const rpc=createSupabaseRpc({rpc:async()=>({data:{ok:true},error:null})}); assert.deepEqual(await rpc("x",{}),{ok:true});
  const bad=createSupabaseRpc({rpc:async()=>({data:null,error:new Error("denied")})}); await assert.rejects(()=>bad("x",{}),/denied/);
});
