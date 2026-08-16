"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v223-center-self-update.js <app-root>");

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
  'const fs = require("node:fs");\n',
  'const fs = require("node:fs");\nconst crypto = require("node:crypto");\n',
  "crypto import",
);

main = replaceOnce(
  main,
  `const APP_PACKAGES_ROOT = path.join(\n  CENTER_DATA_ROOT,\n  "app-packages",\n);`,
  `const APP_PACKAGES_ROOT = path.join(\n  CENTER_DATA_ROOT,\n  "app-packages",\n);\n\nconst CENTER_UPDATE_MANIFEST_URL =\n  "https://sd608.github.io/sd-center/update/center-update.json";\nconst CENTER_UPDATE_TTL_MS = 60 * 1000;`,
  "center update constants",
);

const selfUpdateFunctions = String.raw`

  let centerUpdateManifest = null;
  let centerUpdateFetchedAt = 0;
  let centerUpdatePromise = null;
  let centerUpdateInstalling = false;

  function sendCenterUpdateStatus(payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("center:center-update-status", payload);
  }

  async function refreshCenterUpdateManifest({ force = false } = {}) {
    if (
      !force &&
      centerUpdateManifest &&
      Date.now() - centerUpdateFetchedAt < CENTER_UPDATE_TTL_MS
    ) {
      return centerUpdateManifest;
    }

    if (centerUpdatePromise) return centerUpdatePromise;

    centerUpdatePromise = (async () => {
      const response = await fetch(CENTER_UPDATE_MANIFEST_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`종합센터 업데이트 서버 HTTP ${response.status}`);
      }

      const manifest = await response.json();
      const version = String(manifest?.version || "").trim();
      const downloadUrl = String(manifest?.downloadUrl || "").trim();
      if (!/^\d+(?:\.\d+){1,3}$/.test(version)) {
        throw new Error("종합센터 업데이트 버전 정보가 올바르지 않습니다.");
      }
      if (!/^https:\/\//i.test(downloadUrl)) {
        throw new Error("종합센터 업데이트 다운로드 주소가 올바르지 않습니다.");
      }

      centerUpdateManifest = {
        version,
        downloadUrl,
        sha256: String(manifest?.sha256 || "").trim().toLowerCase(),
        notes: String(manifest?.notes || "").trim(),
        publishedAt: String(manifest?.publishedAt || "").trim(),
      };
      centerUpdateFetchedAt = Date.now();
      return centerUpdateManifest;
    })();

    try {
      return await centerUpdatePromise;
    } finally {
      centerUpdatePromise = null;
    }
  }

  async function checkCenterUpdate({ force = false } = {}) {
    try {
      const manifest = await refreshCenterUpdateManifest({ force });
      const currentVersion = app.getVersion();
      return {
        ok: true,
        currentVersion,
        latestVersion: manifest.version,
        updateAvailable:
          compareVersions(currentVersion, manifest.version) < 0,
        notes: manifest.notes,
        publishedAt: manifest.publishedAt,
        installing: centerUpdateInstalling,
      };
    } catch (error) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        updateAvailable: false,
        installing: centerUpdateInstalling,
        error: error.message,
      };
    }
  }

  function sha256File(filePath) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex").toLowerCase();
  }

  async function installCenterUpdate() {
    if (centerUpdateInstalling) {
      return { ok: false, busy: true, error: "종합센터 업데이트가 이미 진행 중입니다." };
    }

    const checked = await checkCenterUpdate({ force: true });
    if (!checked.ok) return checked;
    if (!checked.updateAvailable) {
      return { ...checked, ok: true, alreadyLatest: true };
    }

    const manifest = centerUpdateManifest;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "SD종합센터 업데이트",
      message: `SD종합센터 v${manifest.version}으로 업데이트할까요?`,
      detail:
        `현재 버전: v${app.getVersion()}\n새 버전: v${manifest.version}` +
        (manifest.notes ? `\n\n${manifest.notes}` : "") +
        "\n\n다운로드가 끝나면 실행 중인 SD 앱을 종료하고 자동으로 설치한 뒤 종합센터를 다시 실행합니다.",
      buttons: ["취소", "다운로드 및 업데이트"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response !== 1) {
      return { ok: false, canceled: true };
    }

    centerUpdateInstalling = true;
    const installerPath = path.join(
      app.getPath("temp"),
      `SDCenterSetup-v${manifest.version}-${Date.now()}.exe`,
    );

    try {
      sendCenterUpdateStatus({
        phase: "downloading",
        message: `SD종합센터 v${manifest.version} 다운로드 중...`,
        latestVersion: manifest.version,
      });

      await downloadFile(manifest.downloadUrl, installerPath);
      const stat = fs.statSync(installerPath);
      if (!stat.isFile() || stat.size < 1024 * 1024) {
        throw new Error("다운로드된 종합센터 설치 파일이 올바르지 않습니다.");
      }

      if (manifest.sha256) {
        const actualHash = sha256File(installerPath);
        if (actualHash !== manifest.sha256) {
          throw new Error("종합센터 업데이트 파일 무결성 검사에 실패했습니다.");
        }
      }

      sendCenterUpdateStatus({
        phase: "installing",
        message: "다운로드 완료 · 설치 준비 중...",
        latestVersion: manifest.version,
      });

      await Promise.all(
        appCatalog.map((entry) => terminateAppAndWait(entry.id)),
      );

      const installer = spawn(installerPath, ["--silent"], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      installer.unref();

      sendCenterUpdateStatus({
        phase: "restarting",
        message: "업데이트 설치를 시작했습니다. 종합센터를 다시 실행합니다.",
        latestVersion: manifest.version,
      });

      isQuitting = true;
      setTimeout(() => app.quit(), 180);
      return { ok: true, installing: true, latestVersion: manifest.version };
    } catch (error) {
      centerUpdateInstalling = false;
      fs.rmSync(installerPath, { force: true });
      sendCenterUpdateStatus({
        phase: "error",
        message: error.message,
        latestVersion: manifest.version,
      });
      return { ok: false, error: error.message };
    }
  }
`;

