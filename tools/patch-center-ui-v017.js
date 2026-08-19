const fs=require('fs'),path=require('path');
const root=process.argv[2]; if(!root)throw new Error('Usage: node patch-center-ui-v017.js <app-root>');
const p={html:path.join(root,'public','index.html'),js:path.join(root,'public','js','ui-preview.js'),css:path.join(root,'public','css','ui-preview.css'),catalog:path.join(root,'src','theme-catalog.js')};
const read=x=>fs.readFileSync(x,'utf8'),write=(x,s)=>fs.writeFileSync(x,s,'utf8');
function rep(s,a,b,n){if(!s.includes(a))throw new Error(`v0.17 marker missing: ${n}`);return s.replace(a,b)}

let s=read(p.html);
s=s.replaceAll('UI Preview v0.16','UI Preview v0.17');
s=rep(s,'<button id="previewThemeResetButton" class="preview-button" type="button">기본 테마</button>','<button id="previewThemeResetButton" class="preview-button" type="button">SD Classic</button>','theme reset label');
write(p.html,s);

s=read(p.catalog);
s=rep(s,'if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === "sd-dark" || seen.has(id)) return;','if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === "sd-dark" || id === "sd-classic" || seen.has(id)) return;','reserved builtin ids');
s=rep(s,'      accent: validHex(entry.accent, "#e9eef7"),\n      backgroundColor: validHex(entry.backgroundColor, "#111214"),','      accent: validHex(entry.accent, "#e9eef7"),\n      sidebarAccent: validHex(entry.sidebarAccent, validHex(entry.accent, "#e9eef7")),\n      sidebarStrength: Math.max(0, Math.min(0.18, Number(entry.sidebarStrength ?? 0.06) || 0.06)),\n      backgroundColor: validHex(entry.backgroundColor, "#111214"),','sidebar catalog fields');
write(p.catalog,s);

