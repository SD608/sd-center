"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const { SdAdminApi } = require("./lib/sd-admin-api");
const { friendlyError } = require("./lib/errors");
const { PendingAdjustmentStore } = require("./lib/pending-adjustment-store");
const { WalletAdjustmentService } = require("./lib/wallet-adjustment-service");
const { RoadmapStore, ALLOWED_REMOTE_URL } = require("./lib/roadmap-store");

const PROD_URL = "https://qmatphbjzafdtlyviqoa.supabase.co";
const PROD_PUBLISHABLE_KEY = "sb_publishable_H2qTl_30-7hPUYFhJ_N_QA_X71xZswO";
const api = new SdAdminApi({
  baseUrl: process.env.SD_ADMIN_SUPABASE_URL || PROD_URL,
  publishableKey: process.env.SD_ADMIN_SUPABASE_KEY || PROD_PUBLISHABLE_KEY
});

let mainWindow = null;
let walletService = null;
let roadmapStore = null;

function safeResult(fn) {
  return async (_event, payload) => {
    try {
      const data = await fn(payload || {});
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: friendlyError(error), code: error?.code || "", status: Number(error?.status || 0), uncertain: Boolean(error?.uncertain) };
    }
  };
}

function registerIpc() {
  ipcMain.handle("sd:login", safeResult(({ email, password }) => api.signIn(email, password)));
  ipcMain.handle("sd:logout", safeResult(() => api.signOut()));
  ipcMain.handle("sd:users", safeResult(() => api.listUsers()));
  ipcMain.handle("sd:user", safeResult(({ userId }) => api.getUser(userId)));
  ipcMain.handle("sd:transactions", safeResult(({ userId, beforeSeq, limit }) => api.listTransactions(userId, beforeSeq, limit)));
  ipcMain.handle("sd:adjust", safeResult((payload) => walletService.adjust(payload)));
  ipcMain.handle("sd:pending-adjustment", safeResult(() => walletService.pending()));
  ipcMain.handle("sd:roadmap", safeResult(() => roadmapStore.sync()));
  ipcMain.handle("sd:roadmap-show-file", safeResult(() => {
    const filePath = roadmapStore.ensure();
    shell.showItemInFolder(filePath);
    return { path: filePath };
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640, show: false, backgroundColor: "#0c1018", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, devTools: process.env.NODE_ENV === "development" }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { if (!mainWindow) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const store = new PendingAdjustmentStore(path.join(app.getPath("userData"), "pending-wallet-adjustment.json"));
    walletService = new WalletAdjustmentService({ api, store });
    roadmapStore = new RoadmapStore({
      userDataPath: app.getPath("userData"),
      seedPath: path.join(__dirname, "roadmap.default.json"),
      livePath: path.join(__dirname, "lib", "roadmap-live.json"),
      remoteUrl: ALLOWED_REMOTE_URL
    });
    registerIpc();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
