"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {assessUnityLaunch,confinedWindowsFile}=require("./launch-policy.cjs");
const digest="a".repeat(64);
const input={appId:"miner-unity",entryType:"native-windows-exe",version:"0.0.0-draft",installedRoot:"C:\\ProgramData\\SDCenter\\installed-apps\\miner-unity",exePath:"C:\\ProgramData\\SDCenter\\installed-apps\\miner-unity\\SDMiner.exe"};
const makeTrusted=()=>({
 nowMs:1000,
 verifyCatalog:()=>({signedOfficial:true,appId:"miner-unity",entryType:"native-windows-exe",digest}),
 verifyFileIdentity:()=>({diskSha256:digest,realpathConfined:true,isRegularFile:true,noSymlink:true}),
 verifySession:()=>({trustedServerAttestation:true,activeDevice:true,revoked:false,scopedFor:"miner-unity",userId:"user1",deviceId:"dev1",runId:"run1",expiresAtMs:2000})
});
const check=(x,t)=>assessUnityLaunch({...input,...x},t);
test("without trusted verification callbacks always fail closed",()=>assert.equal(check({},{}).reason,"TRUSTED_VERIFIERS_MISSING"));
test("approved identity and trusted assertions produce policy eligibility ONLY",()=>{
 const value=check({},makeTrusted());
 assert.equal(value.state,"POLICY_ELIGIBLE_ONLY");
 assert.equal(value.runId,"run1");
 assert.equal(value.walletBalance,undefined);
 assert.equal(value.token,undefined);
});
test("cannot launch arbitrary Electron/legacy app",()=>assert.equal(check({appId:"miner"},makeTrusted()).reason,"APP_NOT_APPROVED"));
test("legacy JavaScript entry fails closed",()=>assert.equal(check({entryType:"electron-js"},makeTrusted()).reason,"NATIVE_ENTRY_REQUIRED"));
test("relative executable fails",()=>assert.equal(check({exePath:"SDMiner.exe"},makeTrusted()).reason,"EXE_OUTSIDE_MANAGED_ROOT"));
test("outside managed root fails",()=>assert.equal(check({exePath:"C:\\Windows\\System32\\cmd.exe"},makeTrusted()).reason,"EXE_OUTSIDE_MANAGED_ROOT"));
test("path traversal fails",()=>assert.equal(confinedWindowsFile({...input,exePath:"C:\\ProgramData\\SDCenter\\installed-apps\\miner-unity\\..\\other.exe"}),false));
test("non-exe fails",()=>assert.equal(check({exePath:"C:\\ProgramData\\SDCenter\\installed-apps\\miner-unity\\fake.dll"},makeTrusted()).reason,"EXE_EXTENSION_REQUIRED"));
test("no signed official manifest",()=>{const t=makeTrusted();t.verifyCatalog=()=>({signedOfficial:false,appId:"miner-unity",entryType:"native-windows-exe",digest});assert.equal(check({},t).reason,"OFFICIAL_PACKAGE_NOT_VERIFIED")});
test("unsigned arbitrary digest fails",()=>{const t=makeTrusted();t.verifyFileIdentity=()=>({diskSha256:"b".repeat(64),realpathConfined:true,isRegularFile:true,noSymlink:true});assert.equal(check({},t).reason,"PACKAGE_DIGEST_MISMATCH")});
test("symlink / realpath uncertainty fails",()=>{const t=makeTrusted();t.verifyFileIdentity=()=>({diskSha256:digest,realpathConfined:false,isRegularFile:true,noSymlink:true});assert.equal(check({},t).reason,"FILE_IDENTITY_NOT_VERIFIED")});
test("device revocation fails",()=>{const t=makeTrusted();t.verifySession=()=>({...makeTrusted().verifySession(),revoked:true});assert.equal(check({},t).reason,"SESSION_NOT_VERIFIED")});
test("expired session fails",()=>{const t=makeTrusted();t.nowMs=2000;assert.equal(check({},t).reason,"SESSION_NOT_VERIFIED")});
test("SD Link UI status alone cannot grant launch",()=>{const t=makeTrusted();t.verifySession=()=>({onlineHealthy:true,linked:true});assert.equal(check({},t).reason,"SESSION_NOT_VERIFIED")});
test("wrong game session scope fails",()=>{const t=makeTrusted();t.verifySession=()=>({...makeTrusted().verifySession(),scopedFor:"sd_link"});assert.equal(check({},t).reason,"SESSION_NOT_VERIFIED")});
test("no authenticated verifier exceptions leak",()=>{const t=makeTrusted();t.verifySession=()=>{throw Error("secret-token-should-not-appear")};const r=check({},t);assert.equal(r.reason,"AUTHORITY_VALIDATION_FAILED");assert.equal(JSON.stringify(r).includes("secret-token"),false)});
test("input-supplied proof is ignored",()=>{const t=makeTrusted();t.verifySession=()=>({});const r=check({serverTrusted:true,deviceId:"d",isAdmin:true,mintedCoins:100000},t);assert.equal(r.ok,false)});
test("SHA256 supplied by caller is never accepted without trusted file attestation",()=>{const t=makeTrusted();t.verifyFileIdentity=()=>null;assert.equal(check({digest},t).reason,"PACKAGE_DIGEST_MISMATCH")});
