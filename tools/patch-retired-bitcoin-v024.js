"use strict";
const fs=require("node:fs"), path=require("node:path");
const root=process.argv[2]; if(!root) throw Error("Usage: node patch-retired-bitcoin-v024.js <app-root>");
const files=[path.join(root,"main.js"),path.join(root,"public/js/app.js")];
for(const file of files) if(!fs.existsSync(file)) throw Error("BLOCKED: missing candidate file: "+file);
let main=fs.readFileSync(files[0],"utf8"), renderer=fs.readFileSync(files[1],"utf8");
const guard='\n  if (["bitcoin","sd-bitcoin-miner","sd-bitcoin-miner-desktop"].includes(String(id || "").trim().toLowerCase())) {\n    return {ok:false,retired:true,error:"SD비트코인 채굴장은 신규 설치 및 업데이트 제공이 중단되었습니다."};\n  }';
function inject(source,name) {
  const marker="SD-BITCOIN-RETIRED-GUARD:"+name;
  if(source.includes(marker)) return source;
  const re=new RegExp("((?:async\\s+)?function\\s+"+name+"\\s*\\(\\s*id\\s*\\)\\s*\\{)","g");
  if((source.match(re)||[]).length!==1) throw Error("BLOCKED: missing or duplicate "+name+"(id)");
  return source.replace(re,(_m,head)=>head+"\n  // "+marker+guard);
}
main=inject(main,"installStoreApp");
main=inject(main,"updateAppFromCatalog");

const manualMarker="SD-BITCOIN-RETIRED-GUARD:addAppFromZip";
if(!main.includes(manualMarker)) {
 const needle="const inspected = inspectZip(selection.filePaths[0]);";
 if(main.split(needle).length!==2) throw Error("BLOCKED: ambiguous or missing manual ZIP inspection gate");
 main=main.replace(needle,needle+
   "\n      // "+manualMarker+
   '\n      if (["bitcoin","sd-bitcoin-miner","sd-bitcoin-miner-desktop"].includes(String(inspected.metadata?.id || "").trim().toLowerCase())) { return {ok:false,retired:true,error:"SD비트코인 채굴장은 신규 ZIP 설치 및 재설치 제공이 중단되었습니다."}; }');
}

// Defense-in-depth for store discovery, all-updates and bulk downloads.
const retired='["bitcoin","sd-bitcoin-miner","sd-bitcoin-miner-desktop"]';
const isRetired='('+retired+'.includes(String(id || "").trim().toLowerCase()))';
function addLineBefore(text, needle, line, marker) {
 if(text.includes(marker)) return text;
 if(text.split(needle).length!==2) { if(marker.endsWith("backendStore") || marker.endsWith("bulkDownload") || marker.endsWith("bulkUpdate") || marker.endsWith("catalogRuleFor")) return text; throw Error("BLOCKED: ambiguous "+marker); }
 return text.replace(needle, marker.endsWith('bulkDownload') ? line : line+needle);
}
main=addLineBefore(main,
 '    const entryId = String(entry?.id || "");',
 '    // SD-BITCOIN-RETIRED-GUARD:catalogRuleFor\n    if ('+retired+'.includes(String(entry?.id || "").trim().toLowerCase())) return null;\n',
 'SD-BITCOIN-RETIRED-GUARD:catalogRuleFor');
main=addLineBefore(main,
 '.filter(([id, rule]) => id !== SD_LINK_ID && rule?.version && rule?.downloadUrl)',
 '.filter(([id]) => { /* SD-BITCOIN-RETIRED-GUARD:backendStore */ return !'+retired+'.includes(String(id).toLowerCase()); })\n        ',
 'SD-BITCOIN-RETIRED-GUARD:backendStore');
main=addLineBefore(main,
 'return Object.entries(extensionCatalog?.apps || {})\n      .map(([id, rule]) => ({',
 '/* SD-BITCOIN-RETIRED-GUARD:bulkDownload */ return Object.entries(extensionCatalog?.apps || {})\n      .filter(([id]) => !'+retired+'.includes(String(id).toLowerCase()))\n      .map(([id, rule]) => ({',
 'SD-BITCOIN-RETIRED-GUARD:bulkDownload');
main=addLineBefore(main,
 '(entry) => entry.id !== SD_LINK_ID && updateAvailabilityFor(entry).updateAvailable,',
 '(entry) => { /* SD-BITCOIN-RETIRED-GUARD:bulkUpdate */ return !'+retired+'.includes(String(entry.id).toLowerCase()) && entry.id !== SD_LINK_ID && updateAvailabilityFor(entry).updateAvailable; },\n        // ',
 'SD-BITCOIN-RETIRED-GUARD:bulkUpdate');

const marker="SD-BITCOIN-RETIRED-GUARD:renderStore";
if(!renderer.includes(marker)) {
 const re=/(function\s+renderStore\s*\(\s*\)\s*\{)/g;
 if((renderer.match(re)||[]).length!==1) throw Error("BLOCKED: missing or duplicate renderStore()");
 renderer=renderer.replace(re,(_m,head)=>head+"\n  // "+marker+
 '\n  state.storeApps = (Array.isArray(state.storeApps) ? state.storeApps : []).filter((app) => !["bitcoin","sd-bitcoin-miner","sd-bitcoin-miner-desktop"].includes(String(app?.id || "").trim().toLowerCase()));');
}
fs.writeFileSync(files[0],main,"utf8");
fs.writeFileSync(files[1],renderer,"utf8");
console.log("Bitcoin retirement candidate patch applied; no user data modified");
