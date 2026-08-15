"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v219-center-qol.js <app-root>");

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

function block(lines) {
  return lines.join("\n") + "\n";
}

// Center package version.
const packagePath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = "2.1.9";
pkg.description = "SD종합센터 버전 표시, 확장팩 ZIP 일괄 다운로드, 즐겨찾기를 지원하는 통합 센터";
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

// ---- main.js ----
let main = read("main.js");

const settings = block([
  "const CENTER_SETTINGS_PATH = path.join(",
  "  CENTER_DATA_ROOT,",
  "  \"center-settings.json\",",
  ");",
  "",
  "function loadCenterSettings() {",
  "  try {",
  "    const parsed = JSON.parse(fs.readFileSync(CENTER_SETTINGS_PATH, \"utf8\"));",
  "    const favoriteIds = Array.isArray(parsed?.favoriteIds)",
  "      ? [...new Set(parsed.favoriteIds",
  "          .filter((id) => typeof id === \"string\" && id.trim())",
  "          .map((id) => id.trim()))]",
  "      : [];",
  "    return { favoriteIds };",
  "  } catch {",
  "    return { favoriteIds: [] };",
  "  }",
  "}",
  "",
  "function saveCenterSettings(settings) {",
  "  fs.mkdirSync(CENTER_DATA_ROOT, { recursive: true });",
  "  const temporaryPath = `${CENTER_SETTINGS_PATH}.${process.pid}.tmp`;",
  "  fs.writeFileSync(",
  "    temporaryPath,",
  "    JSON.stringify({",
  "      favoriteIds: Array.isArray(settings?.favoriteIds)",
  "        ? [...new Set(settings.favoriteIds)]",
  "        : [],",
  "    }, null, 2) + \"\\n\",",
  "    \"utf8\",",
  "  );",
  "  fs.renameSync(temporaryPath, CENTER_SETTINGS_PATH);",
  "}",
  "",
  "let centerSettings = loadCenterSettings();",
  "",
  "function isFavoriteId(id) {",
  "  return (centerSettings.favoriteIds || []).includes(String(id || \"\"));",
  "}",
  "",
  "function setFavoriteId(id, favorite) {",
  "  const appId = String(id || \"\").trim();",
  "  const next = new Set(centerSettings.favoriteIds || []);",
  "  if (favorite) next.add(appId);",
  "  else next.delete(appId);",
  "  centerSettings = { ...centerSettings, favoriteIds: [...next] };",
  "  saveCenterSettings(centerSettings);",
  "  return favorite;",
  "}",
  "",
]);
main = replaceOnce(main, "const FALLBACK_REQUIRED_APPS = {", settings + "const FALLBACK_REQUIRED_APPS = {", "settings insertion");

