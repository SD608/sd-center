"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sdMukjippa", {
  getBootstrap: () => ipcRenderer.invoke("mjp:get-bootstrap"),
  saveSettings: (patch) => ipcRenderer.invoke("mjp:save-settings", patch),
  autoDetectWallet: () => ipcRenderer.invoke("wallet:auto-detect"),
  chooseWalletDatabase: () => ipcRenderer.invoke("wallet:choose-database"),
  listWalletAccounts: () => ipcRenderer.invoke("wallet:list-accounts"),
  getWalletAccount: (accountId) => ipcRenderer.invoke("wallet:get-account", accountId),
  getGameState: (accountId) => ipcRenderer.invoke("mjp:get-state", accountId),
  startGame: (payload) => ipcRenderer.invoke("mjp:start", payload),
  playHand: (payload) => ipcRenderer.invoke("mjp:play-hand", payload),
  continueStreak: (payload) => ipcRenderer.invoke("mjp:continue", payload),
  cashOut: (payload) => ipcRenderer.invoke("mjp:cashout", payload),
  openCenter: () => ipcRenderer.invoke("center:open"),
});
