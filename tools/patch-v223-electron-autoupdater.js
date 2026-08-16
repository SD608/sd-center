"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v223-electron-autoupdater.js <app-root>");

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

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.3";
pkg.description = "SD지갑 코어 · 확장팩 상점 · SD Link 자동 시작 · 종합센터 앱내 업데이트";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");
main = replaceOnce(
  main,
  "  app,\n  BrowserWindow,",
  "  app,\n  autoUpdater,\n  BrowserWindow,",
  "autoUpdater import",
);

const updaterCode = [
  "",
  "  const CENTER_UPDATE_FEED_URL = \"https://github.com/SD608/sd-center/releases/latest/download\";",
  "  let centerUpdateState = { phase: \"idle\", updateAvailable: false, downloaded: false, version: \"\", error: \"\" };",
  "  let centerUpdaterConfigured = false;",
  "",
  "  function sendCenterUpdateState(extra = {}) {",
  "    centerUpdateState = { ...centerUpdateState, ...extra };",
  "    if (mainWindow && !mainWindow.isDestroyed()) {",
  "      mainWindow.webContents.send(\"center:center-update-state\", { ...centerUpdateState, currentVersion: app.getVersion() });",
  "    }",
  "    return { ...centerUpdateState, currentVersion: app.getVersion() };",
  "  }",
  "",
  "  function configureCenterAutoUpdater() {",
  "    if (centerUpdaterConfigured || !app.isPackaged || process.platform !== \"win32\") return;",
  "    centerUpdaterConfigured = true;",
  "    autoUpdater.setFeedURL({ url: CENTER_UPDATE_FEED_URL });",
  "    autoUpdater.on(\"checking-for-update\", () => sendCenterUpdateState({ phase: \"checking\", error: \"\" }));",
  "    autoUpdater.on(\"update-available\", () => sendCenterUpdateState({ phase: \"available\", updateAvailable: true, downloaded: false, error: \"\" }));",
  "    autoUpdater.on(\"update-not-available\", () => sendCenterUpdateState({ phase: \"latest\", updateAvailable: false, downloaded: false, version: app.getVersion(), error: \"\" }));",
  "    autoUpdater.on(\"update-downloaded\", (_event, releaseNotes, releaseName) => {",
  "      const match = String(releaseName || \"\").match(/(\\d+(?:\\.\\d+){1,3})/);",
  "      sendCenterUpdateState({ phase: \"downloaded\", updateAvailable: true, downloaded: true, version: match ? match[1] : \"\", releaseNotes: String(releaseNotes || \"\"), error: \"\" });",
  "    });",
  "    autoUpdater.on(\"error\", (error) => sendCenterUpdateState({ phase: \"error\", error: error?.message || String(error) }));",
  "  }",
  "",
  "  async function checkCenterSelfUpdate() {",
  "    configureCenterAutoUpdater();",
  "    if (!app.isPackaged || process.platform !== \"win32\") return { ok: false, error: \"Windows 설치 버전에서만 종합센터 자동업데이트를 사용할 수 있습니다.\" };",
  "    try {",
  "      sendCenterUpdateState({ phase: \"checking\", error: \"\" });",
  "      await autoUpdater.checkForUpdates();",
  "      return { ok: true, ...centerUpdateState, currentVersion: app.getVersion() };",
  "    } catch (error) {",
  "      return { ok: false, ...sendCenterUpdateState({ phase: \"error\", error: error?.message || String(error) }) };",
  "    }",
  "  }",
  "",
  "  async function installCenterSelfUpdate() {",
  "    if (!centerUpdateState.downloaded) return { ok: false, error: \"업데이트 다운로드가 아직 완료되지 않았습니다.\" };",
  "    const confirmation = await dialog.showMessageBox(mainWindow, {",
  "      type: \"question\", title: \"SD종합센터 업데이트\", message: \"다운로드된 종합센터 업데이트를 지금 설치할까요?\",",
  "      detail: \"실행 중인 SD 앱을 종료하고 종합센터를 업데이트한 뒤 자동으로 다시 실행합니다.\",",
  "      buttons: [\"취소\", \"업데이트 후 재시작\"], defaultId: 1, cancelId: 0, noLink: true,",
  "    });",
  "    if (confirmation.response !== 1) return { ok: false, canceled: true };",
  "    await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));",
  "    isQuitting = true;",
  "    setTimeout(() => autoUpdater.quitAndInstall(), 120);",
  "    return { ok: true, installing: true };",
  "  }",
  ""
].join("\n");

main = replaceOnce(
  main,
  "\n  function rawEntryVersion(entry) {",
  `${updaterCode}\n  function rawEntryVersion(entry) {`,
  "center auto updater code",
);

main = replaceOnce(
  main,
  "    ipcMain.handle(\"center:toggle-favorite\", (event, id) => toggleFavorite(id));",
  "    ipcMain.handle(\"center:check-self-update\", () => checkCenterSelfUpdate());\n    ipcMain.handle(\"center:install-self-update\", () => installCenterSelfUpdate());\n    ipcMain.handle(\"center:get-self-update-state\", () => sendCenterUpdateState());\n    ipcMain.handle(\"center:toggle-favorite\", (event, id) => toggleFavorite(id));",
  "center updater IPC",
);

