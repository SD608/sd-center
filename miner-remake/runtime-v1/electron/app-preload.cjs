"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const gateMode = new URLSearchParams(window.location.search).get("runtimeGate") === "1";

contextBridge.exposeInMainWorld("sdMinerRuntime", Object.freeze({
  bridgeVersion: "miner-runtime-electron-v1",
  gateMode,
  appendJournal: (payload) => ipcRenderer.invoke("miner-runtime:append-journal", payload),
  writeSnapshot: (payload) => ipcRenderer.invoke("miner-runtime:write-snapshot", payload),
  readRecovery: (payload) => ipcRenderer.invoke("miner-runtime:read-recovery", payload),
}));

function injectRuntimeBootstrap() {
  const script = document.createElement("script");
  script.src = new URL("../runtime-v1/integration/electron-renderer-bootstrap.js", window.location.href).href;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", injectRuntimeBootstrap, { once: true });
} else {
  injectRuntimeBootstrap();
}