main = replaceOnce(
  main,
  "\n  async function ensureRequiredVersion(entry) {",
  `${selfUpdateFunctions}\n  async function ensureRequiredVersion(entry) {`,
  "self update functions",
);

main = replaceOnce(
  main,
  `    ipcMain.handle("center:get-center-info", () => ({\n      name: "SD종합센터",\n      version: app.getVersion(),\n    }));`,
  `    ipcMain.handle("center:get-center-info", () => ({\n      name: "SD종합센터",\n      version: app.getVersion(),\n    }));\n    ipcMain.handle("center:check-center-update", (_event, force) =>\n      checkCenterUpdate({ force: Boolean(force) }),\n    );\n    ipcMain.handle("center:install-center-update", () =>\n      installCenterUpdate(),\n    );`,
  "center update IPC",
);

write("main.js", main);

let preload = read("preload.js");
preload = replaceOnce(
  preload,
  `  getCenterInfo: () => invoke("center:get-center-info"),`,
  `  getCenterInfo: () => invoke("center:get-center-info"),\n  checkCenterUpdate: (force = false) =>\n    invoke("center:check-center-update", Boolean(force)),\n  installCenterUpdate: () => invoke("center:install-center-update"),`,
  "preload center update methods",
);
preload = replaceOnce(
  preload,
  `  onBulkDownloadProgress: (callback) =>\n    subscribe("center:bulk-download-progress", callback),`,
  `  onBulkDownloadProgress: (callback) =>\n    subscribe("center:bulk-download-progress", callback),\n  onCenterUpdateStatus: (callback) =>\n    subscribe("center:center-update-status", callback),`,
  "preload center update status",
);
write("preload.js", preload);

let html = read("public/index.html");
html = replaceOnce(
  html,
  `      <div id="centerVersionChip" class="center-version-chip" title="현재 SD종합센터 버전">v...</div>`,
  `      <div id="centerVersionChip" class="center-version-chip" title="현재 SD종합센터 버전">v...</div>\n      <button id="centerUpdateButton" class="button button-secondary center-update-button" type="button">센터 업데이트</button>`,
  "center update button",
);
write("public/index.html", html);

let css = read("public/css/style.css");
css += `\n\n/* v2.2.3 종합센터 자체 업데이트 */\n.center-update-button {\n  min-height: 36px;\n  padding: 8px 13px;\n  white-space: nowrap;\n}\n.center-update-button.is-available {\n  font-weight: 800;\n  transform: translateY(-1px);\n}\n.center-version-chip.has-update {\n  font-weight: 800;\n}\n`;
write("public/css/style.css", css);

let renderer = read("public/js/app.js");
renderer = replaceOnce(
  renderer,
  `  centerVersionChip: document.getElementById("centerVersionChip"),`,
  `  centerVersionChip: document.getElementById("centerVersionChip"),\n  centerUpdateButton: document.getElementById("centerUpdateButton"),`,
  "renderer center update element",
);
renderer = replaceOnce(
  renderer,
  `  downloadingExtensions: false,\n  downloadProgress: null,`,
  `  downloadingExtensions: false,\n  downloadProgress: null,\n  centerUpdate: null,\n  checkingCenterUpdate: false,\n  installingCenterUpdate: false,`,
  "renderer center update state",
);

