"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v011.js <app-root>");

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, content) => fs.writeFileSync(path.join(root, rel), content, "utf8");
function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

// Visible preview label.
let html = read("public/index.html").replaceAll("UI Preview v0.10", "UI Preview v0.11");
write("public/index.html", html);

// Backend: serialize operations that can replace/remove app files.
let main = read("main.js");
if (!main.includes("centerAppOperationLocks")) {
  main = replaceOnce(
    main,
    `let extensionCatalogPromise = null;\n`,
    `let extensionCatalogPromise = null;\n\n// UI Preview v0.11 audit fix: prevent overlapping app file/registry operations.\nconst centerAppOperationLocks = new Set();\nlet centerBulkAppOperation = false;\n\nfunction centerAppBusyResult() {\n  return {\n    ok: false,\n    busy: true,\n    error: \"다른 앱 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.\",\n  };\n}\n\nasync function withCenterAppOperation(id, action) {\n  const key = String(id || \"\").trim();\n  if (!key) return { ok: false, error: \"앱 ID가 없습니다.\" };\n  if (centerBulkAppOperation || centerAppOperationLocks.has(key)) return centerAppBusyResult();\n  centerAppOperationLocks.add(key);\n  try {\n    return await action();\n  } finally {\n    centerAppOperationLocks.delete(key);\n  }\n}\n\nasync function withCenterBulkAppOperation(action) {\n  if (centerBulkAppOperation || centerAppOperationLocks.size > 0) return centerAppBusyResult();\n  centerBulkAppOperation = true;\n  try {\n    return await action();\n  } finally {\n    centerBulkAppOperation = false;\n  }\n}\n`,
    "backend operation locks",
  );
}

main = replaceOnce(
  main,
  `    ipcMain.handle("center:install-store-app", (event, id) =>\n      installStoreApp(id),\n    );`,
  `    ipcMain.handle("center:install-store-app", (event, id) =>\n      withCenterAppOperation(id, () => installStoreApp(id)),\n    );`,
  "store install lock",
);
main = replaceOnce(
  main,
  `    ipcMain.handle("center:launch-app", (event, id) =>\n      launchApp(id),\n    );`,
  `    ipcMain.handle("center:launch-app", (event, id) =>\n      withCenterAppOperation(id, () => launchApp(id)),\n    );`,
  "launch lock",
);
main = replaceOnce(
  main,
  `    ipcMain.handle("center:add-app-zip", addAppFromZip);`,
  `    ipcMain.handle("center:add-app-zip", () =>\n      withCenterBulkAppOperation(() => addAppFromZip()),\n    );`,
  "zip install lock",
);
main = replaceOnce(
  main,
  `    ipcMain.handle("center:check-app-updates", async () => {\n      try {`,
  `    ipcMain.handle("center:check-app-updates", async () => {\n      if (centerBulkAppOperation || centerAppOperationLocks.size > 0) return centerAppBusyResult();\n      try {`,
  "update check guard",
);
main = replaceOnce(
  main,
  `    ipcMain.handle("center:update-app", (event, id) =>\n      updateAppFromCatalog(id),\n    );\n    ipcMain.handle("center:update-all-apps", () =>\n      updateAllAvailableApps(),\n    );\n    ipcMain.handle("center:delete-app", (event, id) =>\n      deleteApp(id),\n    );\n    ipcMain.handle("center:restore-app", (event, id) =>\n      restoreRemovedApp(id),\n    );\n    ipcMain.handle(\n      "center:permanently-delete-removed-app",\n      (event, id) => permanentlyDeleteRemovedApp(id),\n    );\n    ipcMain.handle("center:launch-all", async () => {\n      const results = [];\n\n      for (const entry of appCatalog) {\n        results.push({\n          id: entry.id,\n          ...(await launchApp(entry.id)),\n        });\n      }\n\n      return {\n        ok: results.every((result) => result.ok),\n        count: appCatalog.length,\n        results,\n      };\n    });`,
  `    ipcMain.handle("center:update-app", (event, id) =>\n      withCenterAppOperation(id, () => updateAppFromCatalog(id)),\n    );\n    ipcMain.handle("center:update-all-apps", () =>\n      withCenterBulkAppOperation(() => updateAllAvailableApps()),\n    );\n    ipcMain.handle("center:delete-app", (event, id) =>\n      withCenterAppOperation(id, () => deleteApp(id)),\n    );\n    ipcMain.handle("center:restore-app", (event, id) =>\n      withCenterAppOperation(id, () => restoreRemovedApp(id)),\n    );\n    ipcMain.handle(\n      "center:permanently-delete-removed-app",\n      (event, id) => withCenterAppOperation(id, () => permanentlyDeleteRemovedApp(id)),\n    );\n    ipcMain.handle("center:launch-all", () =>\n      withCenterBulkAppOperation(async () => {\n        const results = [];\n\n        for (const entry of appCatalog) {\n          results.push({\n            id: entry.id,\n            ...(await launchApp(entry.id)),\n          });\n        }\n\n        return {\n          ok: results.every((result) => result.ok),\n          count: appCatalog.length,\n          results,\n        };\n      }),\n    );`,
  "app mutation handlers",
);
write("main.js", main);

