"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=process.argv[2];if(!root)throw new Error("Usage: node check <app-root>");
const checks={
"main.js":["SD_LINK_ID","ensureIntegratedSdLinkUserData","launchIntegratedSdLinkService","center:get-sdlink-state","center:open-sdlink-manager","setTimeout(launchIntegratedSdLinkService, 250)","systemService: entry.id === SD_LINK_ID","--sd-link-open-manager"],
"preload.js":["getSdLinkIntegrationState","openSdLinkManager","onSdLinkIntegrationState"],
"public/index.html":["previewSdLinkStatus","UI Preview v0.21"],
"public/js/ui-preview.js":["UI Preview v0.21: SD Link 통합 상태 칩","app.systemService ? \"관리\""],
"public/css/ui-preview.css":["UI Preview v0.21: SD Link 시스템 상태"],
"src/sdlink-integration.js":["integratedSdLinkUserDataPath","sd-link-binding.json","copyMissingTree"],
"tools/test-sdlink-integration-v021.js":["integration tests passed"]};
for(const [rel,markers] of Object.entries(checks)){const content=fs.readFileSync(path.join(root,rel),"utf8");for(const marker of markers)if(!content.includes(marker))throw new Error(`v0.21 validation marker missing in ${rel}: ${marker}`);}
console.log("v0.21 SD Link static contract check passed");
