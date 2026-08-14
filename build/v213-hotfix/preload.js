"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("sdCenter", {
  listApps: () => invoke("center:list-apps"),
  listRemovedApps: () => invoke("center:list-removed-apps"),
  launchApp: (id) => invoke("center:launch-app", id),
  terminateApp: (id) => invoke("center:terminate-app", id),
  addAppZip: () => invoke("center:add-app-zip"),
  deleteApp: (id) => invoke("center:delete-app", id),
  restoreApp: (id) => invoke("center:restore-app", id),
  permanentlyDeleteRemovedApp: (id) =>
    invoke("center:permanently-delete-removed-app", id),
  launchAll: () => invoke("center:launch-all"),
  terminateAll: () => invoke("center:terminate-all"),
  show: () => invoke("center:show"),
  hide: () => invoke("center:hide"),
  quitCompletely: () => invoke("center:quit-completely"),
  openAppFolder: (id) => invoke("center:open-app-folder", id),

  // v2.1.3: 홈페이지 확장팩 카탈로그 기반 자동 업데이트
  checkAppUpdates: () => invoke("center:check-app-updates"),
  updateApp: (id) => invoke("center:update-app", id),
  updateAllApps: () => invoke("center:update-all-apps"),

  onAppStates: (callback) => subscribe("center:app-states", callback),
  onRemovedAppStates: (callback) =>
    subscribe("center:removed-app-states", callback),
});