const rendererFunctions = String.raw`

function renderCenterUpdate() {
  const button = elements.centerUpdateButton;
  const info = state.centerUpdate;
  if (!button) return;

  const available = Boolean(info?.updateAvailable);
  button.classList.toggle("is-available", available);
  elements.centerVersionChip?.classList.toggle("has-update", available);

  button.disabled = state.checkingCenterUpdate || state.installingCenterUpdate;
  if (state.installingCenterUpdate) {
    button.textContent = "센터 업데이트 중...";
  } else if (state.checkingCenterUpdate) {
    button.textContent = "센터 확인 중...";
  } else if (available) {
    button.textContent = `센터 v${info.latestVersion} 업데이트`;
  } else {
    button.textContent = "센터 업데이트";
  }

  if (available && elements.centerVersionChip) {
    elements.centerVersionChip.title =
      `현재 v${info.currentVersion} · 새 버전 v${info.latestVersion} 사용 가능`;
  }
}

async function checkCenterUpdate({ silent = false, force = true } = {}) {
  if (state.checkingCenterUpdate || state.installingCenterUpdate) return;
  state.checkingCenterUpdate = true;
  renderCenterUpdate();

  try {
    const result = await bridge.checkCenterUpdate(force);
    state.centerUpdate = result || null;
    if (!result?.ok) {
      if (!silent) {
        showToast(result?.error || "종합센터 업데이트 정보를 확인하지 못했습니다.", 4500);
      }
      return result;
    }

    if (result.updateAvailable) {
      showToast(
        `SD종합센터 v${result.latestVersion} 업데이트가 있습니다.`,
        4200,
      );
    } else if (!silent) {
      showToast(`SD종합센터 v${result.currentVersion} · 최신 버전입니다.`);
    }
    return result;
  } finally {
    state.checkingCenterUpdate = false;
    renderCenterUpdate();
  }
}

async function installCenterUpdate() {
  if (state.installingCenterUpdate || state.checkingCenterUpdate) return;

  if (!state.centerUpdate?.updateAvailable) {
    const checked = await checkCenterUpdate({ silent: false, force: true });
    if (!checked?.updateAvailable) return;
  }

  state.installingCenterUpdate = true;
  renderCenterUpdate();
  showToast("종합센터 업데이트 파일을 준비합니다...", 3500);

  try {
    const result = await bridge.installCenterUpdate();
    if (result?.canceled) return;
    if (!result?.ok) {
      showToast(result?.error || "종합센터 업데이트에 실패했습니다.", 5000);
      return;
    }
    if (result.alreadyLatest) {
      state.centerUpdate = result;
      showToast("SD종합센터가 이미 최신 버전입니다.");
    }
  } finally {
    state.installingCenterUpdate = false;
    renderCenterUpdate();
  }
}
`;

renderer = replaceOnce(
  renderer,
  "\nfunction formatRemovedAt(value) {",
  `${rendererFunctions}\nfunction formatRemovedAt(value) {`,
  "renderer center update functions",
);

renderer = replaceOnce(
  renderer,
  `  elements.addAppButton.addEventListener("click", addAppZip);`,
  `  elements.centerUpdateButton?.addEventListener("click", async () => {\n    if (state.centerUpdate?.updateAvailable) {\n      await installCenterUpdate();\n    } else {\n      await checkCenterUpdate({ silent: false, force: true });\n    }\n  });\n  elements.addAppButton.addEventListener("click", addAppZip);`,
  "renderer center update event",
);

renderer = replaceOnce(
  renderer,
  `  bridge.onBulkDownloadProgress?.((progress) => {\n    state.downloadProgress = progress || null;\n    renderOverview();\n  });`,
  `  bridge.onBulkDownloadProgress?.((progress) => {\n    state.downloadProgress = progress || null;\n    renderOverview();\n  });\n  bridge.onCenterUpdateStatus?.((status) => {\n    if (!status) return;\n    if (status.phase === "downloading") {\n      state.installingCenterUpdate = true;\n      showToast(status.message || "종합센터 업데이트 다운로드 중...", 4200);\n    } else if (status.phase === "installing" || status.phase === "restarting") {\n      state.installingCenterUpdate = true;\n      showToast(status.message || "종합센터 업데이트 설치 중...", 4200);\n    } else if (status.phase === "error") {\n      state.installingCenterUpdate = false;\n      showToast(status.message || "종합센터 업데이트에 실패했습니다.", 5000);\n    }\n    renderCenterUpdate();\n  });`,
  "renderer center update status",
);

renderer = replaceOnce(
  renderer,
  `  setRemovedApps(removedApps);\n  selectTab("installed");`,
  `  setRemovedApps(removedApps);\n  selectTab("installed");\n  renderCenterUpdate();\n  window.setTimeout(() => {\n    void checkCenterUpdate({ silent: true, force: true });\n  }, 900);`,
  "renderer startup update check",
);

write("public/js/app.js", renderer);

for (const rel of ["main.js", "preload.js", "public/js/app.js"]) {
  const source = read(rel);
  if (!source.includes("center")) throw new Error(`Unexpected empty patch target: ${rel}`);
}

const validationMain = read("main.js");
for (const marker of [
  "CENTER_UPDATE_MANIFEST_URL",
  "checkCenterUpdate",
  "installCenterUpdate",
  "center:check-center-update",
  "center:install-center-update",
  "sha256File",
]) {
  if (!validationMain.includes(marker)) throw new Error(`v2.2.3 main marker missing: ${marker}`);
}
const validationRenderer = read("public/js/app.js");
for (const marker of ["centerUpdateButton", "checkCenterUpdate", "installCenterUpdate", "onCenterUpdateStatus"]) {
  if (!validationRenderer.includes(marker)) throw new Error(`v2.2.3 renderer marker missing: ${marker}`);
}

console.log("SDCenter v2.2.3 in-app self-update patch applied");
