"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {inspect}=require("./policy.cjs");
const user="00000000-0000-4000-8000-000000000001";
const session="00000000-0000-4000-8000-000000000002";
const device="00000000-0000-4000-8000-000000000003";
const run="00000000-0000-4000-8000-000000000004";
const body={deviceId:device,runId:run,buildDigest:"a".repeat(64)};
const req=(b=body)=>({method:"POST",authorization:"Bearer "+"x".repeat(32),body:b});
const base=()=>({
 verifyUser:async()=>({verified:true,userId:user,sessionId:session,expMs:20000,isAnonymous:false}),
 checkSession:async()=>true,
 checkDevice:async()=>true,
 checkRun:async()=>null, // official Run server absent = deny
 checkBuild:async()=>true
});
const runCase=async(r=req(),a=base())=>inspect(r,a,()=>10000);
test("GET denied",async()=>assert.equal((await runCase({...req(),method:"GET"})).status,405));
test("no adapters denied",async()=>assert.equal((await runCase(req(),{})).status,503));
test("no authorization denied",async()=>assert.equal((await runCase({...req(),authorization:""})).status,401));
test("bogus bearer denied",async()=>assert.equal((await runCase({...req(),authorization:"Bearer abc"})).status,401));
test("missing selectors denied",async()=>assert.equal((await runCase(req({}))).status,400));
test("invalid run UUID denied",async()=>assert.equal((await runCase(req({...body,runId:"hi"}))).status,400));
test("untrusted extra reward amount denied",async()=>assert.equal((await runCase(req({...body,amount:9999}))).status,400));
test("invalid build digest denied",async()=>assert.equal((await runCase(req({...body,buildDigest:"z".repeat(64)}))).status,400));
test("auth server reject denied",async()=>{const a=base();a.verifyUser=async()=>null;assert.equal((await runCase(req(),a)).reason,"AUTH_INVALID")});
test("anonymous user rejected",async()=>{const a=base();a.verifyUser=async()=>({...await base().verifyUser(),isAnonymous:true});assert.equal((await runCase(req(),a)).status,401)});
test("expired JWT rejected",async()=>{const a=base();a.verifyUser=async()=>({...await base().verifyUser(),expMs:9000});assert.equal((await runCase(req(),a)).status,401)});
test("no auth session denied",async()=>{const a=base();a.checkSession=async()=>false;assert.equal((await runCase(req(),a)).reason,"SESSION_INACTIVE")});
test("device revoked denied",async()=>{const a=base();a.checkDevice=async()=>false;assert.equal((await runCase(req(),a)).reason,"DEVICE_INACTIVE")});
test("world Run authority unavailable denies",async()=>assert.equal((await runCase()).reason,"RUN_AUTHORITY_NOT_CONNECTED"));
test("Run mismatched denied",async()=>{const a=base();a.checkRun=async()=>false;assert.equal((await runCase(req(),a)).reason,"RUN_NOT_AUTHORIZED")});
test("unapproved game build denied",async()=>{const a=base();a.checkRun=async()=>true;a.checkBuild=async()=>false;assert.equal((await runCase(req(),a)).reason,"BUILD_NOT_APPROVED")});
test("valid mocked predicates only yield read-only",async()=>{const a=base();a.checkRun=async()=>true;const x=await runCase(req(),a);assert.equal(x.ok,true);assert.equal(x.gameSessionIssued,false);assert.equal(x.token,undefined)});
test("server exception fails closed",async()=>{const a=base();a.checkDevice=async()=>{throw Error("do not leak credential")};const x=await runCase(req(),a);assert.equal(x.status,503);assert.equal(JSON.stringify(x).includes("credential"),false)});
test("caller injected user ID ignored",async()=>{const a=base();a.checkRun=async()=>true;let original;const f=a.checkSession;a.checkSession=async(u,s)=>{original=u;return f(u,s)};const x=await runCase(req({...body,claimedUser:user}),a);assert.equal(x.status,400);assert.equal(original,undefined)});
test("client cannot request a wallet mutation",async()=>{const x=await runCase(req({...body,coins:800}));assert.equal(x.ok,false)});
