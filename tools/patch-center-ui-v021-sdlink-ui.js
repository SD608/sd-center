"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[2];
if(!root)throw new Error("Usage: node patch <app-root>");
const file=(rel)=>path.join(root,rel);
const read=(rel)=>fs.readFileSync(file(rel),"utf8").replace(/\r\n/g,"\n");
const write=(rel,content)=>{fs.mkdirSync(path.dirname(file(rel)),{recursive:true});fs.writeFileSync(file(rel),content,"utf8");};
function replaceOnce(source,needle,replacement,label){const i=source.indexOf(needle);if(i<0)throw new Error(`v0.21 marker missing: ${label}`);return source.slice(0,i)+replacement+source.slice(i+needle.length);}

let preload = read("preload.js");
preload = replaceOnce(
  preload,
  `  installStoreApp: (id) => invoke("center:install-store-app", id),`,
  `  installStoreApp: (id) => invoke("center:install-store-app", id),\n\n  // UI Preview v0.21: 종합센터 내장 SD Link 시스템 서비스\n  getSdLinkIntegrationState: () => invoke("center:get-sdlink-state"),\n  openSdLinkManager: () => invoke("center:open-sdlink-manager"),\n  startSdLinkService: () => invoke("center:start-sdlink-service"),`,
  "preload sdlink methods",
);
preload = replaceOnce(
  preload,
  `  onSelfUpdateState: (callback) =>\n    subscribe("center:center-update-state", callback),`,
  `  onSelfUpdateState: (callback) =>\n    subscribe("center:center-update-state", callback),\n  onSdLinkIntegrationState: (callback) =>\n    subscribe("center:sdlink-state", callback),`,
  "preload sdlink subscription",
);
write("preload.js", preload);

let html = read("public/index.html");
html = html.replace(
  /<span>UI Preview v0\.\d+<\/span>/,
  "<span>UI Preview v0.21</span>",
);
html = replaceOnce(
  html,
  `    </label>\n\n    <div class="preview-window-actions">`,
  `    </label>\n\n    <button id="previewSdLinkStatus" class="preview-sdlink-status" type="button" data-phase="checking" title="SD Link 상태 확인 중">\n      <span class="preview-sdlink-dot" aria-hidden="true"></span>\n      <b>SD Link</b>\n      <span id="previewSdLinkStatusText">확인 중</span>\n    </button>\n\n    <div class="preview-window-actions">`,
  "topbar sdlink status",
);
write("public/index.html", html);

let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.21: SD Link 시스템 상태")) {
  css += `\n\n/* UI Preview v0.21: SD Link 시스템 상태 — 사이드바 순서는 변경하지 않습니다. */\n.preview-sdlink-status{height:32px;max-width:220px;padding:0 10px;border:1px solid var(--preview-line);border-radius:6px;background:#171a1e;color:#aeb5bd;display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}\n.preview-sdlink-status:hover{background:#20242a;border-color:#414851}\n.preview-sdlink-status b{font-size:10px;color:#d6dbe1}\n.preview-sdlink-status>span:last-child{max-width:94px;overflow:hidden;text-overflow:ellipsis;font-size:9px;font-weight:750}\n.preview-sdlink-dot{width:7px;height:7px;border-radius:50%;background:#737b84;box-shadow:0 0 0 3px rgba(115,123,132,.08)}\n.preview-sdlink-status[data-phase="connected"] .preview-sdlink-dot{background:#68c995;box-shadow:0 0 0 3px rgba(104,201,149,.1)}\n.preview-sdlink-status[data-phase="migration-pending"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="linking"] .preview-sdlink-dot{background:#e5bd69;box-shadow:0 0 0 3px rgba(229,189,105,.1)}\n.preview-sdlink-status[data-phase="stopped"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="login-required"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="session-not-persisted"] .preview-sdlink-dot{background:#e07b7b;box-shadow:0 0 0 3px rgba(224,123,123,.1)}\n@media(max-width:900px){.preview-sdlink-status>span:last-child{display:none}.preview-sdlink-status{padding:0 9px}}\n@media(max-width:720px){.preview-sdlink-status b{display:none}.preview-sdlink-status{width:32px;padding:0;justify-content:center}}\n`;
}
write("public/css/ui-preview.css", css);

