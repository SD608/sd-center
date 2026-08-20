"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const { SettingsStore } = require("./src/settings");
const { MAX_STREAK, MOVES, multiplierForStreak } = require("./src/game-engine");
const {
  autoFindWalletDatabase, cashOut, continueStreak, getAccount, getGameState,
  getRecentTransactions, listAccounts, playHand, startSession, validateWalletDatabase,
} = require("./src/wallet-database");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let mainWindow = null;
let settingsStore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380, height: 930, minWidth: 1080, minHeight: 760,
    title: "SD묵찌빠", backgroundColor: "#090711", autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, "public", "icons", "icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false, devTools: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try { if (new URL(url).protocol !== "file:") event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

function walletPath() { return settingsStore.get().walletDatabasePath; }
function openCenter() {
  const executable = process.env.SD_CENTER_EXECUTABLE;
  const root = process.env.SD_CENTER_ROOT;
  if (!executable) return { ok: false, error: "종합센터 실행 정보를 찾지 못했습니다." };
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.SD_CENTER_CHILD_ID;
  delete environment.SD_CENTER_MANAGED;
  const child = spawn(executable, app.isPackaged || !root ? [] : [root], {
    env: environment, detached: true, stdio: "ignore", windowsHide: false,
  });
  child.unref(); return { ok: true };
}

function registerIpc() {
  ipcMain.handle("mjp:get-bootstrap", () => ({
    settings: settingsStore.get(), moves: MOVES, maxStreak: MAX_STREAK,
    multipliers: Array.from({ length: MAX_STREAK }, (_, index) => multiplierForStreak(index + 1)),
  }));
  ipcMain.handle("mjp:save-settings", (event, patch) => settingsStore.update(patch));
  ipcMain.handle("wallet:auto-detect", () => {
    const found = autoFindWalletDatabase({ appDataPath: app.getPath("appData"), homePath: app.getPath("home") });
    if (!found) return { found: false };
    settingsStore.update({ walletDatabasePath: found, selectedAccountId: "" });
    return { found: true, path: found };
  });
  ipcMain.handle("wallet:choose-database", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "SD지갑 데이터베이스 선택", properties: ["openFile"],
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
    try { return { connected: true, databasePath, accounts: listAccounts(databasePath) }; }
    catch (error) { return { connected: false, databasePath, accounts: [], error: error.message }; }
  });
  ipcMain.handle("wallet:get-account", (event, accountId) => {
    const databasePath = walletPath();
    if (!databasePath || !accountId) return { connected: false, account: null, transactions: [] };
    try {
      const account = getAccount(databasePath, String(accountId));
      return { connected: Boolean(account), account, transactions: account ? getRecentTransactions(databasePath, String(accountId), 12) : [] };
    } catch (error) { return { connected: false, account: null, transactions: [], error: error.message }; }
  });
  ipcMain.handle("mjp:get-state", (event, accountId) => {
    const databasePath = walletPath();
    if (!databasePath || !accountId) return { ok: false, error: "계좌를 연결하세요." };
    try { return { ok: true, ...getGameState(databasePath, String(accountId)) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("mjp:start", (event, payload) => {
    try {
      const result = startSession({ databasePath: walletPath(), accountId: String(payload?.accountId || ""), betAmount: payload?.betAmount });
      settingsStore.update({ selectedAccountId: String(payload?.accountId || ""), betAmount: payload?.betAmount });
      return { ok: true, ...result };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("mjp:play-hand", (event, payload) => {
    try { return { ok: true, ...playHand({ databasePath: walletPath(), accountId: String(payload?.accountId || ""), sessionId: String(payload?.sessionId || ""), playerMove: payload?.playerMove }) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("mjp:continue", (event, payload) => {
    try { return { ok: true, ...continueStreak({ databasePath: walletPath(), accountId: String(payload?.accountId || ""), sessionId: String(payload?.sessionId || "") }) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("mjp:cashout", (event, payload) => {
    try { return { ok: true, ...cashOut({ databasePath: walletPath(), accountId: String(payload?.accountId || ""), sessionId: String(payload?.sessionId || "") }) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("center:open", () => { try { return openCenter(); } catch (error) { return { ok: false, error: error.message }; } });
}

app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  createWindow();
});
app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
app.on("window-all-closed", () => app.quit());
