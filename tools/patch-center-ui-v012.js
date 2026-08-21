"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v012.js <app-root>");

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, content) => fs.writeFileSync(path.join(root, rel), content, "utf8");
const replaceOnce = (source, needle, replacement, label) => {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
};

let html = read("public/index.html");
html = html.replaceAll("UI Preview v0.11", "UI Preview v0.12");

if (!html.includes('data-preview-view="themes"')) {
  html = replaceOnce(
    html,
    '      <button class="preview-nav" type="button" data-preview-view="store"><span>＋</span><b>상점</b><i id="storeTabCount">0</i></button>\n',
    '      <button class="preview-nav" type="button" data-preview-view="store"><span>＋</span><b>상점</b><i id="storeTabCount">0</i></button>\n      <button class="preview-nav" type="button" data-preview-view="themes"><span>◈</span><b>테마</b></button>\n',
    "theme sidebar nav",
  );
}

if (!html.includes('id="previewThemeStorePanel"')) {
  const themePanel = `      <section id="previewThemeStorePanel" class="preview-page hidden" aria-live="polite">
        <div class="preview-page-heading">
          <div>
            <h1>테마 상점</h1>
            <p id="previewThemeStatusSummary">종합센터의 분위기를 바꾸는 테마를 선택합니다.</p>
          </div>
          <button id="previewThemeResetButton" class="preview-button" type="button">기본 테마</button>
        </div>
        <section class="preview-theme-launch-note">
          <div class="preview-theme-launch-mark">◈</div>
          <div>
            <strong>종합센터 UI와 동시 출시</strong>
            <p>출시 테마는 무료로 제공합니다. 유료 테마 결제는 SD Core 공용 결제 API가 준비된 뒤 이 상점에 그대로 연결합니다.</p>
          </div>
        </section>
        <section id="previewThemeGrid" class="preview-theme-grid" aria-label="테마 목록"></section>
      </section>

`;
  html = replaceOnce(
    html,
    '      <section id="previewUpdatesPanel" class="preview-page hidden">\n',
    themePanel + '      <section id="previewUpdatesPanel" class="preview-page hidden">\n',
    "theme panel",
  );
}
write("public/index.html", html);

