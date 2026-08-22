"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload || {});

contextBridge.exposeInMainWorld("sdAdmin", Object.freeze({
  login: (email, password) => invoke("sd:login", { email, password }),
  logout: () => invoke("sd:logout"),
  listUsers: () => invoke("sd:users"),
  getUser: (userId) => invoke("sd:user", { userId }),
  listTransactions: (userId, beforeSeq = null, limit = 50) => invoke("sd:transactions", { userId, beforeSeq, limit }),
  adjustWallet: (payload) => invoke("sd:adjust", payload),
  getPendingAdjustment: () => invoke("sd:pending-adjustment"),
  getRoadmap: () => invoke("sd:roadmap"),
  showRoadmapFile: () => invoke("sd:roadmap-show-file")
}));
