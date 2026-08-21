"use strict";

const fs=require("fs"); const path=require("path"); const {ApiError}=require("./sd-admin-api");
function normalizeAdjustment(payload={}){const requestId=String(payload.requestId||"").trim(); const userId=String(payload.userId||"").trim(); const direction=String(payload.direction||"").trim().toLowerCase(); const amount=Math.trunc(Number(payload.amount)); const note=String(payload.note||"").trim(); if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new ApiError("REQUEST_ID_REQUIRED"); if(!userId) throw new ApiError("WALLET_TARGET_NOT_FOUND"); if(!['credit','debit'].includes(direction)) throw new ApiError("INVALID_DIRECTION"); if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000) throw new ApiError("INVALID_AMOUNT"); if(note.length>80) throw new ApiError("NOTE_TOO_LONG"); return {requestId,userId,direction,amount,note};}
function sameAdjustment(a,b){return a.requestId===b.requestId&&a.userId===b.userId&&a.direction===b.direction&&a.amount===b.amount&&a.note===b.note;}
class PendingAdjustmentStore{
  constructor(filePath){this.filePath=path.resolve(String(filePath||"")); if(!this.filePath) throw new Error("PENDING_STORE_PATH_REQUIRED");}
  load(){try{return normalizeAdjustment(JSON.parse(fs.readFileSync(this.filePath,"utf8")));}catch(error){if(error?.code==="ENOENT") return null; if(error instanceof ApiError) throw error; throw new ApiError("PENDING_ADJUSTMENT_CORRUPT");}}
  save(payload){const next=normalizeAdjustment(payload); const current=this.load(); if(current&&!sameAdjustment(current,next)) throw new ApiError(current.requestId===next.requestId?"PENDING_ADJUSTMENT_CONFLICT":"PENDING_ADJUSTMENT_EXISTS"); fs.mkdirSync(path.dirname(this.filePath),{recursive:true}); const tempPath=`${this.filePath}.${process.pid}.tmp`; fs.writeFileSync(tempPath,`${JSON.stringify(next)}\n`,{encoding:"utf8",mode:0o600}); fs.renameSync(tempPath,this.filePath); return next;}
  clear(requestId){const current=this.load(); if(!current) return false; if(requestId&&current.requestId!==requestId) throw new ApiError("PENDING_ADJUSTMENT_CONFLICT"); try{fs.unlinkSync(this.filePath);}catch(error){if(error?.code!=="ENOENT") throw error;} return true;}
}
module.exports={PendingAdjustmentStore,normalizeAdjustment,sameAdjustment};
