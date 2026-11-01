"use strict";
// NON-PRODUCTION authority mock. No real Core, DB, token API, or wallet changes.
const crypto=require("node:crypto");
function createCore({verify,now=Date.now}={}){
  if(typeof verify!=="function")throw Error("VERIFIER_REQUIRED");
  const grants=new Map();
  const hash=t=>crypto.createHash("sha256").update(t).digest("hex");
  function valid(x){return x?.trusted===true&&x.app==="miner-unity"&&
    x.deviceActive===true&&x.revoked===false&&x.runOwned===true&&
    x.buildApproved===true&&Number.isSafeInteger(x.exp)&&x.exp>now()&&
    typeof x.run==="string"&&typeof x.device==="string"}
  return Object.freeze({
    issue(request){
      let v;try{v=verify(request)}catch{return null}
      if(!valid(v))return null;
      const ticket=crypto.randomBytes(32).toString("hex");
      grants.set(hash(ticket),v);
      return ticket;
    },
    redeem(ticket){
      if(typeof ticket!=="string"||!/^[a-f0-9]{64}$/.test(ticket))return null;
      const h=hash(ticket),old=grants.get(h);grants.delete(h);
      if(!valid(old))return null;
      let live;try{live=verify({check:true,run:old.run,device:old.device})}catch{return null}
      if(!valid(live)||live.run!==old.run||live.device!==old.device)return null;
      return Object.freeze({app:"miner-unity",runId:old.run,
         deviceActive:true,revoked:false,expiresAtMs:Math.min(old.exp,live.exp)});
    },
    isActive(claim){
      if(!claim||claim.expiresAtMs<=now())return false;
      try{const v=verify({check:true,run:claim.runId});return valid(v)&&v.run===claim.runId}catch{return false}
    }
  });
}
function createCenter({deliver}={}){
 if(typeof deliver!=="function")throw Error("CONTROLLED_DELIVERY_REQUIRED");
 const seen=new Set();
 return Object.freeze({async transfer(ticket){
   if(typeof ticket!=="string"||!/^[a-f0-9]{64}$/.test(ticket)||seen.has(ticket))
    return false;
   seen.add(ticket);
   try{await deliver(ticket);return true}catch{return false}
 }});
}
module.exports={createCore,createCenter};