let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.12: 테마 상점 + 테마 엔진")) {
  css += `\n\n/* UI Preview v0.12: 테마 상점 + 테마 엔진 */
body[data-preview-theme="sd-dark"]{--theme-chrome:#131518;--theme-card:#17191c;--theme-card-hover:#1d2024;--theme-icon:#24282e;--theme-folder:#23262b;--theme-folder-tab:#343941;--theme-accent:#e9eef7;--theme-accent-text:#101215}
body[data-preview-theme="logistics"]{--preview-bg:#101214;--preview-panel:#1b1a17;--preview-panel-2:#22211d;--preview-line:#3a352c;--preview-line-strong:#554a38;--preview-text:#f2ede4;--preview-muted:#aaa08d;--preview-accent:#e1aa4b;--theme-chrome:#171715;--theme-card:#1c1b18;--theme-card-hover:#29261f;--theme-icon:#292720;--theme-folder:#2a2822;--theme-folder-tab:#5c4d35;--theme-accent:#e1aa4b;--theme-accent-text:#171109}
body[data-preview-theme="flea"]{--preview-bg:#101512;--preview-panel:#182019;--preview-panel-2:#1d281f;--preview-line:#304238;--preview-line-strong:#45604e;--preview-text:#edf2eb;--preview-muted:#98a999;--preview-accent:#91d17d;--theme-chrome:#131a15;--theme-card:#172019;--theme-card-hover:#213027;--theme-icon:#223028;--theme-folder:#253127;--theme-folder-tab:#456247;--theme-accent:#91d17d;--theme-accent-text:#0e170e}
body[data-preview-theme="miner"]{--preview-bg:#111210;--preview-panel:#1b1b17;--preview-panel-2:#24231c;--preview-line:#3b392d;--preview-line-strong:#57513b;--preview-text:#f2efe4;--preview-muted:#a9a38f;--preview-accent:#dfbb55;--theme-chrome:#161713;--theme-card:#1d1d18;--theme-card-hover:#29281f;--theme-icon:#2a291f;--theme-folder:#29281f;--theme-folder-tab:#65583a;--theme-accent:#dfbb55;--theme-accent-text:#16130a}
body[data-preview-theme="casino"]{--preview-bg:#120f16;--preview-panel:#1b1620;--preview-panel-2:#251b2c;--preview-line:#403247;--preview-line-strong:#62466f;--preview-text:#f4edf7;--preview-muted:#ad98b5;--preview-accent:#d37bff;--theme-chrome:#17121b;--theme-card:#1d1722;--theme-card-hover:#2b2032;--theme-icon:#2b2031;--theme-folder:#2a1f31;--theme-folder-tab:#69447a;--theme-accent:#d37bff;--theme-accent-text:#180d1d}
body[data-preview-theme="vault"]{--preview-bg:#101214;--preview-panel:#181b1e;--preview-panel-2:#20252a;--preview-line:#343b42;--preview-line-strong:#4f5962;--preview-text:#f0f2f3;--preview-muted:#9ba3a9;--preview-accent:#d5b875;--theme-chrome:#14171a;--theme-card:#191d20;--theme-card-hover:#242a2f;--theme-icon:#262c31;--theme-folder:#252b30;--theme-folder-tab:#5a5546;--theme-accent:#d5b875;--theme-accent-text:#17140c}
body[data-preview-theme] .preview-topbar,body[data-preview-theme] .preview-sidebar{background:var(--theme-chrome)}
body[data-preview-theme] .preview-main,body[data-preview-theme] .preview-shell{background:var(--preview-bg)}
body[data-preview-theme] .preview-brand-mark,body[data-preview-theme] .preview-nav>i,body[data-preview-theme] .preview-home-badge{background:var(--theme-accent);color:var(--theme-accent-text)}
body[data-preview-theme] .preview-home-icon,body[data-preview-theme] .preview-library-app-icon,body[data-preview-theme] .preview-recent-icon,body[data-preview-theme] .preview-update-icon,body[data-preview-theme] .preview-app-info-icon{background:var(--theme-icon);border-color:var(--preview-line-strong)}
body[data-preview-theme] .preview-home-icon.folder{background:var(--theme-folder)}
body[data-preview-theme] .preview-home-icon.folder::before{background:var(--theme-folder-tab);border-color:var(--preview-line-strong)}
body[data-preview-theme] .preview-recent-card,body[data-preview-theme] .preview-favorite-card,body[data-preview-theme] .preview-center-update,body[data-preview-theme] .preview-app-context-menu,body[data-preview-theme] .preview-app-info-modal,body[data-preview-theme] .preview-folder-modal,body[data-preview-theme] .preview-name-modal,.ui-preview-mode[data-preview-theme] .store-card{background:var(--theme-card);border-color:var(--preview-line)}
body[data-preview-theme] .preview-recent-card:hover,body[data-preview-theme] .preview-favorite-card:hover,body[data-preview-theme] .preview-home-tile:hover,.ui-preview-mode[data-preview-theme] .store-card:hover{background:var(--theme-card-hover)}
body[data-preview-theme] .preview-nav.active{box-shadow:inset 2px 0 0 var(--theme-accent)}
body[data-preview-theme] .preview-running-dot{background:var(--theme-accent)}
.preview-theme-launch-note{display:grid;grid-template-columns:42px minmax(0,1fr);gap:13px;align-items:center;margin-bottom:17px;padding:13px 15px;border:1px solid var(--preview-line);border-radius:7px;background:var(--theme-card,#17191c)}
.preview-theme-launch-mark{width:36px;height:36px;border:1px solid var(--preview-line-strong);border-radius:8px;display:grid;place-items:center;background:var(--theme-icon,#24282e);color:var(--theme-accent,#e9eef7);font-size:17px}
.preview-theme-launch-note strong{display:block;font-size:12px}.preview-theme-launch-note p{margin:4px 0 0;color:var(--preview-muted);font-size:10px;line-height:1.55}
.preview-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.preview-theme-card{min-width:0;padding:10px;border:1px solid var(--preview-line);border-radius:8px;background:var(--theme-card,#17191c);transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.preview-theme-card:hover{border-color:var(--preview-line-strong);background:var(--theme-card-hover,#1d2024)}
.preview-theme-card.is-active{border-color:var(--theme-accent,#e9eef7);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--theme-accent,#e9eef7) 35%,transparent)}
.preview-theme-swatch{height:112px;border:1px solid rgba(255,255,255,.12);border-radius:7px;overflow:hidden;background:var(--card-bg);display:grid;grid-template-columns:26px 1fr;grid-template-rows:20px 1fr;position:relative}
.preview-theme-swatch::before{grid-column:1/3;content:"SD종합센터";padding:4px 7px;background:var(--card-chrome);color:rgba(255,255,255,.78);font-size:6px;font-weight:850;letter-spacing:.03em}
.preview-theme-swatch-sidebar{grid-row:2;background:color-mix(in srgb,var(--card-chrome) 86%,#000);border-right:1px solid rgba(255,255,255,.08)}
.preview-theme-swatch-main{padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start}
.preview-theme-swatch-main i{height:24px;border:1px solid rgba(255,255,255,.09);border-radius:4px;background:var(--card-panel)}
.preview-theme-swatch-main i:first-child{grid-column:1/3;height:7px;background:var(--card-accent);border:0;opacity:.95}
.preview-theme-card-copy{padding:10px 2px 3px}.preview-theme-card-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.preview-theme-card-title strong{min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-theme-price{flex:0 0 auto;color:var(--theme-accent,#e9eef7);font-size:8px;font-weight:900}
.preview-theme-card-copy p{min-height:31px;margin:5px 0 9px;color:var(--preview-muted);font-size:9px;line-height:1.55}.preview-theme-card-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.preview-theme-card-actions span{color:#7f8790;font-size:8px}.preview-theme-apply{min-width:68px}
@media (max-width:980px){.preview-theme-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:680px){.preview-theme-grid{grid-template-columns:1fr}.preview-theme-launch-note{grid-template-columns:1fr}.preview-theme-launch-mark{display:none}}
@media (prefers-reduced-motion:reduce){.preview-theme-card{transition:none!important}}
`;
}
write("public/css/ui-preview.css", css);

