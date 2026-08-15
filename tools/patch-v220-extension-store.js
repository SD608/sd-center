"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v220-extension-store.js <app-root>");

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

// package.json
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.0";
pkg.description = "SD 확장팩 상점에서 설치와 업데이트를 바로 처리하는 통합 센터";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

// main.js
let main = read("main.js");

main = replaceOnce(
  main,
  `      const destinationDirectory = path.join(\n        INSTALLED_APPS_ROOT,\n        inspected.metadata.id,\n      );\n      installInspectedZip(inspected, destinationDirectory);\n      const packagePath = archiveAppZip(\n        temporaryZipPath,\n        inspected.metadata.id,\n      );`,
  `      const destinationDirectory = entry.builtin\n        ? entry.directory\n        : path.join(INSTALLED_APPS_ROOT, inspected.metadata.id);\n      installInspectedZip(inspected, destinationDirectory);\n\n      if (entry.builtin) {\n        registry = {\n          ...registry,\n          hiddenBuiltinIds: (registry.hiddenBuiltinIds || []).filter(\n            (knownId) => knownId !== entry.id,\n          ),\n          customApps: (registry.customApps || []).filter(\n            (knownEntry) => knownEntry.id !== entry.id,\n          ),\n          removedApps: (registry.removedApps || []).filter(\n            (knownEntry) => knownEntry.id !== entry.id,\n          ),\n        };\n        saveRegistry(REGISTRY_PATH, registry);\n        const staleCustomDirectory = path.join(INSTALLED_APPS_ROOT, entry.id);\n        if (path.resolve(staleCustomDirectory) !== path.resolve(destinationDirectory)) {\n          fs.rmSync(staleCustomDirectory, { recursive: true, force: true });\n        }\n        fs.rmSync(path.join(APP_PACKAGES_ROOT, \\`${entry.id}.zip\\`), { force: true });\n        refreshCatalogAndUi();\n        return appById.get(entry.id);\n      }\n\n      const packagePath = archiveAppZip(\n        temporaryZipPath,\n        inspected.metadata.id,\n      );`,
  "builtin catalog update destination",
);

