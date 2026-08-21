"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sdBitcoinMiner", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  autoDetectWallet: () => ipcRenderer.invoke("wallet:auto-detect"),
  chooseWalletDatabase: () => ipcRenderer.invoke("wallet:choose-database"),
  listAccounts: () => ipcRenderer.invoke("wallet:list-accounts"),
  getState: (accountId) => ipcRenderer.invoke("wallet:get-state", accountId),
  buyRoom: (payload) => ipcRenderer.invoke("room:buy", payload),
  buyFrame: (payload) => ipcRenderer.invoke("shop:buy-frame", payload),
  buyGpu: (payload) => ipcRenderer.invoke("shop:buy-gpu", payload),
  decorateRoom: (payload) => ipcRenderer.invoke("room:decorate", payload),
  reactivateElectricity: (accountId) =>
    ipcRenderer.invoke("electricity:reactivate", accountId),
  sellBitcoin: (payload) => ipcRenderer.invoke("bitcoin:sell", payload),
  onElectricityChanged: (callback) => {
    ipcRenderer.on(
      "electricity:changed",
      (event, events) => callback(events),
    );
  },
  onMiningRewards: (callback) => {
    ipcRenderer.on(
      "mining:rewards",
      (event, rewards) =>
        callback(rewards),
    );
  },

  onOfflineMiningApplied: (callback) => {
    ipcRenderer.on(
      "mining:offline-applied",
      (event, result) =>
        callback(result),
    );
  },
});
