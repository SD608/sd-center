"use strict";
/* DEV-ONLY read-only admission policy. Not a GameSession issuer. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const deny=(reason,status=403)=>Object.freeze({ok:false,status,reason,mode:"DEV_READ_ONLY"});
async function inspect(request,adapter,now=Date.now){
 if(!request||request.method!=="POST")return deny("METHOD_NOT_ALLOWED",405);
 if(!adapter||["verifyUser","checkSession","checkDevice","checkRun","checkBuild"].some(k=>typeof adapter[k]!=="function"))return deny("SERVER_NOT_READY",503);
 const auth=String(request.authorization||"").match(/^Bearer ([A-Za-z0-9._-]{10,8192})$/);
 if(!auth)return deny("AUTH_REQUIRED",401);
 const fields=request.body;
 if(!fields||typeof fields!=="object"||Array.isArray(fields)||!UUID.test(fields.deviceId||"")||!UUID.test(fields.runId||"")||!SHA.test(fields.buildDigest||"")||Object.keys(fields).length>3)return deny("INVALID_SELECTOR",400);
 try{
  const user=await adapter.verifyUser(auth[1]);
  if(!user?.verified||!UUID.test(user.userId||"")||!UUID.test(user.sessionId||"")||!Number.isFinite(user.expMs)||user.expMs<=now()||user.isAnonymous===true)return deny("AUTH_INVALID",401);
  if(await adapter.checkSession(user.userId,user.sessionId)!==true)return deny("SESSION_INACTIVE");
  if(await adapter.checkDevice(user.userId,fields.deviceId)!==true)return deny("DEVICE_INACTIVE");
  // The trusted Run server is not connected. A dev QA fixture is not proof of
  // official game-world provenance and must never produce an issuance token.
  const run=await adapter.checkRun(user.userId,fields.runId);
  if(run!==true)return deny(run===null?"RUN_AUTHORITY_NOT_CONNECTED":"RUN_NOT_AUTHORIZED",503);
  if(await adapter.checkBuild(fields.buildDigest)!==true)return deny("BUILD_NOT_APPROVED");
  return Object.freeze({ok:true,status:200,mode:"DEV_READ_ONLY",gameSessionIssued:false});
 }catch{return deny("AUTHORITY_UNAVAILABLE",503)}
}
module.exports={inspect};
