const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root) throw new Error('Usage: node patch-center-ui-v015.js <app-root>');
const htmlPath = path.join(root,'public','index.html');
const jsPath = path.join(root,'public','js','ui-preview.js');
const cssPath = path.join(root,'public','css','ui-preview.css');
function read(p){return fs.readFileSync(p,'utf8');}
function write(p,s){fs.writeFileSync(p,s,'utf8');}
function mustReplace(text, from, to, label){
  if(!text.includes(from)) throw new Error(`v0.15 marker missing: ${label}`);
  return text.replace(from,to);
}
// Historical v0.13/v0.14 artifacts contain two semantically equivalent toast forms.
// Accept either shape so reconstruction follows the actual artifact instead of a stale draft marker.
function mustReplaceAny(text, variants, to, label){
  for(const from of variants){
    if(text.includes(from)) return text.replace(from,to);
  }
  throw new Error(`v0.15 marker missing: ${label}`);
}
let html = read(htmlPath);
html = mustReplace(html,
  '<button class="preview-nav" type="button" data-preview-view="themes"><span>◈</span><b>테마</b></button>',
  '<button class="preview-nav" type="button" data-preview-view="themes"><span>◈</span><b>테마 상점</b></button>',
  'theme sidebar label');
const stageStart = html.indexOf('        <section id="previewThemeHomeStage"');
const favStart = html.indexOf('        <section id="previewFavoriteSection"', stageStart);
if(stageStart < 0 || favStart < 0) throw new Error('v0.15 home theme stage markers missing');
html = html.slice(0,stageStart) + '        <div id="previewHomeStats" class="preview-home-stats" aria-label="홈 상태 요약"></div>\n\n' + html.slice(favStart);
html = mustReplace(html,
  '<strong>종합센터 UI와 동시 출시</strong>\n            <p>출시 테마는 무료로 제공합니다. 유료 테마 결제는 SD Core 공용 결제 API가 준비된 뒤 이 상점에 그대로 연결합니다.</p>',
  '<strong>종합센터 내장 테마 상점</strong>\n            <p>테마 상점은 종합센터 자체 기능입니다. 앞으로 새 테마는 종합센터 앱을 매번 업데이트하지 않고 별도 테마 카탈로그에 업로드해 순차적으로 추가하는 구조를 목표로 합니다.</p>',
  'theme store note');
html = html.replace('UI Preview v0.14','UI Preview v0.15');
write(htmlPath,html);

let js = read(jsPath);
js = js.replace('// UI Preview v0.14: 테마 상태 초기화 전 홈 렌더가 실행될 때 발생하던 TDZ 초기화 오류 수정.', '// UI Preview v0.14: 테마 상태 초기화 전 홈 렌더가 실행될 때 발생하던 TDZ 초기화 오류 수정.\n// UI Preview v0.15: 테마 상점을 시스템 사이드바 전용으로 정리하고 테마 적용 범위를 홈 화면으로 한정.');
const rendererStart = js.indexOf('function renderPreviewThemeHomeDeck(){');
const loadStart = js.indexOf('function loadPreviewTheme(){', rendererStart);
if(rendererStart < 0 || loadStart < 0) throw new Error('v0.15 theme home renderer markers missing');
js = js.slice(0,rendererStart) + js.slice(loadStart);
js = mustReplace(js,
`function loadPreviewTheme(){\n  let saved="sd-dark";\n  try{saved=String(localStorage.getItem(PREVIEW_THEME_KEY)||"sd-dark");}catch{}\n  previewThemeId=previewThemeById(saved).id;\n  document.body.dataset.previewTheme=previewThemeId;\n  renderPreviewThemeHomeDeck();\n}`,
`function previewThemeHomeTarget(){return document.getElementById("previewHomePanel");}\nfunction loadPreviewTheme(){\n  let saved="sd-dark";\n  try{saved=String(localStorage.getItem(PREVIEW_THEME_KEY)||"sd-dark");}catch{}\n  previewThemeId=previewThemeById(saved).id;\n  const home=previewThemeHomeTarget();\n  if(home)home.dataset.previewTheme=previewThemeId;\n}`,
'load theme home only');
js = mustReplaceAny(js,
[
`function applyPreviewTheme(id,{toast=true}={}){\n  const theme=previewThemeById(id);\n  previewThemeId=theme.id;\n  document.body.dataset.previewTheme=theme.id;\n  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  renderPreviewThemeHomeDeck();\n  if(toast)showToast(\`\${theme.name} 테마를 적용했습니다.\`);\n}`,
`function applyPreviewTheme(id,{toast=true}={}){\n  const theme=previewThemeById(id);\n  previewThemeId=theme.id;\n  document.body.dataset.previewTheme=theme.id;\n  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  renderPreviewThemeHomeDeck();\n  if(toast)showToast(theme.name+" 테마를 적용했습니다.");\n}`
],
`function applyPreviewTheme(id,{toast=true}={}){\n  const theme=previewThemeById(id);\n  previewThemeId=theme.id;\n  const home=previewThemeHomeTarget();\n  if(home)home.dataset.previewTheme=theme.id;\n  try{localStorage.setItem(PREVIEW_THEME_KEY,theme.id);}catch{}\n  renderPreviewThemeStore();\n  if(toast)showToast(theme.name+" 홈 테마를 적용했습니다.");\n}`,
'apply theme home only');
const shortcutMarker = '// UI Preview v0.13: 테마 홈 데크 바로가기.';
const shortcutStart = js.indexOf(shortcutMarker);
if(shortcutStart < 0) throw new Error('v0.15 home shortcut marker missing');
js = js.slice(0,shortcutStart).trimEnd() + '\n';
write(jsPath,js);

let css = read(cssPath);
// Scope v0.12 theme variables and effects to the home panel only.
css = css.replaceAll('body[data-preview-theme=', '#previewHomePanel[data-preview-theme=');
css = css.replaceAll('body[data-preview-theme] ', '#previewHomePanel[data-preview-theme] ');
css = css.replaceAll('.ui-preview-mode[data-preview-theme] .store-card', '#previewHomePanel[data-preview-theme] .store-card');
// Remove the v0.13/v0.14 home deck CSS entirely; the home returns to its original structure.
const cssStageStart = css.indexOf('/* UI Preview v0.13: 테마가 홈의 빈 공간을 채우는 장면형 홈 데크 */');
if(cssStageStart < 0) throw new Error('v0.15 home deck CSS marker missing');
css = css.slice(0,cssStageStart).trimEnd() + `\n\n/* UI Preview v0.15: 테마는 기존 홈 구조만 꾸미며, 상점 진입은 사이드바에만 둡니다. */\n#previewHomePanel[data-preview-theme]{min-height:100%;border-radius:0}\n`;
write(cssPath,css);
console.log('UI Preview v0.15 theme store shell patch applied');