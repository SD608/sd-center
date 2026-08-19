const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root) throw new Error('Usage: node patch-center-ui-v013.js <app-root>');
const htmlPath = path.join(root, 'public', 'index.html');
const jsPath = path.join(root, 'public', 'js', 'ui-preview.js');
const cssPath = path.join(root, 'public', 'css', 'ui-preview.css');
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.writeFileSync(p,s,'utf8'); }
function replaceOnce(text, from, to, label){
  if (!text.includes(from)) throw new Error(`v0.13 marker missing: ${label}`);
  return text.replace(from,to);
}
let html = read(htmlPath);
html = replaceOnce(html,
`        <div id="previewHomeStats" class="preview-home-stats" aria-label="홈 상태 요약"></div>\n\n        <section id="previewFavoriteSection" class="preview-section hidden">`,
`        <section id="previewThemeHomeStage" class="preview-theme-home-stage" aria-label="현재 테마 홈 데크">\n          <div class="preview-theme-home-copy">\n            <span id="previewThemeHomeEyebrow" class="preview-theme-home-eyebrow">SD SYSTEM</span>\n            <h2 id="previewThemeHomeTitle">SD종합센터</h2>\n            <p id="previewThemeHomeDescription">앱과 폴더를 한 화면에서 관리하는 데스크톱 런처입니다.</p>\n            <div class="preview-theme-home-actions">\n              <button class="preview-button preview-theme-home-primary" type="button" data-preview-theme-shortcut="library">라이브러리 열기</button>\n              <button class="preview-button" type="button" data-preview-theme-shortcut="themes">테마 변경</button>\n            </div>\n          </div>\n          <div class="preview-theme-home-scene" aria-hidden="true">\n            <span class="preview-theme-scene-primary"></span>\n            <span class="preview-theme-scene-secondary"></span>\n            <span class="preview-theme-scene-detail"></span>\n            <b id="previewThemeSceneLabel">SYSTEM DECK // READY</b>\n          </div>\n          <div id="previewHomeStats" class="preview-home-stats" aria-label="홈 상태 요약"></div>\n        </section>\n\n        <section id="previewFavoriteSection" class="preview-section hidden">`, 'home deck html');
html = replaceOnce(html, 'UI Preview v0.12', 'UI Preview v0.13', 'preview version html');
write(htmlPath, html);

