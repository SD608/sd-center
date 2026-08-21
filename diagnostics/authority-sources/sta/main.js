"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const { SettingsStore } = require("./src/settings");
const engine = require("./src/operation-engine");
const wallet = require("./src/wallet-database");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;
let settingsStore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "STA",
    backgroundColor: "#07090d",
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
    try { if (new URL(url).protocol !== "file:") event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
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
    env: environment,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { ok: true };
}

function safe(handler) {
  return async (event, payload) => {
    try { return { ok: true, ...(await handler(event, payload)) }; }
    catch (error) { return { ok: false, error: error.message }; }
  };
}

function requireWalletPath() {
  const databasePath = walletPath();
  if (!databasePath) throw new Error("SD지갑을 먼저 연결하세요.");
  return databasePath;
}

function registerIpc() {
  ipcMain.handle("sta:get-bootstrap", () => ({
    settings: settingsStore.get(),
    constants: {
      entryFee: engine.ENTRY_FEE,
      hackingRounds: engine.HACKING_ROUNDS,
      laserMaxHits: engine.LASER_MAX_HITS,
      vaultRequiredHits: engine.VAULT_REQUIRED_HITS,
      vaultDecayAmount: engine.VAULT_DECAY_AMOUNT,
      vaultDecayIdleMs: engine.VAULT_DECAY_IDLE_MS,
      vaultDecayIntervalMs: engine.VAULT_DECAY_INTERVAL_MS,
      lootDurationMs: engine.LOOT_DURATION_MS,
      lootClickDelayMs: engine.LOOT_CLICK_DELAY_MS,
      lootPerClick: engine.LOOT_PER_CLICK,
      maxLoot: engine.MAX_LOOT,
      operationCooldownMs: engine.OPERATION_COOLDOWN_MS,
      transportLossPerHit: engine.TRANSPORT_LOSS_PER_HIT,
    },
  }));
  ipcMain.handle("sta:save-settings", (event, patch) => settingsStore.update(patch));
  ipcMain.handle("wallet:auto-detect", () => {
    const found = wallet.autoFindWalletDatabase({ appDataPath: app.getPath("appData"), homePath: app.getPath("home") });
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
    const validation = wallet.validateWalletDatabase(databasePath);
    if (!validation.ok) return { canceled: false, ok: false, error: validation.error };
    settingsStore.update({ walletDatabasePath: databasePath, selectedAccountId: "" });
    return { canceled: false, ok: true, path: databasePath };
  });
  ipcMain.handle("wallet:list-accounts", () => {
    const databasePath = walletPath();
    if (!databasePath) return { connected: false, accounts: [] };
    try { return { connected: true, databasePath, accounts: wallet.listAccounts(databasePath) }; }
    catch (error) { return { connected: false, databasePath, accounts: [], error: error.message }; }
  });
  ipcMain.handle("wallet:get-account", (event, accountId) => {
    const databasePath = walletPath();
    if (!databasePath || !accountId) return { connected: false, account: null, transactions: [] };
    try {
      const account = wallet.getAccount(databasePath, String(accountId));
      return { connected: Boolean(account), account, transactions: account ? wallet.getRecentTransactions(databasePath, String(accountId), 12) : [] };
    } catch (error) { return { connected: false, account: null, transactions: [], error: error.message }; }
  });

  ipcMain.handle("sta:get-state", safe(() => wallet.getOperationState(requireWalletPath())));
  ipcMain.handle("sta:start", safe((event, payload) => {
    const accountId = String(payload?.accountId || "");
    const result = wallet.startOperation({ databasePath: requireWalletPath(), accountId });
    settingsStore.update({ selectedAccountId: accountId });
    return result;
  }));
  ipcMain.handle("sta:hacking-connect", safe((event, payload) => wallet.hackingConnect({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
    sourceColor: payload?.sourceColor, targetColor: payload?.targetColor,
  })));
  ipcMain.handle("sta:start-raid", safe((event, payload) => wallet.startRaid({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:laser-hit", safe((event, payload) => wallet.laserHit({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:laser-checkpoint", safe((event, payload) => wallet.laserCheckpoint({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""), checkpoint: payload?.checkpoint,
  })));
  ipcMain.handle("sta:laser-pass", safe((event, payload) => wallet.laserPass({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:vault-hit", safe((event, payload) => wallet.vaultHit({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:vault-decay", safe((event, payload) => wallet.vaultDecay({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:loot-click", safe((event, payload) => wallet.lootClick({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:finalize-loot", safe((event, payload) => wallet.finalizeLoot({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:start-transport", safe((event, payload) => wallet.startTransport({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:transport-hit", safe((event, payload) => wallet.transportHit({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:transport-checkpoint", safe((event, payload) => wallet.transportCheckpoint({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""), checkpoint: payload?.checkpoint,
  })));
  ipcMain.handle("sta:transport-arrive", safe((event, payload) => wallet.transportArrive({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""),
  })));
  ipcMain.handle("sta:payout", safe((event, payload) => wallet.payout({
    databasePath: requireWalletPath(), operationId: String(payload?.operationId || ""), accountId: String(payload?.accountId || ""),
  })));
  ipcMain.handle("center:open", () => { try { return openCenter(); } catch (error) { return { ok: false, error: error.message }; } });
}

app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  createWindow();
});
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
app.on("window-all-closed", () => app.quit());