main = replaceOnce(
  main,
  "    app.setAppUserModelId(\"com.sdcenter.desktop\");\n    configureSdLinkWindowsAutoStart();",
  "    app.setAppUserModelId(\"com.sdcenter.desktop\");\n    configureCenterAutoUpdater();\n    configureSdLinkWindowsAutoStart();",
  "configure updater on ready",
);
write("main.js", main);

let preload = read("preload.js");
preload = replaceOnce(
  preload,
  "  getCenterInfo: () => invoke(\"center:get-center-info\"),",
  "  getCenterInfo: () => invoke(\"center:get-center-info\"),\n  checkSelfUpdate: () => invoke(\"center:check-self-update\"),\n  installSelfUpdate: () => invoke(\"center:install-self-update\"),\n  getSelfUpdateState: () => invoke(\"center:get-self-update-state\"),",
  "preload updater methods",
);
preload = replaceOnce(
  preload,
  "  onBulkDownloadProgress: (callback) =>\n    subscribe(\"center:bulk-download-progress\", callback),",
  "  onBulkDownloadProgress: (callback) =>\n    subscribe(\"center:bulk-download-progress\", callback),\n  onSelfUpdateState: (callback) =>\n    subscribe(\"center:center-update-state\", callback),",
  "preload updater event",
);
write("preload.js", preload);

let html = read("public/index.html");
html = replaceOnce(
  html,
  "      <div id=\"centerVersionChip\" class=\"center-version-chip\" title=\"현재 SD종합센터 버전\">v...</div>",
  "      <div id=\"centerVersionChip\" class=\"center-version-chip\" title=\"현재 SD종합센터 버전\">v...</div>\n      <button id=\"centerUpdateButton\" class=\"button button-secondary center-update-button\" type=\"button\">센터 업데이트</button>",
  "center update button",
);
write("public/index.html", html);

let css = read("public/css/style.css");
css += "\n\n/* v2.2.3 종합센터 자체 업데이트 */\n.center-update-button{min-height:36px;padding:8px 13px;white-space:nowrap}.center-update-button.is-available{font-weight:800;transform:translateY(-1px)}\n";
write("public/css/style.css", css);

let renderer = read("public/js/app.js");
renderer = replaceOnce(
  renderer,
  "  centerVersionChip: document.getElementById(\"centerVersionChip\"),",
  "  centerVersionChip: document.getElementById(\"centerVersionChip\"),\n  centerUpdateButton: document.getElementById(\"centerUpdateButton\"),",
  "renderer update element",
);
renderer = replaceOnce(
  renderer,
  "  toastTimer: null,",
  "  toastTimer: null,\n  selfUpdate: { phase: \"idle\", updateAvailable: false, downloaded: false, version: \"\", error: \"\" },",
  "renderer update state",
);

const rendererUpdaterCode = [
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
  ""
].join("\n");
renderer = replaceOnce(
  renderer,
  "\nfunction formatRemovedAt(value) {",
  `${rendererUpdaterCode}\nfunction formatRemovedAt(value) {`,
  "renderer updater code",
);
renderer = replaceOnce(
  renderer,
  "  elements.addAppButton.addEventListener(\"click\", addAppZip);",
  "  elements.centerUpdateButton?.addEventListener(\"click\", handleSelfUpdateButton);\n  elements.addAppButton.addEventListener(\"click\", addAppZip);",
  "renderer updater click",
);
renderer = replaceOnce(
  renderer,
  "  bridge.onBulkDownloadProgress?.((progress) => {\n    state.downloadProgress = progress || null;\n    renderOverview();\n  });",
  "  bridge.onBulkDownloadProgress?.((progress) => {\n    state.downloadProgress = progress || null;\n    renderOverview();\n  });\n  bridge.onSelfUpdateState?.((update) => {\n    state.selfUpdate = update || state.selfUpdate;\n    renderSelfUpdate();\n    if (update?.phase === \"available\") showToast(\"새 SD종합센터 업데이트를 다운로드합니다.\", 3500);\n    if (update?.phase === \"downloaded\") showToast(update.version ? \"SD종합센터 v\" + update.version + \" 다운로드 완료 · 설치할 수 있습니다.\" : \"종합센터 업데이트 다운로드가 완료되었습니다.\", 5000);\n    if (update?.phase === \"error\") showToast(update.error || \"종합센터 업데이트 오류\", 4500);\n  });",
  "renderer updater event",
);
renderer = replaceOnce(
  renderer,
  "  setRemovedApps(removedApps);\n  selectTab(\"installed\");",
  "  setRemovedApps(removedApps);\n  selectTab(\"installed\");\n  renderSelfUpdate();\n  window.setTimeout(() => { void checkSelfUpdate(true); }, 1200);",
  "renderer updater startup",
);
write("public/js/app.js", renderer);

for (const rel of ["main.js", "preload.js", "public/js/app.js"]) {
  const source = read(rel);
  if (!source.includes("self-update") && rel === "main.js") {
    // marker check below handles exact updater strings
  }
}
for (const marker of ["autoUpdater", "CENTER_UPDATE_FEED_URL", "center:check-self-update", "center:install-self-update"]) {
  if (!read("main.js").includes(marker)) throw new Error(`Missing updater marker: ${marker}`);
}
for (const marker of ["centerUpdateButton", "checkSelfUpdate", "handleSelfUpdateButton", "onSelfUpdateState"]) {
  if (!read("public/js/app.js").includes(marker)) throw new Error(`Missing renderer updater marker: ${marker}`);
}

console.log("SDCenter v2.2.3 Electron autoUpdater patch applied");