let renderer = read("public/js/ui-preview.js");
renderer = renderer.replaceAll("UI Preview v0.20", "UI Preview v0.21");
renderer = replaceOnce(
  renderer,
  `function libraryStatus(app) {\n  if (app.updateRequired) return { cls: "update", text: \`필수 v\${app.requiredVersion}\` };\n  if (app.updateAvailable) return { cls: "update", text: \`v\${app.latestVersion} 업데이트\` };\n  if (app.running) return { cls: "running", text: "실행 중" };\n  return { cls: "", text: "설치됨" };\n}`,
  `function libraryStatus(app) {\n  if (app.updateRequired) return { cls: "update", text: \`필수 v\${app.requiredVersion}\` };\n  if (app.updateAvailable) return { cls: "update", text: \`v\${app.latestVersion} 업데이트\` };\n  if (app.systemService) return { cls: app.running ? "running" : "", text: app.running ? "시스템 서비스" : "서비스 중단" };\n  if (app.running) return { cls: "running", text: "실행 중" };\n  return { cls: "", text: "설치됨" };\n}`,
  "library system service status",
);
renderer = replaceOnce(
  renderer,
  `  const launchLabel = app.updateRequired ? "필수 업데이트" : app.running ? "열기" : "실행";`,
  `  const launchLabel = app.updateRequired ? "필수 업데이트" : app.systemService ? "관리" : app.running ? "열기" : "실행";`,
  "system service manage label",
);
renderer = replaceOnce(
  renderer,
  `        \${app.running ? \`<button class="button button-danger terminate-button" type="button" \${busy ? "disabled" : ""}>종료</button>\` : ""}\n        <button class="button button-secondary folder-button" type="button">폴더</button>\n        <button class="button button-delete delete-button" type="button" \${busy ? "disabled" : ""}>제거</button>`,
  `        \${app.running && !app.systemService ? \`<button class="button button-danger terminate-button" type="button" \${busy ? "disabled" : ""}>종료</button>\` : ""}\n        <button class="button button-secondary folder-button" type="button">폴더</button>\n        \${!app.systemService ? \`<button class="button button-delete delete-button" type="button" \${busy ? "disabled" : ""}>제거</button>\` : ""}`,
  "hide service terminate delete",
);
if (!renderer.includes("UI Preview v0.21: SD Link 통합 상태 칩")) {
  renderer += [
    "",
    "// UI Preview v0.21: SD Link 통합 상태 칩.",
    "const previewSdLinkStatus = document.getElementById(\"previewSdLinkStatus\");",
    "const previewSdLinkStatusText = document.getElementById(\"previewSdLinkStatusText\");",
    "function renderPreviewSdLinkStatus(linkState){",
    "  if(!previewSdLinkStatus || !previewSdLinkStatusText || !linkState)return;",
    "  previewSdLinkStatus.dataset.phase=String(linkState.phase||\"checking\");",
    "  previewSdLinkStatusText.textContent=String(linkState.label||\"확인 중\");",
    "  const details=[",
    "    `상태: ${linkState.label||\"확인 중\"}`,",
    "    linkState.onlineEmail?`계정: ${linkState.onlineEmail}`:\"\",",
    "    linkState.lastSyncAt?`마지막 동기화: ${new Date(linkState.lastSyncAt).toLocaleString(\"ko-KR\")}`:\"\",",
    "    linkState.lastSyncMessage?String(linkState.lastSyncMessage):\"\",",
    "  ].filter(Boolean);",
    "  previewSdLinkStatus.title=details.join(\"\\n\")||\"SD Link 관리\";",
    "}",
    "window.sdCenter?.onSdLinkIntegrationState?.(renderPreviewSdLinkStatus);",
    "window.sdCenter?.getSdLinkIntegrationState?.().then(renderPreviewSdLinkStatus).catch(()=>{});",
    "previewSdLinkStatus?.addEventListener(\"click\",async()=>{",
    "  previewSdLinkStatus.disabled=true;",
    "  try{",
    "    const result=await window.sdCenter?.openSdLinkManager?.();",
    "    if(result && !result.ok)showToast(result.error||\"SD Link 관리 화면을 열지 못했습니다.\",4500);",
    "  }catch(error){",
    "    showToast(error?.message||\"SD Link 관리 화면을 열지 못했습니다.\",4500);",
    "  }finally{",
    "    previewSdLinkStatus.disabled=false;",
    "  }",
    "});",
    ""
  ].join("\n");
}
write("public/js/ui-preview.js", renderer);
console.log("v0.21 SD Link UI integration applied");
