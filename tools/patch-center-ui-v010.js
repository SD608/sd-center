"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v010.js <app-root>");

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, content) => fs.writeFileSync(path.join(root, rel), content, "utf8");

let html = read("public/index.html");
html = html.replaceAll("UI Preview v0.9", "UI Preview v0.10");
write("public/index.html", html);

let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.10: 최종 UI 마감")) {
  css += `

/* UI Preview v0.10: 최종 UI 마감
   - 간격/정렬 통일
   - 긴 앱 이름 및 좁은 화면 오버플로 방지
   - hover/focus/active 상태 통일
   - 우클릭 메뉴/정보창 데스크톱 스타일 마감
*/
.ui-preview-mode button,
.ui-preview-mode [role="button"],
.ui-preview-mode .preview-home-tile,
.ui-preview-mode .app-card,
.ui-preview-mode .store-card,
.ui-preview-mode .removed-app-card{outline:none}
.ui-preview-mode button:focus-visible,
.ui-preview-mode [role="button"]:focus-visible,
.ui-preview-mode .preview-home-tile:focus-visible,
.ui-preview-mode .app-card:focus-visible,
.ui-preview-mode .store-card:focus-visible,
.ui-preview-mode .removed-app-card:focus-visible{box-shadow:0 0 0 2px rgba(139,189,255,.7);border-color:#6d8fb7!important}

.preview-section{min-width:0}
.preview-section-heading{min-width:0;gap:12px}
.preview-section-heading h2,.preview-section-heading span{min-width:0}
.preview-home-grid{align-items:start;grid-auto-rows:minmax(0,auto)}
.preview-home-tile{min-width:0;border-radius:10px;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.preview-home-tile:hover{background:#24292f}
.preview-home-tile:active{transform:translateY(1px)}
.preview-home-icon,.preview-home-folder-preview{flex:0 0 auto}
.preview-home-name{width:100%;max-width:116px;min-height:30px;margin-left:auto;margin-right:auto;line-height:1.25;white-space:normal!important;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.preview-home-sub{width:100%;max-width:116px;margin-left:auto;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.preview-folder-mini-app img,.preview-home-icon img,.preview-library-app-icon img,.preview-favorite-icon img,.preview-recent-icon img,.preview-update-icon img,.store-app-icon img,.removed-app-card .app-icon img{display:block;max-width:100%;max-height:100%}

.preview-home-stats{gap:10px}
.preview-home-stat{min-width:0}
.preview-home-stat span,.preview-home-stat strong{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.preview-favorite-card,.preview-recent-card,.preview-library-row,.removed-app-card,.preview-update-row,.store-card{min-width:0;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.preview-favorite-card:hover,.preview-recent-card:hover,.preview-library-row:hover,.removed-app-card:hover,.preview-update-row:hover,.store-card:hover{border-color:#424a54}
.preview-favorite-card:active,.preview-recent-card:active,.preview-library-row:active,.store-card:active{transform:translateY(1px)}
.preview-favorite-copy,.preview-recent-copy,.preview-library-copy,.preview-update-copy,.store-app-copy{min-width:0}
.preview-favorite-copy strong,.preview-favorite-copy span,.preview-recent-copy strong,.preview-recent-copy span,.preview-library-copy strong,.preview-library-copy span,.preview-update-copy strong,.preview-update-copy span,.store-app-copy strong,.store-app-copy span{max-width:100%;overflow:hidden;text-overflow:ellipsis}

.preview-center-update{min-width:0}
.preview-center-update-copy,.preview-center-update-title{min-width:0}
.preview-center-update-title strong,.preview-center-update-title span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.preview-center-update>button{white-space:nowrap}

.preview-app-context-menu{min-width:210px;max-width:min(280px,calc(100vw - 16px));padding:6px;border-color:#3b424b;border-radius:8px;background:#1c2025;box-shadow:0 12px 34px rgba(0,0,0,.5)}
.preview-app-context-item{min-height:36px;padding:7px 9px;border-radius:5px;font-size:11px;line-height:1.2;white-space:nowrap}
.preview-app-context-item:hover,.preview-app-context-item:focus-visible{background:#2a3037;box-shadow:none!important;border-color:transparent!important}
.preview-app-context-item:active{background:#30363e}
.preview-app-context-item .preview-context-icon{width:20px;flex:0 0 20px;color:#a9b1ba;font-size:13px;line-height:1;text-align:center}
.preview-app-context-item.preview-context-danger:hover,.preview-app-context-item.preview-context-danger:focus-visible{background:#38262a;color:#ffaaaa}
.preview-app-context-separator{margin:5px 3px;background:#343a42}

.preview-app-info-backdrop{padding:20px;background:rgba(7,9,12,.72)}
.preview-app-info-modal{width:min(500px,calc(100vw - 40px));max-height:calc(100vh - 40px);display:flex;flex-direction:column;border-radius:10px;border-color:#3b424a;background:#1b1f24}
.preview-app-info-head{flex:0 0 auto;padding:17px 18px;grid-template-columns:64px minmax(0,1fr) 34px;gap:14px}
.preview-app-info-title strong{font-size:16px;line-height:1.25}
.preview-app-info-title span{line-height:1.35}
.preview-app-info-body{min-height:0;overflow:auto;padding:16px 18px 17px}
.preview-app-info-description{overflow-wrap:anywhere}
.preview-app-info-grid{grid-template-columns:110px minmax(0,1fr)}
.preview-app-info-grid dt,.preview-app-info-grid dd{min-width:0;line-height:1.45}
.preview-app-info-grid dd{overflow-wrap:anywhere}
.preview-app-info-foot{flex:0 0 auto;border-top:0;padding:11px 18px 16px}
.preview-app-info-close,.preview-app-info-ok{transition:background-color .12s ease,border-color .12s ease}
.preview-app-info-close:focus-visible,.preview-app-info-ok:focus-visible{box-shadow:0 0 0 2px rgba(139,189,255,.7)!important}

@media(max-width:920px){
  .preview-home-grid{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:17px 8px}
  .preview-home-name,.preview-home-sub{max-width:106px}
  .preview-home-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .preview-favorite-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:680px){
  .preview-home-grid{grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:15px 6px}
  .preview-home-icon,.preview-home-folder-preview{width:70px;height:70px}
  .preview-home-name,.preview-home-sub{max-width:92px}
  .preview-favorite-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .preview-app-info-backdrop{padding:12px}
  .preview-app-info-modal{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}
  .preview-app-info-head{grid-template-columns:54px minmax(0,1fr) 32px;padding:14px}
  .preview-app-info-icon{width:54px;height:54px;border-radius:12px}
  .preview-app-info-body{padding:14px}
  .preview-app-info-grid{grid-template-columns:92px minmax(0,1fr)}
  .preview-app-info-foot{padding:10px 14px 14px}
}
@media(max-width:470px){
  .preview-home-stats{grid-template-columns:1fr 1fr}
  .preview-favorite-grid{grid-template-columns:1fr}
  .preview-app-info-grid{grid-template-columns:1fr}
  .preview-app-info-grid dt{padding-bottom:3px;border-bottom:0}
  .preview-app-info-grid dd{padding-top:0}
}
@media(prefers-reduced-motion:reduce){
  .preview-home-tile,.preview-favorite-card,.preview-recent-card,.preview-library-row,.removed-app-card,.preview-update-row,.store-card,.preview-app-info-close,.preview-app-info-ok{transition:none!important}
}
`;
}
write("public/css/ui-preview.css", css);

