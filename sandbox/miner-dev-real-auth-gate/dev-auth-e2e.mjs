// Disposable SD-Core-Dev Auth E2E. Never accepts production endpoints.
// No secret, password, JWT or refresh token is logged or written to disk.
import { randomBytes, randomUUID } from "node:crypto";

const REF = "rwjueffaziiawdebbwpf";
const ORIGIN = "https://" + REF + ".supabase.co";
const GATE_PATH = "/functions/v1/miner-dev-auth-gate-20261101";
const preflight = process.argv.includes("--preflight");
const secret = process.env.SD_CORE_DEV_SERVICE_ROLE_KEY || "";
const ack = process.env.SD_CORE_DEV_QA_ACK || "";
const endpoint = process.env.SD_CORE_DEV_URL || ORIGIN;
function requireDev() {
  if (endpoint !== ORIGIN) throw Error("BLOCKED_WRONG_DEV_PROJECT");
  if (process.env.SD_CORE_DEV_PROJECT_REF !== REF && !preflight) throw Error("BLOCKED_PROJECT_REF");
  if (preflight) return;
  if (ack !== "I_CONFIRM_DEV_ONLY") throw Error("BLOCKED_EXPLICIT_ACK");
  if (!secret || !(secret.startsWith("eyJ") || secret.startsWith("sb_secret_")))
    throw Error("BLOCKED_SERVICE_ROLE_CREDENTIAL");
}
requireDev();
if (preflight) {
  console.log("PRECHECK_PASS DEV_URL_PINNED; LIVE_NOT_RUN");
  process.exit(0);
}

const adminHeaders = () => ({
  apikey: secret,
  ...(secret.startsWith("eyJ") ? { authorization: "Bearer " + secret } : {}),
  "content-type": "application/json",
});
async function api(path, {method="GET", body, token, extraHeaders={}}={}) {
  const headers = {...adminHeaders(), ...extraHeaders};
  if (token) headers.authorization = "Bearer " + token;
  const res = await fetch(ORIGIN+path,{
    method, headers, ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal: AbortSignal.timeout(15000),
  });
  // Do not include untrusted response body in logs; Auth errors may contain secrets.
  if (!res.ok) throw Error("API_HTTP_"+res.status+" "+method+" "+path.split("?")[0]);
  return res.status === 204 ? null : await res.json().catch(()=>null);
}
async function gate(jwt,deviceId,runId) {
  const res = await fetch(ORIGIN+GATE_PATH,{
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+jwt},
    body:JSON.stringify({deviceId,runId,buildDigest:"a".repeat(64)}),
    signal:AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(()=>({}));
  return { status:res.status, reason:typeof body.reason==="string"?body.reason:"NO_REASON", issued:body.gameSessionIssued===true };
}
function assertGate(stage,actual,allowed) {
  if(actual.issued || !allowed.some(([status,reason])=>actual.status===status&&actual.reason===reason))
    throw Error("GATE_MISMATCH_"+stage+"_"+actual.status+"_"+actual.reason);
  console.log("PASS",stage,actual.status,actual.reason);
}

const email = "sd-miner-qa-"+randomUUID()+"@example.com";
const password = randomBytes(32).toString("base64url")+"Aa1!";
const deviceId = randomUUID();
const runId = randomUUID(); // Not an official Run; issuer must stay disconnected.
let userId = null;
let accessToken = null;
let failed = false;
try {
  const created = await api("/auth/v1/admin/users",{
    method:"POST",
    body:{email,password,email_confirm:true,app_metadata:{sd_dev_qa:true}},
  });
  userId = created?.id || created?.user?.id;
  if(!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw Error("AUTH_CREATE_NO_USER_ID");
  console.log("PASS DEV_ACCOUNT_CREATED", userId);

  const login = await api("/auth/v1/token?grant_type=password",{
    method:"POST",body:{email,password},
  });
  accessToken = login?.access_token;
  if(!accessToken || !login?.user?.id || login.user.id!==userId) throw Error("AUTH_LOGIN_NOT_VALID");
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1]||"","base64url").toString("utf8"));
  if(claims.sub!==userId || !claims.session_id) throw Error("AUTH_JWT_SESSION_ID_MISSING");
  console.log("PASS DEV_LOGIN_JWT_SESSION_CLAIM");

  await api("/rest/v1/profiles?on_conflict=id",{
    method:"POST",
    extraHeaders:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:[{id:userId,nickname:"SD Miner DEV QA",role:"user",status:"active"}]
  });
  await api("/rest/v1/devices",{
    method:"POST",
    extraHeaders:{Prefer:"return=minimal"},
    body:[{id:deviceId,user_id:userId,device_key:"miner-dev-qa-"+randomUUID(),device_name:"Miner QA disposable",platform:"qa-node",link_status:"active"}]
  });
  console.log("PASS DEV_PROFILE_DEVICE_PROVISIONED");

  assertGate("ACTIVE_VALID_JWT_FAILS_CLOSED",await gate(accessToken,deviceId,runId),[[503,"RUN_SERVER_NOT_CONNECTED"]]);

  await api("/rest/v1/devices?id=eq."+deviceId+"&user_id=eq."+userId,{
    method:"PATCH",body:{revoked_at:new Date().toISOString()},extraHeaders:{Prefer:"return=minimal"},
  });
  assertGate("REVOKED_DEVICE_DENIED",await gate(accessToken,deviceId,runId),[[403,"IDENTITY_OR_DEVICE_DENIED"]]);

  await api("/rest/v1/devices?id=eq."+deviceId+"&user_id=eq."+userId,{
    method:"PATCH",body:{revoked_at:null},extraHeaders:{Prefer:"return=minimal"},
  });
  assertGate("RESTORED_DEVICE_STILL_NO_ISSUER",await gate(accessToken,deviceId,runId),[[503,"RUN_SERVER_NOT_CONNECTED"]]);

  await api("/auth/v1/logout?scope=local",{method:"POST",token:accessToken});
  assertGate("REVOKED_SESSION_DENIED",await gate(accessToken,deviceId,runId),[[401,"AUTH_INVALID"],[403,"IDENTITY_OR_DEVICE_DENIED"]]);
  console.log("LIVE_DEV_AUTH_E2E_PASS; NO_GAMESESSION_OR_ASSETS_ISSUED");
} catch(e) {
  failed = true;
  console.error("LIVE_DEV_AUTH_E2E_BLOCKED",e?.message||"UNEXPECTED_ERROR");
} finally {
  if(userId) {
    for (const [label,path,method] of [
      ["DEVICE","/rest/v1/devices?id=eq."+deviceId+"&user_id=eq."+userId,"DELETE"],
      ["PROFILE","/rest/v1/profiles?id=eq."+userId,"DELETE"],
      ["AUTH_USER","/auth/v1/admin/users/"+userId,"DELETE"],
    ]) {
      try { await api(path,{method}); console.log("CLEANUP_OK",label); }
      catch(e) {failed=true;console.error("CLEANUP_FAILED",label,e?.message||"ERROR");}
    }
  }
  // Credential bytes stay only in this process and are never persisted.
}
if(failed) process.exitCode=1;
