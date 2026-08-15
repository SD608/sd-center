"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flea", {
  getState: () => ipcRenderer.invoke("flea:get-state"),
  startMission: () => ipcRenderer.invoke("flea:start-mission"),
  searchMissionNode: (nodeId) => ipcRenderer.invoke("flea:search-node", nodeId),
  finishMission: () => ipcRenderer.invoke("flea:finish-mission"),
  buyCutter: () => ipcRenderer.invoke("flea:buy-cutter"),
  buyLockpicks: (quantity) => ipcRenderer.invoke("flea:buy-lockpicks", quantity),
  startBoxOpen: (boxId) => ipcRenderer.invoke("flea:start-box-open", boxId),
  completeCut: (boxId, step) => ipcRenderer.invoke("flea:complete-cut", boxId, step),
  safeAttempt: (boxId, angle, pressure) => ipcRenderer.invoke("flea:safe-attempt", boxId, angle, pressure),
  devReset: () => ipcRenderer.invoke("flea:dev-reset"),
});
