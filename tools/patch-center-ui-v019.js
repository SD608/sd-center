const fs=require('fs'),path=require('path');
const root=process.argv[2]; if(!root)throw new Error('Usage: node patch-center-ui-v019.js <app-root>');
const htmlPath=path.join(root,'public','index.html');
const cssPath=path.join(root,'public','css','ui-preview.css');
const read=x=>fs.readFileSync(x,'utf8'),write=(x,s)=>fs.writeFileSync(x,s,'utf8');
function rep(s,a,b,n){if(!s.includes(a))throw new Error(`v0.19 marker missing: ${n}`);return s.replace(a,b)}

let s=read(htmlPath);
s=s.replaceAll('UI Preview v0.18','UI Preview v0.19');
s=rep(s,
`      <button class="preview-nav" type="button" data-preview-view="removed"><span>□</span><b>보관함</b><i id="removedTabCount">0</i></button>
      <div class="preview-nav-spacer"></div>
      <button id="previewAddAppNav" class="preview-nav" type="button"><span>⇧</span><b>ZIP 추가</b></button>
      <button class="preview-nav preview-theme-nav-last" type="button" data-preview-view="themes"><span>◈</span><b>테마 상점</b></button>`,
`      <button class="preview-nav" type="button" data-preview-view="removed"><span>□</span><b>보관함</b><i id="removedTabCount">0</i></button>
      <button class="preview-nav preview-theme-nav-after-archive" type="button" data-preview-view="themes"><span>◈</span><b>테마 상점</b></button>
      <div class="preview-nav-spacer"></div>
      <button id="previewAddAppNav" class="preview-nav" type="button"><span>⇧</span><b>ZIP 추가</b></button>`,
'archive -> theme store -> spacer -> ZIP order');
write(htmlPath,s);

s=read(cssPath);
s=s.replaceAll('.preview-theme-nav-last','.preview-theme-nav-after-archive');
if(!s.includes('UI Preview v0.19: 테마 상점은 보관함 바로 아래')){
  s+=`\n/* UI Preview v0.19: 테마 상점은 보관함 바로 아래에 배치하고 ZIP 추가는 하단 분리 위치를 유지합니다. */\n`;
}
write(cssPath,s);
console.log('UI Preview v0.19 sidebar order correction applied');
