"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v220-extension-store.js <app-root>");
const snippetRoot = path.join(__dirname, "v220-snippets");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}
function snippet(name) {
  return fs.readFileSync(path.join(snippetRoot, name), "utf8").replace(/\r\n/g, "\n");
}
function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}
function lines(items) {
  return items.join("\n");
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.0";
pkg.description = "SD 확장팩 상점에서 설치와 업데이트를 바로 처리하는 통합 센터";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");
const oldCatalogInstallBlock = lines([
  "      const destinationDirectory = path.join(",
  "        INSTALLED_APPS_ROOT,",
  "        inspected.metadata.id,",
  "      );",
  "      installInspectedZip(inspected, destinationDirectory);",
  "      const packagePath = archiveAppZip(",
  "        temporaryZipPath,",
  "        inspected.metadata.id,",
  "      );",
]);
main = replaceOnce(
  main,
  oldCatalogInstallBlock,
  snippet("main-builtin-update-block.txt").trimEnd(),
  "builtin catalog update destination",
);
main = replaceOnce(
  main,
  "  async function installRequiredUpdate(entry, rule) {",
  snippet("main-store-functions.txt") + "  async function installRequiredUpdate(entry, rule) {",
  "store functions",
);
main = replaceOnce(
  main,
  lines([
    "    ipcMain.handle(\"center:toggle-favorite\", (event, id) => toggleFavorite(id));",
    "    ipcMain.handle(\"center:download-extension-zips\", () => downloadAllExtensionZips());",
  ]),
  lines([
    "    ipcMain.handle(\"center:toggle-favorite\", (event, id) => toggleFavorite(id));",
    "    ipcMain.handle(\"center:get-extension-store\", (event, force = false) =>",
    "      getExtensionStoreState({ force: Boolean(force) }),",
    "    );",
    "    ipcMain.handle(\"center:install-store-app\", (event, id) =>",
    "      installStoreApp(id),",
    "    );",
  ]),
  "store IPC",
);
write("main.js", main);

let preload = read("preload.js");
preload = replaceOnce(
  preload,
  lines([
    "  toggleFavorite: (id) => invoke(\"center:toggle-favorite\", id),",
    "  downloadExtensionZips: () => invoke(\"center:download-extension-zips\"),",
  ]),
  lines([
    "  toggleFavorite: (id) => invoke(\"center:toggle-favorite\", id),",
    "  getExtensionStore: (force = false) => invoke(\"center:get-extension-store\", force),",
    "  installStoreApp: (id) => invoke(\"center:install-store-app\", id),",
  ]),
  "preload store APIs",
);
preload = replaceOnce(
  preload,
  lines([
    "  onRemovedAppStates: (callback) =>",
    "    subscribe(\"center:removed-app-states\", callback),",
    "  onBulkDownloadProgress: (callback) =>",
    "    subscribe(\"center:bulk-download-progress\", callback),",
  ]),
  lines([
    "  onRemovedAppStates: (callback) =>",
    "    subscribe(\"center:removed-app-states\", callback),",
  ]),
  "remove bulk preload subscription",
);
write("preload.js", preload);

let html = read("public/index.html");
html = replaceOnce(
  html,
  "          <button id=\"downloadExtensionsButton\" class=\"button button-download\" type=\"button\">확장팩 ZIP 일괄 다운로드</button>\n",
  "",
  "remove bulk download button",
);
html = replaceOnce(
  html,
  lines([
    "      <button id=\"removedTabButton\" class=\"app-tab\" type=\"button\" data-tab=\"removed\">",
    "        삭제된 앱 보관함 <span id=\"removedTabCount\">0</span>",
    "      </button>",
  ]),
  lines([
    "      <button id=\"storeTabButton\" class=\"app-tab store-tab\" type=\"button\" data-tab=\"store\">",
    "        확장팩 상점 <span id=\"storeTabCount\">0</span>",
    "      </button>",
    "      <button id=\"removedTabButton\" class=\"app-tab\" type=\"button\" data-tab=\"removed\">",
    "        삭제된 앱 보관함 <span id=\"removedTabCount\">0</span>",
    "      </button>",
  ]),
  "store tab",
);
html = replaceOnce(
  html,
  "    <section id=\"removedPanel\" class=\"app-panel hidden\" aria-live=\"polite\">",
  snippet("store-panel.html") + "    <section id=\"removedPanel\" class=\"app-panel hidden\" aria-live=\"polite\">",
  "store panel",
);
write("public/index.html", html);

let ui = read("public/js/app.js");
ui = replaceOnce(
  ui,
  lines([
    "  removedPanel: document.getElementById(\"removedPanel\"),",
    "  installedTabButton: document.getElementById(\"installedTabButton\"),",
    "  removedTabButton: document.getElementById(\"removedTabButton\"),",
    "  installedTabCount: document.getElementById(\"installedTabCount\"),",
    "  removedTabCount: document.getElementById(\"removedTabCount\"),",
  ]),
  lines([
    "  removedPanel: document.getElementById(\"removedPanel\"),",
    "  storePanel: document.getElementById(\"storePanel\"),",
    "  installedTabButton: document.getElementById(\"installedTabButton\"),",
    "  storeTabButton: document.getElementById(\"storeTabButton\"),",
    "  removedTabButton: document.getElementById(\"removedTabButton\"),",
    "  installedTabCount: document.getElementById(\"installedTabCount\"),",
    "  storeTabCount: document.getElementById(\"storeTabCount\"),",
    "  removedTabCount: document.getElementById(\"removedTabCount\"),",
    "  storeGrid: document.getElementById(\"storeGrid\"),",
    "  storeEmpty: document.getElementById(\"storeEmpty\"),",
    "  storeRefreshButton: document.getElementById(\"storeRefreshButton\"),",
    "  storeStatusSummary: document.getElementById(\"storeStatusSummary\"),",
  ]),
  "store elements",
);
ui = replaceOnce(
  ui,
  lines([
    "  centerVersionChip: document.getElementById(\"centerVersionChip\"),",
    "  downloadExtensionsButton: document.getElementById(\"downloadExtensionsButton\"),",
  ]),
  "  centerVersionChip: document.getElementById(\"centerVersionChip\"),",
  "remove bulk element",
);
ui = replaceOnce(
  ui,
  lines([
    "  removedApps: [],",
    "  activeTab: \"installed\",",
    "  busyIds: new Set(),",
  ]),
  lines([
    "  removedApps: [],",
    "  storeApps: [],",
    "  activeTab: \"installed\",",
    "  busyIds: new Set(),",
    "  storeBusyIds: new Set(),",
    "  storeLoading: false,",
  ]),
  "store state",
);
ui = replaceOnce(
  ui,
  lines([
    "  downloadingExtensions: false,",
    "  downloadProgress: null,",
  ]) + "\n",
  "",
  "remove bulk state",
);

const bulkOverviewStart = "  if (elements.downloadExtensionsButton) {";
const bulkOverviewEnd = "  document.documentElement.style.setProperty(";
const bulkStartIndex = ui.indexOf(bulkOverviewStart);
const bulkEndIndex = ui.indexOf(bulkOverviewEnd, bulkStartIndex);
if (bulkStartIndex < 0 || bulkEndIndex < 0) throw new Error("Patch marker missing: bulk overview block");
ui = ui.slice(0, bulkStartIndex) + ui.slice(bulkEndIndex);

ui = ui.replace(
  "`${updateCount}개 확장팩 업데이트 가능 · 카드의 업데이트 버튼 또는 모두 업데이트를 사용할 수 있습니다.`",
  "`${updateCount}개 확장팩 업데이트 가능 · 확장팩 상점에서 업데이트할 수 있습니다.`",
);
ui = ui.replace(
  "app.updateAvailable\n      ? `v${app.latestVersion} 업데이트`",
  "app.updateAvailable\n      ? \"상점 업데이트\"",
);

const updateButtonStart = "        ${\n          app.updateAvailable\n            ? `<button class=\"button button-secondary update-button\"";
const updateButtonEndMarker = "        ${\n          app.running";
const updateButtonStartIndex = ui.indexOf(updateButtonStart);
const updateButtonEndIndex = ui.indexOf(updateButtonEndMarker, updateButtonStartIndex);
if (updateButtonStartIndex < 0 || updateButtonEndIndex < 0) throw new Error("Patch marker missing: installed update button");
ui = ui.slice(0, updateButtonStartIndex) + ui.slice(updateButtonEndIndex);

ui = replaceOnce(
  ui,
  "function renderApps() {",
  snippet("ui-store-functions.txt") + "function renderApps() {",
  "store UI functions",
);
ui = replaceOnce(
  ui,
  lines([
    "  renderOverview();",
    "  renderFavorites();",
  ]),
  lines([
    "  renderOverview();",
    "  renderFavorites();",
    "  renderStore();",
  ]),
  "render store",
);
ui = replaceOnce(
  ui,
  lines([
    "function selectTab(tab) {",
    "  state.activeTab = tab === \"removed\" ? \"removed\" : \"installed\";",
    "  const removedActive = state.activeTab === \"removed\";",
    "",
    "  elements.installedPanel.classList.toggle(\"hidden\", removedActive);",
    "  elements.removedPanel.classList.toggle(\"hidden\", !removedActive);",
    "  elements.installedTabButton.classList.toggle(\"active\", !removedActive);",
    "  elements.removedTabButton.classList.toggle(\"active\", removedActive);",
    "}",
  ]),
  lines([
    "function selectTab(tab) {",
    "  state.activeTab = tab === \"removed\" || tab === \"store\" ? tab : \"installed\";",
    "  const installedActive = state.activeTab === \"installed\";",
    "  const storeActive = state.activeTab === \"store\";",
    "  const removedActive = state.activeTab === \"removed\";",
    "",
    "  elements.installedPanel.classList.toggle(\"hidden\", !installedActive);",
    "  elements.storePanel.classList.toggle(\"hidden\", !storeActive);",
    "  elements.removedPanel.classList.toggle(\"hidden\", !removedActive);",
    "  elements.installedTabButton.classList.toggle(\"active\", installedActive);",
    "  elements.storeTabButton.classList.toggle(\"active\", storeActive);",
    "  elements.removedTabButton.classList.toggle(\"active\", removedActive);",
    "  if (storeActive && state.storeApps.length === 0 && !state.storeLoading) {",
    "    void loadStore(true);",
    "  }",
    "}",
  ]),
  "three tabs",
);
ui = replaceOnce(
  ui,
  lines([
    "  elements.removedTabButton.addEventListener(\"click\", () => {",
    "    selectTab(\"removed\");",
    "  });",
  ]),
  lines([
    "  elements.storeTabButton.addEventListener(\"click\", () => {",
    "    selectTab(\"store\");",
    "  });",
    "",
    "  elements.removedTabButton.addEventListener(\"click\", () => {",
    "    selectTab(\"removed\");",
    "  });",
    "",
    "  elements.storeRefreshButton?.addEventListener(\"click\", () => {",
    "    void loadStore(true);",
    "  });",
    "",
    "  elements.storeGrid?.addEventListener(\"click\", async (event) => {",
    "    const card = event.target.closest(\".store-card\");",
    "    const action = event.target.closest(\".store-action-button\");",
    "    if (!card || !action || action.disabled) return;",
    "    await installFromStore(card.dataset.id);",
    "  });",
  ]),
  "store events",
);
ui = ui.replace("  elements.downloadExtensionsButton?.addEventListener(\"click\", downloadExtensionZips);\n", "");
ui = ui.replace("  ensureUpdateControls();\n  bindEvents();", "  bindEvents();");
ui = replaceOnce(
  ui,
  lines([
    "  const [apps, removedApps, centerInfo] = await Promise.all([",
    "    bridge.listApps(),",
    "    bridge.listRemovedApps(),",
    "    bridge.getCenterInfo(),",
    "  ]);",
  ]),
  lines([
    "  const [apps, removedApps, centerInfo, store] = await Promise.all([",
    "    bridge.listApps(),",
    "    bridge.listRemovedApps(),",
    "    bridge.getCenterInfo(),",
    "    bridge.getExtensionStore(false),",
    "  ]);",
  ]),
  "startup store load",
);
ui = replaceOnce(
  ui,
  lines([
    "  setApps(apps);",
    "  setRemovedApps(removedApps);",
    "  selectTab(\"installed\");",
  ]),
  lines([
    "  if (store?.ok && Array.isArray(store.apps)) {",
    "    state.storeApps = store.apps;",
    "  }",
    "  setApps(apps);",
    "  setRemovedApps(removedApps);",
    "  renderStore();",
    "  selectTab(\"installed\");",
  ]),
  "initialize store",
);
write("public/js/app.js", ui);

let css = read("public/css/style.css");
css += snippet("store.css");
write("public/css/style.css", css);

console.log("SDCenter v2.2.0 extension store patch applied");
