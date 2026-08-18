"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  Tray,
} = require("electron");
const { ConfigStore } = require("./src/config-store");
const { AuthService } = require("./src/auth-service");
const { inspectDatabase, fingerprintAccount, getAccount } = require("./src/wallet-db");
const { SyncState } = require("./src/sync-state");
const { SyncEngine } = require("./src/sync-engine");
const { inspectBitcoinSource } = require("./src/bitcoin-reader");

const WEBSITE_URL = "https://sd608.github.io/sd-center/";
const ACCOUNT_URL = `${WEBSITE_URL}account.html`;
const MOBILE_DOWNLOAD_URL =
  "https://github.com/SD608/sd-center/releases/latest/download/SDCenter-Mobile.apk";

let mainWindow = null;
let configStore = null;
let authService = null;
let syncState = null;
let syncEngine = null;
let timer = null;
let tray = null;
let isQuitting = false;

const AUTO_SYNC_INTERVAL_MS = 15_000;

function sendStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sdlink:status", payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 820,
    minHeight: 640,
    title: "SD Link",
    icon: path.join(__dirname, "public", "icons", "icon-512.png"),
    backgroundColor: "#07111f",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    sendStatus({
      message: "SD Link는 작업 표시줄 알림 영역에서 계속 동기화됩니다.",
      kind: "info",
      at: new Date().toISOString(),
    });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

async function runBackgroundSync() {
  const config = configStore?.load();
  if (!config?.autoSync || !authService?.publicSession().authenticated) return;
  if (!config.databasePath || !config.selectedAccountId) return;
  try {
    await syncEngine.syncOnce();
  } catch {
    // 상태 이벤트는 SyncEngine이 전송합니다.
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "public", "icons", "icon.ico"));
  tray.setToolTip("SD Link · PC ↔ 모바일 실시간 동기화");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "SD Link 열기", click: showMainWindow },
    { label: "지금 동기화", click: () => runBackgroundSync() },
    { type: "separator" },
    {
      label: "완전 종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showMainWindow);
}

function commonCandidates() {
  const roots = [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.cwd(),
    path.dirname(process.cwd()),
    app.getPath("userData"),
    path.dirname(app.getPath("userData")),
  ].filter(Boolean);
  const suffixes = [
    ["sdwallet-desktop", "data", "sdwallet.sqlite"],
    ["SD지갑", "data", "sdwallet.sqlite"],
    ["SDWallet", "data", "sdwallet.sqlite"],
    ["data", "sdwallet.sqlite"],
    ["sdwallet.sqlite"],
  ];
  const values = new Set();
  for (const root of roots) {
    for (const suffix of suffixes) values.add(path.resolve(root, ...suffix));
  }
  return [...values];
}

function autoDetectWallet() {
  const matches = [];
  for (const candidate of commonCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const inspected = inspectDatabase(candidate, { deepCheck: true });
      matches.push(inspected);
    } catch {
      // 다른 SQLite 파일은 무시합니다.
    }
  }
  matches.sort((a, b) => {
    try {
      return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs;
    } catch {
      return 0;
    }
  });
  return matches;
}

function getCurrentLocal() {
  const config = configStore.load();
  if (!config.databasePath || !fs.existsSync(config.databasePath)) return null;
  try {
    const inspection = inspectDatabase(config.databasePath);
    const selected = inspection.accounts.find((item) => item.id === config.selectedAccountId) || null;
    return { ...inspection, selected };
  } catch (error) {
    return { error: error.message, path: config.databasePath };
  }
}

async function appState(includeSnapshot = false) {
  const config = configStore.load();
  const result = {
    config,
    auth: authService.publicSession(),
    local: getCurrentLocal(),
    snapshot: null,
  };
  if (includeSnapshot && result.auth.authenticated && config.databasePath && config.selectedAccountId) {
    try {
      result.snapshot = (await syncEngine.snapshot()).snapshot;
    } catch (error) {
      result.snapshotError = error.message;
    }
  }
  return result;
}