let js = read("public/js/ui-preview.js");
js = js.replace("/* SD종합센터 UI Preview v0.11", "/* SD종합센터 UI Preview v0.12");

js = replaceOnce(
  js,
  '  const next = ["home", "library", "store", "updates", "removed"].includes(view) ? view : "home";',
  '  const next = ["home", "library", "store", "themes", "updates", "removed"].includes(view) ? view : "home";',
  "themes accepted by view router",
);
js = replaceOnce(
  js,
  '  state.activeTab = next === "library" ? "installed" : next;',
  '  state.activeTab = next === "library" ? "installed" : next === "themes" ? "store" : next;',
  "theme active tab compatibility",
);
js = replaceOnce(
  js,
  '  elements.storePanel.classList.toggle("hidden", next !== "store");\n  previewElements.updatesPanel.classList.toggle("hidden", next !== "updates");',
  '  elements.storePanel.classList.toggle("hidden", next !== "store");\n  document.getElementById("previewThemeStorePanel")?.classList.toggle("hidden", next !== "themes");\n  previewElements.updatesPanel.classList.toggle("hidden", next !== "updates");',
  "theme panel routing",
);
js = replaceOnce(
  js,
  '  if (next === "store" && state.storeApps.length === 0 && !state.storeLoading) void loadStore(true);\n  if (next === "home") renderPreviewHome();',
  '  if (next === "store" && state.storeApps.length === 0 && !state.storeLoading) void loadStore(true);\n  if (next === "themes") renderPreviewThemeStore();\n  if (next === "home") renderPreviewHome();',
  "theme render on navigation",
);