s=read(p.js);
s=rep(s,'// UI Preview v0.16: 별도 원격 카탈로그에서 테마 목록을 읽어 앱 업데이트 없이 항목을 늘립니다.','// UI Preview v0.16: 별도 원격 카탈로그에서 테마 목록을 읽어 앱 업데이트 없이 항목을 늘립니다.\n// UI Preview v0.17: 첫 기준 테마 `SD Classic`을 실제 홈/사이드바 시각 시스템으로 구현합니다.','v017 header');
s=rep(s,'const PREVIEW_BUILTIN_THEME={id:"sd-dark",name:"SD 기본",price:"기본 제공",tag:"STANDARD",description:"기존 SD종합센터 컬러를 유지하는 기본 홈 테마입니다.",bg:"#111214",chrome:"#131518",panel:"#24282e",accent:"#e9eef7"};',`const PREVIEW_BUILTIN_THEME={
  id:"sd-classic",name:"SD Classic",price:"기본 제공",tag:"CLASSIC",
  description:"초기 SD종합센터의 청색·보라 그라데이션과 SD지갑의 흔적을 절제된 방식으로 다시 살린 클래식 테마입니다.",
  bg:"#0b1020",chrome:"#12172a",panel:"#1d2441",accent:"#7187ff",sidebarAccent:"#8a91ff",sidebarStrength:.10
};`,'builtin theme');
s=rep(s,'function normalizePreviewTheme(theme){return {id:String(theme.id||""),name:String(theme.name||theme.id||"테마"),price:String(theme.priceLabel||"무료"),tag:String(theme.tag||"THEME"),description:String(theme.description||""),bg:String(theme.backgroundColor||"#111214"),chrome:"#131518",panel:"#24282e",accent:String(theme.accent||"#e9eef7"),backgroundUrl:String(theme.backgroundUrl||""),thumbnailUrl:String(theme.thumbnailUrl||"")};}','function normalizePreviewTheme(theme){return {id:String(theme.id||""),name:String(theme.name||theme.id||"테마"),price:String(theme.priceLabel||"무료"),tag:String(theme.tag||"THEME"),description:String(theme.description||""),bg:String(theme.backgroundColor||"#111214"),chrome:"#131518",panel:"#24282e",accent:String(theme.accent||"#e9eef7"),sidebarAccent:String(theme.sidebarAccent||theme.accent||"#e9eef7"),sidebarStrength:Math.max(0,Math.min(.18,Number(theme.sidebarStrength??.06)||.06)),backgroundUrl:String(theme.backgroundUrl||""),thumbnailUrl:String(theme.thumbnailUrl||"")};}','normalize sidebar');
s=rep(s,'let previewThemeId="sd-dark";','let previewThemeId="sd-classic";','theme default id');
s=rep(s,'function applyPreviewThemeVisual(theme){const home=previewThemeHomeTarget();if(!home)return;home.dataset.previewTheme=theme.id;home.style.setProperty("--preview-theme-home-color",theme.bg||"#111214");home.style.setProperty("--preview-theme-home-accent",theme.accent||"#e9eef7");}','function previewThemeRgba(hex,alpha){const text=String(hex||"").replace("#","");if(!/^[0-9a-fA-F]{6}$/.test(text))return `rgba(0,0,0,${alpha})`;const value=parseInt(text,16);return `rgba(${(value>>16)&255},${(value>>8)&255},${value&255},${alpha})`;}\nfunction applyPreviewThemeVisual(theme){\n  const home=previewThemeHomeTarget();\n  if(!home)return;\n  const normalizedId=theme?.id||PREVIEW_BUILTIN_THEME.id;\n  const sidebarAccent=theme.sidebarAccent||theme.accent||"#e9eef7";\n  const sidebarStrength=Math.max(0,Math.min(.18,Number(theme.sidebarStrength??.06)||.06));\n  home.dataset.previewTheme=normalizedId;\n  document.body.dataset.centerTheme=normalizedId;\n  document.body.style.setProperty("--preview-theme-home-color",theme.bg||"#111214");\n  document.body.style.setProperty("--preview-theme-home-accent",theme.accent||"#e9eef7");\n  document.body.style.setProperty("--preview-theme-sidebar-tint",previewThemeRgba(sidebarAccent,sidebarStrength));\n  document.body.style.setProperty("--preview-theme-sidebar-accent",sidebarAccent);\n}','theme visual engine');
s=rep(s,'function loadPreviewTheme(){let saved="sd-dark";try{saved=String(localStorage.getItem(PREVIEW_THEME_KEY)||"sd-dark");}catch{}previewThemeId=saved;applyPreviewThemeVisual(previewThemeById(saved));}','function loadPreviewTheme(){\n  let saved="sd-classic";\n  try{saved=String(localStorage.getItem(PREVIEW_THEME_KEY)||"sd-classic");}catch{}\n  if(saved==="sd-dark") saved="sd-classic"; // v0.12~v0.16 기본 테마 설정 마이그레이션\n  previewThemeId=saved;\n  applyPreviewThemeVisual(previewThemeById(saved));\n}','theme migration');
s=s.replace('if(toast)showToast(`${theme.name} 홈 테마를 적용했습니다.`);','if(toast)showToast(`${theme.name} 테마를 적용했습니다.`);');
s=rep(s,'  const active=theme.id===previewThemeId;\n  return `<article','  const active=theme.id===previewThemeId;\n  const classic=theme.id==="sd-classic";\n  return `<article','classic card flag');
s=rep(s,'<div class="preview-theme-swatch" style="--card-bg:${theme.bg};--card-chrome:${theme.chrome};--card-panel:${theme.panel};--card-accent:${theme.accent}">','<div class="preview-theme-swatch${classic?" is-sd-classic":""}" style="--card-bg:${theme.bg};--card-chrome:${theme.chrome};--card-panel:${theme.panel};--card-accent:${theme.accent}">','classic swatch');
s=s.replaceAll('theme.id&&theme.id!=="sd-dark"','theme.id&&theme.id!=="sd-classic"&&theme.id!=="sd-dark"');
s=s.replaceAll('previewThemeId="sd-dark";try{localStorage.setItem(PREVIEW_THEME_KEY,"sd-dark");}','previewThemeId="sd-classic";try{localStorage.setItem(PREVIEW_THEME_KEY,"sd-classic");}');
s=s.replaceAll('previewThemeId="sd-dark";applyPreviewThemeVisual(PREVIEW_BUILTIN_THEME);','previewThemeId="sd-classic";applyPreviewThemeVisual(PREVIEW_BUILTIN_THEME);');
s=s.replaceAll('applyPreviewTheme("sd-dark")','applyPreviewTheme("sd-classic")');
s=rep(s,'  preview.view = next;\n  state.activeTab = next === "library" ? "installed" : next === "themes" ? "store" : next;','  preview.view = next;\n  document.body.dataset.previewView = next;\n  state.activeTab = next === "library" ? "installed" : next === "themes" ? "store" : next;','view dataset');
write(p.js,s);

