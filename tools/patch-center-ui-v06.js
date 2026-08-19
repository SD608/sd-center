"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v06.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

let html = read("public/index.html");
html = html.replaceAll("UI Preview v0.4", "UI Preview v0.6");
html = html.replaceAll("UI Preview v0.5", "UI Preview v0.6");
html = html.replace(
  '      <button id="centerUpdateButton" class="preview-hidden-control" type="button" tabindex="-1">센터 업데이트</button>\n',
  "",
);
html = html.replace(
  "설치된 앱의 업데이트 상태를 한곳에서 확인합니다.",
  "SD종합센터와 설치된 확장팩의 업데이트 상태를 한곳에서 확인합니다.",
);

if (!html.includes('id="previewHomeStats"')) {
  html = replaceOnce(
    html,
    `        <section class="preview-section">\n          <div class="preview-section-heading">\n            <h2>최근 실행</h2>`,
    `        <div id="previewHomeStats" class="preview-home-stats" aria-label="홈 상태 요약"></div>\n\n        <section id="previewFavoriteSection" class="preview-section hidden">\n          <div class="preview-section-heading">\n            <h2>즐겨찾기</h2>\n            <span>자주 쓰는 앱</span>\n          </div>\n          <div id="previewFavoriteGrid" class="preview-favorite-grid"></div>\n        </section>\n\n        <section class="preview-section">\n          <div class="preview-section-heading">\n            <h2>최근 실행</h2>`,
    "home overview insertion",
  );
}

if (!html.includes('id="previewCenterUpdateStatus"')) {
  html = replaceOnce(
    html,
    `        <div id="previewUpdateSummary" class="preview-update-summary"></div>`,
    `        <section class="preview-center-update" aria-label="SD종합센터 업데이트">\n          <div class="preview-center-update-mark">SD</div>\n          <div class="preview-center-update-copy">\n            <div class="preview-center-update-title">\n              <strong>SD종합센터</strong>\n              <span id="previewCenterCurrentVersion">현재 버전 확인 중</span>\n            </div>\n            <p id="previewCenterUpdateStatus">센터 업데이트 상태를 확인하고 있습니다.</p>\n          </div>\n          <button id="centerUpdateButton" class="preview-button preview-button-primary" type="button">센터 업데이트</button>\n        </section>\n        <div class="preview-update-section-label">확장팩 업데이트</div>\n        <div id="previewUpdateSummary" class="preview-update-summary"></div>`,
    "center update card insertion",
  );
}
write("public/index.html", html);

