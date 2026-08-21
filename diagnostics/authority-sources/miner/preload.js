"use strict";

const {
  contextBridge,
  ipcRenderer,
} = require("electron");

contextBridge.exposeInMainWorld("sdMiner", {
  getSettings: () =>
    ipcRenderer.invoke("settings:get"),

  saveSettings: (patch) =>
    ipcRenderer.invoke("settings:save", patch),

  getMiningConfig: () =>
    ipcRenderer.invoke("mining:get-config"),

  autoDetectWallet: () =>
    ipcRenderer.invoke("wallet:auto-detect"),

  chooseWalletDatabase: () =>
    ipcRenderer.invoke("wallet:choose-database"),

  listWalletAccounts: () =>
    ipcRenderer.invoke("wallet:list-accounts"),

  getAccountState: (accountId) =>
    ipcRenderer.invoke(
      "wallet:get-account-state",
      accountId,
    ),

  mine: (accountId) =>
    ipcRenderer.invoke("mining:mine", accountId),

  buyAutoMiningUpgrade: (accountId) =>
    ipcRenderer.invoke(
      "shop:buy-auto-mining-upgrade",
      accountId,
    ),

  sellOre: (payload) =>
    ipcRenderer.invoke("shop:sell", payload),

  sellAllOre: (accountId) =>
    ipcRenderer.invoke(
      "shop:sell-all",
      accountId,
    ),
});