const featureFunctions = block([
  "  function downloadableExtensionEntries() {",
  "    const seenUrls = new Set();",
  "    return Object.entries(extensionCatalog?.apps || {})",
  "      .map(([id, rule]) => ({",
  "        id: String(id || \"\"),",
  "        name: String(rule?.name || id || \"확장팩\"),",
  "        version: String(rule?.version || \"\"),",
  "        downloadUrl: String(rule?.downloadUrl || \"\").trim(),",
  "      }))",
  "      .filter((entry) => {",
  "        if (!entry.id || !entry.version || !entry.downloadUrl) return false;",
  "        if (!/^https:\\/\\//i.test(entry.downloadUrl)) return false;",
  "        if (seenUrls.has(entry.downloadUrl)) return false;",
  "        seenUrls.add(entry.downloadUrl);",
  "        return true;",
  "      });",
  "  }",
  "",
  "  function safeExtensionFileName(entry) {",
  "    let candidate = \"\";",
  "    try {",
  "      const parsed = new URL(entry.downloadUrl);",
  "      candidate = decodeURIComponent(path.posix.basename(parsed.pathname));",
  "    } catch {}",
  "    if (!/\\.zip$/i.test(candidate)) {",
  "      candidate = `${entry.name}_v${entry.version}.zip`;",
  "    }",
  "    const safe = candidate",
  "      .replace(/[<>:\"/\\\\|?*\\u0000-\\u001f]/g, \"_\")",
  "      .replace(/[. ]+$/g, \"\")",
  "      .slice(0, 160);",
  "    return safe || `${entry.id}_v${entry.version}.zip`;",
  "  }",
  "",
  "  function bulkDownloadStamp(date = new Date()) {",
  "    const pad = (value) => String(value).padStart(2, \"0\");",
  "    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;",
  "  }",
  "",
  "  function sendBulkDownloadProgress(payload) {",
  "    if (!mainWindow || mainWindow.isDestroyed()) return;",
  "    mainWindow.webContents.send(\"center:bulk-download-progress\", payload);",
  "  }",
  "",
  "  async function downloadAllExtensionZips() {",
  "    try {",
  "      await refreshExtensionCatalog({ force: true });",
  "      const entries = downloadableExtensionEntries();",
  "      if (entries.length === 0) {",
  "        return { ok: false, error: \"다운로드 가능한 확장팩 ZIP이 없습니다.\" };",
  "      }",
  "",
  "      const confirmation = await dialog.showMessageBox(mainWindow, {",
  "        type: \"question\",",
  "        title: \"확장팩 ZIP 일괄 다운로드\",",
  "        message: `최신 확장팩 ZIP ${entries.length}개를 한 번에 다운로드할까요?`,",
  "        detail: entries.map((entry) => `• ${entry.name} v${entry.version}`).join(\"\\n\") + \"\\n\\n설치하지 않고 ZIP 파일만 저장합니다.\",",
  "        buttons: [\"취소\", \"저장 위치 선택\"],",
  "        defaultId: 1,",
  "        cancelId: 0,",
  "        noLink: true,",
  "      });",
  "      if (confirmation.response !== 1) return { ok: false, canceled: true };",
  "",
  "      const selection = await dialog.showOpenDialog(mainWindow, {",
  "        title: \"확장팩 ZIP 저장 폴더 선택\",",
  "        defaultPath: app.getPath(\"downloads\"),",
  "        properties: [\"openDirectory\", \"createDirectory\"],",
  "      });",
  "      if (selection.canceled || !selection.filePaths?.[0]) {",
  "        return { ok: false, canceled: true };",
  "      }",
  "",
  "      const targetDirectory = path.join(selection.filePaths[0], `SD확장팩_${bulkDownloadStamp()}`);",
  "      fs.mkdirSync(targetDirectory, { recursive: true });",
  "      const results = [];",
  "      const usedNames = new Set();",
  "      sendBulkDownloadProgress({ completed: 0, total: entries.length, name: \"준비 중\" });",
  "",
  "      for (let index = 0; index < entries.length; index += 1) {",
  "        const entry = entries[index];",
  "        let fileName = safeExtensionFileName(entry);",
  "        if (usedNames.has(fileName.toLowerCase())) fileName = `${entry.id}_${fileName}`;",
  "        usedNames.add(fileName.toLowerCase());",
  "        const destination = path.join(targetDirectory, fileName);",
  "        const temporary = `${destination}.part`;",
  "        sendBulkDownloadProgress({ completed: index, total: entries.length, name: entry.name });",
  "",
  "        try {",
  "          fs.rmSync(temporary, { force: true });",
  "          await downloadFile(entry.downloadUrl, temporary);",
  "          const stat = fs.statSync(temporary);",
  "          if (!stat.isFile() || stat.size <= 0) throw new Error(\"다운로드된 ZIP 파일이 비어 있습니다.\");",
  "          inspectZip(temporary);",
  "          fs.rmSync(destination, { force: true });",
  "          fs.renameSync(temporary, destination);",
  "          results.push({ id: entry.id, name: entry.name, ok: true, fileName });",
  "        } catch (error) {",
  "          fs.rmSync(temporary, { force: true });",
  "          results.push({ id: entry.id, name: entry.name, ok: false, error: error.message });",
  "        }",
  "        sendBulkDownloadProgress({ completed: index + 1, total: entries.length, name: entry.name });",
  "      }",
  "",
  "      const failed = results.filter((result) => !result.ok);",
  "      const openError = await shell.openPath(targetDirectory);",
  "      return {",
  "        ok: failed.length === 0,",
  "        count: entries.length,",
  "        downloadedCount: results.length - failed.length,",
  "        failedCount: failed.length,",
  "        folder: targetDirectory,",
  "        folderOpenError: openError || \"\",",
  "        results,",
  "      };",
  "    } catch (error) {",
  "      return { ok: false, error: error.message };",
  "    }",
  "  }",
  "",
  "  function toggleFavorite(id) {",
  "    const entry = appById.get(String(id || \"\"));",
  "    if (!entry) return { ok: false, error: \"등록되지 않은 앱입니다.\" };",
  "    const favorite = !isFavoriteId(entry.id);",
  "    setFavoriteId(entry.id, favorite);",
  "    sendAppStates();",
  "    return { ok: true, id: entry.id, favorite };",
  "  }",
  "",
]);
main = replaceOnce(main, "  async function installRequiredUpdate(entry, rule) {", featureFunctions + "  async function installRequiredUpdate(entry, rule) {", "feature functions insertion");
main = replaceOnce(
  main,
  "      rawVersion: rawEntryVersion(entry),\n      ...updateRequirementFor(entry),",
  "      rawVersion: rawEntryVersion(entry),\n      favorite: isFavoriteId(entry.id),\n      ...updateRequirementFor(entry),",
  "favorite public state",
);
main = replaceOnce(
  main,
  "  function registerIpcHandlers() {\n    ipcMain.handle(\"center:list-apps\", () => getAllAppStates());",
  block([
    "  function registerIpcHandlers() {",
    "    ipcMain.handle(\"center:get-center-info\", () => ({",
    "      name: \"SD종합센터\",",
    "      version: app.getVersion(),",
    "    }));",
    "    ipcMain.handle(\"center:toggle-favorite\", (event, id) => toggleFavorite(id));",
    "    ipcMain.handle(\"center:download-extension-zips\", () => downloadAllExtensionZips());",
    "    ipcMain.handle(\"center:list-apps\", () => getAllAppStates());",
  ]).trimEnd(),
  "IPC handlers insertion",
);
write("main.js", main);