// Renderer base: reject duplicate per-app requests immediately and reflect global mutation state.
let app = read("public/js/app.js");
app = replaceOnce(
  app,
  `function renderOverview() {\n  const runningCount = state.apps.filter((app) => app.running).length;\n  const appCount = state.apps.length;\n  const removedCount = state.removedApps.length;\n  const updateCount = state.apps.filter((app) => app.updateAvailable).length;`,
  `function renderOverview() {\n  const runningCount = state.apps.filter((app) => app.running).length;\n  const appCount = state.apps.length;\n  const removedCount = state.removedApps.length;\n  const updateCount = state.apps.filter((app) => app.updateAvailable).length;\n  const anyAppOperation = state.updatingAll || state.addingApp || state.busyIds.size > 0 || state.storeBusyIds.size > 0;`,
  "overview busy state",
);
app = replaceOnce(
  app,
  `  elements.launchAllButton.textContent = \`${appCount}개 앱 모두 실행\`;\n  elements.launchAllButton.disabled = appCount === 0;`,
  `  elements.launchAllButton.textContent = \`${appCount}개 앱 모두 실행\`;\n  elements.launchAllButton.disabled = appCount === 0 || anyAppOperation;\n  if (elements.addAppButton) elements.addAppButton.disabled = anyAppOperation;`,
  "launch all/add busy controls",
);
app = replaceOnce(
  app,
  `    elements.checkUpdatesButton.disabled = state.checkingUpdates || state.updatingAll;`,
  `    elements.checkUpdatesButton.disabled = state.checkingUpdates || anyAppOperation;`,
  "check updates busy control",
);
app = replaceOnce(
  app,
  `      updateCount === 0 || state.updatingAll || state.checkingUpdates;`,
  `      updateCount === 0 || state.updatingAll || state.checkingUpdates || state.addingApp || state.busyIds.size > 0 || state.storeBusyIds.size > 0;`,
  "update all busy control",
);
app = replaceOnce(
  app,
  `function storeCard(app) {\n  const busy = state.storeBusyIds.has(app.id);`,
  `function storeCard(app) {\n  const busy = state.storeBusyIds.has(app.id) || state.busyIds.has(app.id) || state.updatingAll || state.addingApp;`,
  "store card busy state",
);
app = replaceOnce(
  app,
  `async function installFromStore(id) {\n  if (state.storeBusyIds.has(id)) return;\n  const current = state.storeApps.find((entry) => entry.id === id);\n  state.storeBusyIds.add(id);\n  renderStore();`,
  `async function installFromStore(id) {\n  if (state.storeBusyIds.has(id) || state.busyIds.has(id) || state.updatingAll || state.addingApp) {\n    showToast("다른 앱 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");\n    return;\n  }\n  const current = state.storeApps.find((entry) => entry.id === id);\n  state.storeBusyIds.add(id);\n  renderStore();\n  renderOverview();`,
  "store install renderer guard",
);
app = replaceOnce(
  app,
  `  } finally {\n    state.storeBusyIds.delete(id);\n    renderStore();\n  }\n}\n\nfunction renderApps() {`,
  `  } finally {\n    state.storeBusyIds.delete(id);\n    renderStore();\n    renderOverview();\n  }\n}\n\nfunction renderApps() {`,
  "store install renderer cleanup",
);
app = replaceOnce(
  app,
  `async function withBusy(id, action) {\n  state.busyIds.add(id);\n  renderApps();`,
  `async function withBusy(id, action) {\n  if (state.busyIds.has(id) || state.storeBusyIds.has(id) || state.updatingAll || state.addingApp) {\n    return { ok: false, busy: true, error: "다른 앱 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요." };\n  }\n  state.busyIds.add(id);\n  renderApps();`,
  "per-app renderer lock",
);
app = replaceOnce(
  app,
  `async function addAppZip() {\n  if (state.addingApp) {\n    return;\n  }\n\n  state.addingApp = true;\n  elements.addAppButton.disabled = true;`,
  `async function addAppZip() {\n  if (state.addingApp || state.updatingAll || state.busyIds.size > 0 || state.storeBusyIds.size > 0) {\n    if (!state.addingApp) showToast("다른 앱 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");\n    return;\n  }\n\n  state.addingApp = true;\n  elements.addAppButton.disabled = true;\n  renderOverview();`,
  "zip add renderer guard",
);
app = replaceOnce(
  app,
  `  } finally {\n    state.addingApp = false;\n    elements.addAppButton.disabled = false;\n    elements.addAppButton.textContent = "ZIP 앱 추가";\n  }\n}`,
  `  } finally {\n    state.addingApp = false;\n    elements.addAppButton.textContent = "ZIP 앱 추가";\n    renderOverview();\n  }\n}`,
  "zip add renderer cleanup",
);
app = replaceOnce(
  app,
  `async function updateAllApps() {\n  if (state.updatingAll || state.checkingUpdates) return;`,
  `async function updateAllApps() {\n  if (state.updatingAll || state.checkingUpdates || state.addingApp || state.busyIds.size > 0 || state.storeBusyIds.size > 0) {\n    if (!state.updatingAll && !state.checkingUpdates) showToast("다른 앱 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");\n    return;\n  }`,
  "bulk update renderer guard",
);
app = replaceOnce(
  app,
  `    } finally {\n      elements.launchAllButton.disabled = state.apps.length === 0;\n    }\n  });`,
  `    } finally {\n      renderOverview();\n    }\n  });`,
  "launch all renderer cleanup",
);
write("public/js/app.js", app);

