"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v223-electron-autoupdater-ui.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}
function insertAfter(source, marker, insertion, label) {
  const i = source.indexOf(marker);
  if (i < 0) throw new Error(`Patch marker missing: ${label}`);
  const at = i + marker.length;
  return source.slice(0, at) + insertion + source.slice(at);
}
function insertBefore(source, marker, insertion, label) {
  const i = source.indexOf(marker);
  if (i < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, i) + insertion + source.slice(i);
}

let preload = read("preload.js");
if (!preload.includes("checkSelfUpdate:")) {
  preload = insertAfter(
    preload,
    '  getCenterInfo: () => invoke("center:get-center-info"),',
    '\n  checkSelfUpdate: () => invoke("center:check-self-update"),\n  installSelfUpdate: () => invoke("center:install-self-update"),\n  getSelfUpdateState: () => invoke("center:get-self-update-state"),',
    "preload center info",
  );
}
if (!preload.includes("onSelfUpdateState:")) {
  const end = preload.lastIndexOf("\n});");
  if (end < 0) throw new Error("preload expose object end missing");
  preload = preload.slice(0, end) +
    '\n  onSelfUpdateState: (callback) =>\n    subscribe("center:center-update-state", callback),' +
    preload.slice(end);
}
write("preload.js", preload);

let html = read("public/index.html");
if (!html.includes('id="centerUpdateButton"')) {
  const marker = '      <div id="centerVersionChip" class="center-version-chip" title="현재 SD종합센터 버전">v...</div>';
  html = insertAfter(
    html,
    marker,
    '\n      <button id="centerUpdateButton" class="button button-secondary center-update-button" type="button">센터 업데이트</button>',
    "center version chip",
  );
}
write("public/index.html", html);

let css = read("public/css/style.css");
if (!css.includes("v2.2.3 종합센터 자체 업데이트")) {
  css += "\n\n/* v2.2.3 종합센터 자체 업데이트 */\n.center-update-button{min-height:36px;padding:8px 13px;white-space:nowrap}.center-update-button.is-available{font-weight:800;transform:translateY(-1px)}\n";
}
write("public/css/style.css", css);

let renderer = read("public/js/app.js");
if (!renderer.includes("centerUpdateButton: document.getElementById")) {
  renderer = insertAfter(
    renderer,
    '  centerVersionChip: document.getElementById("centerVersionChip"),',
    '\n  centerUpdateButton: document.getElementById("centerUpdateButton"),',
    "renderer center version element",
  );
}
if (!renderer.includes('selfUpdate: { phase: "idle"')) {
  renderer = insertAfter(
    renderer,
    "  toastTimer: null,",
    '\n  selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" },',
    "renderer state",
  );
}

if (!renderer.includes("function renderSelfUpdate()")) {
  const updaterFunctions = [
    "",
    "function renderSelfUpdate() {",
    "  const button = elements.centerUpdateButton;",
    "  if (!button) return;",
    "  const update = state.selfUpdate || {};",
    "  button.classList.toggle(\"is-available\", Boolean(update.updateAvailable));",
    "  button.disabled = update.phase === \"checking\" || update.phase === \"installing\";",
    "  if (update.phase === \"checking\") button.textContent = \"센터 업데이트 확인 중...\";",
    "  else if (update.downloaded) button.textContent = update.version ? \"센터 v\" + update.version + \" 설치\" : \"다운로드 완료 · 설치\";",
    "  else if (update.updateAvailable) button.textContent = \"센터 업데이트 다운로드 중...\";",
    "  else button.textContent = \"센터 업데이트\";",
    "}",
    "",
    "async function checkSelfUpdate(silent = false) {",
    "  const result = await bridge.checkSelfUpdate();",
    "  if (!result?.ok && !silent) showToast(result?.error || \"종합센터 업데이트를 확인하지 못했습니다.\", 4500);",
    "  return result;",
    "}",
    "",
    "async function handleSelfUpdateButton() {",
    "  if (state.selfUpdate?.downloaded) {",
    "    const result = await bridge.installSelfUpdate();",
    "    if (result?.canceled) return;",
    "    if (!result?.ok) showToast(result?.error || \"종합센터 업데이트를 설치하지 못했습니다.\", 4500);",
    "    return;",
    "  }",
    "  const result = await checkSelfUpdate(false);",
    "  if (result?.ok && !result.updateAvailable && !result.downloaded) showToast(\"SD종합센터가 최신 버전입니다.\");",
    "}",
    "",
  ].join("\n");
  renderer = insertBefore(renderer, "\nfunction formatRemovedAt(value) {", updaterFunctions, "formatRemovedAt");
}

if (!renderer.includes('centerUpdateButton?.addEventListener("click"')) {
  renderer = insertBefore(
    renderer,
    '  elements.addAppButton.addEventListener("click", addAppZip);',
    '  elements.centerUpdateButton?.addEventListener("click", handleSelfUpdateButton);\n',
    "add app listener",
  );
}

if (!renderer.includes("bridge.onSelfUpdateState?.")) {
  const bindEndMarker = "\n}\n\nasync function initialize() {";
  const eventCode = [
    "",
    "  bridge.onSelfUpdateState?.((update) => {",
    "    state.selfUpdate = update || state.selfUpdate;",
    "    renderSelfUpdate();",
    "    if (update?.phase === \"available\") showToast(\"새 SD종합센터 업데이트를 다운로드합니다.\", 3500);",
    "    if (update?.phase === \"downloaded\") showToast(update.version ? \"SD종합센터 v\" + update.version + \" 다운로드 완료 · 설치할 수 있습니다.\" : \"종합센터 업데이트 다운로드가 완료되었습니다.\", 5000);",
    "    if (update?.phase === \"error\") showToast(update.error || \"종합센터 업데이트 오류\", 4500);",
    "  });",
  ].join("\n");
  const idx = renderer.indexOf(bindEndMarker);
  if (idx < 0) throw new Error("bindEvents end marker missing");
  renderer = renderer.slice(0, idx) + eventCode + renderer.slice(idx);
}

if (!renderer.includes("void checkSelfUpdate(true)")) {
  renderer = insertAfter(
    renderer,
    '  selectTab("installed");',
    '\n  renderSelfUpdate();\n  window.setTimeout(() => { void checkSelfUpdate(true); }, 1200);',
    "initialize select tab",
  );
}
write("public/js/app.js", renderer);

for (const marker of ["checkSelfUpdate:", "installSelfUpdate:", "onSelfUpdateState:"]) {
  if (!read("preload.js").includes(marker)) throw new Error(`Missing preload marker: ${marker}`);
}
for (const marker of ["centerUpdateButton", "renderSelfUpdate", "handleSelfUpdateButton", "bridge.onSelfUpdateState"] ) {
  if (!read("public/js/app.js").includes(marker)) throw new Error(`Missing renderer marker: ${marker}`);
}
console.log("SDCenter v2.2.3 autoUpdater UI patch applied");