let js = read(jsPath);
js = replaceOnce(js, '// UI Preview v0.12: 종합센터 테마 상점.', '// UI Preview v0.12: 종합센터 테마 상점.\n// UI Preview v0.13: 테마가 홈의 빈 공간을 실제 장면/정보 데크로 채우도록 확장.', 'v013 js header');
js = replaceOnce(js,
`const PREVIEW_THEMES = [\n  {id:"sd-dark",name:"SD Dark",price:"기본 제공",tag:"STANDARD",description:"종합센터 기본 다크 테마. 가장 중립적인 데스크톱 런처 스타일입니다.",bg:"#111214",chrome:"#131518",panel:"#24282e",accent:"#e9eef7"},\n  {id:"logistics",name:"물류센터 · 차고",price:"출시 무료",tag:"LOGISTICS",description:"철판과 작업등을 연상시키는 스틸·앰버 계열 차고 테마입니다.",bg:"#101214",chrome:"#171715",panel:"#292720",accent:"#e1aa4b"},\n  {id:"flea",name:"플리마켓 · 창고",price:"출시 무료",tag:"FLEA MARKET",description:"창고와 시장의 분위기를 살린 딥그린 계열 테마입니다.",bg:"#101512",chrome:"#131a15",panel:"#223028",accent:"#91d17d"},\n  {id:"miner",name:"광부 · 작업장",price:"출시 무료",tag:"MINER",description:"광산 작업장과 광석을 표현한 차콜·골드 계열 테마입니다.",bg:"#111210",chrome:"#161713",panel:"#2a291f",accent:"#dfbb55"},\n  {id:"casino",name:"카지노 · 네온",price:"출시 무료",tag:"CASINO",description:"어두운 로비에 네온 포인트를 더한 퍼플 계열 테마입니다.",bg:"#120f16",chrome:"#17121b",panel:"#2b2031",accent:"#d37bff"},\n  {id:"vault",name:"금고 · 메탈",price:"출시 무료",tag:"VAULT",description:"금속 금고실을 표현한 스틸·브라스 계열 테마입니다.",bg:"#101214",chrome:"#14171a",panel:"#262c31",accent:"#d5b875"},\n];`,
`const PREVIEW_THEMES = [\n  {id:"sd-dark",name:"SD Dark",price:"기본 제공",tag:"STANDARD",description:"종합센터 기본 다크 테마. 가장 중립적인 데스크톱 런처 스타일입니다.",bg:"#111214",chrome:"#131518",panel:"#24282e",accent:"#e9eef7",homeEyebrow:"SD SYSTEM",homeTitle:"CONTROL DECK",homeDescription:"앱, 최근 실행, 업데이트 상태를 하나의 시스템 데크에서 확인합니다.",sceneLabel:"SYSTEM DECK // READY"},\n  {id:"logistics",name:"물류센터 · 차고",price:"출시 무료",tag:"LOGISTICS",description:"철판과 작업등을 연상시키는 스틸·앰버 계열 차고 테마입니다.",bg:"#101214",chrome:"#171715",panel:"#292720",accent:"#e1aa4b",homeEyebrow:"SD LOGISTICS",homeTitle:"GARAGE CONTROL",homeDescription:"차고 셔터와 배차 보드가 홈 화면을 채우는 물류 운영실 테마입니다.",sceneLabel:"BAY 04 // STANDBY"},\n  {id:"flea",name:"플리마켓 · 창고",price:"출시 무료",tag:"FLEA MARKET",description:"창고와 시장의 분위기를 살린 딥그린 계열 테마입니다.",bg:"#101512",chrome:"#131a15",panel:"#223028",accent:"#91d17d",homeEyebrow:"SD FLEA MARKET",homeTitle:"WAREHOUSE FLOOR",homeDescription:"선반, 적재함, 거래 표식이 보이는 창고형 홈 데크입니다.",sceneLabel:"ZONE B // OPEN"},\n  {id:"miner",name:"광부 · 작업장",price:"출시 무료",tag:"MINER",description:"광산 작업장과 광석을 표현한 차콜·골드 계열 테마입니다.",bg:"#111210",chrome:"#161713",panel:"#2a291f",accent:"#dfbb55",homeEyebrow:"SD MINER",homeTitle:"SHAFT WORKSHOP",homeDescription:"갱도 지지대와 광석 신호가 홈의 배경을 구성하는 작업장 테마입니다.",sceneLabel:"SHAFT 07 // ACTIVE"},\n  {id:"casino",name:"카지노 · 네온",price:"출시 무료",tag:"CASINO",description:"어두운 로비에 네온 포인트를 더한 퍼플 계열 테마입니다.",bg:"#120f16",chrome:"#17121b",panel:"#2b2031",accent:"#d37bff",homeEyebrow:"SD CASINO",homeTitle:"NEON LOBBY",homeDescription:"네온 링과 라이트 바가 홈 공간을 채우는 야간 카지노 로비 테마입니다.",sceneLabel:"LOBBY // OPEN 24H"},\n  {id:"vault",name:"금고 · 메탈",price:"출시 무료",tag:"VAULT",description:"금속 금고실을 표현한 스틸·브라스 계열 테마입니다.",bg:"#101214",chrome:"#14171a",panel:"#262c31",accent:"#d5b875",homeEyebrow:"SD VAULT",homeTitle:"SECURE CHAMBER",homeDescription:"금고문과 보안 패널이 홈의 여백을 채우는 메탈 금고실 테마입니다.",sceneLabel:"VAULT 01 // SECURED"},\n];`, 'theme metadata');
js = replaceOnce(js, 'function previewThemeById(id){return PREVIEW_THEMES.find((theme)=>theme.id===id)||PREVIEW_THEMES[0];}\n', `function previewThemeById(id){return PREVIEW_THEMES.find((theme)=>theme.id===id)||PREVIEW_THEMES[0];}\nfunction renderPreviewThemeHomeDeck(){\n  const theme=previewThemeById(previewThemeId);\n  const eyebrow=document.getElementById("previewThemeHomeEyebrow");\n  const title=document.getElementById("previewThemeHomeTitle");\n  const description=document.getElementById("previewThemeHomeDescription");\n  const label=document.getElementById("previewThemeSceneLabel");\n  if(eyebrow)eyebrow.textContent=theme.homeEyebrow||theme.tag;\n  if(title)title.textContent=theme.homeTitle||theme.name;\n  if(description)description.textContent=theme.homeDescription||theme.description;\n  if(label)label.textContent=theme.sceneLabel||\`${theme.tag} // READY\`;\n}\n`, 'home deck renderer');
js = replaceOnce(js, `  previewThemeId=previewThemeById(saved).id;\n  document.body.dataset.previewTheme=previewThemeId;\n}`, `  previewThemeId=previewThemeById(saved).id;\n  document.body.dataset.previewTheme=previewThemeId;\n  renderPreviewThemeHomeDeck();\n}`, 'load home deck');
js = replaceOnce(js, `  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  if(toast)showToast(\`${theme.name} 테마를 적용했습니다.\`);`, `  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  renderPreviewThemeHomeDeck();\n  if(toast)showToast(\`${theme.name} 테마를 적용했습니다.\`);`, 'apply home deck');
js = replaceOnce(js, `function renderPreviewHomeOverview() {\n  const registered = state.apps.length;`, `function renderPreviewHomeOverview() {\n  renderPreviewThemeHomeDeck();\n  const registered = state.apps.length;`, 'home overview refresh');
js += `\n// UI Preview v0.13: 테마 홈 데크 바로가기.\ndocument.getElementById("previewThemeHomeStage")?.addEventListener("click",(event)=>{\n  const button=event.target.closest("[data-preview-theme-shortcut]");\n  if(!button)return;\n  const target=button.dataset.previewThemeShortcut;\n  if(target==="library"||target==="themes")setPreviewView(target);\n});\n`;
write(jsPath, js);