const storeFunctions = `
  function extensionStoreRule(id) {
    const appId = String(id || "").trim();
    const rule = extensionCatalog?.apps?.[appId];
    if (!rule || !rule.version || !rule.downloadUrl) return null;
    return rule;
  }

  function extensionStoreEntry(id, rule) {
    const appId = String(id || "");
    const installed = appById.get(appId) || null;
    const removed = removedById.get(appId) || null;
    const builtin = BUILTIN_CATALOG.some((entry) => entry.id === appId);
    const latestVersion = String(rule?.version || "0.0.0");
    const currentVersion = installed ? rawEntryVersion(installed) : "";
    const updateAvailable = Boolean(
      installed && compareVersions(currentVersion, latestVersion) < 0,
    );
    const visualEntry = installed || removed;

    return {
      id: appId,
      name: String(rule?.name || visualEntry?.name || appId),
      latestVersion,
      currentVersion,
      notes: String(rule?.notes || ""),
      description: String(
        visualEntry?.description ||
        rule?.description ||
        "SD 홈페이지 카탈로그에서 제공하는 공식 확장팩입니다.",
      ),
      accent: String(visualEntry?.accent || rule?.accent || "cyan"),
      iconUrl: visualEntry ? appIconUrl(visualEntry) : "",
      installed: Boolean(installed),
      removed: Boolean(removed),
      builtin,
      running: Boolean(installed && runningApps.get(appId)?.exitCode === null),
      updateAvailable,
      status: installed
        ? updateAvailable
          ? "update"
          : "installed"
        : "available",
    };
  }

  async function getExtensionStoreState({ force = false } = {}) {
    try {
      await refreshExtensionCatalog({ force });
      const apps = Object.entries(extensionCatalog?.apps || {})
        .filter(([, rule]) => rule?.version && rule?.downloadUrl)
        .map(([id, rule]) => extensionStoreEntry(id, rule))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
      return {
        ok: true,
        catalogVersion: extensionCatalog?.catalogVersion || 0,
        updatedAt: extensionCatalog?.updatedAt || "",
        count: apps.length,
        apps,
      };
    } catch (error) {
      return { ok: false, error: error.message, apps: [] };
    }
  }

  function clearRemovedStoreFiles(entry, replacementPackagePath = "") {
    if (!entry || entry.builtin) return;
    const recycleDirectory = entry.recycleDirectory || "";
    const oldPackagePath = entry.packagePath || "";
    if (recycleDirectory && fs.existsSync(recycleDirectory)) {
      removeFileIfManaged(recycleDirectory, REMOVED_APPS_ROOT);
    }
    if (
      oldPackagePath &&
      oldPackagePath !== replacementPackagePath &&
      fs.existsSync(oldPackagePath)
    ) {
      removeFileIfManaged(oldPackagePath, APP_PACKAGES_ROOT);
    }
  }

  async function installFreshStoreApp(appId, rule) {
    ensureManagedDirectory(APP_PACKAGES_ROOT);
    const temporaryZipPath = path.join(
      APP_PACKAGES_ROOT,
      \\`.store-${appId}-${Date.now()}.zip\\`,
    );

    try {
      await downloadFile(String(rule.downloadUrl), temporaryZipPath);
      const inspected = inspectZip(temporaryZipPath);
      if (inspected.metadata.id !== appId) {
        throw new Error(
          \\`상점 앱 ID가 다릅니다. 카탈로그: ${appId} / ZIP: ${inspected.metadata.id}\\`,
        );
      }
      if (
        compareVersions(
          inspected.metadata.rawVersion,
          String(rule.version || "0.0.0"),
        ) < 0
      ) {
        throw new Error(
          \\`다운로드된 버전(v${inspected.metadata.rawVersion})이 상점 최신 버전(v${rule.version})보다 낮습니다.\\`,
        );
      }

      const protectedDataFolders = new Set([
        "SD종합센터",
        ...BUILTIN_CATALOG.map((entry) => entry.userDataFolder),
      ]);
      if (protectedDataFolders.has(inspected.metadata.userDataFolder)) {
        throw new Error("상점 확장팩의 저장 폴더가 기본 앱과 충돌합니다.");
      }

      const collision = [...appCatalog, ...removedCatalog].find(
        (entry) =>
          entry.id !== appId &&
          entry.userDataFolder === inspected.metadata.userDataFolder,
      );
      if (collision) {
        throw new Error(\\`${collision.name}과 같은 저장 폴더를 사용합니다.\\`);
      }

      const removedExisting = removedById.get(appId) || null;
      const destinationDirectory = path.join(INSTALLED_APPS_ROOT, appId);
      installInspectedZip(inspected, destinationDirectory);
      const packagePath = archiveAppZip(temporaryZipPath, appId);
      clearRemovedStoreFiles(removedExisting, packagePath);

      const appEntry = {
        ...inspected.metadata,
        directory: destinationDirectory,
        packagePath,
        importedAt: removedExisting?.importedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      registry = upsertCustomApp(registry, appEntry);
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();
      return appById.get(appId);
    } finally {
      fs.rmSync(temporaryZipPath, { force: true });
    }
  }

  async function installStoreApp(id) {
    const appId = String(id || "").trim();
    if (!appId) return { ok: false, error: "확장팩 ID가 없습니다." };

    try {
      await refreshExtensionCatalog({ force: true });
      const rule = extensionStoreRule(appId);
      if (!rule) {
        return { ok: false, error: "홈페이지 확장팩 카탈로그에서 앱을 찾지 못했습니다." };
      }

      let entry = appById.get(appId) || null;
      const latestVersion = String(rule.version || "0.0.0");
      if (entry) {
        if (compareVersions(rawEntryVersion(entry), latestVersion) >= 0) {
          return {
            ok: true,
            alreadyLatest: true,
            action: "installed",
            store: await getExtensionStoreState(),
          };
        }
        const updatedEntry = await installCatalogUpdate(entry, rule);
        return {
          ok: true,
          action: "updated",
          app: publicAppState(updatedEntry),
          store: await getExtensionStoreState(),
        };
      }

      const builtinDefinition = BUILTIN_CATALOG.find(
        (candidate) => candidate.id === appId,
      );
      if (builtinDefinition) {
        registry = {
          ...registry,
          hiddenBuiltinIds: (registry.hiddenBuiltinIds || []).filter(
            (knownId) => knownId !== appId,
          ),
          customApps: (registry.customApps || []).filter(
            (knownEntry) => knownEntry.id !== appId,
          ),
          removedApps: (registry.removedApps || []).filter(
            (knownEntry) => knownEntry.id !== appId,
          ),
        };
        saveRegistry(REGISTRY_PATH, registry);
        refreshCatalogAndUi();
        entry = appById.get(appId);
        if (!entry) throw new Error("기본 앱을 상점에서 복원하지 못했습니다.");
        if (compareVersions(rawEntryVersion(entry), latestVersion) < 0) {
          entry = await installCatalogUpdate(entry, rule);
        }
        return {
          ok: true,
          action: "installed",
          app: publicAppState(entry),
          store: await getExtensionStoreState(),
        };
      }

      const installedEntry = await installFreshStoreApp(appId, rule);
      return {
        ok: true,
        action: "installed",
        app: publicAppState(installedEntry),
        store: await getExtensionStoreState(),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

`;

