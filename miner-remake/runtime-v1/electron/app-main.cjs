"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { RuntimeStorageService } = require("./runtime-storage-service");
const { registerRuntimeStorageIpc } = require("./register-runtime-storage-ipc");

if (process.env.SD_MINER_RUNTIME_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.SD_MINER_RUNTIME_USER_DATA));
}

let mainWindow = null;

function createWindow() {
  const uiPath = path.resolve(__dirname, "..", "..", "ui-v1", "index.html");
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: "SD광부",
    backgroundColor: "#080a0d",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "app-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!navigationUrl.startsWith("file:")) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const query = process.env.SD_MINER_RUNTIME_GATE === "1"
    ? { runtime: "1", runtimeGate: "1" }
    : { runtime: "1" };
  mainWindow.loadFile(uiPath, { query });
}

app.whenReady().then(() => {
  const storageRoot = path.join(app.getPath("userData"), "encounter-runtime-v1");
  registerRuntimeStorageIpc(ipcMain, new RuntimeStorageService(storageRoot));
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});

app.on("window-all-closed", () => app.quit());