// ---- preload.js ----
let preload = read("preload.js");
preload = replaceOnce(
  preload,
  "  openAppFolder: (id) => invoke(\"center:open-app-folder\", id),",
  block([
    "  openAppFolder: (id) => invoke(\"center:open-app-folder\", id),",
    "  getCenterInfo: () => invoke(\"center:get-center-info\"),",
    "  toggleFavorite: (id) => invoke(\"center:toggle-favorite\", id),",
    "  downloadExtensionZips: () => invoke(\"center:download-extension-zips\"),",
  ]).trimEnd(),
  "preload commands",
);
preload = replaceOnce(
  preload,
  "  onRemovedAppStates: (callback) =>\n    subscribe(\"center:removed-app-states\", callback),",
  block([
    "  onRemovedAppStates: (callback) =>",
    "    subscribe(\"center:removed-app-states\", callback),",
    "  onBulkDownloadProgress: (callback) =>",
    "    subscribe(\"center:bulk-download-progress\", callback),",
  ]).trimEnd(),
  "preload progress subscription",
);
write("preload.js", preload);

// ---- public/index.html ----
let html = read("public/index.html");
html = replaceOnce(
  html,
  "    <div class=\"topbar-actions\">\n      <div class=\"shortcut-chip\">",
  block([
    "    <div class=\"topbar-actions\">",
    "      <div id=\"centerVersionChip\" class=\"center-version-chip\" title=\"현재 SD종합센터 버전\">v...</div>",
    "      <div class=\"shortcut-chip\">",
  ]).trimEnd(),
  "version chip",
);
html = replaceOnce(
  html,
  "        <div class=\"hero-actions\">\n          <button id=\"addAppButton\" class=\"button button-add\" type=\"button\">ZIP 앱 추가</button>",
  block([
    "        <div class=\"hero-actions\">",
    "          <button id=\"downloadExtensionsButton\" class=\"button button-download\" type=\"button\">확장팩 ZIP 일괄 다운로드</button>",
    "          <button id=\"addAppButton\" class=\"button button-add\" type=\"button\">ZIP 앱 추가</button>",
  ]).trimEnd(),
  "bulk download button",
);
html = replaceOnce(
  html,
  "    <section id=\"installedPanel\" class=\"app-panel\">\n      <section class=\"section-heading\">",
  block([
    "    <section id=\"installedPanel\" class=\"app-panel\">",
    "      <section id=\"favoritesSection\" class=\"favorites-section hidden\" aria-live=\"polite\">",
    "        <div class=\"favorites-heading\">",
    "          <div>",
    "            <p class=\"eyebrow\">FAVORITES</p>",
    "            <h2>즐겨찾기</h2>",
    "          </div>",
    "          <p>★를 누른 앱을 여기서 바로 실행할 수 있습니다.</p>",
    "        </div>",
    "        <div id=\"favoriteGrid\" class=\"favorite-grid\"></div>",
    "      </section>",
    "",
    "      <section class=\"section-heading\">",
  ]).trimEnd(),
  "favorites section",
);
write("public/index.html", html);