main = replaceOnce(
  main,
  "  async function installRequiredUpdate(entry, rule) {",
  storeFunctions + "  async function installRequiredUpdate(entry, rule) {",
  "extension store functions",
);

main = replaceOnce(
  main,
  `    ipcMain.handle("center:toggle-favorite", (event, id) => toggleFavorite(id));\n    ipcMain.handle("center:download-extension-zips", () => downloadAllExtensionZips());`,
  `    ipcMain.handle("center:toggle-favorite", (event, id) => toggleFavorite(id));\n    ipcMain.handle("center:get-extension-store", (event, force = false) =>\n      getExtensionStoreState({ force: Boolean(force) }),\n    );\n    ipcMain.handle("center:install-store-app", (event, id) =>\n      installStoreApp(id),\n    );`,
  "store IPC handlers",
);

write("main.js", main);

// preload.js
let preload = read("preload.js");
preload = replaceOnce(
  preload,
  `  toggleFavorite: (id) => invoke("center:toggle-favorite", id),\n  downloadExtensionZips: () => invoke("center:download-extension-zips"),`,
  `  toggleFavorite: (id) => invoke("center:toggle-favorite", id),\n  getExtensionStore: (force = false) => invoke("center:get-extension-store", force),\n  installStoreApp: (id) => invoke("center:install-store-app", id),`,
  "preload store commands",
);
preload = replaceOnce(
  preload,
  `  onRemovedAppStates: (callback) =>\n    subscribe("center:removed-app-states", callback),\n  onBulkDownloadProgress: (callback) =>\n    subscribe("center:bulk-download-progress", callback),`,
  `  onRemovedAppStates: (callback) =>\n    subscribe("center:removed-app-states", callback),`,
  "remove bulk progress preload",
);
write("preload.js", preload);

// public/index.html
let html = read("public/index.html");
html = replaceOnce(
  html,
  `          <button id="downloadExtensionsButton" class="button button-download" type="button">확장팩 ZIP 일괄 다운로드</button>\n`,
  "",
  "remove bulk download button",
);
html = replaceOnce(
  html,
  `      <button id="removedTabButton" class="app-tab" type="button" data-tab="removed">\n        삭제된 앱 보관함 <span id="removedTabCount">0</span>\n      </button>`,
  `      <button id="storeTabButton" class="app-tab store-tab" type="button" data-tab="store">\n        확장팩 상점 <span id="storeTabCount">0</span>\n      </button>\n      <button id="removedTabButton" class="app-tab" type="button" data-tab="removed">\n        삭제된 앱 보관함 <span id="removedTabCount">0</span>\n      </button>`,
  "store tab",
);

