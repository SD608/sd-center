// DEV-ONLY Supabase authentication probe. NEVER mints sessions or assets.
import { createClient } from "npm:@supabase/supabase-js@2.83.0";
import postgres from "npm:postgres@3.4.7";
const out=(status:number,reason:string)=>new Response(JSON.stringify({ok:false,reason,mode:"DEV_NO_ISSUER"}),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return out(405,"POST_ONLY");
 const jwt=(req.headers.get("authorization")||"").match(/^Bearer ([\w.\-]{10,8192})$/)?.[1];
 if(!jwt)return out(401,"AUTH_REQUIRED");
 let data;
 try{const body=await req.text();if(body.length>2048)return out(413,"TOO_LARGE");
 data=JSON.parse(body);if(!data||typeof data!=="object"||Object.keys(data).sort().join(",")!=="buildDigest,deviceId,runId")return out(400,"INVALID_SELECTOR");}
 catch{return out(400,"INVALID_JSON")}
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!key)return out(503,"AUTH_UNAVAILABLE");
 const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 let userId,sessionId;
 try{const [u,c]=await Promise.all([auth.auth.getUser(jwt),auth.auth.getClaims(jwt)]);
 userId=u.data.user?.id;sessionId=c.data?.claims?.session_id;
 if(u.error||c.error||!userId||!sessionId||c.data?.claims?.sub!==userId)return out(401,"AUTH_INVALID");}
 catch{return out(503,"AUTH_UNAVAILABLE")}
 const db=Deno.env.get("SUPABASE_DB_URL");if(!db)return out(503,"DB_NOT_READY");
 const sql=postgres(db,{ssl:"require",prepare:false,max:1,connect_timeout:4});
 try{const [r]=await sql`select
 exists(select 1 from auth.sessions s where s.id=${sessionId}::uuid and s.user_id=${userId}::uuid and (s.not_after is null or s.not_after>now())) as signed_in,
 exists(select 1 from public.profiles p where p.id=${userId}::uuid and p.status='active') as active,
 exists(select 1 from public.devices d where d.id=${data.deviceId}::uuid and d.user_id=${userId}::uuid and d.link_status='active' and d.revoked_at is null) as device_ok`;
 if(!r?.signed_in||!r.active||!r.device_ok)return out(403,"IDENTITY_OR_DEVICE_DENIED");
 return out(503,"RUN_SERVER_NOT_CONNECTED");}
 catch{return out(503,"AUTH_DB_UNAVAILABLE")}
 finally{await sql.end({timeout:1}).catch(()=>{})}
});