// ---- public/js/app.js ----
let ui = read("public/js/app.js");
ui = replaceOnce(
  ui,
  "  toast: document.getElementById(\"toast\"),",
  block([
    "  toast: document.getElementById(\"toast\"),",
    "  centerVersionChip: document.getElementById(\"centerVersionChip\"),",
    "  downloadExtensionsButton: document.getElementById(\"downloadExtensionsButton\"),",
    "  favoritesSection: document.getElementById(\"favoritesSection\"),",
    "  favoriteGrid: document.getElementById(\"favoriteGrid\"),",
  ]).trimEnd(),
  "renderer elements",
);
ui = replaceOnce(
  ui,
  "  updatingAll: false,\n  quitting: false,",
  "  updatingAll: false,\n  downloadingExtensions: false,\n  downloadProgress: null,\n  quitting: false,",
  "renderer state",
);
ui = replaceOnce(
  ui,
  block([
    "  if (elements.updateAllButton) {",
    "    elements.updateAllButton.disabled =",
    "      updateCount === 0 || state.updatingAll || state.checkingUpdates;",
    "    elements.updateAllButton.textContent = state.updatingAll",
    "      ? \"업데이트 중...\"",
    "      : updateCount > 0",
    "        ? `모두 업데이트 (${updateCount})`",
    "        : \"모두 업데이트\";",
    "  }",
  ]),
  block([
    "  if (elements.updateAllButton) {",
    "    elements.updateAllButton.disabled =",
    "      updateCount === 0 || state.updatingAll || state.checkingUpdates;",
    "    elements.updateAllButton.textContent = state.updatingAll",
    "      ? \"업데이트 중...\"",
    "      : updateCount > 0",
    "        ? `모두 업데이트 (${updateCount})`",
    "        : \"모두 업데이트\";",
    "  }",
    "  if (elements.downloadExtensionsButton) {",
    "    const progress = state.downloadProgress;",
    "    elements.downloadExtensionsButton.disabled = state.downloadingExtensions;",
    "    elements.downloadExtensionsButton.textContent = state.downloadingExtensions",
    "      ? progress?.total",
    "        ? `ZIP 다운로드 중 (${progress.completed}/${progress.total})`",
    "        : \"ZIP 다운로드 준비 중...\"",
    "      : \"확장팩 ZIP 일괄 다운로드\";",
    "  }",
  ]),
  "bulk download render state",
);
ui = replaceOnce(
  ui,
  "        <div class=\"status-group\">\n          <span class=\"source-pill\">${sourceLabel}</span>",
  "        <div class=\"status-group\">\n          <button class=\"favorite-button${app.favorite ? \" is-favorite\" : \"\"}\" type=\"button\" title=\"${app.favorite ? \"즐겨찾기 해제\" : \"즐겨찾기에 추가\"}\" aria-label=\"${app.favorite ? \"즐겨찾기 해제\" : \"즐겨찾기에 추가\"}\">${app.favorite ? \"★\" : \"☆\"}</button>\n          <span class=\"source-pill\">${sourceLabel}</span>",
  "favorite card button",
);

const favoriteHelpers = block([
  "function favoriteShortcut(app) {",
  "  const status = app.updateRequired",
  "    ? `필수 v${app.requiredVersion}`",
  "    : app.running",
  "      ? \"실행 중\"",
  "      : app.updateAvailable",
  "        ? `v${app.latestVersion} 업데이트 가능`",
  "        : \"바로 실행\";",
  "  return `",
  "    <button class=\"favorite-shortcut${app.running ? \" is-running\" : \"\"}\" type=\"button\" data-id=\"${escapeHtml(app.id)}\">",
  "      <img src=\"${escapeHtml(iconPath(app))}\" alt=\"\" draggable=\"false\">",
  "      <span>",
  "        <strong>${escapeHtml(app.name)}</strong>",
  "        <small>${escapeHtml(status)}</small>",
  "      </span>",
  "      <b>열기</b>",
  "    </button>",
  "  `;",
  "}",
  "",
  "function renderFavorites() {",
  "  const favorites = state.apps",
  "    .filter((app) => app.favorite)",
  "    .sort((a, b) => String(a.name).localeCompare(String(b.name), \"ko\"));",
  "  elements.favoritesSection?.classList.toggle(\"hidden\", favorites.length === 0);",
  "  if (elements.favoriteGrid) {",
  "    elements.favoriteGrid.innerHTML = favorites.map(favoriteShortcut).join(\"\");",
  "  }",
  "}",
  "",
]);
ui = replaceOnce(
  ui,
  block([
    "function renderApps() {",
    "  renderOverview();",
    "  elements.appGrid.innerHTML = state.apps",
    "    .map(installedAppCard)",
    "    .join(\"\");",
  ]),
  favoriteHelpers + block([
    "function renderApps() {",
    "  renderOverview();",
    "  renderFavorites();",
    "  const orderedApps = [...state.apps].sort((a, b) => {",
    "    const favoriteOrder = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));",
    "    if (favoriteOrder !== 0) return favoriteOrder;",
    "    return String(a.name).localeCompare(String(b.name), \"ko\");",
    "  });",
    "  elements.appGrid.innerHTML = orderedApps",
    "    .map(installedAppCard)",
    "    .join(\"\");",
  ]),
  "favorites renderer",
);

