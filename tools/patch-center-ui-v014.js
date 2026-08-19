const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root) throw new Error('Usage: node patch-center-ui-v014.js <app-root>');
const htmlPath = path.join(root, 'public', 'index.html');
const jsPath = path.join(root, 'public', 'js', 'ui-preview.js');
const cssPath = path.join(root, 'public', 'css', 'ui-preview.css');
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.writeFileSync(p,s,'utf8'); }
function replaceOnce(text, from, to, label){
  if (!text.includes(from)) throw new Error(`v0.14 marker missing: ${label}`);
  return text.replace(from,to);
}
let js = read(jsPath);
js = replaceOnce(js,
  'function renderPreviewHomeOverview() {\n  renderPreviewThemeHomeDeck();\n  const registered = state.apps.length;',
  'function renderPreviewHomeOverview() {\n  const registered = state.apps.length;',
  'remove early theme home deck call');
js = replaceOnce(js,
  '// UI Preview v0.13: 테마가 홈의 빈 공간을 실제 장면/정보 데크로 채우도록 확장.',
  '// UI Preview v0.13: 테마가 홈의 빈 공간을 실제 장면/정보 데크로 채우도록 확장.\n// UI Preview v0.14: 테마 상태 초기화 전 홈 렌더가 실행될 때 발생하던 TDZ 초기화 오류 수정.',
  'v014 header');
write(jsPath, js);

let html = read(htmlPath);
html = replaceOnce(html, 'UI Preview v0.13', 'UI Preview v0.14', 'preview version html');
write(htmlPath, html);

let css = read(cssPath);
css += '\n\n/* UI Preview v0.14: v0.13 테마 홈 데크 초기화 오류 수정. */\n';
write(cssPath, css);

const finalJs = read(jsPath);
const decl = finalJs.indexOf('const PREVIEW_THEME_KEY');
if (decl < 0) throw new Error('v0.14 theme declaration missing');
const beforeThemeInit = finalJs.slice(0, decl);
if (beforeThemeInit.includes('renderPreviewThemeHomeDeck(') || beforeThemeInit.includes('previewThemeId')) {
  throw new Error('v0.14 pre-init theme reference remains');
}
console.log('UI Preview v0.14 theme initialization order fix applied');
