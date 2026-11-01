// HTTP negative QA: DEV endpoint only, no credentials, no production writes.
const uri=process.env.DEV_GATE_URL;
if(!uri||!uri.includes("rwjueffaziiawdebbwpf.supabase.co"))throw Error("WRONG_PROJECT");
const checks=[
 {label:"missing JWT",method:"POST",headers:{"content-type":"application/json"},body:"{}"},
 {label:"invalid JWT",method:"POST",headers:{"content-type":"application/json","authorization":"Bearer invalid.token.value"},body:"{}"},
 {label:"unauthenticated GET",method:"GET"}
];
for(const c of checks){
 const response=await fetch(uri,{method:c.method,headers:c.headers,body:c.body,signal:AbortSignal.timeout(12000)});
 if(response.status<400||response.status>=500)throw Error(c.label+" should reject unauthenticated request, got "+response.status);
 console.log("PASS DEV_EDGE_FAIL_CLOSED",c.label,response.status);
}