const actionHelpers = block([
  "async function toggleFavorite(id) {",
  "  const currentApp = state.apps.find((entry) => entry.id === id);",
  "  const result = await bridge.toggleFavorite(id);",
  "  if (!result?.ok) {",
  "    showToast(result?.error || \"즐겨찾기를 변경하지 못했습니다.\");",
  "    return;",
  "  }",
  "  showToast(result.favorite",
  "    ? `${currentApp?.name || \"앱\"}을 즐겨찾기에 추가했습니다.`",
  "    : `${currentApp?.name || \"앱\"}을 즐겨찾기에서 해제했습니다.`);",
  "}",
  "",
  "async function downloadExtensionZips() {",
  "  if (state.downloadingExtensions) return;",
  "  state.downloadingExtensions = true;",
  "  state.downloadProgress = null;",
  "  renderOverview();",
  "  try {",
  "    const result = await bridge.downloadExtensionZips();",
  "    if (result?.canceled) return;",
  "    if (!result?.ok && !result?.downloadedCount) {",
  "      showToast(result?.error || \"확장팩 ZIP을 다운로드하지 못했습니다.\", 5000);",
  "      return;",
  "    }",
  "    showToast(result.failedCount",
  "      ? `${result.downloadedCount}개 ZIP 다운로드 완료 · ${result.failedCount}개 실패`",
  "      : `확장팩 ZIP ${result.downloadedCount}개를 모두 다운로드했습니다.`, 4800);",
  "  } finally {",
  "    state.downloadingExtensions = false;",
  "    state.downloadProgress = null;",
  "    renderOverview();",
  "  }",
  "}",
  "",
]);
ui = replaceOnce(ui, "async function deleteApp(id) {", actionHelpers + "async function deleteApp(id) {", "renderer actions");
ui = replaceOnce(
  ui,
  "    const id = card.dataset.id;\n\n    if (event.target.closest(\".update-button\")) {",
  "    const id = card.dataset.id;\n\n    if (event.target.closest(\".favorite-button\")) {\n      await toggleFavorite(id);\n      return;\n    }\n\n    if (event.target.closest(\".update-button\")) {",
  "favorite click handler",
);
ui = replaceOnce(
  ui,
  "  elements.removedAppGrid.addEventListener(\"click\", async (event) => {",
  block([
    "  elements.favoriteGrid?.addEventListener(\"click\", async (event) => {",
    "    const shortcut = event.target.closest(\".favorite-shortcut\");",
    "    if (!shortcut) return;",
    "    await launchApp(shortcut.dataset.id);",
    "  });",
    "",
    "  elements.removedAppGrid.addEventListener(\"click\", async (event) => {",
  ]).trimEnd(),
  "favorite shortcut handler",
);
ui = replaceOnce(
  ui,
  "  elements.updateAllButton?.addEventListener(\"click\", updateAllApps);",
  "  elements.updateAllButton?.addEventListener(\"click\", updateAllApps);\n  elements.downloadExtensionsButton?.addEventListener(\"click\", downloadExtensionZips);",
  "bulk listener",
);
ui = replaceOnce(
  ui,
  "  bridge.onAppStates(setApps);\n  bridge.onRemovedAppStates(setRemovedApps);",
  block([
    "  bridge.onAppStates(setApps);",
    "  bridge.onRemovedAppStates(setRemovedApps);",
    "  bridge.onBulkDownloadProgress?.((progress) => {",
    "    state.downloadProgress = progress || null;",
    "    renderOverview();",
    "  });",
  ]).trimEnd(),
  "progress subscription",
);
ui = replaceOnce(
  ui,
  block([
    "  const [apps, removedApps] = await Promise.all([",
    "    bridge.listApps(),",
    "    bridge.listRemovedApps(),",
    "  ]);",
    "  setApps(apps);",
    "  setRemovedApps(removedApps);",
  ]),
  block([
    "  const [apps, removedApps, centerInfo] = await Promise.all([",
    "    bridge.listApps(),",
    "    bridge.listRemovedApps(),",
    "    bridge.getCenterInfo(),",
    "  ]);",
    "  if (elements.centerVersionChip && centerInfo?.version) {",
    "    elements.centerVersionChip.textContent = `v${centerInfo.version}`;",
    "    elements.centerVersionChip.title = `현재 SD종합센터 버전: v${centerInfo.version}`;",
    "  }",
    "  setApps(apps);",
    "  setRemovedApps(removedApps);",
  ]),
  "center info initialization",
);
write("public/js/app.js", ui);