let css = read("public/css/ui-preview.css");
if (!css.includes(".preview-home-stats{")) {
  css += `\n\n/* UI Preview v0.6: 풍부한 홈 + 폴더 3x3 미리보기 + 센터 업데이트 */\n.preview-home-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 26px}\n.preview-home-stat{min-height:58px;padding:10px 12px;border:1px solid var(--preview-line);border-radius:7px;background:var(--preview-panel);display:flex;flex-direction:column;justify-content:center}\n.preview-home-stat span{color:var(--preview-muted);font-size:9px;font-weight:700}\n.preview-home-stat strong{margin-top:3px;font-size:15px;letter-spacing:-.02em}\n.preview-favorite-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}\n.preview-favorite-card{min-width:0;min-height:70px;padding:8px 9px;border:1px solid var(--preview-line);border-radius:7px;background:var(--preview-panel);color:inherit;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer}\n.preview-favorite-card:hover{background:var(--preview-panel-2);border-color:var(--preview-line-strong)}\n.preview-favorite-icon{width:38px;height:38px;flex:0 0 auto;border:1px solid #343a42;border-radius:9px;background:#24282e;overflow:hidden;display:grid;place-items:center}\n.preview-favorite-icon img{width:100%;height:100%;object-fit:cover}\n.preview-favorite-copy{min-width:0}\n.preview-favorite-copy strong,.preview-favorite-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.preview-favorite-copy strong{font-size:10px}\n.preview-favorite-copy span{margin-top:3px;color:var(--preview-muted);font-size:8px}\n.preview-home-folder-preview{position:relative;width:64px;height:64px;margin:0 auto 7px;padding:7px;border:1px solid #343a42;border-radius:12px;background:#23262b;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:2px;overflow:hidden}\n.preview-home-folder-preview::before{position:absolute;left:8px;top:-1px;width:24px;height:5px;content:"";border-radius:0 0 3px 3px;background:#3c424a;opacity:.85}\n.preview-folder-mini-app{min-width:0;min-height:0;border-radius:3px;background:#30353b;overflow:hidden}\n.preview-folder-mini-app img{width:100%;height:100%;display:block;object-fit:cover}\n.preview-folder-mini-empty{grid-column:1/-1;grid-row:1/-1;display:grid;place-items:center;color:#a3aab2;font-size:18px;font-weight:900}\n.preview-center-update{min-height:82px;margin:0 0 24px;padding:13px 14px;border:1px solid var(--preview-line-strong);border-radius:8px;background:var(--preview-panel);display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center}\n.preview-center-update-mark{width:42px;height:42px;border-radius:8px;background:var(--preview-accent);color:#111418;display:grid;place-items:center;font-size:13px;font-weight:950}\n.preview-center-update-copy{min-width:0}\n.preview-center-update-title{display:flex;align-items:baseline;gap:9px}\n.preview-center-update-title strong{font-size:12px}\n.preview-center-update-title span{color:var(--preview-muted);font-size:9px}\n.preview-center-update-copy p{margin:5px 0 0;color:#a1a8b0;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.preview-update-section-label{margin:0 0 8px;color:var(--preview-muted);font-size:10px;font-weight:800;letter-spacing:.03em}\n@media(max-width:1040px){.preview-favorite-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}\n@media(max-width:820px){.preview-home-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.preview-center-update{grid-template-columns:40px minmax(0,1fr)}.preview-center-update>button{grid-column:1/-1}.preview-favorite-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n`;
}
write("public/css/ui-preview.css", css);

let js = read("public/js/ui-preview.js");
js = js.replace("/* SD종합센터 UI Preview v0.5", "/* SD종합센터 UI Preview v0.6");
js = js.replace("/* SD종합센터 UI Preview v0.4", "/* SD종합센터 UI Preview v0.6");

if (!js.includes("homeStats: document.getElementById(\"previewHomeStats\")")) {
  js = replaceOnce(
    js,
    `  updateNavCount: document.getElementById("previewUpdateNavCount"),`,
    `  updateNavCount: document.getElementById("previewUpdateNavCount"),\n  homeStats: document.getElementById("previewHomeStats"),\n  favoriteSection: document.getElementById("previewFavoriteSection"),\n  favoriteGrid: document.getElementById("previewFavoriteGrid"),\n  centerUpdateStatus: document.getElementById("previewCenterUpdateStatus"),\n  centerCurrentVersion: document.getElementById("previewCenterCurrentVersion"),`,
    "preview element additions",
  );
}

