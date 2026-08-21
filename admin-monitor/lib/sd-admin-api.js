"use strict";

const { friendlyError } = require("./errors");
const DEFAULT_TIMEOUT_MS = 12000;

function normalizeBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  if (!/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) throw new Error("INVALID_SUPABASE_HOST");
  url.pathname = ""; url.search = ""; url.hash = ""; return url.toString().replace(/\/$/, "");
}
function normalizeKey(value) { const key = String(value || "").trim(); if (!key || key.length < 20) throw new Error("INVALID_PUBLISHABLE_KEY"); return key; }
class ApiError extends Error { constructor(message, options = {}) { super(message); this.name="ApiError"; this.status=options.status||0; this.code=options.code||""; this.body=options.body; this.uncertain=Boolean(options.uncertain); } }

class SdAdminApi {
  constructor({ baseUrl, publishableKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (typeof fetchImpl !== "function") throw new Error("FETCH_REQUIRED");
    this.baseUrl=normalizeBaseUrl(baseUrl); this.publishableKey=normalizeKey(publishableKey); this.fetch=fetchImpl; this.timeoutMs=Math.max(1000,Math.min(Number(timeoutMs)||DEFAULT_TIMEOUT_MS,30000)); this.session=null; this.refreshPromise=null;
  }
  get isAuthenticated(){ return Boolean(this.session?.access_token); }
  clearSession(){ this.session=null; }
  _headers(authenticated=false){ const headers={apikey:this.publishableKey,"content-type":"application/json",accept:"application/json"}; if(authenticated&&this.session?.access_token) headers.authorization=`Bearer ${this.session.access_token}`; return headers; }
  async _fetchJson(path, options={}, {authenticated=false,retryAuth=true,uncertainOnNetwork=false}={}) {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response=await this.fetch(`${this.baseUrl}${path}`,{...options,headers:{...this._headers(authenticated),...(options.headers||{})},signal:controller.signal});
      let body=null; const raw=await response.text(); if(raw){try{body=JSON.parse(raw);}catch{body={message:raw.slice(0,400)};}}
      if(response.status===401&&authenticated&&retryAuth&&this.session?.refresh_token){await this._refresh(); return this._fetchJson(path,options,{authenticated,retryAuth:false,uncertainOnNetwork});}
      if(!response.ok){const message=body?.message||body?.error_description||body?.error||`HTTP_${response.status}`; throw new ApiError(message,{status:response.status,code:body?.code||"",body,uncertain:uncertainOnNetwork&&response.status>=500});}
      return body;
    } catch(error) {
      if(error instanceof ApiError) throw error;
      throw new ApiError(error?.message||"NETWORK_ERROR",{status:0,code:error?.name||"NETWORK_ERROR",body:null,uncertain:uncertainOnNetwork});
    } finally { clearTimeout(timer); }
  }
  async signIn(email,password){const normalizedEmail=String(email||"").trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new ApiError("INVALID_EMAIL"); if(!password||String(password).length<1) throw new ApiError("PASSWORD_REQUIRED"); const body=await this._fetchJson("/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email:normalizedEmail,password:String(password)})}); this.session={access_token:body?.access_token||"",refresh_token:body?.refresh_token||"",expires_in:body?.expires_in||0,user:body?.user||null}; if(!this.session.access_token){this.clearSession();throw new ApiError("AUTH_TOKEN_MISSING");} try{return await this.me();}catch(error){this.clearSession();throw error;}}
  async _refresh(){if(!this.session?.refresh_token) throw new ApiError("AUTH_REQUIRED",{status:401}); if(this.refreshPromise) return this.refreshPromise; this.refreshPromise=(async()=>{try{const body=await this._fetchJson("/auth/v1/token?grant_type=refresh_token",{method:"POST",body:JSON.stringify({refresh_token:this.session.refresh_token})},{authenticated:false,retryAuth:false}); if(!body?.access_token) throw new ApiError("AUTH_REFRESH_FAILED",{status:401}); this.session={...this.session,access_token:body.access_token,refresh_token:body.refresh_token||this.session.refresh_token,expires_in:body.expires_in||0,user:body.user||this.session.user};}catch(error){this.clearSession();throw error;}finally{this.refreshPromise=null;}})(); return this.refreshPromise;}
  async signOut(){try{if(this.session?.access_token) await this._fetchJson("/auth/v1/logout",{method:"POST",body:"{}"},{authenticated:true,retryAuth:false});}catch{}finally{this.clearSession();}}
  async rpc(name,args={}, {uncertainOnNetwork=false}={}){if(!/^[a-z0-9_]+$/i.test(String(name||""))) throw new ApiError("INVALID_RPC_NAME"); if(!this.isAuthenticated) throw new ApiError("AUTH_REQUIRED",{status:401}); return this._fetchJson(`/rest/v1/rpc/${name}`,{method:"POST",body:JSON.stringify(args||{})},{authenticated:true,uncertainOnNetwork});}
  me(){return this.rpc("sd_admin_v1_me");} listUsers(){return this.rpc("sd_admin_v1_list_users");} getUser(userId){return this.rpc("sd_admin_v1_get_user",{p_user_id:userId});}
  listTransactions(userId,beforeSeq=null,limit=50){return this.rpc("sd_admin_v1_list_transactions",{p_user_id:userId,p_before_seq:beforeSeq,p_limit:Math.max(1,Math.min(Number(limit)||50,100))});}
  adjustWallet({userId,direction,amount,note=null,requestId}){const normalizedDirection=String(direction||"").toLowerCase(); const normalizedAmount=Math.trunc(Number(amount)); if(!userId) throw new ApiError("WALLET_TARGET_NOT_FOUND"); if(!requestId) throw new ApiError("REQUEST_ID_REQUIRED"); if(!['credit','debit'].includes(normalizedDirection)) throw new ApiError("INVALID_DIRECTION"); if(!Number.isSafeInteger(normalizedAmount)||normalizedAmount<1||normalizedAmount>1000000000) throw new ApiError("INVALID_AMOUNT"); const cleanNote=String(note||"").trim(); if(cleanNote.length>80) throw new ApiError("NOTE_TOO_LONG"); return this.rpc("sd_admin_v1_adjust_wallet",{p_target_user_id:userId,p_direction:normalizedDirection,p_amount:normalizedAmount,p_note:cleanNote||null,p_request_id:requestId},{uncertainOnNetwork:true});}
  explainError(error){return friendlyError(error);}
}
module.exports={SdAdminApi,ApiError,normalizeBaseUrl,normalizeKey};
