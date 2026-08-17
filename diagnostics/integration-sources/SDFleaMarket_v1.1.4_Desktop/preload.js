"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flea", {
  getState: () => ipcRenderer.invoke("flea:get-state"),
  refreshCompany: () => ipcRenderer.invoke("flea:refresh-company"),
  refreshInventory: () => ipcRenderer.invoke("flea:refresh-inventory"),
  startMission: (locationId, bankMode = "") => ipcRenderer.invoke("flea:start-mission", locationId, bankMode),
  searchMissionNode: (nodeId) => ipcRenderer.invoke("flea:search-node", nodeId),
  triggerBankGuardAlert: () => ipcRenderer.invoke("flea:bank-guard-alert"),
  shootBankGuard: (nodeId, hitZone) => ipcRenderer.invoke("flea:shoot-bank-guard", nodeId, hitZone),
  bankGuardHitPlayer: () => ipcRenderer.invoke("flea:bank-guard-hit-player"),
  unlockBankDoor: (code) => ipcRenderer.invoke("flea:unlock-bank-door", code),
  finishMission: () => ipcRenderer.invoke("flea:finish-mission"),
  finishBankChase: (success) => ipcRenderer.invoke("flea:finish-bank-chase", Boolean(success)),
  startMissionSafe: (safeId) => ipcRenderer.invoke("flea:start-mission-safe", safeId),
  missionSafeListen: (safeId, dialNumber) => ipcRenderer.invoke("flea:mission-safe-listen", safeId, dialNumber),
  missionSafeAttempt: (safeId, dialNumber) => ipcRenderer.invoke("flea:mission-safe-attempt", safeId, dialNumber),
  setFullscreen: (enabled) => ipcRenderer.invoke("flea:set-fullscreen", Boolean(enabled)),
  buyCutter: () => ipcRenderer.invoke("flea:buy-cutter"),
  buyStethoscope: () => ipcRenderer.invoke("flea:buy-stethoscope"),
  buyQualityManager: () => ipcRenderer.invoke("flea:buy-quality-manager"),
  buyCart: () => ipcRenderer.invoke("flea:buy-cart"),
  startBoxOpen: (boxId) => ipcRenderer.invoke("flea:start-box-open", boxId),
  completeCut: (boxId, step) => ipcRenderer.invoke("flea:complete-cut", boxId, step),
  safeListen: (boxId, dialNumber) => ipcRenderer.invoke("flea:safe-listen", boxId, dialNumber),
  safeAttempt: (boxId, dialNumber) => ipcRenderer.invoke("flea:safe-attempt", boxId, dialNumber),
  devReset: () => ipcRenderer.invoke("flea:dev-reset"),
});
