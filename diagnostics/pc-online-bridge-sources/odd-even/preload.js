"use strict";

const {
  contextBridge,
  ipcRenderer,
} = require("electron");

contextBridge.exposeInMainWorld("sdOddEven", {
  getSettings: () =>
    ipcRenderer.invoke("settings:get"),

  saveSettings: (patch) =>
    ipcRenderer.invoke("settings:save", patch),

  autoDetectWallet: () =>
    ipcRenderer.invoke("wallet:auto-detect"),

  chooseWalletDatabase: () =>
    ipcRenderer.invoke("wallet:choose-database"),

  listWalletAccounts: () =>
    ipcRenderer.invoke("wallet:list-accounts"),

  getWalletAccount: (accountId) =>
    ipcRenderer.invoke(
      "wallet:get-account",
      accountId,
    ),

  startGame: (payload) =>
    ipcRenderer.invoke("game:start", payload),

  stopGame: (roundId) =>
    ipcRenderer.invoke("game:stop", roundId),

  resolveGame: (payload) =>
    ipcRenderer.invoke("game:resolve", payload),
});