const storePanel = `
    <section id="storePanel" class="app-panel hidden" aria-live="polite">
      <section class="store-banner">
        <div class="store-banner-copy">
          <p class="eyebrow">SD EXTENSION STORE</p>
          <h2>확장팩 상점</h2>
          <p>SD 홈페이지의 공식 확장팩 카탈로그와 연결되어 있습니다. ZIP 파일을 따로 받을 필요 없이 설치와 업데이트를 여기서 바로 진행합니다.</p>
          <div class="store-badges">
            <span>홈페이지 연동</span>
            <span>원클릭 설치</span>
            <span>상점 업데이트</span>
          </div>
        </div>
        <button id="storeRefreshButton" class="button button-secondary" type="button">상점 새로고침</button>
      </section>

      <section class="section-heading store-section-heading">
        <div>
          <p class="eyebrow">ONLINE CATALOG</p>
          <h2>다운로드 가능한 확장팩</h2>
        </div>
        <p id="storeStatusSummary" class="status-summary">홈페이지 카탈로그 연결 중...</p>
      </section>

      <section id="storeGrid" class="store-grid"></section>
      <section id="storeEmpty" class="removed-empty hidden">
        <strong>상점 정보를 불러오지 못했습니다.</strong>
        <p>인터넷 연결을 확인한 뒤 상점 새로고침을 눌러주세요.</p>
      </section>
    </section>

`;
html = replaceOnce(
  html,
  `    <section id="removedPanel" class="app-panel hidden" aria-live="polite">`,
  storePanel + `    <section id="removedPanel" class="app-panel hidden" aria-live="polite">`,
  "store panel",
);
write("public/index.html", html);

// public/js/app.js
let ui = read("public/js/app.js");
ui = replaceOnce(
  ui,
  `  removedPanel: document.getElementById("removedPanel"),\n  installedTabButton: document.getElementById("installedTabButton"),\n  removedTabButton: document.getElementById("removedTabButton"),\n  installedTabCount: document.getElementById("installedTabCount"),\n  removedTabCount: document.getElementById("removedTabCount"),`,
  `  removedPanel: document.getElementById("removedPanel"),\n  storePanel: document.getElementById("storePanel"),\n  installedTabButton: document.getElementById("installedTabButton"),\n  storeTabButton: document.getElementById("storeTabButton"),\n  removedTabButton: document.getElementById("removedTabButton"),\n  installedTabCount: document.getElementById("installedTabCount"),\n  storeTabCount: document.getElementById("storeTabCount"),\n  removedTabCount: document.getElementById("removedTabCount"),\n  storeGrid: document.getElementById("storeGrid"),\n  storeEmpty: document.getElementById("storeEmpty"),\n  storeRefreshButton: document.getElementById("storeRefreshButton"),\n  storeStatusSummary: document.getElementById("storeStatusSummary"),`,
  "store elements",
);
ui = replaceOnce(
  ui,
  `  centerVersionChip: document.getElementById("centerVersionChip"),\n  downloadExtensionsButton: document.getElementById("downloadExtensionsButton"),`,
  `  centerVersionChip: document.getElementById("centerVersionChip"),`,
  "remove bulk element",
);
ui = replaceOnce(
  ui,
  `  removedApps: [],\n  activeTab: "installed",\n  busyIds: new Set(),`,
  `  removedApps: [],\n  storeApps: [],\n  activeTab: "installed",\n  busyIds: new Set(),\n  storeBusyIds: new Set(),\n  storeLoading: false,`,
  "store state",
);
ui = replaceOnce(
  ui,
  `  downloadingExtensions: false,\n  downloadProgress: null,\n`,
  "",
  "remove bulk state",
);