if (!js.includes("function renderPreviewHomeOverview()")) {
  js = replaceOnce(
    js,
    `function renderPreviewRecent() {`,
    `function renderPreviewHomeOverview() {\n  const registered = state.apps.length;\n  const running = state.apps.filter((app) => app.running).length;\n  const favorites = state.apps.filter((app) => app.favorite);\n  const updates = state.apps.filter((app) => app.updateAvailable || app.updateRequired).length;\n\n  previewElements.homeStats.innerHTML = [\n    ["등록된 앱", registered + "개"],\n    ["실행 중", running + "개"],\n    ["즐겨찾기", favorites.length + "개"],\n    ["업데이트", updates + "개"],\n  ].map(([label, value]) => \`<div class="preview-home-stat"><span>\${label}</span><strong>\${value}</strong></div>\`).join("");\n\n  const visibleFavorites = favorites.slice(0, 6);\n  previewElements.favoriteSection.classList.toggle("hidden", visibleFavorites.length === 0);\n  previewElements.favoriteGrid.innerHTML = visibleFavorites.map((app) => \`\n    <button class="preview-favorite-card" type="button" data-preview-app="\${previewEscape(app.id)}">\n      \${appIconMarkup(app, "preview-favorite-icon")}\n      <span class="preview-favorite-copy">\n        <strong>\${previewEscape(app.name)}</strong>\n        <span>\${app.running ? '<i class="preview-running-dot"></i>실행 중' : (app.updateAvailable || app.updateRequired) ? "업데이트 있음" : previewEscape(app.version || "설치됨")}</span>\n      </span>\n    </button>\n  \`).join("");\n}\n\nfunction renderPreviewRecent() {`,
    "home overview renderer",
  );
}

if (!js.includes("function folderPreviewMarkup(item)")) {
  js = replaceOnce(
    js,
    `function homeTile(item, index) {`,
    `function folderPreviewMarkup(item) {\n  const apps = (Array.isArray(item.apps) ? item.apps : []).map(findApp).filter(Boolean).slice(0, 9);\n  if (!apps.length) {\n    return '<span class="preview-home-folder-preview"><span class="preview-folder-mini-empty">▦</span></span>';\n  }\n  return \`<span class="preview-home-folder-preview">\${apps.map((app) => \`<span class="preview-folder-mini-app">\${appIconMarkup(app)}</span>\`).join("")}</span>\`;\n}\n\nfunction homeTile(item, index) {`,
    "folder preview renderer",
  );
  js = js.replace(
    `        <span class="preview-home-icon folder">▦</span>`,
    `        \${folderPreviewMarkup(item)}`,
  );
}

if (!js.includes("renderPreviewHomeOverview();")) {
  js = replaceOnce(
    js,
    `function renderPreviewHome() {\n  syncPreviewLayout();\n  renderPreviewRecent();`,
    `function renderPreviewHome() {\n  syncPreviewLayout();\n  renderPreviewHomeOverview();\n  renderPreviewRecent();`,
    "home overview invocation",
  );
}

if (!js.includes("function renderPreviewCenterUpdate()")) {
  js = replaceOnce(
    js,
    `function renderPreviewUpdates() {`,
    `function renderPreviewCenterUpdate() {\n  if (!previewElements.centerUpdateStatus || !previewElements.centerCurrentVersion) return;\n  const update = state.selfUpdate || {};\n  const currentVersion = String(elements.centerVersionChip?.textContent || "").trim();\n  previewElements.centerCurrentVersion.textContent = currentVersion && currentVersion !== "v..." ? \`현재 \${currentVersion}\` : "현재 버전 확인 중";\n\n  let status = "센터가 최신 상태인지 확인할 수 있습니다.";\n  if (update.phase === "checking") status = "새 SD종합센터 버전을 확인하고 있습니다.";\n  else if (update.downloaded) status = update.version ? \`v\${update.version} 다운로드 완료 · 설치할 수 있습니다.\` : "새 버전 다운로드 완료 · 설치할 수 있습니다.";\n  else if (update.updateAvailable) status = update.version ? \`v\${update.version} 업데이트를 다운로드하고 있습니다.\` : "새 센터 업데이트를 다운로드하고 있습니다.";\n  else if (update.phase === "error") status = update.error || "센터 업데이트를 확인하지 못했습니다.";\n  else if (update.phase === "idle") status = "센터 업데이트 확인 버튼으로 최신 버전을 확인합니다.";\n  previewElements.centerUpdateStatus.textContent = status;\n}\n\nfunction renderPreviewUpdates() {`,
    "center update renderer",
  );
}