s=read(p.css);
const block=`

/* v0.17 테마 엔진: 모든 테마는 사이드바 구조를 바꾸지 않고 아주 약한 포인트 색만 공유합니다. */
body.ui-preview-mode[data-center-theme] .preview-sidebar{
  background:linear-gradient(180deg,var(--preview-theme-sidebar-tint,transparent),rgba(19,21,24,0) 72%),#131518;
}
body.ui-preview-mode[data-center-theme] .preview-nav.active{
  box-shadow:inset 2px 0 0 color-mix(in srgb,var(--preview-theme-sidebar-accent,#e9eef7) 42%,transparent);
}

/* UI Preview v0.17: SD Classic — 기존 홈 구조를 유지한 채 초기 SD 색감과 아주 약한 지갑 오마주를 적용합니다. */
body.ui-preview-mode[data-center-theme="sd-classic"]{
  --preview-theme-classic-blue:#546dff;
  --preview-theme-classic-indigo:#6b63ff;
  --preview-theme-classic-violet:#8156df;
}
body.ui-preview-mode[data-center-theme="sd-classic"] .preview-sidebar{
  background:
    linear-gradient(180deg,rgba(76,93,218,.11) 0%,rgba(74,67,161,.065) 42%,rgba(19,21,24,.98) 100%),
    #131518;
  border-right-color:rgba(111,126,230,.18);
}
body.ui-preview-mode[data-center-theme="sd-classic"] .preview-nav:hover{background:rgba(82,91,180,.12);color:#e0e4ff}
body.ui-preview-mode[data-center-theme="sd-classic"] .preview-nav.active{
  color:#f7f8ff;
  background:linear-gradient(135deg,rgba(80,100,224,.24),rgba(111,72,189,.15));
  box-shadow:inset 2px 0 0 color-mix(in srgb,var(--preview-theme-sidebar-accent,#8a91ff) 68%,transparent);
}
body.ui-preview-mode[data-center-theme="sd-classic"] .preview-nav>i{background:#7887ff;color:#0d1225}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] .preview-main{
  position:relative;isolation:isolate;
  background:
    radial-gradient(circle at 86% 16%,rgba(76,105,255,.19),transparent 31%),
    radial-gradient(circle at 79% 73%,rgba(126,76,218,.13),transparent 38%),
    linear-gradient(132deg,#0a0e19 0%,#0d1324 38%,#11162b 68%,#130f27 100%);
}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] .preview-main::before{
  content:"";position:absolute;z-index:-2;pointer-events:none;inset:0;opacity:.38;
  background-image:
    linear-gradient(rgba(119,137,255,.026) 1px,transparent 1px),
    linear-gradient(90deg,rgba(119,137,255,.021) 1px,transparent 1px),
    radial-gradient(circle at 74% 38%,rgba(89,110,255,.12),transparent 24%);
  background-size:46px 46px,46px 46px,auto;
  mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.18) 42%,#000 68%,#000 100%);
}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] .preview-main::after{
  content:"";position:absolute;z-index:-1;pointer-events:none;
  width:min(31vw,390px);aspect-ratio:1.72;right:5.5%;top:118px;
  border:1px solid rgba(126,143,255,.085);border-radius:24px;
  background:linear-gradient(145deg,rgba(93,114,255,.027),rgba(115,69,190,.018));
  box-shadow:26px 20px 0 -1px rgba(115,106,241,.024),26px 20px 0 0 rgba(129,123,255,.045),50px 39px 0 -1px rgba(116,70,187,.016),50px 39px 0 0 rgba(123,89,212,.03),0 24px 70px rgba(80,91,230,.035);
  transform:rotate(-5deg);opacity:.72;
}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] #previewHomePanel{position:relative;z-index:1;background:transparent!important}
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-home-badge,
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-running-dot{background:#7887ff}
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-home-tile:hover{background:rgba(84,103,211,.10)}
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-recent-card{background:rgba(20,24,42,.82);border-color:rgba(99,111,171,.24);backdrop-filter:blur(3px)}
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-recent-card:hover{background:rgba(29,34,57,.88);border-color:rgba(113,130,218,.36)}
body.ui-preview-mode[data-center-theme="sd-classic"] #previewHomePanel .preview-recent-card::before{background:linear-gradient(90deg,#526dff,#7859df);opacity:.72}
.preview-theme-swatch.is-sd-classic{
  background:radial-gradient(circle at 84% 24%,rgba(82,108,255,.38),transparent 34%),radial-gradient(circle at 75% 82%,rgba(124,75,218,.28),transparent 41%),linear-gradient(135deg,#0a0f1d,#11162c 66%,#15102a)!important;
}
.preview-theme-swatch.is-sd-classic .preview-theme-swatch-sidebar{background:linear-gradient(180deg,rgba(76,93,218,.23),rgba(18,22,39,.92))}
.preview-theme-swatch.is-sd-classic .preview-theme-swatch-main{position:relative;overflow:hidden}
.preview-theme-swatch.is-sd-classic .preview-theme-swatch-main::after{content:"";position:absolute;width:47px;height:28px;right:7px;bottom:7px;border:1px solid rgba(133,145,255,.18);border-radius:7px;transform:rotate(-5deg);box-shadow:7px 5px 0 rgba(118,89,220,.055)}
.preview-theme-swatch.is-sd-classic .preview-theme-swatch-main i{background:rgba(35,42,72,.72)}
.preview-theme-swatch.is-sd-classic .preview-theme-swatch-main i:first-child{background:linear-gradient(90deg,#5872ff,#7e5adf)}
@media(max-width:720px){body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] .preview-main::after{width:270px;right:-80px;top:155px;opacity:.45}}
@media(prefers-reduced-motion:reduce){body.ui-preview-mode[data-center-theme="sd-classic"] .preview-sidebar,body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="home"] .preview-main{background-attachment:initial}}
`;
if(s.includes('UI Preview v0.17: SD Classic'))throw new Error('v0.17 CSS already applied');
s+=block;
write(p.css,s);
console.log('UI Preview v0.17 SD Classic theme patch applied');