function registerIpc() {
  ipcMain.handle("sdlink:get-state", (_event, includeSnapshot) => appState(Boolean(includeSnapshot)));

  ipcMain.handle("sdlink:auto-detect", () => autoDetectWallet());

  ipcMain.handle("sdlink:choose-db", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "SD지갑 데이터베이스 선택",
      properties: ["openFile"],
      filters: [
        { name: "SD지갑 SQLite", extensions: ["sqlite", "db"] },
        { name: "모든 파일", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return inspectDatabase(result.filePaths[0], { deepCheck: true });
  });

  ipcMain.handle("sdlink:choose-bitcoin-source", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "구형 BTC 데이터 직접 선택 (보조 기능)",
      properties: ["openFile"],
      filters: [
        { name: "BTC 데이터", extensions: ["json", "sqlite", "db"] },
        { name: "모든 파일", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0];
    const inspected = inspectBitcoinSource(sourcePath);
    if (!inspected) {
      throw new Error("선택한 파일에서 BTC 보유 수량을 찾지 못했습니다. 최신 SD비트코인 채굴장은 SD지갑 SQLite에서 자동으로 정확한 수량을 읽습니다.");
    }
    configStore.update({
      bitcoinSourcePath: path.resolve(sourcePath),
      lastBitcoinQuantity: inspected.quantity,
    });
    return { sourcePath: path.resolve(sourcePath), quantity: inspected.quantity, sourceHint: inspected.sourceHint };
  });

  ipcMain.handle("sdlink:select-wallet", (_event, databasePath, accountId) => {
    const inspection = inspectDatabase(databasePath, { deepCheck: true });
    const account = inspection.accounts.find((item) => item.id === String(accountId));
    if (!account) throw new Error("선택한 계좌를 찾지 못했습니다.");
    const current = configStore.load();
    const changed =
      path.resolve(databasePath) !== path.resolve(current.databasePath || databasePath) ||
      String(accountId) !== String(current.selectedAccountId || accountId);
    if (changed && current.activated) {
      throw new Error("이미 동기화가 시작된 계좌입니다. 먼저 ‘연결 초기화’를 실행하세요.");
    }
    const fingerprint = fingerprintAccount(account);
    configStore.update({
      databasePath: path.resolve(databasePath),
      selectedAccountId: String(accountId),
      walletFingerprint: fingerprint,
    });
    return appState(false);
  });

  ipcMain.handle("sdlink:login", async (_event, email, password, remember) => {
    const auth = await authService.signIn(String(email).trim(), String(password), Boolean(remember));
    const config = configStore.load();
    if (
      config.linkedOnlineUserId &&
      config.linkedOnlineUserId !== auth.user.id &&
      config.activated
    ) {
      await authService.signOut();
      throw new Error("이 PC는 다른 홈페이지 계정과 이미 연결되어 있습니다. 연결 초기화 후 다시 시도하세요.");
    }
    return appState(false);
  });

  ipcMain.handle("sdlink:logout", async () => {
    syncEngine.clearIntegrationState();
    await authService.signOut();
    return appState(false);
  });

  ipcMain.handle("sdlink:register-device", async () => syncEngine.registerDevice());
  ipcMain.handle("sdlink:request-migration", async () => syncEngine.requestMigration());
  ipcMain.handle("sdlink:sync", async () => syncEngine.syncOnce());

  ipcMain.handle("sdlink:set-auto-sync", (_event, enabled) => {
    configStore.update({ autoSync: Boolean(enabled) });
    if (enabled) setTimeout(() => runBackgroundSync(), 100);
    return appState(false);
  });

  ipcMain.handle("sdlink:reset", async () => {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["취소", "연결 초기화"],
      defaultId: 0,
      cancelId: 0,
      title: "SD Link 연결 초기화",
      message: "이 PC의 SD Link 설정과 동기화 기록을 초기화할까요?",
      detail: "로컬 SD지갑 데이터와 홈페이지 계정은 삭제되지 않습니다. 다시 연결하면 서버 잔액으로 재조정됩니다.",
    });
    if (answer.response !== 1) return { canceled: true };
    const current = configStore.load();
    try {
      if (authService.publicSession().authenticated && current.databasePath && current.selectedAccountId) {
        const linked = await syncEngine.snapshot();
        if (linked?.snapshot?.device_id) {
          await authService.rpc("revoke_sd_link_device", {
            p_device_id: linked.snapshot.device_id,
          });
        }
      }
    } catch {
      // 서버 연결이 끊겨 있어도 로컬 초기화는 진행합니다.
    }
    syncEngine.clearIntegrationState();
    await authService.signOut();
    syncState.clearSynchronizationMarks();
    configStore.save({
      ...current,
      activated: false,
      linkedOnlineUserId: "",
      linkedOnlineEmail: "",
      migrationId: "",
      migrationStatus: "",
      lastServerCursor: 0,
      lastExpectedLocalBalance: null,
      lastSyncAt: "",
      lastSyncMessage: "",
    });
    return appState(false);
  });

  ipcMain.handle("sdlink:open-website", () => shell.openExternal(WEBSITE_URL));
  ipcMain.handle("sdlink:open-account", () => shell.openExternal(ACCOUNT_URL));
  ipcMain.handle("sdlink:open-mobile-download", () => shell.openExternal(MOBILE_DOWNLOAD_URL));
}