if (!js.includes("const PREVIEW_THEME_KEY")) {
  js += `\n\n// UI Preview v0.12: 종합센터 테마 상점.\n// 유료 구매는 SD Core 공용 결제 API가 생기기 전까지 직접 SD지갑 DB에 결합하지 않습니다.\nconst PREVIEW_THEME_KEY = "sd-center-theme-v1";\nconst PREVIEW_THEMES = [\n  {id:"sd-dark",name:"SD Dark",price:"기본 제공",tag:"STANDARD",description:"종합센터 기본 다크 테마. 가장 중립적인 데스크톱 런처 스타일입니다.",bg:"#111214",chrome:"#131518",panel:"#24282e",accent:"#e9eef7"},\n  {id:"logistics",name:"물류센터 · 차고",price:"출시 무료",tag:"LOGISTICS",description:"철판과 작업등을 연상시키는 스틸·앰버 계열 차고 테마입니다.",bg:"#101214",chrome:"#171715",panel:"#292720",accent:"#e1aa4b"},\n  {id:"flea",name:"플리마켓 · 창고",price:"출시 무료",tag:"FLEA MARKET",description:"창고와 시장의 분위기를 살린 딥그린 계열 테마입니다.",bg:"#101512",chrome:"#131a15",panel:"#223028",accent:"#91d17d"},\n  {id:"miner",name:"광부 · 작업장",price:"출시 무료",tag:"MINER",description:"광산 작업장과 광석을 표현한 차콜·골드 계열 테마입니다.",bg:"#111210",chrome:"#161713",panel:"#2a291f",accent:"#dfbb55"},\n  {id:"casino",name:"카지노 · 네온",price:"출시 무료",tag:"CASINO",description:"어두운 로비에 네온 포인트를 더한 퍼플 계열 테마입니다.",bg:"#120f16",chrome:"#17121b",panel:"#2b2031",accent:"#d37bff"},\n  {id:"vault",name:"금고 · 메탈",price:"출시 무료",tag:"VAULT",description:"금속 금고실을 표현한 스틸·브라스 계열 테마입니다.",bg:"#101214",chrome:"#14171a",panel:"#262c31",accent:"#d5b875"},\n];\nlet previewThemeId = "sd-dark";\nfunction previewThemeById(id){return PREVIEW_THEMES.find((theme)=>theme.id===id)||PREVIEW_THEMES[0];}\nfunction loadPreviewTheme(){\n  let saved="sd-dark";\n  try{saved=String(localStorage.getItem(PREVIEW_THEME_KEY)||"sd-dark");}catch{}\n  previewThemeId=previewThemeById(saved).id;\n  document.body.dataset.previewTheme=previewThemeId;\n}\nfunction applyPreviewTheme(id,{toast=true}={}){\n  const theme=previewThemeById(id);\n  previewThemeId=theme.id;\n  document.body.dataset.previewTheme=theme.id;\n  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  if(toast)showToast(\`\${theme.name} 테마를 적용했습니다.\`);\n}\nfunction previewThemeCard(theme){\n  const active=theme.id===previewThemeId;\n  return \`<article class="preview-theme-card\${active?" is-active":""}" data-preview-theme-card="\${previewEscape(theme.id)}">\n    <div class="preview-theme-swatch" style="--card-bg:\${theme.bg};--card-chrome:\${theme.chrome};--card-panel:\${theme.panel};--card-accent:\${theme.accent}"><div class="preview-theme-swatch-sidebar"></div><div class="preview-theme-swatch-main"><i></i><i></i><i></i><i></i><i></i></div></div>\n    <div class="preview-theme-card-copy"><div class="preview-theme-card-title"><strong>\${previewEscape(theme.name)}</strong><span class="preview-theme-price">\${previewEscape(theme.price)}</span></div><p>\${previewEscape(theme.description)}</p><div class="preview-theme-card-actions"><span>\${previewEscape(theme.tag)}</span><button class="preview-button preview-theme-apply\${active?" preview-button-primary":""}" type="button" data-preview-apply-theme="\${previewEscape(theme.id)}" \${active?"disabled":""}>\${active?"사용 중":"적용"}</button></div></div>\n  </article>\`;\n}\nfunction renderPreviewThemeStore(){\n  const grid=document.getElementById("previewThemeGrid");\n  if(!grid)return;\n  const current=previewThemeById(previewThemeId);\n  grid.innerHTML=PREVIEW_THEMES.map(previewThemeCard).join("");\n  const summary=document.getElementById("previewThemeStatusSummary");\n  if(summary)summary.textContent=\`현재 적용: \${current.name} · 출시 테마 \${PREVIEW_THEMES.length}종\`;\n}\nloadPreviewTheme();\nrenderPreviewThemeStore();\ndocument.getElementById("previewThemeGrid")?.addEventListener("click",(event)=>{\n  const button=event.target.closest("[data-preview-apply-theme]");\n  if(!button)return;\n  applyPreviewTheme(button.dataset.previewApplyTheme);\n});\ndocument.getElementById("previewThemeResetButton")?.addEventListener("click",()=>applyPreviewTheme("sd-dark"));\n`;
}
write("public/js/ui-preview.js", js);

for (const [rel, markers] of Object.entries({
  "public/index.html":["UI Preview v0.12",'data-preview-view="themes"','id="previewThemeStorePanel"','id="previewThemeGrid"'],
  "public/css/ui-preview.css":["UI Preview v0.12: 테마 상점 + 테마 엔진",'data-preview-theme="logistics"',".preview-theme-grid",".preview-theme-card"],
  "public/js/ui-preview.js":["SD종합센터 UI Preview v0.12","const PREVIEW_THEME_KEY",'"themes", "updates"',"renderPreviewThemeStore","applyPreviewTheme","SD Core 공용 결제 API"],
})) {
  const content = read(rel);
  for (const marker of markers) if (!content.includes(marker)) throw new Error(`Missing v0.12 theme marker in ${rel}: ${marker}`);
}

console.log("SDCenter UI Preview v0.12 theme store applied");
