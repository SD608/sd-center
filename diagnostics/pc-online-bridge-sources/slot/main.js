"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
} = require("electron");

const { SettingsStore } = require("./src/settings");
const { createSpinResult, SYMBOLS } = require("./src/slot-engine");
const {
  autoFindWalletDatabase,
  beginSpin,
  getAccount,
  getRecentTransactions,
  listAccounts,
  settleRound,
  validateWalletDatabase,
} = require("./src/wallet-database");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;
let settingsStore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1020,
    minHeight: 760,
    title: "SD슬롯",
    backgroundColor: "#07090f",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "public", "icons", "icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).protocol !== "file:") event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

function walletPath() {
  return settingsStore.get().walletDatabasePath;
}

function openCenter() {
  const executable = process.env.SD_CENTER_EXECUTABLE;
  const root = process.env.SD_CENTER_ROOT;
  if (!executable) return { ok: false, error: "종합센터 실행 정보를 찾지 못했습니다." };

  const args = app.isPackaged || !root ? [] : [root];
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.SD_CENTER_CHILD_ID;
  delete environment.SD_CENTER_MANAGED;

  const child = spawn(executable, args, {
    env: environment,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle("slot:get-bootstrap", () => ({
    settings: settingsStore.get(),
    symbols: SYMBOLS,
  }));

  ipcMain.handle("slot:save-settings", (event, patch) => settingsStore.update(patch));

  ipcMain.handle("wallet:auto-detect", () => {
    const found = autoFindWalletDatabase({
      appDataPath: app.getPath("appData"),
      homePath: app.getPath("home"),
    });
    if (!found) return { found: false };
    settingsStore.update({ walletDatabasePath: found, selectedAccountId: "" });
    return { found: true, path: found };
  });

  ipcMain.handle("wallet:choose-database", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "SD지갑 데이터베이스 선택",
      properties: ["openFile"],
      filters: [{ name: "SQLite Database", extensions: ["sqlite", "db", "sqlite3"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const databasePath = result.filePaths[0];
    const validation = validateWalletDatabase(databasePath);
    if (!validation.ok) return { canceled: false, ok: false, error: validation.error };
    settingsStore.update({ walletDatabasePath: databasePath, selectedAccountId: "" });
    return { canceled: false, ok: true, path: databasePath };
  });

  ipcMain.handle("wallet:list-accounts", () => {
    const databasePath = walletPath();
    if (!databasePath) return { connected: false, accounts: [] };
    try {
      return { connected: true, databasePath, accounts: listAccounts(databasePath) };
    } catch (error) {
      return { connected: false, databasePath, accounts: [], error: error.message };
    }
  });

  ipcMain.handle("wallet:get-account", (event, accountId) => {
    const databasePath = walletPath();
    if (!databasePath || !accountId) {
      return { connected: false, account: null, transactions: [] };
    }
    try {
      const account = getAccount(databasePath, String(accountId));
      return {
        connected: Boolean(account),
        account,
        transactions: account
          ? getRecentTransactions(databasePath, String(accountId), 10)
          : [],
      };
    } catch (error) {
      return { connected: false, account: null, transactions: [], error: error.message };
    }
  });

  ipcMain.handle("slot:start", (event, payload) => {
    const databasePath = walletPath();
    const accountId = String(payload?.accountId || "");
    if (!databasePath || !accountId) {
      return { ok: false, error: "먼저 SD지갑 계좌를 연결하세요." };
    }

    try {
      const spin = createSpinResult(payload?.betAmount);
      const payment = beginSpin({ databasePath, accountId, spin });
      settingsStore.update({
        selectedAccountId: accountId,
        betAmount: spin.stake,
      });
      return {
        ok: true,
        ...spin,
        roundId: payment.roundId,
        balanceAfterBet: payment.balance,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("slot:settle", (event, roundId) => {
    const databasePath = walletPath();
    if (!databasePath || !roundId) return { ok: false, error: "정산 정보를 찾지 못했습니다." };
    try {
      return { ok: true, ...settleRound({ databasePath, roundId: String(roundId) }) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("center:open", () => {
    try { return openCenter(); }
    catch (error) { return { ok: false, error: error.message }; }
  });
}

app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  createWindow();
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => app.quit());
