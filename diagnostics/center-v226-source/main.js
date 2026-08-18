"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  Tray,
} = require("electron");

// Squirrel.Windows 설치·업데이트·제거 이벤트 처리
if (require("electron-squirrel-startup")) {
  app.quit();
}

const {
  inspectZip,
  installInspectedZip,
  loadRegistry,
  moveAppToRemoved,
  permanentlyRemoveApp,
  resolveCatalog,
  resolveRemovedCatalog,
  restoreAppInRegistry,
  saveRegistry,
  upsertCustomApp,
} = require("./src/app-registry");

const {
  compareVersions,
  downloadFile,
  fetchRequiredPolicy,
} = require("./src/required-updates");

const BUILTIN_CATALOG = [
  {
    id: "wallet",
    name: "SD지갑",
    version: "Stage 11 · v1.1.1",
    folder: "SDWallet",
    productName: "SD지갑",
    userDataFolder: "SD지갑",
    description: "모든 SD 앱과 확장팩이 함께 사용하는 가상 계좌와 거래 내역을 관리합니다.",
    improvement: "SD 생태계의 기본 코어 앱으로 항상 제공됩니다.",
    accent: "blue",
    icon: "public/icons/icon-512.png",
  },
];

function getAppDataRoot() {
  if (process.platform === "win32") {
    return (
      process.env.APPDATA ||
      path.join(os.homedir(), "AppData", "Roaming")
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

const APP_DATA_ROOT = getAppDataRoot();
const CENTER_DATA_ROOT = path.join(APP_DATA_ROOT, "SD종합센터");
const REGISTRY_PATH = path.join(CENTER_DATA_ROOT, "apps.json");
const INSTALLED_APPS_ROOT = path.join(
  CENTER_DATA_ROOT,
  "installed-apps",
);
const REMOVED_APPS_ROOT = path.join(
  CENTER_DATA_ROOT,
  "removed-apps",
);
const APP_PACKAGES_ROOT = path.join(
  CENTER_DATA_ROOT,
  "app-packages",
);

const CENTER_SETTINGS_PATH = path.join(
  CENTER_DATA_ROOT,
  "center-settings.json",
);

function loadCenterSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CENTER_SETTINGS_PATH, "utf8"));
    const favoriteIds = Array.isArray(parsed?.favoriteIds)
      ? [...new Set(parsed.favoriteIds
          .filter((id) => typeof id === "string" && id.trim())
          .map((id) => id.trim()))]
      : [];
    return { favoriteIds };
  } catch {
    return { favoriteIds: [] };
  }
}