// Preview renderer: busy state on update screen/context menu and accessibility focus restoration.
let ui = read("public/js/ui-preview.js");
ui = ui.replace("/* SD종합센터 UI Preview v0.10", "/* SD종합센터 UI Preview v0.11");
ui = replaceOnce(
  ui,
  `installedAppCard = function previewInstalledAppCard(app) {\n  const busy = state.busyIds.has(app.id);`,
  `installedAppCard = function previewInstalledAppCard(app) {\n  const busy = state.busyIds.has(app.id) || state.storeBusyIds.has(app.id) || state.updatingAll || state.addingApp;`,
  "library busy state",
);
if (!ui.includes("function previewAppOperationBusy")) {
  ui = replaceOnce(
    ui,
    `function renderPreviewUpdates() {`,
    `function previewAppOperationBusy(id) {\n  return state.busyIds.has(id) || state.storeBusyIds.has(id) || state.updatingAll || state.addingApp;\n}\n\nfunction renderPreviewUpdates() {`,
    "preview busy helper",
  );
}
ui = replaceOnce(
  ui,
  `    ${count ? '<button class="preview-button" type="button" data-preview-update-all>모두 업데이트</button>' : ""}\n  \`;`,
  `    ${count ? `<button class="preview-button" type="button" data-preview-update-all ${state.updatingAll || state.checkingUpdates || state.addingApp || state.busyIds.size > 0 || state.storeBusyIds.size > 0 ? "disabled" : ""}>${state.updatingAll ? "업데이트 중..." : "모두 업데이트"}</button>` : ""}\n  \`;`,
  "preview update all busy button",
);
ui = replaceOnce(
  ui,
  `  previewElements.updateList.innerHTML = count ? updates.map((app) => \`\n    <div class="preview-update-row" data-preview-update-id="${previewEscape(app.id)}">`,
  `  previewElements.updateList.innerHTML = count ? updates.map((app) => {\n    const busy = previewAppOperationBusy(app.id) || state.checkingUpdates;\n    return \`\n    <div class="preview-update-row" data-preview-update-id="${previewEscape(app.id)}">`,
  "preview update item busy start",
);
ui = replaceOnce(
  ui,
  `      <button class="preview-button preview-button-primary" type="button" data-preview-update-app="${previewEscape(app.id)}">업데이트</button>\n    </div>\n  \`).join("") : '<div class="preview-up-to-date">지금 설치할 업데이트가 없습니다.</div>';`,
  `      <button class="preview-button preview-button-primary" type="button" data-preview-update-app="${previewEscape(app.id)}" ${busy ? "disabled" : ""}>${busy ? "처리 중..." : "업데이트"}</button>\n    </div>\n  \`;\n  }).join("") : '<div class="preview-up-to-date">지금 설치할 업데이트가 없습니다.</div>';`,
  "preview update item busy end",
);
ui = replaceOnce(
  ui,
  `  if (appButton) {\n    void updateApp(appButton.dataset.previewUpdateApp).then(renderPreviewUpdates);`,
  `  if (appButton) {\n    if (appButton.disabled) return;\n    void updateApp(appButton.dataset.previewUpdateApp).then(renderPreviewUpdates);`,
  "preview update click disabled guard",
);
ui = replaceOnce(
  ui,
  `  if (event.target.closest("[data-preview-update-all]")) {\n    void updateAllApps().then(renderPreviewUpdates);`,
  `  const updateAllButton = event.target.closest("[data-preview-update-all]");\n  if (updateAllButton) {\n    if (updateAllButton.disabled) return;\n    void updateAllApps().then(renderPreviewUpdates);`,
  "preview update all click disabled guard",
);
ui = replaceOnce(
  ui,
  `let previewContextAppId = "";`,
  `let previewContextAppId = "";\nlet previewContextReturnFocus = null;\nlet previewInfoReturnFocus = null;`,
  "context focus state",
);
ui = replaceOnce(
  ui,
  `function closePreviewAppContextMenu() {\n  const menu = document.getElementById("previewAppContextMenu");\n  menu?.classList.add("hidden");\n  previewContextAppId = "";\n}`,
  `function closePreviewAppContextMenu(restoreFocus = false) {\n  const menu = document.getElementById("previewAppContextMenu");\n  menu?.classList.add("hidden");\n  previewContextAppId = "";\n  const target = previewContextReturnFocus;\n  previewContextReturnFocus = null;\n  if (restoreFocus && target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));\n}`,
  "context focus restore",
);
ui = replaceOnce(
  ui,
  `  previewContextAppId = app.id;\n  menu.classList.remove("hidden");`,
  `  previewContextAppId = app.id;\n  previewContextReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;\n  const operationBusy = previewAppOperationBusy(app.id);\n  menu.querySelector('[data-preview-context-action="open"]')?.toggleAttribute("disabled", operationBusy);\n  menu.querySelector('[data-preview-context-action="delete"]')?.toggleAttribute("disabled", operationBusy);\n  menu.classList.remove("hidden");`,
  "context busy state",
);
ui = replaceOnce(
  ui,
  `function closePreviewAppInfo() {\n  document.getElementById("previewAppInfoBackdrop")?.classList.add("hidden");\n}`,
  `function closePreviewAppInfo() {\n  document.getElementById("previewAppInfoBackdrop")?.classList.add("hidden");\n  const target = previewInfoReturnFocus;\n  previewInfoReturnFocus = null;\n  if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));\n}`,
  "info focus restore",
);
ui = replaceOnce(
  ui,
  `  const appId = previewContextAppId;\n  const action = actionButton.dataset.previewContextAction;\n  closePreviewAppContextMenu();\n  if (action === "open") {`,
  `  const appId = previewContextAppId;\n  const action = actionButton.dataset.previewContextAction;\n  if (action === "info") previewInfoReturnFocus = previewContextReturnFocus;\n  closePreviewAppContextMenu(action !== "info");\n  if (action === "open") {`,
  "context action focus restore",
);
ui = replaceOnce(
  ui,
  `  if (menu && !menu.classList.contains("hidden") && !event.target.closest("#previewAppContextMenu")) closePreviewAppContextMenu();`,
  `  if (menu && !menu.classList.contains("hidden") && !event.target.closest("#previewAppContextMenu")) closePreviewAppContextMenu(false);`,
  "pointer context close",
);
ui = ui.replaceAll("window.addEventListener(\"blur\", closePreviewAppContextMenu);", "window.addEventListener(\"blur\", () => closePreviewAppContextMenu(false));");
ui = ui.replaceAll("window.addEventListener(\"resize\", closePreviewAppContextMenu);", "window.addEventListener(\"resize\", () => closePreviewAppContextMenu(false));");
ui = ui.replaceAll("window.addEventListener(\"scroll\", closePreviewAppContextMenu, true);", "window.addEventListener(\"scroll\", () => closePreviewAppContextMenu(false), true);");
ui = replaceOnce(
  ui,
  `  closePreviewAppContextMenu();\n  closePreviewAppInfo();`,
  `  closePreviewAppContextMenu(true);\n  closePreviewAppInfo();`,
  "escape focus restore",
);
write("public/js/ui-preview.js", ui);