ui = replaceOnce(
  ui,
  `  if (elements.downloadExtensionsButton) {\n    const progress = state.downloadProgress;\n    elements.downloadExtensionsButton.disabled = state.downloadingExtensions;\n    elements.downloadExtensionsButton.textContent = state.downloadingExtensions\n      ? progress?.total\n        ? \\`ZIP 다운로드 중 (${progress.completed}/${progress.total})\\`\n        : "ZIP 다운로드 준비 중..."\n      : "확장팩 ZIP 일괄 다운로드";\n  }\n\n`,
  "",
  "remove bulk overview",
);
ui = replaceOnce(
  ui,
  `      \\`${updateCount}개 확장팩 업데이트 가능 · 카드의 업데이트 버튼 또는 모두 업데이트를 사용할 수 있습니다.\\`;`,
  `      \\`${updateCount}개 확장팩 업데이트 가능 · 확장팩 상점에서 업데이트할 수 있습니다.\\`;`,
  "update summary store wording",
);
ui = replaceOnce(
  ui,
  `    : app.updateAvailable\n      ? \\`v${app.latestVersion} 업데이트\\``,
  `    : app.updateAvailable\n      ? "상점 업데이트"`,
  "installed card store status",
);
ui = replaceOnce(
  ui,
  `        ${\n          app.updateAvailable\n            ? \\`<button class="button button-secondary update-button" type="button" ${busy ? "disabled" : ""}>v${escapeHtml(app.latestVersion)} 업데이트</button>\\`\n            : ""\n        }\n`,
  "",
  "remove installed update button",
);

