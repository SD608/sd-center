"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sdSlot", {
  getBootstrap: () => ipcRenderer.invoke("slot:get-bootstrap"),
  saveSettings: (patch) => ipcRenderer.invoke("slot:save-settings", patch),
  autoDetectWallet: () => ipcRenderer.invoke("wallet:auto-detect"),
  chooseWalletDatabase: () => ipcRenderer.invoke("wallet:choose-database"),
  listWalletAccounts: () => ipcRenderer.invoke("wallet:list-accounts"),
  getWalletAccount: (accountId) => ipcRenderer.invoke("wallet:get-account", accountId),
  startSpin: (payload) => ipcRenderer.invoke("slot:start", payload),
  settleSpin: (roundId) => ipcRenderer.invoke("slot:settle", roundId),
  openCenter: () => ipcRenderer.invoke("center:open"),
});