function startAutoSync() {
  clearInterval(timer);
  timer = setInterval(() => runBackgroundSync(), AUTO_SYNC_INTERVAL_MS);
  setTimeout(() => runBackgroundSync(), 1_500);
}

app.whenReady().then(() => {
  configStore = new ConfigStore(app.getPath("userData"));
  authService = new AuthService(app.getPath("userData"), safeStorage);
  syncState = new SyncState(app.getPath("userData"));
  syncEngine = new SyncEngine({
    authService,
    configStore,
    syncState,
    userDataDirectory: app.getPath("userData"),
    onStatus: sendStatus,
  });
  registerIpc();
  createWindow();
  createTray();
  startAutoSync();
});

app.on("activate", showMainWindow);
app.on("window-all-closed", () => {
  // 창을 닫아도 트레이에서 PC 게임 수익 동기화를 계속합니다.
});
app.on("before-quit", () => {
  isQuitting = true;
  clearInterval(timer);
  try { tray?.destroy(); } catch { /* 종료 계속 */ }
  try { syncState?.close(); } catch { /* 종료 계속 */ }
});

// SD_LINK_BACKGROUND_AUTOSTART_V128
// SD종합센터가 Windows 로그인 자동 시작으로 실행했을 때 SD Link 창을 띄우지 않고
// 기존 트레이/백그라운드 동기화 동작을 그대로 유지합니다.
const {
  app: SdLinkAutoStartApp,
  BrowserWindow: SdLinkAutoStartBrowserWindow,
} = require("electron");
const SD_LINK_AUTO_START_ARGUMENT = "--sd-link-auto-start";
const SD_LINK_STARTED_FROM_WINDOWS_LOGIN = process.argv.includes(
  SD_LINK_AUTO_START_ARGUMENT,
);

if (SD_LINK_STARTED_FROM_WINDOWS_LOGIN) {
  const hideAutoStartedWindow = (window) => {
    if (!window || window.isDestroyed()) return;
    try {
      window.hide();
    } catch {}
  };

  SdLinkAutoStartApp.on("browser-window-created", (_event, window) => {
    hideAutoStartedWindow(window);
    window.once("ready-to-show", () => hideAutoStartedWindow(window));
    setTimeout(() => hideAutoStartedWindow(window), 150);
    setTimeout(() => hideAutoStartedWindow(window), 900);
  });

  SdLinkAutoStartApp.whenReady()
    .then(() => {
      const hideAll = () => {
        for (const window of SdLinkAutoStartBrowserWindow.getAllWindows()) {
          hideAutoStartedWindow(window);
        }
      };
      hideAll();
      setTimeout(hideAll, 250);
      setTimeout(hideAll, 1200);
    })
    .catch(() => {});
}