const storeUiFunctions = `
function storeCard(app) {
  const busy = state.storeBusyIds.has(app.id);
  const actionLabel = app.installed
    ? app.updateAvailable
      ? "업데이트"
      : "설치됨"
    : app.removed
      ? "다시 설치"
      : "설치";
  const statusLabel = app.installed
    ? app.updateAvailable
      ? `v${app.currentVersion} → v${app.latestVersion}`
      : `최신 v${app.latestVersion}`
    : `v${app.latestVersion}`;
  const buttonClass = app.installed && !app.updateAvailable
    ? "button button-secondary store-action-button is-installed"
    : "button button-primary store-action-button";
  const disabled = busy || (app.installed && !app.updateAvailable);
  const icon = app.iconUrl
    ? `<img src="${escapeHtml(app.iconUrl)}" alt="" draggable="false">`
    : `<span class="store-generic-icon">SD</span>`;

  return `
    <article class="store-card" data-id="${escapeHtml(app.id)}" data-accent="${escapeHtml(app.accent)}">
      <div class="store-card-top">
        <div class="store-app-identity">
          <div class="store-app-icon">${icon}</div>
          <div>
            <div class="store-name-row">
              <strong>${escapeHtml(app.name)}</strong>
              ${app.builtin ? '<span class="store-type-badge">기본 앱</span>' : '<span class="store-type-badge">확장팩</span>'}
            </div>
            <span class="store-version">${escapeHtml(statusLabel)}</span>
          </div>
        </div>
        <span class="store-price">FREE</span>
      </div>
      <p class="store-description">${escapeHtml(app.description)}</p>
      <div class="store-notes">
        <span>UPDATE NOTES</span>
        <p>${escapeHtml(app.notes || "최신 공식 확장팩 버전입니다.")}</p>
      </div>
      <div class="store-card-footer">
        <span class="store-state ${app.updateAvailable ? "needs-update" : app.installed ? "installed" : "available"}">
          ${app.updateAvailable ? "업데이트 가능" : app.installed ? "설치 완료" : app.removed ? "보관함에 있음" : "설치 가능"}
        </span>
        <button class="${buttonClass}" type="button" ${disabled ? "disabled" : ""}>
          ${busy ? "처리 중..." : actionLabel}
        </button>
      </div>
    </article>
  `;
}

function renderStore() {
  if (!elements.storeGrid) return;
  elements.storeTabCount.textContent = String(state.storeApps.length);
  elements.storeGrid.innerHTML = state.storeApps.map(storeCard).join("");
  elements.storeEmpty?.classList.toggle(
    "hidden",
    state.storeLoading || state.storeApps.length > 0,
  );
  const installed = state.storeApps.filter((app) => app.installed).length;
  const updates = state.storeApps.filter((app) => app.updateAvailable).length;
  if (elements.storeStatusSummary) {
    elements.storeStatusSummary.textContent = state.storeLoading
      ? "홈페이지 카탈로그 새로고침 중..."
      : updates > 0
        ? `${state.storeApps.length}개 상품 · ${updates}개 업데이트 가능`
        : `${state.storeApps.length}개 상품 · ${installed}개 설치됨`;
  }
  if (elements.storeRefreshButton) {
    elements.storeRefreshButton.disabled = state.storeLoading;
    elements.storeRefreshButton.textContent = state.storeLoading
      ? "새로고침 중..."
      : "상점 새로고침";
  }
}

async function loadStore(force = false) {
  if (state.storeLoading) return;
  state.storeLoading = true;
  renderStore();
  try {
    const result = await bridge.getExtensionStore(force);
    if (!result?.ok) {
      showToast(result?.error || "확장팩 상점을 불러오지 못했습니다.", 4500);
      return;
    }
    state.storeApps = Array.isArray(result.apps) ? result.apps : [];
  } finally {
    state.storeLoading = false;
    renderStore();
  }
}

async function installFromStore(id) {
  if (state.storeBusyIds.has(id)) return;
  const current = state.storeApps.find((entry) => entry.id === id);
  state.storeBusyIds.add(id);
  renderStore();
  try {
    const result = await bridge.installStoreApp(id);
    if (!result?.ok) {
      showToast(result?.error || "확장팩을 설치하지 못했습니다.", 5000);
      return;
    }
    if (result.store?.apps) {
      state.storeApps = result.store.apps;
    } else {
      await loadStore(false);
    }
    showToast(
      result.alreadyLatest
        ? `${current?.name || "확장팩"}은 이미 최신 버전입니다.`
        : result.action === "updated"
          ? `${current?.name || "확장팩"} 업데이트를 완료했습니다.`
          : `${current?.name || "확장팩"} 설치를 완료했습니다.`,
      4200,
    );
  } finally {
    state.storeBusyIds.delete(id);
    renderStore();
  }
}

`;
ui = replaceOnce(
  ui,
  "function renderApps() {",
  storeUiFunctions + "function renderApps() {",
  "store UI functions",
);
ui = replaceOnce(
  ui,
  `  renderOverview();\n  renderFavorites();`,
  `  renderOverview();\n  renderFavorites();\n  renderStore();`,
  "render store",
);

ui = replaceOnce(
  ui,
  `function selectTab(tab) {\n  state.activeTab = tab === "removed" ? "removed" : "installed";\n  const removedActive = state.activeTab === "removed";\n\n  elements.installedPanel.classList.toggle("hidden", removedActive);\n  elements.removedPanel.classList.toggle("hidden", !removedActive);\n  elements.installedTabButton.classList.toggle("active", !removedActive);\n  elements.removedTabButton.classList.toggle("active", removedActive);\n}`,
  `function selectTab(tab) {\n  state.activeTab = tab === "removed" || tab === "store" ? tab : "installed";\n  const installedActive = state.activeTab === "installed";\n  const storeActive = state.activeTab === "store";\n  const removedActive = state.activeTab === "removed";\n\n  elements.installedPanel.classList.toggle("hidden", !installedActive);\n  elements.storePanel.classList.toggle("hidden", !storeActive);\n  elements.removedPanel.classList.toggle("hidden", !removedActive);\n  elements.installedTabButton.classList.toggle("active", installedActive);\n  elements.storeTabButton.classList.toggle("active", storeActive);\n  elements.removedTabButton.classList.toggle("active", removedActive);\n  if (storeActive && state.storeApps.length === 0 && !state.storeLoading) {\n    void loadStore(true);\n  }\n}`,
  "three tabs",
);

