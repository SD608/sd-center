"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const base=fs.mkdtempSync(path.join(os.tmpdir(),"sd-btc-retire-"));
try {
 const dir=path.join(base,"public/js");fs.mkdirSync(dir,{recursive:true});
 const main='async function installStoreApp(id) {return {ok:true};}\nasync function updateAppFromCatalog(id) {return {ok:true};}\n';
 const ui='const state={storeApps:[{id:"bitcoin"},{id:"sd-bitcoin-miner"},{id:"sd-slot"}]};\nfunction renderStore(){return state.storeApps.length;}\n';
 fs.writeFileSync(path.join(base,"main.js"),main);
 fs.writeFileSync(path.join(dir,"app.js"),ui);
 const patch=path.join(__dirname,"patch-retired-bitcoin-v024.js");
 cp.execFileSync(process.execPath,[patch,base]);
 const m=fs.readFileSync(path.join(base,"main.js"),"utf8");
 const u=fs.readFileSync(path.join(dir,"app.js"),"utf8");
 const api=new Function(m+"\nreturn {installStoreApp,updateAppFromCatalog};")();
 const view=new Function(u+"\nrenderStore();return state.storeApps;")();
 assert.deepEqual(view.map(x=>x.id),["sd-slot"]);
 Promise.all([api.installStoreApp("bitcoin"),api.installStoreApp("sd-bitcoin-miner"),api.updateAppFromCatalog("sd-bitcoin-miner-desktop"),api.installStoreApp("sd-slot")]).then(results=>{
  assert.equal(results[0].retired,true);assert.equal(results[1].retired,true);
  assert.equal(results[2].retired,true);assert.equal(results[3].ok,true);
  cp.execFileSync(process.execPath,[patch,base]);
  assert.equal(fs.readFileSync(path.join(base,"main.js"),"utf8"),m);
  assert.equal(fs.readFileSync(path.join(dir,"app.js"),"utf8"),u);
  console.log("retired Bitcoin store/IPC regression PASS");
 }).catch(e=>{console.error(e);process.exitCode=1;});
} finally {process.on("exit",()=>fs.rmSync(base,{recursive:true,force:true}));}