// ---- CSS ----
let css = read("public/css/style.css");
css += `\n\n/* v2.1.9: Center version, bulk ZIP download, favorites */\n`;
css += block([
  ".center-version-chip { display:grid;min-height:34px;padding:0 11px;place-items:center;border:1px solid rgba(100,215,255,.22);border-radius:10px;background:rgba(36,112,158,.16);color:#9ee8ff;font-size:.68rem;font-weight:900;letter-spacing:.04em; }",
  ".button-download { border-color:rgba(99,211,255,.28);background:linear-gradient(135deg,rgba(45,150,215,.92),rgba(65,102,203,.92));color:#effbff;box-shadow:0 12px 30px rgba(44,123,211,.18); }",
  ".favorites-section { margin-top:22px;padding:18px;border:1px solid rgba(255,211,95,.16);border-radius:19px;background:linear-gradient(145deg,rgba(52,43,18,.24),rgba(9,22,37,.72)); }",
  ".favorites-heading { display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:13px; }",
  ".favorites-heading h2 { margin:0;font-size:1.2rem;letter-spacing:-.04em; }",
  ".favorites-heading p:last-child { margin:0;color:#8da1b3;font-size:.72rem;font-weight:700; }",
  ".favorite-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px; }",
  ".favorite-shortcut { display:flex;min-width:0;min-height:64px;padding:9px 12px;align-items:center;gap:10px;border:1px solid rgba(255,211,95,.14);border-radius:14px;background:rgba(8,19,32,.78);color:#dce8f3;text-align:left;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease; }",
  ".favorite-shortcut:hover { transform:translateY(-1px);border-color:rgba(255,211,95,.4);background:rgba(28,34,37,.9); }",
  ".favorite-shortcut.is-running { border-color:rgba(78,225,157,.28); }",
  ".favorite-shortcut img { width:42px;height:42px;flex:0 0 auto;border-radius:11px;object-fit:cover;background:#0a1726; }",
  ".favorite-shortcut span { min-width:0;flex:1; }",
  ".favorite-shortcut strong,.favorite-shortcut small { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }",
  ".favorite-shortcut strong { font-size:.78rem; }",
  ".favorite-shortcut small { margin-top:4px;color:#7e95aa;font-size:.62rem;font-weight:750; }",
  ".favorite-shortcut b { color:#ffd86e;font-size:.65rem; }",
  ".favorite-button { display:grid;width:34px;height:34px;flex:0 0 auto;place-items:center;padding:0;border:1px solid rgba(255,211,95,.16);border-radius:10px;background:rgba(7,17,29,.62);color:#7d8fa0;font-size:1.16rem;line-height:1;cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .16s ease; }",
  ".favorite-button:hover { transform:translateY(-1px);border-color:rgba(255,211,95,.5);color:#ffe38b; }",
  ".favorite-button.is-favorite { border-color:rgba(255,211,95,.42);background:rgba(119,87,12,.2);color:#ffd35f;box-shadow:0 0 18px rgba(255,211,95,.1); }",
  "@media (max-width:1100px) { .favorite-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }",
  "@media (max-width:760px) { .favorite-grid { grid-template-columns:1fr; } .favorites-heading { align-items:flex-start;flex-direction:column; } .center-version-chip { display:none; } }",
]);
write("public/css/style.css", css);

console.log("Patched SD Center source to v2.1.9");