ui = replaceOnce(
  ui,
  `async function downloadExtensionZips() {\n  if (state.downloadingExtensions) return;\n  state.downloadingExtensions = true;\n  state.downloadProgress = null;\n  renderOverview();\n  try {\n    const result = await bridge.downloadExtensionZips();\n    if (result?.canceled) return;\n    if (!result?.ok && !result?.downloadedCount) {\n      showToast(result?.error || "확장팩 ZIP을 다운로드하지 못했습니다.", 5000);\n      return;\n    }\n    showToast(result.failedCount\n      ? \\`${result.downloadedCount}개 ZIP 다운로드 완료 · ${result.failedCount}개 실패\\`\n      : \\`확장팩 ZIP ${result.downloadedCount}개를 모두 다운로드했습니다.\\`, 4800);\n  } finally {\n    state.downloadingExtensions = false;\n    state.downloadProgress = null;\n    renderOverview();\n  }\n}\n\n`,
  "",
  "remove bulk UI function",
);

ui = replaceOnce(
  ui,
  `  elements.removedTabButton.addEventListener("click", () => {\n    selectTab("removed");\n  });`,
  `  elements.storeTabButton.addEventListener("click", () => {\n    selectTab("store");\n  });\n\n  elements.removedTabButton.addEventListener("click", () => {\n    selectTab("removed");\n  });\n\n  elements.storeRefreshButton?.addEventListener("click", () => {\n    void loadStore(true);\n  });\n\n  elements.storeGrid?.addEventListener("click", async (event) => {\n    const card = event.target.closest(".store-card");\n    const action = event.target.closest(".store-action-button");\n    if (!card || !action || action.disabled) return;\n    await installFromStore(card.dataset.id);\n  });`,
  "store events",
);
ui = replaceOnce(
  ui,
  `  elements.downloadExtensionsButton?.addEventListener("click", downloadExtensionZips);\n`,
  "",
  "remove bulk event",
);
ui = replaceOnce(
  ui,
  `  bridge.onBulkDownloadProgress?.((progress) => {\n    state.downloadProgress = progress || null;\n    renderOverview();\n  });\n`,
  "",
  "remove bulk subscription",
);
ui = replaceOnce(
  ui,
  `  ensureUpdateControls();\n  bindEvents();`,
  `  bindEvents();`,
  "move update controls to store",
);
ui = replaceOnce(
  ui,
  `  const [apps, removedApps, centerInfo] = await Promise.all([\n    bridge.listApps(),\n    bridge.listRemovedApps(),\n    bridge.getCenterInfo(),\n  ]);`,
  `  const [apps, removedApps, centerInfo, store] = await Promise.all([\n    bridge.listApps(),\n    bridge.listRemovedApps(),\n    bridge.getCenterInfo(),\n    bridge.getExtensionStore(false),\n  ]);`,
  "load store on startup",
);
ui = replaceOnce(
  ui,
  `  setApps(apps);\n  setRemovedApps(removedApps);\n  selectTab("installed");`,
  `  if (store?.ok && Array.isArray(store.apps)) {\n    state.storeApps = store.apps;\n  }\n  setApps(apps);\n  setRemovedApps(removedApps);\n  renderStore();\n  selectTab("installed");`,
  "initialize store",
);
write("public/js/app.js", ui);