let css = read(cssPath);
css += String.raw`

/* UI Preview v0.13: 테마가 홈의 빈 공간을 채우는 장면형 홈 데크 */
.preview-theme-home-stage{
  position:relative;min-height:272px;margin:0 0 27px;padding:22px 22px 0;border:1px solid var(--preview-line);border-radius:12px;
  overflow:hidden;background:var(--theme-card,#17191c);display:grid;grid-template-columns:minmax(300px,1.05fr) minmax(300px,.95fr);grid-template-rows:minmax(170px,1fr) auto;gap:12px 28px;
  box-shadow:0 14px 38px rgba(0,0,0,.16)
}
.preview-theme-home-stage::before{position:absolute;inset:0;content:"";pointer-events:none;opacity:.75;background:linear-gradient(105deg,color-mix(in srgb,var(--theme-accent,#e9eef7) 7%,transparent),transparent 38%,rgba(255,255,255,.018))}
.preview-theme-home-stage::after{position:absolute;left:0;right:0;bottom:64px;height:1px;content:"";background:var(--preview-line)}
.preview-theme-home-copy{position:relative;z-index:2;min-width:0;align-self:center;padding:5px 0 20px}
.preview-theme-home-eyebrow{display:inline-flex;align-items:center;gap:7px;color:var(--theme-accent,#e9eef7);font-size:9px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
.preview-theme-home-eyebrow::before{width:18px;height:2px;content:"";background:var(--theme-accent,#e9eef7)}
.preview-theme-home-copy h2{margin:10px 0 7px;font-size:31px;line-height:1;letter-spacing:-.055em}
.preview-theme-home-copy p{max-width:510px;margin:0;color:var(--preview-muted);font-size:11px;line-height:1.65}
.preview-theme-home-actions{display:flex;gap:7px;margin-top:18px}
.preview-theme-home-primary{border-color:var(--theme-accent,#e9eef7);background:var(--theme-accent,#e9eef7);color:var(--theme-accent-text,#101215)}
.preview-theme-home-primary:hover{filter:brightness(1.08);background:var(--theme-accent,#e9eef7);border-color:var(--theme-accent,#e9eef7)}
.preview-theme-home-scene{position:relative;z-index:1;min-height:176px;align-self:stretch;margin:-4px -2px 8px 0;overflow:hidden;border-left:1px solid color-mix(in srgb,var(--preview-line) 74%,transparent)}
.preview-theme-home-scene>span{position:absolute;display:block}
.preview-theme-home-scene>b{position:absolute;right:13px;bottom:10px;color:color-mix(in srgb,var(--theme-accent,#e9eef7) 86%,#fff);font-size:8px;letter-spacing:.14em;opacity:.84}
.preview-theme-scene-primary{inset:14px 12px 28px 34px;border:1px solid var(--preview-line-strong);background:color-mix(in srgb,var(--theme-icon,#24282e) 82%,transparent)}
.preview-theme-scene-secondary{right:26px;top:28px;width:82px;height:82px;border:1px solid var(--theme-accent,#e9eef7);opacity:.7}
.preview-theme-scene-detail{left:50px;bottom:44px;width:110px;height:6px;background:var(--theme-accent,#e9eef7);opacity:.75}
.preview-theme-home-stage .preview-home-stats{position:relative;z-index:2;grid-column:1/-1;margin:0 -22px;gap:0;background:color-mix(in srgb,var(--theme-chrome,#131518) 82%,transparent)}
.preview-theme-home-stage .preview-home-stat{min-height:64px;padding:10px 22px;border:0;border-right:1px solid var(--preview-line);border-radius:0;background:transparent}
.preview-theme-home-stage .preview-home-stat:last-child{border-right:0}
.preview-theme-home-stage .preview-home-stat span{font-size:8px;letter-spacing:.04em;text-transform:uppercase}
.preview-theme-home-stage .preview-home-stat strong{font-size:16px}

body[data-preview-theme="sd-dark"] .preview-theme-home-scene{background:linear-gradient(90deg,transparent 0 24px,rgba(255,255,255,.025) 24px 25px,transparent 25px 49px),linear-gradient(transparent 0 24px,rgba(255,255,255,.025) 24px 25px,transparent 25px 49px);background-size:50px 50px}
body[data-preview-theme="sd-dark"] .preview-theme-scene-primary{clip-path:polygon(0 0,92% 0,100% 13%,100% 100%,8% 100%,0 87%)}
body[data-preview-theme="sd-dark"] .preview-theme-scene-secondary{border-radius:50%;box-shadow:0 0 0 12px rgba(255,255,255,.025),0 0 0 25px rgba(255,255,255,.016)}

body[data-preview-theme="logistics"] .preview-theme-home-stage{background:linear-gradient(115deg,#1c1b18 0 43%,#151513 43% 100%)}
body[data-preview-theme="logistics"] .preview-theme-home-scene::before{position:absolute;left:34px;right:16px;top:14px;bottom:28px;content:"";border:1px solid #5b513f;background:repeating-linear-gradient(0deg,#25231e 0 12px,#343027 12px 14px);box-shadow:inset 22px 0 0 rgba(0,0,0,.18)}
body[data-preview-theme="logistics"] .preview-theme-home-scene::after{position:absolute;left:50px;top:28px;width:9px;height:93px;content:"";background:repeating-linear-gradient(135deg,#e1aa4b 0 8px,#2c2418 8px 16px);opacity:.8}
body[data-preview-theme="logistics"] .preview-theme-scene-primary{display:none}
body[data-preview-theme="logistics"] .preview-theme-scene-secondary{right:35px;top:30px;width:52px;height:30px;border:1px solid #e1aa4b;border-radius:4px;background:#1c1a15;box-shadow:0 0 18px rgba(225,170,75,.18)}
body[data-preview-theme="logistics"] .preview-theme-scene-detail{left:auto;right:36px;bottom:50px;width:116px;height:4px;box-shadow:0 10px 0 #4a4131,0 20px 0 #4a4131}

body[data-preview-theme="flea"] .preview-theme-home-scene::before{position:absolute;inset:18px 20px 32px 36px;content:"";background:repeating-linear-gradient(0deg,transparent 0 35px,#46604e 35px 37px),repeating-linear-gradient(90deg,#24362b 0 66px,#324a39 66px 69px);border:1px solid #46604e}
body[data-preview-theme="flea"] .preview-theme-scene-primary{left:58px;top:39px;width:72px;height:46px;inset:auto;border:1px solid #62866a;background:#283b2e;box-shadow:82px 18px 0 -1px #213429,82px 18px 0 0 #62866a,164px -4px 0 -1px #213429,164px -4px 0 0 #62866a}
body[data-preview-theme="flea"] .preview-theme-scene-secondary{right:31px;top:24px;width:58px;height:18px;border:1px solid #91d17d;border-radius:2px;background:#17241b}
body[data-preview-theme="flea"] .preview-theme-scene-detail{left:47px;bottom:43px;width:90px;height:5px;box-shadow:105px 0 0 #91d17d}

body[data-preview-theme="miner"] .preview-theme-home-scene::before{position:absolute;left:42px;right:18px;top:12px;bottom:30px;content:"";clip-path:polygon(17% 0,83% 0,100% 100%,0 100%);background:linear-gradient(90deg,#2a291f,#171813 24% 76%,#2a291f);border-bottom:2px solid #65583a}
body[data-preview-theme="miner"] .preview-theme-home-scene::after{position:absolute;left:89px;right:63px;top:28px;height:100px;content:"";border-left:4px solid #65583a;border-right:4px solid #65583a;box-shadow:inset 0 4px 0 #65583a}
body[data-preview-theme="miner"] .preview-theme-scene-primary{left:113px;top:64px;width:26px;height:19px;inset:auto;border:0;border-radius:48% 52% 44% 56%;background:#dfbb55;box-shadow:54px 28px 0 -7px #af8737,101px -8px 0 -10px #f0d36e,0 0 24px rgba(223,187,85,.24)}
body[data-preview-theme="miner"] .preview-theme-scene-secondary{display:none}
body[data-preview-theme="miner"] .preview-theme-scene-detail{left:74px;bottom:43px;width:150px;height:3px;background:#65583a}

body[data-preview-theme="casino"] .preview-theme-home-stage{background:radial-gradient(circle at 76% 30%,rgba(211,123,255,.12),transparent 30%),linear-gradient(120deg,#1d1722,#120f16)}
body[data-preview-theme="casino"] .preview-theme-home-scene-primary{left:96px;top:24px;width:112px;height:112px;inset:auto;border:2px solid #d37bff;border-radius:50%;background:transparent;box-shadow:0 0 22px rgba(211,123,255,.24),inset 0 0 18px rgba(211,123,255,.12)}
body[data-preview-theme="casino"] .preview-theme-home-scene-primary::after{position:absolute;inset:24px;content:"";border:1px solid #6d4ef1;border-radius:50%;box-shadow:0 0 18px rgba(109,78,241,.24)}
body[data-preview-theme="casino"] .preview-theme-scene-secondary{right:40px;top:34px;width:88px;height:7px;border:0;border-radius:8px;background:#6d4ef1;box-shadow:0 0 14px rgba(109,78,241,.55),0 18px 0 #d37bff,0 18px 14px rgba(211,123,255,.35)}
body[data-preview-theme="casino"] .preview-theme-scene-detail{left:48px;bottom:44px;width:34px;height:34px;border-radius:50%;background:#d37bff;box-shadow:0 0 20px rgba(211,123,255,.38),182px -2px 0 -9px #6d4ef1}

body[data-preview-theme="vault"] .preview-theme-home-scene::before{position:absolute;left:76px;top:15px;width:130px;height:130px;content:"";border:7px solid #4f5962;border-radius:50%;background:radial-gradient(circle,#171a1d 0 22%,#d5b875 23% 25%,#2a3035 26% 47%,#15181b 48% 100%);box-shadow:inset 0 0 0 2px #777067,0 0 0 1px #181a1d}
body[data-preview-theme="vault"] .preview-theme-home-scene::after{position:absolute;left:137px;top:34px;width:8px;height:92px;content:"";background:#777067;box-shadow:0 0 0 1px #23272a;transform:rotate(45deg);transform-origin:center}
body[data-preview-theme="vault"] .preview-theme-scene-primary{left:137px;top:34px;width:8px;height:92px;inset:auto;border:0;background:#777067;transform:rotate(-45deg);transform-origin:center}
body[data-preview-theme="vault"] .preview-theme-scene-secondary{right:31px;top:32px;width:82px;height:48px;border:1px solid #5b6268;border-radius:4px;background:repeating-linear-gradient(0deg,#23282d 0 7px,#2c3237 7px 8px)}
body[data-preview-theme="vault"] .preview-theme-scene-detail{left:auto;right:50px;bottom:47px;width:44px;height:5px;background:#d5b875;box-shadow:0 10px 0 #5b6268}

@media(max-width:900px){
  .preview-theme-home-stage{grid-template-columns:1fr;grid-template-rows:auto 150px auto;padding-top:18px}
  .preview-theme-home-scene{border-left:0;border-top:1px solid var(--preview-line);margin:0 -4px}
  .preview-theme-home-stage .preview-home-stats{grid-column:1;margin:0 -22px}
  .preview-theme-home-stage::after{bottom:64px}
}
@media(max-width:620px){
  .preview-theme-home-stage{padding-left:16px;padding-right:16px;border-radius:9px}
  .preview-theme-home-copy h2{font-size:25px}
  .preview-theme-home-actions{flex-wrap:wrap}
  .preview-theme-home-stage .preview-home-stats{margin-left:-16px;margin-right:-16px;grid-template-columns:repeat(2,minmax(0,1fr))}
  .preview-theme-home-stage .preview-home-stat{border-bottom:1px solid var(--preview-line)}
  .preview-theme-home-stage::after{display:none}
}
@media(prefers-reduced-motion:reduce){.preview-theme-home-stage,.preview-theme-home-scene>*{transition:none!important}}
`;
write(cssPath, css);
console.log('UI Preview v0.13 theme home deck patch applied');