function saveCenterSettings(settings) {
  fs.mkdirSync(CENTER_DATA_ROOT, { recursive: true });
  const temporaryPath = `${CENTER_SETTINGS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify({
      favoriteIds: Array.isArray(settings?.favoriteIds)
        ? [...new Set(settings.favoriteIds)]
        : [],
    }, null, 2) + "\n",
    "utf8",
  );
  fs.renameSync(temporaryPath, CENTER_SETTINGS_PATH);
}

let centerSettings = loadCenterSettings();

function isFavoriteId(id) {
  return (centerSettings.favoriteIds || []).includes(String(id || ""));
}

function setFavoriteId(id, favorite) {
  const appId = String(id || "").trim();
  const next = new Set(centerSettings.favoriteIds || []);
  if (favorite) next.add(appId);
  else next.delete(appId);
  centerSettings = { ...centerSettings, favoriteIds: [...next] };
  saveCenterSettings(centerSettings);
  return favorite;
}

const FALLBACK_REQUIRED_APPS = {
  "sd-logistics-center-desktop": {
    required: true,
    minVersion: "1.0.9",
    downloadUrl:
      "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip",
    message:
      "물류회사 진행도 1회 초기화/랭크 밸런스 패치가 필수입니다. v1.0.9 이상으로 업데이트해야 실행할 수 있습니다.",
  },
  "sdlink-desktop": {
    required: true,
    minVersion: "1.2.4",
    downloadUrl:
      "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.2.4_Desktop.zip",
    message:
      "구 센터 우회 차단을 위해 SD Link v1.2.4 이상이 필수입니다.",
  },
};
const REQUIRED_POLICY_TTL_MS = 5 * 60 * 1000;
const EXTENSION_CATALOG_URL =
  "https://sd608.github.io/sd-center/update/extensions-catalog.json";
const EXTENSION_CATALOG_TTL_MS = 5 * 60 * 1000;
const FALLBACK_EXTENSION_CATALOG = {
  apps: {
    "sdlink-desktop": {
      name: "SD Link",
      version: "1.2.4",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.2.4_Desktop.zip",
      notes: "SD Link 안정화 및 센터 버전 증명",
    },
    "sd-logistics-center-desktop": {
      name: "SD 물류센터",
      version: "1.0.9",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=109",
      notes: "회사 랭크·차량 해금 밸런스 및 진행도 1회 초기화",
    },
    "sd-slot": {
      name: "SD슬롯",
      version: "1.0.6",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/SDSlot_Stage7_Desktop.zip",
      notes: "SD지갑 연동 슬롯 확장팩",
    },
    "sd-mukjippa": {
      name: "SD묵찌빠",
      version: "1.0.1",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/SDMukjippa_Version1_1_Desktop.zip",
      notes: "SD지갑 연동 묵찌빠 확장팩",
    },
    "sta-expansion": {
      name: "STA",
      version: "1.5.1",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/STA_Version6_Desktop.zip?v=151",
      notes: "현금 획득 종료 후 다음 단계 전환 버그 수정",
    },
    "bitcoin": {
      name: "SD비트코인 채굴장",
      version: "1.2.2",
      downloadUrl:
        "https://sd608.github.io/sd-center/downloads/extensions/SDBitcoinMiner_v1.2.2_Desktop.zip?v=122",
      notes: "v1.2.2 실행 오류 수정 · GPU 내구도/전기세/채굴 확률 밸런스",
    },
  },
};

let registry = loadRegistry(REGISTRY_PATH);

function cleanupBitcoinBuiltinDuplicate() {}

cleanupBitcoinBuiltinDuplicate();
let appCatalog = [];
let appById = new Map();
let removedCatalog = [];
let removedById = new Map();
let requiredPolicy = { apps: { ...FALLBACK_REQUIRED_APPS } };
let requiredPolicyFetchedAt = 0;
let requiredPolicyPromise = null;
let extensionCatalog = { ...FALLBACK_EXTENSION_CATALOG };
let extensionCatalogFetchedAt = 0;
let extensionCatalogPromise = null;

function reloadCatalog() {
  const builtinRoot = path.join(__dirname, "apps");

  appCatalog = resolveCatalog({
    builtinCatalog: BUILTIN_CATALOG,
    registry,
    builtinRoot,
  });
  removedCatalog = resolveRemovedCatalog({
    builtinCatalog: BUILTIN_CATALOG,
    registry,
    builtinRoot,
  });
  appById = new Map(
    appCatalog.map((entry) => [entry.id, entry]),
  );
  removedById = new Map(
    removedCatalog.map((entry) => [entry.id, entry]),
  );
}

reloadCatalog();

function parseChildId() {
  const prefix = "--sd-child-app=";
  const argument = process.argv.find((value) =>
    value.startsWith(prefix),
  );

  return argument ? argument.slice(prefix.length) : "";
}

function getChildDirectory(entry) {
  return entry.directory;
}

function runChildMode(childId) {
  const entry = appById.get(childId);

  if (!entry) {
    app.quit();
    return;
  }

  const childDirectory = getChildDirectory(entry);
  const childMainPath = path.join(
    childDirectory,
    entry.entry || "main.js",
  );

  if (!fs.existsSync(childMainPath)) {
    app.quit();
    return;
  }

  app.setName(entry.productName || entry.name);
  app.setPath(
    "userData",
    path.join(APP_DATA_ROOT, entry.userDataFolder),
  );
  app.setAppUserModelId(`com.sdcenter.${entry.id}`);

  process.env.SD_CENTER_MANAGED = "1";
  process.env.SD_CENTER_EXECUTABLE = process.execPath;
  process.env.SD_CENTER_ROOT = __dirname;
  process.env.SD_CENTER_CHILD_ID = entry.id;

  require(childMainPath);
}

const childId = parseChildId();

if (childId) {
  runChildMode(childId);
} else {
  runCenterMode();
}

function runCenterMode() {
  const autoStartLinkMode = process.argv.includes("--sd-center-auto-link");
  const singleInstanceLock = app.requestSingleInstanceLock();

  if (!singleInstanceLock) {
    app.quit();
    return;
  }

  let mainWindow = null;
  let tray = null;
  let isQuitting = false;
  const runningApps = new Map();

  const CENTER_UPDATE_FEED_URL = "https://github.com/SD608/sd-center/releases/latest/download";
  let centerUpdateState = { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" };
  let centerUpdaterConfigured = false;

  function sendCenterUpdateState(extra = {}) {
    centerUpdateState = { ...centerUpdateState, ...extra };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("center:center-update-state", { ...centerUpdateState, currentVersion: app.getVersion() });
    return { ...centerUpdateState, currentVersion: app.getVersion() };
  }

  function configureCenterAutoUpdater() {
    if (centerUpdaterConfigured || !app.isPackaged || process.platform !== "win32") return;
    centerUpdaterConfigured = true;
    autoUpdater.setFeedURL({ url: CENTER_UPDATE_FEED_URL });
    autoUpdater.on("checking-for-update", () => sendCenterUpdateState({ phase: "checking", error: "" }));
    autoUpdater.on("update-available", () => sendCenterUpdateState({ phase: "available", updateAvailable: true, downloaded: false, error: "" }));
    autoUpdater.on("update-not-available", () => sendCenterUpdateState({ phase: "latest", updateAvailable: false, downloaded: false, version: app.getVersion(), error: "" }));
    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      const match = String(releaseName || "").match(/(\d+(?:\.\d+){1,3})/);
      sendCenterUpdateState({ phase: "downloaded", updateAvailable: true, downloaded: true, version: match ? match[1] : "", releaseNotes: String(releaseNotes || ""), error: "" });
    });
    autoUpdater.on("error", (error) => sendCenterUpdateState({ phase: "error", error: error?.message || String(error) }));
  }

  async function checkCenterSelfUpdate() {
    configureCenterAutoUpdater();
    if (!app.isPackaged || process.platform !== "win32") return { ok: false, error: "Windows 설치 버전에서만 종합센터 자동업데이트를 사용할 수 있습니다." };
    try {
      sendCenterUpdateState({ phase: "checking", error: "" });
      await autoUpdater.checkForUpdates();
      return { ok: true, ...centerUpdateState, currentVersion: app.getVersion() };
    } catch (error) {
      return { ok: false, ...sendCenterUpdateState({ phase: "error", error: error?.message || String(error) }) };
    }
  }

  async function installCenterSelfUpdate() {
    if (!centerUpdateState.downloaded) return { ok: false, error: "업데이트 다운로드가 아직 완료되지 않았습니다." };
    const confirmation = await dialog.showMessageBox(mainWindow, { type: "question", title: "SD종합센터 업데이트", message: "다운로드된 종합센터 업데이트를 지금 설치할까요?", detail: "실행 중인 SD 앱을 종료하고 종합센터를 업데이트한 뒤 자동으로 다시 실행합니다.", buttons: ["취소", "업데이트 후 재시작"], defaultId: 1, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return { ok: false, canceled: true };
    await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));
    isQuitting = true;
    setTimeout(() => autoUpdater.quitAndInstall(), 120);
    return { ok: true, installing: true };
  }

  function rawEntryVersion(entry) {
    if (entry?.rawVersion) {
      return String(entry.rawVersion);
    }

    const match = String(entry?.version || "").match(/v?(\d+(?:\.\d+){1,3})/i);
    return match ? match[1] : "0.0.0";
  }

  function displayEntryVersion(entry) {
    const rawVersion = rawEntryVersion(entry);
    const label = String(entry?.version || "");
    if (!rawVersion || rawVersion === "0.0.0") {
      return label;
    }
    if (/v?\d+(?:\.\d+){1,3}/i.test(label)) {
      return label.replace(/v?\d+(?:\.\d+){1,3}/i, `v${rawVersion}`);
    }
    return label ? `${label} · v${rawVersion}` : `v${rawVersion}`;
  }

  function requiredRuleFor(entry) {
    const fallbackRule = FALLBACK_REQUIRED_APPS[entry?.id];

    // v2.1.2 핫픽스에서는 물류센터와 SD Link만 강제 업데이트 대상으로 허용합니다.
    // 서버 정책에 다른 앱이 있어도 여기 등록되지 않은 앱은 차단하지 않습니다.
    if (!fallbackRule) {
      return null;
    }

    const remoteRule = requiredPolicy?.apps?.[entry?.id];
    const rule = {
      ...fallbackRule,
      ...(remoteRule || {}),
    };

    if (rule.required === false) {
      return null;
    }

    return rule;
  }

  function updateRequirementFor(entry) {
    const rule = requiredRuleFor(entry);
    if (!rule) {
      return { updateRequired: false, requiredVersion: "" };
    }

    const currentVersion = rawEntryVersion(entry);
    const requiredVersion = String(rule.minVersion || "0.0.0");

    return {
      updateRequired:
        compareVersions(currentVersion, requiredVersion) < 0,
      requiredVersion,
      currentVersion,
    };
  }

  function catalogRuleFor(entry) {
    const entryId = String(entry?.id || "");
    const lookupId =
      entryId === "sd-bitcoin-miner-desktop" ? "bitcoin" : entryId;
    const rule =
      extensionCatalog?.apps?.[entryId] ||
      extensionCatalog?.apps?.[lookupId];
    if (!rule || !rule.version || !rule.downloadUrl) {
      return null;
    }
    return rule;
  }

  function updateAvailabilityFor(entry) {
    const rule = catalogRuleFor(entry);
    if (!rule) {
      return {
        updateAvailable: false,
        latestVersion: "",
        updateNotes: "",
      };
    }

    const latestVersion = String(rule.version || "0.0.0");
    const currentVersion = rawEntryVersion(entry);

    return {
      updateAvailable:
        compareVersions(currentVersion, latestVersion) < 0,
      latestVersion,
      updateNotes: String(rule.notes || ""),
    };
  }

  async function refreshRequiredPolicy({ force = false } = {}) {
    if (
      !force &&
      requiredPolicyFetchedAt > 0 &&
      Date.now() - requiredPolicyFetchedAt < REQUIRED_POLICY_TTL_MS
    ) {
      return requiredPolicy;
    }

    if (requiredPolicyPromise) {
      return requiredPolicyPromise;
    }

    requiredPolicyPromise = (async () => {
      try {
        const remotePolicy = await fetchRequiredPolicy();
        requiredPolicy = {
          ...remotePolicy,
          apps: {
            ...FALLBACK_REQUIRED_APPS,
            ...(remotePolicy?.apps || {}),
          },
        };
        requiredPolicyFetchedAt = Date.now();
        return requiredPolicy;
      } catch (error) {
        requiredPolicy = {
          ...requiredPolicy,
          apps: {
            ...FALLBACK_REQUIRED_APPS,
            ...(requiredPolicy?.apps || {}),
          },
        };
        requiredPolicyFetchedAt = Date.now();
        console.warn(
          "필수 업데이트 정책을 불러오지 못해 내장 정책을 사용합니다.",
          error?.message || error,
        );
        return requiredPolicy;
      } finally {
        requiredPolicyPromise = null;
      }
    })();

    return requiredPolicyPromise;
  }

  async function refreshExtensionCatalog({ force = false } = {}) {
    if (
      !force &&
      extensionCatalogFetchedAt > 0 &&
      Date.now() - extensionCatalogFetchedAt < EXTENSION_CATALOG_TTL_MS
    ) {
      return extensionCatalog;
    }

    if (extensionCatalogPromise) {
      return extensionCatalogPromise;
    }

    extensionCatalogPromise = (async () => {
      try {
        const response = await fetch(EXTENSION_CATALOG_URL, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`확장팩 카탈로그 HTTP ${response.status}`);
        }
        const remote = await response.json();
        if (!remote || typeof remote !== "object" || !remote.apps) {
          throw new Error("확장팩 카탈로그 형식이 올바르지 않습니다.");
        }
        extensionCatalog = {
          ...remote,
          apps: {
            ...(FALLBACK_EXTENSION_CATALOG.apps || {}),
            ...(remote.apps || {}),
          },
        };
      } catch (error) {
        extensionCatalog = {
          ...extensionCatalog,
          apps: {
            ...(FALLBACK_EXTENSION_CATALOG.apps || {}),
            ...(extensionCatalog?.apps || {}),
          },
        };
        console.warn(
          "확장팩 업데이트 카탈로그를 불러오지 못해 내장 목록을 사용합니다.",
          error?.message || error,
        );
      } finally {
        extensionCatalogFetchedAt = Date.now();
        extensionCatalogPromise = null;
      }
      return extensionCatalog;
    })();

    return extensionCatalogPromise;
  }

  function downloadableExtensionEntries() {
    const seenUrls = new Set();
    return Object.entries(extensionCatalog?.apps || {})
      .map(([id, rule]) => ({
        id: String(id || ""),
        name: String(rule?.name || id || "확장팩"),
        version: String(rule?.version || ""),
        downloadUrl: String(rule?.downloadUrl || "").trim(),
      }))
      .filter((entry) => {
        if (!entry.id || !entry.version || !entry.downloadUrl) return false;
        if (!/^https:\/\//i.test(entry.downloadUrl)) return false;
        if (seenUrls.has(entry.downloadUrl)) return false;
        seenUrls.add(entry.downloadUrl);
        return true;
      });
  }

  function safeExtensionFileName(entry) {
    let candidate = "";
    try {
      const parsed = new URL(entry.downloadUrl);
      candidate = decodeURIComponent(path.posix.basename(parsed.pathname));
    } catch {}
    if (!/\.zip$/i.test(candidate)) {
      candidate = `${entry.name}_v${entry.version}.zip`;
    }
    const safe = candidate
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 160);
    return safe || `${entry.id}_v${entry.version}.zip`;
  }

  function bulkDownloadStamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function sendBulkDownloadProgress(payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("center:bulk-download-progress", payload);
  }

  async function downloadAllExtensionZips() {
    try {
      await refreshExtensionCatalog({ force: true });
      const entries = downloadableExtensionEntries();
      if (entries.length === 0) {
        return { ok: false, error: "다운로드 가능한 확장팩 ZIP이 없습니다." };
      }

      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "확장팩 ZIP 일괄 다운로드",
        message: `최신 확장팩 ZIP ${entries.length}개를 한 번에 다운로드할까요?`,
        detail: entries.map((entry) => `• ${entry.name} v${entry.version}`).join("\n") + "\n\n설치하지 않고 ZIP 파일만 저장합니다.",
        buttons: ["취소", "저장 위치 선택"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) return { ok: false, canceled: true };

      const selection = await dialog.showOpenDialog(mainWindow, {
        title: "확장팩 ZIP 저장 폴더 선택",
        defaultPath: app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths?.[0]) {
        return { ok: false, canceled: true };
      }

      const targetDirectory = path.join(selection.filePaths[0], `SD확장팩_${bulkDownloadStamp()}`);
      fs.mkdirSync(targetDirectory, { recursive: true });
      const results = [];
      const usedNames = new Set();
      sendBulkDownloadProgress({ completed: 0, total: entries.length, name: "준비 중" });

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        let fileName = safeExtensionFileName(entry);
        if (usedNames.has(fileName.toLowerCase())) fileName = `${entry.id}_${fileName}`;
        usedNames.add(fileName.toLowerCase());
        const destination = path.join(targetDirectory, fileName);
        const temporary = `${destination}.part`;
        sendBulkDownloadProgress({ completed: index, total: entries.length, name: entry.name });

        try {
          fs.rmSync(temporary, { force: true });
          await downloadFile(entry.downloadUrl, temporary);
          const stat = fs.statSync(temporary);
          if (!stat.isFile() || stat.size <= 0) throw new Error("다운로드된 ZIP 파일이 비어 있습니다.");
          inspectZip(temporary);
          fs.rmSync(destination, { force: true });
          fs.renameSync(temporary, destination);
          results.push({ id: entry.id, name: entry.name, ok: true, fileName });
        } catch (error) {
          fs.rmSync(temporary, { force: true });
          results.push({ id: entry.id, name: entry.name, ok: false, error: error.message });
        }
        sendBulkDownloadProgress({ completed: index + 1, total: entries.length, name: entry.name });
      }

      const failed = results.filter((result) => !result.ok);
      const openError = await shell.openPath(targetDirectory);
      return {
        ok: failed.length === 0,
        count: entries.length,
        downloadedCount: results.length - failed.length,
        failedCount: failed.length,
        folder: targetDirectory,
        folderOpenError: openError || "",
        results,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function toggleFavorite(id) {
    const entry = appById.get(String(id || ""));
    if (!entry) return { ok: false, error: "등록되지 않은 앱입니다." };
    const favorite = !isFavoriteId(entry.id);
    setFavoriteId(entry.id, favorite);
    sendAppStates();
    return { ok: true, id: entry.id, favorite };
  }

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
      `.store-${appId}-${Date.now()}.zip`,
    );

    try {
      await downloadFile(String(rule.downloadUrl), temporaryZipPath);
      const inspected = inspectZip(temporaryZipPath);
      if (inspected.metadata.id !== appId) {
        throw new Error(
          `상점 앱 ID가 다릅니다. 카탈로그: ${appId} / ZIP: ${inspected.metadata.id}`,
        );
      }
      if (
        compareVersions(
          inspected.metadata.rawVersion,
          String(rule.version || "0.0.0"),
        ) < 0
      ) {
        throw new Error(
          `다운로드된 버전(v${inspected.metadata.rawVersion})이 상점 최신 버전(v${rule.version})보다 낮습니다.`,
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
        throw new Error(`${collision.name}과 같은 저장 폴더를 사용합니다.`);
      }

      const removedExisting = removedById.get(appId) || null;
      const destinationDirectory = path.join(INSTALLED_APPS_ROOT, appId);
      await installInspectedZipWithRetry(inspected, destinationDirectory);
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

  async function installRequiredUpdate(entry, rule) {
    const downloadUrl = String(rule.downloadUrl || "").trim();
    if (!downloadUrl) {
      throw new Error("필수 업데이트 다운로드 주소가 없습니다.");
    }

    ensureManagedDirectory(APP_PACKAGES_ROOT);
    const temporaryZipPath = path.join(
      APP_PACKAGES_ROOT,
      `.required-${entry.id}-${Date.now()}.zip`,
    );

    try {
      await downloadFile(downloadUrl, temporaryZipPath);
      const inspected = inspectZip(temporaryZipPath);
      const requiredVersion = String(rule.minVersion || "0.0.0");

      if (inspected.metadata.id !== entry.id) {
        throw new Error(
          `업데이트 앱 ID가 다릅니다. (${inspected.metadata.id})`,
        );
      }

      if (
        compareVersions(
          inspected.metadata.rawVersion,
          requiredVersion,
        ) < 0
      ) {
        throw new Error(
          `다운로드된 버전(v${inspected.metadata.rawVersion})이 필수 버전(v${requiredVersion})보다 낮습니다.`,
        );
      }

      await terminateAppAndWait(entry.id);
      const destinationDirectory = entry.builtin
        ? entry.directory
        : path.join(INSTALLED_APPS_ROOT, inspected.metadata.id);
      await installInspectedZipWithRetry(inspected, destinationDirectory);

      if (entry.builtin) {
        const staleCustomDirectory = path.join(
          INSTALLED_APPS_ROOT,
          inspected.metadata.id,
        );
        registry = permanentlyRemoveApp(registry, entry.id, false);
        saveRegistry(REGISTRY_PATH, registry);
        if (path.resolve(staleCustomDirectory) !== path.resolve(destinationDirectory)) {
          fs.rmSync(staleCustomDirectory, { recursive: true, force: true });
        }
        fs.rmSync(path.join(APP_PACKAGES_ROOT, `${entry.id} .zip`.replace(" ", "")), { force: true });
        refreshCatalogAndUi();
        return appById.get(entry.id);
      }

      const packagePath = archiveAppZip(
        temporaryZipPath,
        inspected.metadata.id,
      );
      const appEntry = {
        ...inspected.metadata,
        directory: destinationDirectory,
        packagePath,
        importedAt: entry.importedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      registry = upsertCustomApp(registry, appEntry);
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();
      return appById.get(appEntry.id);
    } finally {
      fs.rmSync(temporaryZipPath, { force: true });
    }
  }

  async function installCatalogUpdate(entry, rule) {
    const downloadUrl = String(rule.downloadUrl || "").trim();
    const latestVersion = String(rule.version || "0.0.0");
    if (!downloadUrl) {
      throw new Error("업데이트 다운로드 주소가 없습니다.");
    }

    ensureManagedDirectory(APP_PACKAGES_ROOT);
    const temporaryZipPath = path.join(
      APP_PACKAGES_ROOT,
      `.catalog-${entry.id}-${Date.now()}.zip`,
    );

    try {
      await downloadFile(downloadUrl, temporaryZipPath);
      const inspected = inspectZip(temporaryZipPath);

      if (inspected.metadata.id !== entry.id) {
        throw new Error(
          `업데이트 앱 ID가 다릅니다. (${inspected.metadata.id})`,
        );
      }

      if (
        compareVersions(inspected.metadata.rawVersion, latestVersion) < 0
      ) {
        throw new Error(
          `다운로드된 버전(v${inspected.metadata.rawVersion})이 최신 버전(v${latestVersion})보다 낮습니다.`,
        );
      }

      await terminateAppAndWait(entry.id);
      const destinationDirectory = entry.builtin
        ? entry.directory
        : path.join(INSTALLED_APPS_ROOT, inspected.metadata.id);
      await installInspectedZipWithRetry(inspected, destinationDirectory);

      if (entry.builtin) {
        registry = {
          ...registry,
          hiddenBuiltinIds: (registry.hiddenBuiltinIds || []).filter(
            (knownId) => knownId !== entry.id,
          ),
          customApps: (registry.customApps || []).filter(
            (knownEntry) => knownEntry.id !== entry.id,
          ),
          removedApps: (registry.removedApps || []).filter(
            (knownEntry) => knownEntry.id !== entry.id,
          ),
        };
        saveRegistry(REGISTRY_PATH, registry);
        const staleCustomDirectory = path.join(INSTALLED_APPS_ROOT, entry.id);
        if (path.resolve(staleCustomDirectory) !== path.resolve(destinationDirectory)) {
          fs.rmSync(staleCustomDirectory, { recursive: true, force: true });
        }
        fs.rmSync(path.join(APP_PACKAGES_ROOT, `${entry.id}.zip`), { force: true });
        refreshCatalogAndUi();
        return appById.get(entry.id);
      }

      const packagePath = archiveAppZip(
        temporaryZipPath,
        inspected.metadata.id,
      );
      const appEntry = {
        ...inspected.metadata,
        directory: destinationDirectory,
        packagePath,
        importedAt: entry.importedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      registry = upsertCustomApp(registry, appEntry);
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();
      return appById.get(appEntry.id);
    } finally {
      fs.rmSync(temporaryZipPath, { force: true });
    }
  }

  async function updateAppFromCatalog(id) {
    const entry = appById.get(id);
    if (!entry) {
      return { ok: false, error: "등록되지 않은 앱입니다." };
    }

    await refreshExtensionCatalog();
    const rule = catalogRuleFor(entry);
    if (!rule) {
      return {
        ok: false,
        error: "이 앱은 종합센터 자동 업데이트 목록에 없습니다.",
      };
    }

    const availability = updateAvailabilityFor(entry);

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "확장팩 업데이트",
      message: `${entry.name}을 v${availability.latestVersion}으로 업데이트할까요?`,
      detail: `현재 버전: v${rawEntryVersion(entry)}\n최신 버전: v${availability.latestVersion}\n\n${availability.updateNotes || "최신 확장팩 파일로 교체합니다."}\n\n앱 파일만 교체하며 저장 데이터는 유지합니다.`,
      buttons: ["취소", "업데이트"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response !== 1) {
      return { ok: false, canceled: true };
    }

    try {
      const updatedEntry = await installCatalogUpdate(entry, rule);
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "업데이트 완료",
        message: `${entry.name} 업데이트가 완료되었습니다.`,
        detail: `v${rawEntryVersion(updatedEntry)} 버전으로 교체했습니다. 기존 저장 데이터는 유지됩니다.`,
        buttons: ["확인"],
        defaultId: 0,
        noLink: true,
      });
      return {
        ok: true,
        updated: true,
        app: publicAppState(updatedEntry),
      };
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "업데이트 실패",
        message: `${entry.name}을 업데이트하지 못했습니다.`,
        detail: error.message,
        buttons: ["확인"],
        defaultId: 0,
        noLink: true,
      });
      return { ok: false, error: error.message };
    }
  }

  async function updateAllAvailableApps() {
    await refreshExtensionCatalog({ force: true });
    const targets = appCatalog.filter(
      (entry) => updateAvailabilityFor(entry).updateAvailable,
    );

    if (targets.length === 0) {
      sendAppStates();
      return { ok: true, count: 0, updatedCount: 0, results: [] };
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "확장팩 모두 업데이트",
      message: `업데이트 가능한 확장팩 ${targets.length}개를 모두 업데이트할까요?`,
      detail: targets
        .map((entry) => {
          const availability = updateAvailabilityFor(entry);
          return `• ${entry.name}: v${rawEntryVersion(entry)} → v${availability.latestVersion}`;
        })
        .join("\n"),
      buttons: ["취소", "모두 업데이트"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response !== 1) {
      return { ok: false, canceled: true };
    }

    const results = [];
    for (const originalEntry of targets) {
      const entry = appById.get(originalEntry.id) || originalEntry;
      const rule = catalogRuleFor(entry);
      try {
        const updatedEntry = await installCatalogUpdate(entry, rule);
        results.push({
          id: entry.id,
          name: entry.name,
          ok: true,
          version: rawEntryVersion(updatedEntry),
        });
      } catch (error) {
        results.push({
          id: entry.id,
          name: entry.name,
          ok: false,
          error: error.message,
        });
      }
    }

    const updatedCount = results.filter((result) => result.ok).length;
    const failed = results.filter((result) => !result.ok);
    refreshCatalogAndUi();

    await dialog.showMessageBox(mainWindow, {
      type: failed.length ? "warning" : "info",
      title: "확장팩 업데이트 결과",
      message: failed.length
        ? `${updatedCount}개 업데이트 완료 · ${failed.length}개 실패`
        : `확장팩 ${updatedCount}개 업데이트를 완료했습니다.`,
      detail: failed.length
        ? failed.map((result) => `• ${result.name}: ${result.error}`).join("\n")
        : "기존 저장 데이터는 유지됩니다.",
      buttons: ["확인"],
      defaultId: 0,
      noLink: true,
    });

    return {
      ok: failed.length === 0,
      count: targets.length,
      updatedCount,
      failedCount: failed.length,
      results,
    };
  }

  async function ensureRequiredVersion(entry) {
    await refreshRequiredPolicy();
    const rule = requiredRuleFor(entry);

    if (!rule) {
      return { ok: true, entry };
    }

    const requirement = updateRequirementFor(entry);
    if (!requirement.updateRequired) {
      return { ok: true, entry };
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "필수 업데이트",
      message: `${entry.name}을 실행하려면 업데이트가 필요합니다.`,
      detail: `${rule.message || "경제 밸런스 필수 업데이트입니다."}\n\n현재 버전: v${requirement.currentVersion}\n필수 버전: v${requirement.requiredVersion}\n\n업데이트하지 않으면 이 앱은 실행할 수 없습니다.`,
      buttons: ["취소", "지금 업데이트"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response !== 1) {
      return {
        ok: false,
        blockedByRequiredUpdate: true,
        error: `${entry.name} v${requirement.requiredVersion} 필수 업데이트가 필요합니다.`,
      };
    }

    try {
      const updatedEntry = await installRequiredUpdate(entry, rule);
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "업데이트 완료",
        message: `${entry.name} 업데이트가 완료되었습니다.`,
        detail: `v${rawEntryVersion(updatedEntry)} 버전으로 교체했습니다. 기존 저장 데이터는 유지됩니다.`,
        buttons: ["확인"],
        defaultId: 0,
        noLink: true,
      });
      return {
        ok: true,
        entry: updatedEntry,
        mandatoryUpdated: true,
      };
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "필수 업데이트 실패",
        message: `${entry.name}을 업데이트하지 못했습니다.`,
        detail: `${error.message}\n\n업데이트가 완료되기 전에는 앱을 실행할 수 없습니다.`,
        buttons: ["확인"],
        defaultId: 0,
        noLink: true,
      });
      return {
        ok: false,
        blockedByRequiredUpdate: true,
        error: error.message,
      };
    }
  }

  function appIconUrl(entry) {
    const fallbackPath = path.join(
      __dirname,
      "public",
      "icons",
      "icon-512.png",
    );
    const candidatePath = entry.icon
      ? path.join(entry.directory, entry.icon)
      : fallbackPath;
    const iconPath = fs.existsSync(candidatePath)
      ? candidatePath
      : fallbackPath;

    return pathToFileURL(iconPath).href;
  }

  function publicAppState(entry) {
    const child = runningApps.get(entry.id);

    return {
      id: entry.id,
      name: entry.name,
      version: displayEntryVersion(entry),
      description: entry.description,
      improvement: entry.improvement,
      accent: entry.accent,
      builtin: Boolean(entry.builtin),
      sourceZipName: entry.sourceZipName || "",
      running: Boolean(child && child.exitCode === null),
      directory: getChildDirectory(entry),
      iconUrl: appIconUrl(entry),
      rawVersion: rawEntryVersion(entry),
      favorite: isFavoriteId(entry.id),
      ...updateRequirementFor(entry),
      ...updateAvailabilityFor(entry),
    };
  }

  function getAllAppStates() {
    return appCatalog.map(publicAppState);
  }

  function publicRemovedAppState(entry) {
    const mainPath = entry.directory
      ? path.join(entry.directory, entry.entry || "main.js")
      : "";
    const packageAvailable = Boolean(
      entry.packagePath && fs.existsSync(entry.packagePath),
    );
    const filesAvailable = Boolean(
      entry.builtin || (mainPath && fs.existsSync(mainPath)),
    );

    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      improvement: entry.improvement,
      accent: entry.accent,
      builtin: Boolean(entry.builtin),
      sourceZipName: entry.sourceZipName || "",
      removedAt: entry.removedAt || "",
      restorable: filesAvailable || packageAvailable,
      iconUrl: appIconUrl(entry),
    };
  }

  function getRemovedAppStates() {
    return removedCatalog.map(publicRemovedAppState);
  }

  function sendAppStates() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(
      "center:app-states",
      getAllAppStates(),
    );
    mainWindow.webContents.send(
      "center:removed-app-states",
      getRemovedAppStates(),
    );
  }

  function showCenter() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  }

  function childLaunchArgs(id, extraArgs = []) {
    const childArgument = `--sd-child-app=${id}`;
    const normalizedExtraArgs = Array.isArray(extraArgs)
      ? extraArgs.filter((value) => typeof value === "string" && value)
      : [];

    if (app.isPackaged) {
      return [childArgument, ...normalizedExtraArgs];
    }

    return [__dirname, childArgument, ...normalizedExtraArgs];
  }

  function spawnChild(entry, { track = true, extraArgs = [] } = {}) {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;

    const child = spawn(
      process.execPath,
      childLaunchArgs(entry.id, extraArgs),
      {
        cwd: getChildDirectory(entry),
        env: environment,
        stdio: "ignore",
        windowsHide: false,
      },
    );

    if (!track) {
      child.unref();
      return child;
    }

    runningApps.set(entry.id, child);
    sendAppStates();

    child.once("exit", () => {
      if (runningApps.get(entry.id) === child) {
        runningApps.delete(entry.id);
        sendAppStates();
      }
    });

    child.once("error", () => {
      if (runningApps.get(entry.id) === child) {
        runningApps.delete(entry.id);
        sendAppStates();
      }
    });

    return child;
  }

  async function launchApp(id) {
    let entry = appById.get(id);

    if (!entry) {
      return {
        ok: false,
        error: "등록되지 않은 앱입니다.",
      };
    }

    const requiredCheck = await ensureRequiredVersion(entry);
    if (!requiredCheck.ok) {
      return requiredCheck;
    }
    entry = requiredCheck.entry || appById.get(id) || entry;

    const running = runningApps.get(id);

    if (running && running.exitCode === null) {
      spawnChild(entry, { track: false });
      return {
        ok: true,
        alreadyRunning: true,
        mandatoryUpdated: Boolean(requiredCheck.mandatoryUpdated),
      };
    }

    try {
      spawnChild(entry);
      return {
        ok: true,
        alreadyRunning: false,
        mandatoryUpdated: Boolean(requiredCheck.mandatoryUpdated),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function terminateApp(id) {
    const child = runningApps.get(id);

    if (!child || child.exitCode !== null) {
      runningApps.delete(id);
      sendAppStates();
      return { ok: true, wasRunning: false };
    }

    try {
      child.kill();
      return { ok: true, wasRunning: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function updateDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode !== null) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (exited) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      child.once("exit", onExit);
      timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs);
    });
  }

  async function forceKillChildTree(child) {
    if (!child || child.exitCode !== null) return true;

    try {
      child.kill();
    } catch {}

    if (await waitForChildExit(child, 900)) return true;

    if (process.platform === "win32" && child.pid) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        try {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("exit", finish);
          killer.once("error", finish);
          setTimeout(finish, 2200);
        } catch {
          finish();
        }
      });
    } else {
      try {
        child.kill("SIGKILL");
      } catch {}
    }

    return waitForChildExit(child, 1800);
  }

  async function installInspectedZipWithRetry(inspected, destinationDirectory) {
    const retryableCodes = new Set(["EBUSY", "EPERM", "EACCES"]);
    let lastError = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        installInspectedZip(inspected, destinationDirectory);
        return;
      } catch (error) {
        lastError = error;
        const code = String(error?.code || "").toUpperCase();
        if (!retryableCodes.has(code) || attempt === 7) throw error;
        await updateDelay(300 + attempt * 250);
      }
    }

    throw lastError || new Error("앱 파일 교체에 실패했습니다.");
  }

  async function terminateAppAndWait(id) {
    const child = runningApps.get(id);

    if (!child || child.exitCode !== null) {
      runningApps.delete(id);
      sendAppStates();
      return;
    }

    const exited = await forceKillChildTree(child);
    if (!exited && child.exitCode === null) {
      throw new Error(
        "실행 중인 앱 프로세스를 완전히 종료하지 못했습니다. 앱을 닫은 뒤 다시 업데이트해 주세요.",
      );
    }

    runningApps.delete(id);
    sendAppStates();
    // Windows가 종료된 Electron 프로세스의 파일 핸들을 정리할 시간을 줍니다.
    await updateDelay(350);
  }

  function terminateAllApps() {
    for (const entry of appCatalog) {
      terminateApp(entry.id);
    }
  }

  function sdLinkStartupRegistration() {
    if (process.platform !== "win32" || !app.isPackaged) return null;

    const startupArgument = "--sd-center-auto-link";
    const squirrelUpdateExe = path.resolve(
      path.dirname(process.execPath),
      "..",
      "Update.exe",
    );

    if (fs.existsSync(squirrelUpdateExe)) {
      return {
        path: squirrelUpdateExe,
        args: [
          "--processStart",
          path.basename(process.execPath),
          "--process-start-args",
          startupArgument,
        ],
      };
    }

    return {
      path: process.execPath,
      args: [startupArgument],
    };
  }

  function configureSdLinkWindowsAutoStart() {
    const registration = sdLinkStartupRegistration();
    if (!registration) return;

    const enabled = appById.has("sdlink-desktop");
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: registration.path,
        args: registration.args,
      });
      console.log(
        `SD Link Windows 자동 시작: ${enabled ? "ON" : "OFF"}`,
      );
    } catch (error) {
      console.warn(
        "SD Link Windows 자동 시작 등록 실패",
        error?.message || error,
      );
    }
  }

  function launchSdLinkForWindowsLogin() {
    if (!autoStartLinkMode) return;

    const entry = appById.get("sdlink-desktop");
    if (!entry) {
      isQuitting = true;
      app.quit();
      return;
    }

    const running = runningApps.get(entry.id);
    if (running && running.exitCode === null) return;

    try {
      spawnChild(entry, {
        track: true,
        extraArgs: ["--sd-link-auto-start"],
      });
    } catch (error) {
      console.warn(
        "Windows 로그인 시 SD Link 자동 실행 실패",
        error?.message || error,
      );
    }
  }

  function updateTrayMenu() {
    if (!tray) {
      return;
    }

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "SD종합센터 열기",
          click: showCenter,
        },
        { type: "separator" },
        ...appCatalog.map((entry) => ({
          label: `${entry.name} 열기`,
          click: () => { void launchApp(entry.id); },
        })),
        { type: "separator" },
        {
          label: "실행 중 앱 모두 종료",
          click: terminateAllApps,
        },
        {
          label: "종합센터 완전 종료",
          click: quitCenterCompletely,
        },
      ]),
    );
  }

  function refreshCatalogAndUi() {
    reloadCatalog();
    configureSdLinkWindowsAutoStart();
    updateTrayMenu();
    sendAppStates();
  }

  function ensureManagedDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  function isPathInside(rootDirectory, candidatePath) {
    const root = `${path.resolve(rootDirectory)}${path.sep}`;
    const candidate = path.resolve(candidatePath);
    return candidate.startsWith(root);
  }

  function archiveAppZip(sourceZipPath, appId) {
    ensureManagedDirectory(APP_PACKAGES_ROOT);
    const finalPath = path.join(APP_PACKAGES_ROOT, `${appId}.zip`);
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;

    fs.copyFileSync(sourceZipPath, temporaryPath);
    fs.rmSync(finalPath, { force: true });
    fs.renameSync(temporaryPath, finalPath);
    return finalPath;
  }

  function moveDirectory(sourceDirectory, destinationDirectory) {
    if (!isPathInside(CENTER_DATA_ROOT, sourceDirectory)) {
      throw new Error("앱 폴더 경로가 안전하지 않습니다.");
    }

    if (!isPathInside(CENTER_DATA_ROOT, destinationDirectory)) {
      throw new Error("보관함 경로가 안전하지 않습니다.");
    }

    ensureManagedDirectory(path.dirname(destinationDirectory));
    fs.rmSync(destinationDirectory, {
      recursive: true,
      force: true,
    });
    fs.renameSync(sourceDirectory, destinationDirectory);
  }

  function removeFileIfManaged(filePath, rootDirectory) {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }

    if (!isPathInside(rootDirectory, filePath)) {
      throw new Error("삭제 대상 경로가 안전하지 않습니다.");
    }

    fs.rmSync(filePath, {
      recursive: true,
      force: true,
    });
  }

  async function addAppFromZip() {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "종합센터에 추가할 앱 ZIP 선택",
      properties: ["openFile"],
      filters: [
        { name: "ZIP 앱 패키지", extensions: ["zip"] },
      ],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    try {
      const inspected = inspectZip(selection.filePaths[0]);
      const builtinCollision = BUILTIN_CATALOG.some(
        (entry) => entry.id === inspected.metadata.id,
      );

      if (builtinCollision) {
        return {
          ok: false,
          error:
            "기본 앱과 같은 ID입니다. 기본 앱은 삭제된 앱 보관함에서 재설치해 주세요.",
        };
      }

      const protectedDataFolders = new Set([
        "SD종합센터",
        ...BUILTIN_CATALOG.map((entry) => entry.userDataFolder),
      ]);

      if (protectedDataFolders.has(inspected.metadata.userDataFolder)) {
        return {
          ok: false,
          error:
            "기본 앱 또는 종합센터와 같은 저장 폴더 이름입니다. sd-app.json의 userDataFolder를 다른 이름으로 바꿔주세요.",
        };
      }

      const allKnownApps = [
        ...appCatalog,
        ...removedCatalog,
      ];
      const dataFolderCollision = allKnownApps.find(
        (entry) =>
          entry.id !== inspected.metadata.id &&
          entry.userDataFolder === inspected.metadata.userDataFolder,
      );

      if (dataFolderCollision) {
        return {
          ok: false,
          error: `${dataFolderCollision.name}과 같은 저장 폴더를 사용합니다. sd-app.json의 userDataFolder를 다른 이름으로 바꿔주세요.`,
        };
      }

      const existing = appById.get(inspected.metadata.id);
      const removedExisting = removedById.get(
        inspected.metadata.id,
      );

      if (existing || removedExisting) {
        const target = existing || removedExisting;
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: "question",
          title: existing ? "앱 업데이트" : "삭제된 앱 재설치",
          message: `${target.name} 앱이 이미 ${existing ? "등록" : "보관"}되어 있습니다.`,
          detail: `${inspected.metadata.version} 버전으로 교체할까요? 저장 데이터는 유지됩니다.`,
          buttons: ["취소", existing ? "업데이트" : "새 ZIP으로 재설치"],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });

        if (confirmation.response !== 1) {
          return { ok: false, canceled: true };
        }

        if (existing) {
          await terminateAppAndWait(existing.id);
        }
      }

      const destinationDirectory = path.join(
        INSTALLED_APPS_ROOT,
        inspected.metadata.id,
      );
      await installInspectedZipWithRetry(inspected, destinationDirectory);
      const packagePath = archiveAppZip(
        inspected.zipPath,
        inspected.metadata.id,
      );

      const appEntry = {
        ...inspected.metadata,
        directory: destinationDirectory,
        packagePath,
        importedAt: new Date().toISOString(),
      };

      if (removedExisting && !removedExisting.builtin) {
        const oldRecycleDirectory =
          removedExisting.recycleDirectory || "";
        const oldPackagePath = removedExisting.packagePath || "";

        if (
          oldRecycleDirectory &&
          fs.existsSync(oldRecycleDirectory)
        ) {
          removeFileIfManaged(
            oldRecycleDirectory,
            REMOVED_APPS_ROOT,
          );
        }

        if (
          oldPackagePath &&
          oldPackagePath !== packagePath &&
          fs.existsSync(oldPackagePath)
        ) {
          removeFileIfManaged(
            oldPackagePath,
            APP_PACKAGES_ROOT,
          );
        }
      }

      registry = upsertCustomApp(registry, appEntry);
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();

      return {
        ok: true,
        updated: Boolean(existing || removedExisting),
        restoredFromBin: Boolean(removedExisting),
        app: publicAppState(appById.get(appEntry.id)),
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  function safeDataDirectory(entry) {
    const candidate = path.resolve(
      APP_DATA_ROOT,
      entry.userDataFolder,
    );
    const rootPrefix = `${path.resolve(APP_DATA_ROOT)}${path.sep}`;
    const protectedCenterDirectory = path.resolve(CENTER_DATA_ROOT);

    if (
      !candidate.startsWith(rootPrefix) ||
      candidate === protectedCenterDirectory
    ) {
      throw new Error("저장 데이터 경로가 안전하지 않습니다.");
    }

    return candidate;
  }

  async function deleteApp(id) {
    const entry = appById.get(id);

    if (!entry) {
      return { ok: false, error: "등록되지 않은 앱입니다." };
    }

    const detail = entry.builtin
      ? "센터에서 제거하면 삭제된 앱 보관함으로 이동합니다. 기본 앱 원본은 센터에 포함되어 있어 언제든 원클릭 재설치할 수 있습니다."
      : "센터에서 제거하면 앱 파일을 삭제된 앱 보관함으로 옮기고 저장 데이터와 ZIP 백업은 유지합니다.";
    const destructiveLabel = entry.builtin
      ? "데이터까지 삭제 후 보관함 이동"
      : "앱과 저장 데이터 완전 삭제";
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "앱 제거",
      message: `${entry.name}을 센터에서 제거할까요?`,
      detail: `${detail}\n\n진행 데이터를 삭제하면 복구하기 어렵습니다.`,
      buttons: ["취소", "삭제된 앱 보관함으로 이동", destructiveLabel],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response === 0) {
      return { ok: false, canceled: true };
    }

    try {
      await terminateAppAndWait(id);
      const deleteData = confirmation.response === 2;

      if (deleteData) {
        const dataDirectory = safeDataDirectory(entry);
        fs.rmSync(dataDirectory, {
          recursive: true,
          force: true,
        });
      }

      if (confirmation.response === 2 && !entry.builtin) {
        removeFileIfManaged(
          entry.directory,
          INSTALLED_APPS_ROOT,
        );

        if (entry.packagePath) {
          removeFileIfManaged(
            entry.packagePath,
            APP_PACKAGES_ROOT,
          );
        }

        registry = permanentlyRemoveApp(
          registry,
          entry.id,
          false,
        );
        saveRegistry(REGISTRY_PATH, registry);
        refreshCatalogAndUi();

        return {
          ok: true,
          permanentlyDeleted: true,
          deletedData: true,
          movedToBin: false,
          builtin: false,
          name: entry.name,
        };
      }

      let removedEntry = { ...entry };

      if (!entry.builtin) {
        const recycleDirectory = path.join(
          REMOVED_APPS_ROOT,
          entry.id,
        );

        if (fs.existsSync(entry.directory)) {
          moveDirectory(entry.directory, recycleDirectory);
        }

        removedEntry = {
          ...entry,
          originalDirectory: entry.directory,
          recycleDirectory,
        };
      }

      registry = moveAppToRemoved(
        registry,
        removedEntry,
      );
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();

      return {
        ok: true,
        permanentlyDeleted: false,
        deletedData: deleteData,
        movedToBin: true,
        builtin: entry.builtin,
        name: entry.name,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function restoreRemovedApp(id) {
    const entry = removedById.get(id);

    if (!entry) {
      return {
        ok: false,
        error: "삭제된 앱 보관함에서 해당 앱을 찾지 못했습니다.",
      };
    }

    try {
      if (entry.builtin) {
        registry = restoreAppInRegistry(registry, entry);
      } else {
        const destinationDirectory = path.join(
          INSTALLED_APPS_ROOT,
          entry.id,
        );
        const recycleDirectory =
          entry.recycleDirectory || entry.directory || "";
        const recycledMainPath = recycleDirectory
          ? path.join(
              recycleDirectory,
              entry.entry || "main.js",
            )
          : "";

        if (recycledMainPath && fs.existsSync(recycledMainPath)) {
          if (fs.existsSync(destinationDirectory)) {
            removeFileIfManaged(
              destinationDirectory,
              INSTALLED_APPS_ROOT,
            );
          }
          moveDirectory(recycleDirectory, destinationDirectory);
        } else if (
          entry.packagePath &&
          fs.existsSync(entry.packagePath)
        ) {
          const inspected = inspectZip(entry.packagePath);
          await installInspectedZipWithRetry(inspected, destinationDirectory);
        } else {
          return {
            ok: false,
            error:
              "재설치에 필요한 앱 파일과 ZIP 백업을 찾지 못했습니다. 새 ZIP으로 다시 추가해 주세요.",
          };
        }

        registry = restoreAppInRegistry(registry, {
          ...entry,
          builtin: false,
          directory: destinationDirectory,
        });
      }

      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();

      return {
        ok: true,
        app: publicAppState(appById.get(id)),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function permanentlyDeleteRemovedApp(id) {
    const entry = removedById.get(id);

    if (!entry) {
      return {
        ok: false,
        error: "삭제된 앱 보관함에서 해당 앱을 찾지 못했습니다.",
      };
    }

    if (entry.builtin) {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "기본 앱 데이터 삭제",
        message: `${entry.name}의 저장 데이터를 삭제할까요?`,
        detail:
          "기본 앱 원본은 종합센터에 포함되어 있으므로 보관함에는 계속 남으며, 나중에 재설치할 수 있습니다.",
        buttons: ["취소", "저장 데이터 삭제"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });

      if (confirmation.response !== 1) {
        return { ok: false, canceled: true };
      }

      try {
        fs.rmSync(safeDataDirectory(entry), {
          recursive: true,
          force: true,
        });
        return {
          ok: true,
          builtin: true,
          deletedData: true,
          remainsInBin: true,
          name: entry.name,
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "앱 완전 삭제",
      message: `${entry.name}을 삭제된 앱 보관함에서도 지울까요?`,
      detail:
        "앱 파일과 ZIP 백업을 삭제하면 원클릭 재설치를 사용할 수 없습니다.",
      buttons: ["취소", "앱 파일 완전 삭제", "앱과 저장 데이터 완전 삭제"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response === 0) {
      return { ok: false, canceled: true };
    }

    try {
      const recycleDirectory =
        entry.recycleDirectory || entry.directory || "";

      if (recycleDirectory) {
        removeFileIfManaged(
          recycleDirectory,
          REMOVED_APPS_ROOT,
        );
      }

      if (entry.packagePath) {
        removeFileIfManaged(
          entry.packagePath,
          APP_PACKAGES_ROOT,
        );
      }

      const deleteData = confirmation.response === 2;

      if (deleteData) {
        fs.rmSync(safeDataDirectory(entry), {
          recursive: true,
          force: true,
        });
      }

      registry = permanentlyRemoveApp(
        registry,
        entry.id,
        false,
      );
      saveRegistry(REGISTRY_PATH, registry);
      refreshCatalogAndUi();

      return {
        ok: true,
        builtin: false,
        deletedData: deleteData,
        remainsInBin: false,
        name: entry.name,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function quitCenterCompletely() {
    const runningCount = [...runningApps.values()].filter(
      (child) => child && child.exitCode === null,
    ).length;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "종합센터 완전 종료",
      message: "SD종합센터를 완전히 종료할까요?",
      detail:
        runningCount > 0
          ? `현재 실행 중인 연결 앱 ${runningCount}개도 함께 종료됩니다.`
          : "시스템 트레이와 단축키를 포함해 종합센터가 완전히 종료됩니다.",
      buttons: ["취소", "완전히 종료"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (confirmation.response !== 1) {
      return { ok: false, canceled: true };
    }

    isQuitting = true;
    await Promise.all(
      appCatalog.map((entry) => terminateAppAndWait(entry.id)),
    );
    app.quit();
    return { ok: true };
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 980,
      minHeight: 700,
      title: "SD종합센터",
      backgroundColor: "#07101d",
      autoHideMenuBar: true,
      show: false,
      icon: path.join(
        __dirname,
        "public",
        "icons",
        "icon-512.png",
      ),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({
      action: "deny",
    }));

    mainWindow.webContents.on(
      "will-attach-webview",
      (event) => event.preventDefault(),
    );

    mainWindow.webContents.on(
      "will-navigate",
      (event, navigationUrl) => {
        try {
          const target = new URL(navigationUrl);

          if (target.protocol !== "file:") {
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      },
    );

    mainWindow.on("close", (event) => {
      if (isQuitting) {
        return;
      }

      event.preventDefault();
      mainWindow.hide();
    });

    mainWindow.once("ready-to-show", () => {
      if (autoStartLinkMode) {
        mainWindow.hide();
      } else {
        showCenter();
      }
      sendAppStates();
    });

    mainWindow.loadFile(
      path.join(__dirname, "public", "index.html"),
    );
  }

  function createTray() {
    tray = new Tray(
      path.join(
        __dirname,
        "public",
        "icons",
        "icon.ico",
      ),
    );
    tray.setToolTip("SD종합센터");
    updateTrayMenu();
    tray.on("double-click", showCenter);
  }

  function registerIpcHandlers() {
    ipcMain.handle("center:get-center-info", () => ({
      name: "SD종합센터",
      version: app.getVersion(),
    }));
    ipcMain.handle("center:check-self-update", () => checkCenterSelfUpdate());
    ipcMain.handle("center:install-self-update", () => installCenterSelfUpdate());
    ipcMain.handle("center:get-self-update-state", () => sendCenterUpdateState());
    ipcMain.handle("center:toggle-favorite", (event, id) => toggleFavorite(id));
    ipcMain.handle("center:get-extension-store", (event, force = false) =>
      getExtensionStoreState({ force: Boolean(force) }),
    );
    ipcMain.handle("center:install-store-app", (event, id) =>
      installStoreApp(id),
    );
    ipcMain.handle("center:list-apps", () => getAllAppStates());
    ipcMain.handle("center:list-removed-apps", () =>
      getRemovedAppStates(),
    );
    ipcMain.handle("center:launch-app", (event, id) =>
      launchApp(id),
    );
    ipcMain.handle("center:terminate-app", (event, id) =>
      terminateApp(id),
    );
    ipcMain.handle("center:add-app-zip", addAppFromZip);
    ipcMain.handle("center:check-app-updates", async () => {
      try {
        await refreshExtensionCatalog({ force: true });
        sendAppStates();
        const available = appCatalog
          .filter((entry) => updateAvailabilityFor(entry).updateAvailable)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            currentVersion: rawEntryVersion(entry),
            latestVersion: updateAvailabilityFor(entry).latestVersion,
          }));
        return { ok: true, count: available.length, apps: available };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle("center:update-app", (event, id) =>
      updateAppFromCatalog(id),
    );
    ipcMain.handle("center:update-all-apps", () =>
      updateAllAvailableApps(),
    );
    ipcMain.handle("center:delete-app", (event, id) =>
      deleteApp(id),
    );
    ipcMain.handle("center:restore-app", (event, id) =>
      restoreRemovedApp(id),
    );
    ipcMain.handle(
      "center:permanently-delete-removed-app",
      (event, id) => permanentlyDeleteRemovedApp(id),
    );
    ipcMain.handle("center:launch-all", async () => {
      const results = [];

      for (const entry of appCatalog) {
        results.push({
          id: entry.id,
          ...(await launchApp(entry.id)),
        });
      }

      return {
        ok: results.every((result) => result.ok),
        count: appCatalog.length,
        results,
      };
    });
    ipcMain.handle("center:terminate-all", () => {
      terminateAllApps();
      return { ok: true };
    });
    ipcMain.handle("center:show", () => {
      showCenter();
      return { ok: true };
    });
    ipcMain.handle("center:hide", () => {
      mainWindow?.hide();
      return { ok: true };
    });
    ipcMain.handle("center:quit-completely", () =>
      quitCenterCompletely(),
    );
    ipcMain.handle("center:open-app-folder", async (event, id) => {
      const entry = appById.get(id);

      if (!entry) {
        return { ok: false, error: "등록되지 않은 앱입니다." };
      }

      const error = await shell.openPath(getChildDirectory(entry));
      return error ? { ok: false, error } : { ok: true };
    });
  }

  app.whenReady().then(() => {
    app.setAppUserModelId("com.sdcenter.desktop");
    configureCenterAutoUpdater();
    configureSdLinkWindowsAutoStart();
    createMainWindow();
    createTray();
    registerIpcHandlers();
    if (autoStartLinkMode) {
      setTimeout(launchSdLinkForWindowsLogin, 250);
    }
    void Promise.all([
      refreshRequiredPolicy({ force: true }),
      refreshExtensionCatalog({ force: true }),
    ]).then(() => {
      sendAppStates();
    });

    globalShortcut.register("CommandOrControl+Shift+S", showCenter);
  });

  app.on("second-instance", (_event, argv) => {
    if (Array.isArray(argv) && argv.includes("--sd-center-auto-link")) {
      return;
    }
    showCenter();
  });
  app.on("activate", showCenter);
  app.on("window-all-closed", () => {
    // 종합센터는 시스템 트레이와 단축키를 위해 계속 실행합니다.
  });
  app.on("before-quit", () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
  });
}