// CSS
let css = read("public/css/style.css");
css += `

/* v2.2.0 · SD Extension Store */
.store-tab { color:#a9e8ff; }
.store-banner { display:flex;margin-top:20px;padding:30px 32px;align-items:center;justify-content:space-between;gap:28px;border:1px solid rgba(102,215,255,.2);border-radius:24px;background:radial-gradient(circle at 78% 15%,rgba(88,210,255,.16),transparent 36%),linear-gradient(135deg,rgba(18,52,78,.94),rgba(8,22,38,.95));box-shadow:0 20px 55px rgba(0,0,0,.2); }
.store-banner-copy { max-width:850px; }
.store-banner h2 { margin:0;font-size:2rem;letter-spacing:-.05em; }
.store-banner-copy>p:not(.eyebrow) { margin:13px 0 0;color:#9fb4c7;font-size:.84rem;line-height:1.7; }
.store-badges { display:flex;margin-top:18px;gap:8px;flex-wrap:wrap; }
.store-badges span { padding:7px 10px;border:1px solid rgba(103,211,255,.18);border-radius:999px;background:rgba(7,20,34,.55);color:#9edfff;font-size:.65rem;font-weight:850; }
.store-section-heading { margin-top:26px!important; }
.store-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px; }
.store-card { padding:22px;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:22px;background:linear-gradient(150deg,rgba(18,37,58,.94),rgba(8,19,32,.94));box-shadow:0 18px 55px rgba(0,0,0,.18); }
.store-card::after { width:190px;height:190px;content:"";position:absolute;top:-120px;right:-80px;border-radius:50%;background:#63d8ff;filter:blur(55px);opacity:.08;pointer-events:none; }
.store-card-top,.store-card-footer,.store-app-identity,.store-name-row { display:flex;align-items:center; }
.store-card-top { position:relative;z-index:1;justify-content:space-between;gap:16px; }
.store-app-identity { min-width:0;gap:13px; }
.store-app-icon { display:grid;width:56px;height:56px;flex:0 0 auto;place-items:center;overflow:hidden;border:1px solid rgba(190,226,249,.15);border-radius:17px;background:rgba(7,18,31,.9); }
.store-app-icon img { width:100%;height:100%;object-fit:cover; }
.store-generic-icon { color:#82ddff;font-size:.82rem;font-weight:950;letter-spacing:.06em; }
.store-name-row { min-width:0;gap:8px;flex-wrap:wrap; }
.store-name-row strong { font-size:1.02rem; }
.store-type-badge { padding:4px 7px;border:1px solid rgba(110,213,255,.18);border-radius:999px;color:#88dfff;font-size:.56rem;font-weight:900; }
.store-version { display:block;margin-top:5px;color:#7f98ae;font-size:.67rem;font-weight:800; }
.store-price { padding:7px 10px;border:1px solid rgba(77,226,160,.23);border-radius:999px;background:rgba(28,92,65,.18);color:#73eab0;font-size:.62rem;font-weight:950;letter-spacing:.08em; }
.store-description { min-height:45px;margin:19px 0 14px;position:relative;z-index:1;color:#a8bacb;font-size:.8rem;line-height:1.6; }
.store-notes { min-height:74px;padding:12px 13px;position:relative;z-index:1;border:1px solid rgba(143,197,227,.1);border-radius:13px;background:rgba(5,15,27,.54); }
.store-notes span { display:block;margin-bottom:5px;color:#6ed7ff;font-size:.59rem;font-weight:950;letter-spacing:.1em; }
.store-notes p { margin:0;color:#8ea5ba;font-size:.71rem;line-height:1.55; }
.store-card-footer { margin-top:16px;position:relative;z-index:1;justify-content:space-between;gap:12px; }
.store-state { color:#8297aa;font-size:.67rem;font-weight:850; }
.store-state.installed { color:#65dea7; }
.store-state.needs-update { color:#ffd27a; }
.store-action-button { min-width:126px; }
.store-action-button.is-installed { cursor:default;opacity:.72; }
@media (max-width:900px) { .store-grid { grid-template-columns:1fr; } .store-banner { align-items:flex-start;flex-direction:column; } }
`;
write("public/css/style.css", css);

console.log("SDCenter v2.2.0 extension store patch applied");