if (!js.includes("const centerUpdatePending = Boolean")) {
  js = replaceOnce(
    js,
    `  const count = updates.length;\n  previewElements.updateNavCount.textContent = String(count);\n  previewElements.updateNavCount.classList.toggle("hidden", count === 0);`,
    `  const count = updates.length;\n  const centerUpdatePending = Boolean(state.selfUpdate?.updateAvailable || state.selfUpdate?.downloaded);\n  const navCount = count + (centerUpdatePending ? 1 : 0);\n  previewElements.updateNavCount.textContent = String(navCount);\n  previewElements.updateNavCount.classList.toggle("hidden", navCount === 0);\n  renderPreviewCenterUpdate();`,
    "update nav center integration",
  );
}

if (!js.includes("const originalRenderSelfUpdate = renderSelfUpdate;")) {
  js = replaceOnce(
    js,
    `function refreshPreviewNav() {`,
    `const originalRenderSelfUpdate = renderSelfUpdate;\nrenderSelfUpdate = function previewRenderSelfUpdate() {\n  originalRenderSelfUpdate();\n  renderPreviewUpdates();\n};\n\nfunction refreshPreviewNav() {`,
    "self update renderer hook",
  );
}

if (!js.includes("previewElements.favoriteGrid.addEventListener")) {
  js = replaceOnce(
    js,
    `previewElements.recentGrid.addEventListener("click", (event) => {\n  const app = event.target.closest("[data-preview-app]");\n  if (app) void launchApp(app.dataset.previewApp);\n});`,
    `previewElements.recentGrid.addEventListener("click", (event) => {\n  const app = event.target.closest("[data-preview-app]");\n  if (app) void launchApp(app.dataset.previewApp);\n});\n\npreviewElements.favoriteGrid.addEventListener("click", (event) => {\n  const app = event.target.closest("[data-preview-app]");\n  if (app) void launchApp(app.dataset.previewApp);\n});`,
    "favorite launch handler",
  );
}

js = js.replace(
  `previewElements.previewCheckUpdatesButton.addEventListener("click", async () => {\n  await checkAppUpdates();\n  renderPreviewUpdates();\n});`,
  `previewElements.previewCheckUpdatesButton.addEventListener("click", async () => {\n  await Promise.all([checkAppUpdates(), checkSelfUpdate(false)]);\n  renderPreviewUpdates();\n});`,
);

write("public/js/ui-preview.js", js);

const checkHtml = read("public/index.html");
const checkCss = read("public/css/ui-preview.css");
const checkJs = read("public/js/ui-preview.js");

for (const marker of [
  'id="previewHomeStats"',
  'id="previewFavoriteGrid"',
  'id="previewCenterUpdateStatus"',
  'id="centerUpdateButton" class="preview-button preview-button-primary"',
  "UI Preview v0.6",
]) {
  if (!checkHtml.includes(marker)) throw new Error(`Missing v0.6 HTML marker: ${marker}`);
}
if ((checkHtml.match(/id="centerUpdateButton"/g) || []).length !== 1) throw new Error("centerUpdateButton must exist exactly once");

for (const marker of [
  ".preview-home-folder-preview{",
  "grid-template-columns:repeat(3,1fr)",
  ".preview-home-stats{",
  ".preview-center-update{",
]) {
  if (!checkCss.includes(marker)) throw new Error(`Missing v0.6 CSS marker: ${marker}`);
}

for (const marker of [
  "function renderPreviewHomeOverview()",
  "function folderPreviewMarkup(item)",
  ".slice(0, 9)",
  "function renderPreviewCenterUpdate()",
  "const centerUpdatePending = Boolean",
  "Promise.all([checkAppUpdates(), checkSelfUpdate(false)])",
  "previewElements.favoriteGrid.addEventListener",
]) {
  if (!checkJs.includes(marker)) throw new Error(`Missing v0.6 JS marker: ${marker}`);
}

console.log("SDCenter UI Preview v0.6 density/folder/update patch applied");
