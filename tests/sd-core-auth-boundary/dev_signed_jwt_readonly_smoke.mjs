#!/usr/bin/env node
// DEV-only signed JWT HTTP authentication smoke check.
// Requires a disposable Auth user created outside this script.
// No user creation, mutations, payouts, token or password printing.
const { env } = process;
const required = ['SD_CORE_QA_URL','SD_CORE_QA_PUBLISHABLE_KEY','SD_CORE_QA_EMAIL','SD_CORE_QA_PASSWORD'];
for (const k of required) if (!env[k]) { console.error('MISSING_ENV: '+k); process.exit(2); }
const url = new URL(env.SD_CORE_QA_URL);
if (url.protocol !== 'https:' || url.hostname !== 'rwjueffaziiawdebbwpf.supabase.co' || url.pathname !== '/') {
  console.error('BLOCKED: target must be the exact SD-Core-Dev Supabase HTTPS project');
  process.exit(2);
}
if (env.SD_CORE_QA_DISPOSABLE !== 'YES') {
  console.error('BLOCKED: set SD_CORE_QA_DISPOSABLE=YES only for a disposable DEV-only test user');
  process.exit(2);
}
const apiKey=env.SD_CORE_QA_PUBLISHABLE_KEY;
const account=env.SD_CORE_QA_EMAIL;
const password=env.SD_CORE_QA_PASSWORD;
const common = {apikey:apiKey};
const req = async (path,opts={})=>{
  const response=await fetch(new URL(path,url),{...opts,headers:{...common,...opts.headers},signal:AbortSignal.timeout(15000)});
  return response;
};
try {
  // Invalid access token must be rejected before any RLS policy query.
  const invalid = await req('/auth/v1/user',{headers:{Authorization:'Bearer invalid.jwt.token'}});
  if (![401,403].includes(invalid.status)) throw Error('INVALID_JWT_NOT_REJECTED HTTP '+invalid.status);
  console.log('PASS invalid JWT rejected by Auth');

  // Authenticate via real Supabase GoTrue, never by manually setting JWT claims.
  const login=await req('/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:account,password})
  });
  if (!login.ok) throw Error('DEV_LOGIN_FAILED HTTP '+login.status);
  const session=await login.json();
  if (!session.access_token||!session.refresh_token||!session.user?.id) throw Error('DEV_SESSION_INCOMPLETE');
  const auth={Authorization:'Bearer '+session.access_token};

  // Check that Auth recognizes the signed access token and its user identity.
  const userResp=await req('/auth/v1/user',{headers:auth});
  if (!userResp.ok) throw Error('SIGNED_JWT_GETUSER_FAILED HTTP '+userResp.status);
  const user=await userResp.json();
  if (user.id!==session.user.id) throw Error('SIGNED_JWT_USER_MISMATCH');
  console.log('PASS signed JWT /auth/v1/user');

  // Read-only authenticated Data API query; does not create wallets/devices.
  const devices=await req('/rest/v1/devices?select=id&limit=1',{headers:auth});
  if (!devices.ok) throw Error('SIGNED_JWT_DEVICES_RLS_READ_FAILED HTTP '+devices.status);
  const body=await devices.json();
  if (!Array.isArray(body)) throw Error('DEVICES_READ_UNEXPECTED_RESPONSE');
  console.log('PASS signed JWT device read through real DEV Data API');

  // Never print JWT, refresh token, password, email, user id or untrusted rows.
  console.log('DEV_SIGNED_JWT_READONLY_SMOKE_PASS');
  console.log('NOT_TESTED: revoked device, terminated session, signed JWT after signout, transactions, rollback');
} catch(err) {
  console.error('DEV_SIGNED_JWT_READONLY_SMOKE_FAILED: '+String(err?.message||'unknown failure'));
  process.exitCode=1;
}
