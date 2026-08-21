const fs=require('fs'),path=require('path');
const root=process.argv[2]; if(!root)throw new Error('Usage: node patch-center-ui-v018.js <app-root>');
const p={html:path.join(root,'public','index.html'),js:path.join(root,'public','js','ui-preview.js'),css:path.join(root,'public','css','ui-preview.css'),catalog:path.join(root,'src','theme-catalog.js')};
const read=x=>fs.readFileSync(x,'utf8'),write=(x,s)=>fs.writeFileSync(x,s,'utf8');
function rep(s,a,b,n){if(!s.includes(a))throw new Error(`v0.18 marker missing: ${n}`);return s.replace(a,b)}

let s=read(p.html);
s=s.replaceAll('UI Preview v0.17','UI Preview v0.18');
s=rep(s,
`      <button class="preview-nav" type="button" data-preview-view="store"><span>＋</span><b>상점</b><i id="storeTabCount">0</i></button>
      <button class="preview-nav" type="button" data-preview-view="themes"><span>◈</span><b>테마 상점</b></button>
      <button class="preview-nav" type="button" data-preview-view="updates"><span>↻</span><b>업데이트</b><i id="previewUpdateNavCount" class="hidden">0</i></button>
      <button class="preview-nav" type="button" data-preview-view="removed"><span>□</span><b>보관함</b><i id="removedTabCount">0</i></button>
      <div class="preview-nav-spacer"></div>
      <button id="previewAddAppNav" class="preview-nav" type="button"><span>⇧</span><b>ZIP 추가</b></button>`,
`      <button class="preview-nav" type="button" data-preview-view="store"><span>＋</span><b>상점</b><i id="storeTabCount">0</i></button>
      <button class="preview-nav" type="button" data-preview-view="updates"><span>↻</span><b>업데이트</b><i id="previewUpdateNavCount" class="hidden">0</i></button>
      <button class="preview-nav" type="button" data-preview-view="removed"><span>□</span><b>보관함</b><i id="removedTabCount">0</i></button>
      <div class="preview-nav-spacer"></div>
      <button id="previewAddAppNav" class="preview-nav" type="button"><span>⇧</span><b>ZIP 추가</b></button>
      <button class="preview-nav preview-theme-nav-last" type="button" data-preview-view="themes"><span>◈</span><b>테마 상점</b></button>`,
'sidebar theme nav last');
write(p.html,s);

s=read(p.catalog);
s=rep(s,'const MAX_THEMES = 100;','const MAX_THEMES = 100;\nconst RETIRED_THEME_IDS = new Set(["logistics"]);','retired theme ids');
s=rep(s,'if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === "sd-dark" || id === "sd-classic" || seen.has(id)) return;','if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === "sd-dark" || id === "sd-classic" || RETIRED_THEME_IDS.has(id) || seen.has(id)) return;','retired catalog filter');
write(p.catalog,s);

s=read(p.js);
s=rep(s,'// UI Preview v0.17: 첫 기준 테마 `SD Classic`을 실제 홈/사이드바 시각 시스템으로 구현합니다.','// UI Preview v0.17: 첫 기준 테마 `SD Classic`을 실제 홈/사이드바 시각 시스템으로 구현합니다.\n// UI Preview v0.18: 홈과 일반 화면은 같은 테마의 서로 다른 배경 타입을 사용하고, 테마 상점은 중립 화면으로 분리합니다.','v018 header');
s=rep(s,'let PREVIEW_THEMES=[PREVIEW_BUILTIN_THEME];\nlet previewThemeCatalogSource="builtin";','const PREVIEW_RETIRED_THEME_IDS=new Set(["logistics"]);\nlet PREVIEW_THEMES=[PREVIEW_BUILTIN_THEME];\nlet previewThemeCatalogSource="builtin";','retired renderer ids');
s=rep(s,'if(saved==="sd-dark") saved="sd-classic"; // v0.12~v0.16 기본 테마 설정 마이그레이션','if(saved==="sd-dark"||PREVIEW_RETIRED_THEME_IDS.has(saved)) saved="sd-classic"; // 구버전/퇴역 테마 설정 마이그레이션','retired saved migration');
s=rep(s,'PREVIEW_THEMES=[PREVIEW_BUILTIN_THEME,...remote.filter(theme=>theme.id&&theme.id!=="sd-classic"&&theme.id!=="sd-dark")];','PREVIEW_THEMES=[PREVIEW_BUILTIN_THEME,...remote.filter(theme=>theme.id&&theme.id!=="sd-classic"&&theme.id!=="sd-dark"&&!PREVIEW_RETIRED_THEME_IDS.has(theme.id))];','retired remote filter');
write(p.js,s);

s=read(p.css);
if(s.includes('UI Preview v0.18: SD Classic 화면 계층'))throw new Error('v0.18 CSS already applied');
s+=`

/* UI Preview v0.18: SD Classic 화면 계층.
   홈은 대표 배경, 라이브러리/상점/업데이트/보관함은 같은 테마의 차분한 서브 배경,
   테마 상점은 테마 비교를 위해 중립 배경을 유지합니다. */
body.ui-preview-mode[data-center-theme="sd-classic"]:is([data-preview-view="library"],[data-preview-view="store"],[data-preview-view="updates"],[data-preview-view="removed"]) .preview-main{
  position:relative;isolation:isolate;
  background:radial-gradient(ellipse at 88% 7%,rgba(81,103,238,.105),transparent 34%),radial-gradient(ellipse at 22% 100%,rgba(102,70,175,.055),transparent 42%),linear-gradient(145deg,#0b0f19 0%,#0d1220 48%,#101326 100%);
}
body.ui-preview-mode[data-center-theme="sd-classic"]:is([data-preview-view="library"],[data-preview-view="store"],[data-preview-view="updates"],[data-preview-view="removed"]) .preview-main::before{
  content:"";position:absolute;z-index:-2;inset:0;pointer-events:none;opacity:.34;
  background:linear-gradient(115deg,transparent 0 58%,rgba(105,122,244,.025) 58% 59%,transparent 59% 100%),linear-gradient(rgba(113,128,232,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(113,128,232,.015) 1px,transparent 1px);
  background-size:auto,64px 64px,64px 64px;mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.25) 28%,#000 72%,rgba(0,0,0,.55) 100%);
}
body.ui-preview-mode[data-center-theme="sd-classic"]:is([data-preview-view="library"],[data-preview-view="store"],[data-preview-view="updates"],[data-preview-view="removed"]) .preview-main::after{
  content:"";position:absolute;z-index:-1;pointer-events:none;width:44%;height:150px;right:-7%;top:4%;border-radius:50%;
  background:radial-gradient(ellipse,rgba(89,103,224,.055),rgba(111,72,186,.022) 48%,transparent 72%);filter:blur(18px);
}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="themes"] .preview-main{position:relative;isolation:isolate;background:var(--preview-bg)}
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="themes"] .preview-main::before,
body.ui-preview-mode[data-center-theme="sd-classic"][data-preview-view="themes"] .preview-main::after{content:none!important}
body.ui-preview-mode[data-center-theme="sd-classic"] .preview-theme-nav-last{margin-top:0}
@media(prefers-reduced-motion:reduce){body.ui-preview-mode[data-center-theme="sd-classic"]:is([data-preview-view="library"],[data-preview-view="store"],[data-preview-view="updates"],[data-preview-view="removed"]) .preview-main::after{filter:none}}
`;
write(p.css,s);
console.log('UI Preview v0.18 background hierarchy + retired logistics patch applied');
