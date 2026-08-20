"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("staApi", {
  getBootstrap: () => ipcRenderer.invoke("sta:get-bootstrap"),
  saveSettings: (patch) => ipcRenderer.invoke("sta:save-settings", patch),
  autoDetectWallet: () => ipcRenderer.invoke("wallet:auto-detect"),
  chooseWalletDatabase: () => ipcRenderer.invoke("wallet:choose-database"),
  listWalletAccounts: () => ipcRenderer.invoke("wallet:list-accounts"),
  getWalletAccount: (accountId) => ipcRenderer.invoke("wallet:get-account", accountId),
  getState: () => ipcRenderer.invoke("sta:get-state"),
  startOperation: (payload) => ipcRenderer.invoke("sta:start", payload),
  hackingConnect: (payload) => ipcRenderer.invoke("sta:hacking-connect", payload),
  startRaid: (payload) => ipcRenderer.invoke("sta:start-raid", payload),
  laserHit: (payload) => ipcRenderer.invoke("sta:laser-hit", payload),
  laserCheckpoint: (payload) => ipcRenderer.invoke("sta:laser-checkpoint", payload),
  laserPass: (payload) => ipcRenderer.invoke("sta:laser-pass", payload),
  vaultHit: (payload) => ipcRenderer.invoke("sta:vault-hit", payload),
  vaultDecay: (payload) => ipcRenderer.invoke("sta:vault-decay", payload),
  lootClick: (payload) => ipcRenderer.invoke("sta:loot-click", payload),
  finalizeLoot: (payload) => ipcRenderer.invoke("sta:finalize-loot", payload),
  startTransport: (payload) => ipcRenderer.invoke("sta:start-transport", payload),
  transportHit: (payload) => ipcRenderer.invoke("sta:transport-hit", payload),
  transportCheckpoint: (payload) => ipcRenderer.invoke("sta:transport-checkpoint", payload),
  transportArrive: (payload) => ipcRenderer.invoke("sta:transport-arrive", payload),
  payout: (payload) => ipcRenderer.invoke("sta:payout", payload),
  openCenter: () => ipcRenderer.invoke("center:open"),
});
