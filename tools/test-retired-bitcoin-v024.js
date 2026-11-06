"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const base=fs.mkdtempSync(path.join(os.tmpdir(),"sd-btc-retire-"));
try {
 const dir=path.join(base,"public/js");fs.mkdirSync(dir,{recursive:true});
 const main = [
 'let chosenId="bitcoin";',
 'const dialog={showOpenDialog: async ()=>({canceled:false,filePaths:["fixture.zip"]})};',
 'function inspectZip() {return {metadata:{id:chosenId}};}',
 'async function installStoreApp(id) {return {ok:true};}',
 'async function updateAppFromCatalog(id) {return {ok:true};}',
 'function catalogRuleFor(entry) { const entryId = String(entry?.id || ""); return null; }',
 'function getExtensionStoreState() { const apps = Object.entries({}).filter(([id, rule]) => id !== SD_LINK_ID && rule?.version && rule?.downloadUrl).map(([id, rule]) => ({})); return apps; }',
 'function downloadableExtensionEntries() { return Object.entries({}).map(([id, rule]) => ({id,rule})); }',
 'function updateAllAvailableApps() { const targets = appCatalog.filter((entry) => entry.id !== SD_LINK_ID && updateAvailabilityFor(entry).updateAvailable,); return targets; }',
 'async function addAppFromZip() {',
 ' const selection = await dialog.showOpenDialog(null, {});',
 ' try { const inspected = inspectZip(selection.filePaths[0]); return {ok:true}; } catch(e) { return {ok:false,error:String(e)}; }',
 '}'
 ].join("\n")+"\n";
 const ui='const state={storeApps:[{id:"bitcoin"},{id:"sd-bitcoin-miner"},{id:"sd-slot"}]};\nfunction renderStore(){return state.storeApps.length;}\n';
 fs.writeFileSync(path.join(base,"main.js"),main);
 fs.writeFileSync(path.join(dir,"app.js"),ui);
 const patch=path.join(__dirname,"patch-retired-bitcoin-v024.js");
 cp.execFileSync(process.execPath,[patch,base]);
 const m=fs.readFileSync(path.join(base,"main.js"),"utf8");
 const u=fs.readFileSync(path.join(dir,"app.js"),"utf8");
 for(const marker of ["catalogRuleFor","backendStore","bulkDownload","bulkUpdate"]) assert(m.includes("SD-BITCOIN-RETIRED-GUARD:"+marker),marker+" guard absent");
 const api=new Function(m+"\nreturn {installStoreApp,updateAppFromCatalog,addAppFromZip,setZipId:(v)=>chosenId=v};")();
 const view=new Function(u+"\nrenderStore();return state.storeApps;")();
 assert.deepEqual(view.map(x=>x.id),["sd-slot"]);
 Promise.all([api.installStoreApp("bitcoin"),api.installStoreApp("sd-bitcoin-miner"),api.updateAppFromCatalog("sd-bitcoin-miner-desktop"),api.installStoreApp("sd-slot"),api.addAppFromZip()]).then(async results=>{
  assert.equal(results[0].retired,true);assert.equal(results[1].retired,true);
  assert.equal(results[2].retired,true);assert.equal(results[3].ok,true);
  assert.equal(results[4].retired,true,"manual ZIP Bitcoin install must be rejected");
  for (const alias of ["sd-bitcoin-miner","sd-bitcoin-miner-desktop"]) { api.setZipId(alias); assert.equal((await api.addAppFromZip()).retired,true); }
  api.setZipId("sd-slot"); assert.equal((await api.addAppFromZip()).ok,true,"unrelated manual ZIP must remain installable");
  cp.execFileSync(process.execPath,[patch,base]);
  assert.equal(fs.readFileSync(path.join(base,"main.js"),"utf8"),m);
  assert.equal(fs.readFileSync(path.join(dir,"app.js"),"utf8"),u);
  console.log("retired Bitcoin store/IPC/manual-ZIP regression PASS");
 }).catch(e=>{console.error(e);process.exitCode=1;});
} finally {process.on("exit",()=>fs.rmSync(base,{recursive:true,force:true}));}
