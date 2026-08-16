"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v223-electron-autoupdater-core.js <app-root>");

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n"); }
function write(rel, content) { fs.writeFileSync(path.join(root, rel), content, "utf8"); }
function replaceOnce(source, needle, replacement, label) {
  const i = source.indexOf(needle);
  if (i < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, i) + replacement + source.slice(i + needle.length);
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.3";
pkg.description = "SD지갑 코어 · 확장팩 상점 · SD Link 자동 시작 · 종합센터 앱내 업데이트";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");
if (!main.includes("autoUpdater,")) {
  main = replaceOnce(main, "  app,\n  BrowserWindow,", "  app,\n  autoUpdater,\n  BrowserWindow,", "autoUpdater import");
}

if (!main.includes("CENTER_UPDATE_FEED_URL")) {
  const updaterCode = [
    "",
    "  const CENTER_UPDATE_FEED_URL = \"https://github.com/SD608/sd-center/releases/latest/download\";",
    "  let centerUpdateState = { phase: \"idle\", updateAvailable: false, downloaded: false, version: \"\", error: \"\" };",
    "  let centerUpdaterConfigured = false;",
    "",
    "  function sendCenterUpdateState(extra = {}) {",
    "    centerUpdateState = { ...centerUpdateState, ...extra };",
    "    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(\"center:center-update-state\", { ...centerUpdateState, currentVersion: app.getVersion() });",
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
    "    const confirmation = await dialog.showMessageBox(mainWindow, { type: \"question\", title: \"SD종합센터 업데이트\", message: \"다운로드된 종합센터 업데이트를 지금 설치할까요?\", detail: \"실행 중인 SD 앱을 종료하고 종합센터를 업데이트한 뒤 자동으로 다시 실행합니다.\", buttons: [\"취소\", \"업데이트 후 재시작\"], defaultId: 1, cancelId: 0, noLink: true });",
    "    if (confirmation.response !== 1) return { ok: false, canceled: true };",
    "    await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));",
    "    isQuitting = true;",
    "    setTimeout(() => autoUpdater.quitAndInstall(), 120);",
    "    return { ok: true, installing: true };",
    "  }",
    ""
  ].join("\n");
  main = replaceOnce(main, "\n  function rawEntryVersion(entry) {", `${updaterCode}\n  function rawEntryVersion(entry) {`, "center auto updater code");
}

if (!main.includes('center:check-self-update')) {
  main = replaceOnce(
    main,
    '    ipcMain.handle("center:toggle-favorite", (event, id) => toggleFavorite(id));',
    '    ipcMain.handle("center:check-self-update", () => checkCenterSelfUpdate());\n    ipcMain.handle("center:install-self-update", () => installCenterSelfUpdate());\n    ipcMain.handle("center:get-self-update-state", () => sendCenterUpdateState());\n    ipcMain.handle("center:toggle-favorite", (event, id) => toggleFavorite(id));',
    "center updater IPC",
  );
}

if (!main.includes('configureCenterAutoUpdater();\n    configureSdLinkWindowsAutoStart();')) {
  main = replaceOnce(
    main,
    '    app.setAppUserModelId("com.sdcenter.desktop");\n    configureSdLinkWindowsAutoStart();',
    '    app.setAppUserModelId("com.sdcenter.desktop");\n    configureCenterAutoUpdater();\n    configureSdLinkWindowsAutoStart();',
    "configure updater on ready",
  );
}

write("main.js", main);
for (const marker of ["autoUpdater", "CENTER_UPDATE_FEED_URL", "center:check-self-update", "center:install-self-update", "quitAndInstall"]) {
  if (!main.includes(marker)) throw new Error(`Missing updater marker: ${marker}`);
}
console.log("SDCenter v2.2.3 autoUpdater core patch applied");