let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.11: 2차 감사 수정")) {
  css += `\n\n/* UI Preview v0.11: 2차 감사 수정 — 작업 중 상태/컨텍스트 메뉴 */\n.preview-app-context-item:disabled{opacity:.42;cursor:default;pointer-events:none}\n.preview-app-context-item:disabled:hover{background:transparent}\n.preview-update-row button:disabled,.preview-update-summary button:disabled{opacity:.55;cursor:wait}\n`;
}
write("public/css/ui-preview.css", css);

const markers = {
  "public/index.html": ["UI Preview v0.11"],
  "main.js": ["centerAppOperationLocks", "withCenterAppOperation", "withCenterBulkAppOperation", 'center:update-all-apps', 'center:launch-all'],
  "public/js/app.js": ["anyAppOperation", "state.storeBusyIds.has(id) || state.updatingAll || state.addingApp", "state.busyIds.has(id) || state.storeBusyIds.has(id)"],
  "public/js/ui-preview.js": ["SD종합센터 UI Preview v0.11", "function previewAppOperationBusy", "appButton.disabled", "previewContextReturnFocus", "previewInfoReturnFocus"],
  "public/css/ui-preview.css": ["UI Preview v0.11: 2차 감사 수정", ".preview-app-context-item:disabled"],
};
for (const [rel, required] of Object.entries(markers)) {
  const source = read(rel);
  for (const marker of required) if (!source.includes(marker)) throw new Error(`Missing v0.11 marker in ${rel}: ${marker}`);
}
console.log("SDCenter UI Preview v0.11 second-audit concurrency fixes applied");
