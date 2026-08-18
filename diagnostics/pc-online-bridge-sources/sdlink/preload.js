"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sdLink", {
  getState: (includeSnapshot = false) => ipcRenderer.invoke("sdlink:get-state", includeSnapshot),
  autoDetect: () => ipcRenderer.invoke("sdlink:auto-detect"),
  chooseDatabase: () => ipcRenderer.invoke("sdlink:choose-db"),
  chooseBitcoinSource: () => ipcRenderer.invoke("sdlink:choose-bitcoin-source"),
  selectWallet: (databasePath, accountId) =>
    ipcRenderer.invoke("sdlink:select-wallet", databasePath, accountId),
  login: (email, password, remember) =>
    ipcRenderer.invoke("sdlink:login", email, password, remember),
  logout: () => ipcRenderer.invoke("sdlink:logout"),
  registerDevice: () => ipcRenderer.invoke("sdlink:register-device"),
  requestMigration: () => ipcRenderer.invoke("sdlink:request-migration"),
  sync: () => ipcRenderer.invoke("sdlink:sync"),
  setAutoSync: (enabled) => ipcRenderer.invoke("sdlink:set-auto-sync", enabled),
  reset: () => ipcRenderer.invoke("sdlink:reset"),
  openWebsite: () => ipcRenderer.invoke("sdlink:open-website"),
  openAccount: () => ipcRenderer.invoke("sdlink:open-account"),
  openMobileDownload: () => ipcRenderer.invoke("sdlink:open-mobile-download"),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sdlink:status", listener);
    return () => ipcRenderer.removeListener("sdlink:status", listener);
  },
});