let js = read("public/js/ui-preview.js");
js = js.replace("/* SD종합센터 UI Preview v0.9", "/* SD종합센터 UI Preview v0.10");
if (!js.includes("UI Preview v0.10: 홈 타일 마감 보조")) {
  js += `

// UI Preview v0.10: 홈 타일 마감 보조 — 긴 이름 툴팁/키보드 컨텍스트 메뉴.
function applyPreviewV010HomePolish(){
  document.querySelectorAll(".preview-home-tile[data-preview-app]").forEach((tile)=>{
    const app=findApp(tile.dataset.previewApp);
    if(!app)return;
    tile.setAttribute("title",app.name||"앱");
    if(!tile.hasAttribute("tabindex"))tile.tabIndex=0;
    tile.setAttribute("aria-label",`${app.name||"앱"} 열기`);
  });
}
const previewV010HomeObserver=new MutationObserver(applyPreviewV010HomePolish);
if(previewElements?.homeGrid){
  previewV010HomeObserver.observe(previewElements.homeGrid,{childList:true,subtree:true});
  applyPreviewV010HomePolish();
  previewElements.homeGrid.addEventListener("keydown",(event)=>{
    if(!(event.key==="ContextMenu"||(event.shiftKey&&event.key==="F10")))return;
    const tile=event.target.closest?.(".preview-home-tile[data-preview-app]");
    if(!tile)return;
    event.preventDefault();
    const rect=tile.getBoundingClientRect();
    openPreviewAppContextMenu(tile.dataset.previewApp,Math.round(rect.left+Math.min(28,rect.width/2)),Math.round(rect.top+Math.min(28,rect.height/2)));
    requestAnimationFrame(()=>document.querySelector("#previewAppContextMenu .preview-app-context-item")?.focus());
  });
}
document.getElementById("previewAppContextMenu")?.addEventListener("keydown",(event)=>{
  const menu=event.currentTarget;
  const items=[...menu.querySelectorAll(".preview-app-context-item:not([disabled])")];
  if(!items.length)return;
  const current=Math.max(0,items.indexOf(document.activeElement));
  if(event.key==="ArrowDown"||event.key==="ArrowUp"||event.key==="Home"||event.key==="End"){
    event.preventDefault();
    let next=current;
    if(event.key==="ArrowDown")next=(current+1)%items.length;
    else if(event.key==="ArrowUp")next=(current-1+items.length)%items.length;
    else if(event.key==="Home")next=0;
    else next=items.length-1;
    items[next].focus();
  }
});
`;
}
write("public/js/ui-preview.js", js);

const checks = {
  "public/index.html": ["UI Preview v0.10"],
  "public/css/ui-preview.css": [
    "UI Preview v0.10: 최종 UI 마감",
    ".preview-home-name",
    ".preview-app-context-menu",
    ".preview-app-info-modal",
    "prefers-reduced-motion",
  ],
  "public/js/ui-preview.js": [
    "UI Preview v0.10: 홈 타일 마감 보조",
    "applyPreviewV010HomePolish",
    'event.key==="ContextMenu"',
    'event.shiftKey&&event.key==="F10"',
  ],
};
for (const [rel, markers] of Object.entries(checks)) {
  const content = read(rel);
  for (const marker of markers) {
    if (!content.includes(marker)) throw new Error(`Missing v0.10 polish marker in ${rel}: ${marker}`);
  }
}

console.log("SDCenter UI Preview v0.10 final UI polish applied");
