"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const repo = path.resolve(root, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (pkg.dependencies?.phaser !== "4.2.1") throw new Error("PHASER_MUST_BE_EXACT_4_2_1");
if (JSON.stringify(pkg).includes("latest")) throw new Error("LATEST_DEPENDENCY_FORBIDDEN");
if (lock.packages?.["node_modules/phaser"]?.version !== "4.2.1") throw new Error("LOCKFILE_PHASER_MISMATCH");
if (lock.packages?.["node_modules/eventemitter3"]?.version !== "5.0.4") throw new Error("LOCKFILE_EVENTEMITTER_MISMATCH");

const rendererFiles = [
  "bridge/runtime-persistence-client.js",
  "dev/harness.js",
  "integration/electron-renderer-bootstrap.js",
].map((p) => fs.readFileSync(path.join(root, p), "utf8")).join("\n");
if (/require\(["'](?:electron|node:fs|fs)["']\)/.test(rendererFiles)) {
  throw new Error("RENDERER_PRIVILEGED_MODULE_FORBIDDEN");
}

const appMain = fs.readFileSync(path.join(root, "electron", "app-main.cjs"), "utf8");
for (const token of ["nodeIntegration: false", "contextIsolation: true", "sandbox: true", "webSecurity: true"]) {
  if (!appMain.includes(token)) throw new Error(`RUNTIME_ELECTRON_SECURITY_MISSING:${token}`);
}
for (const forbidden of ["wallet:", "mining:mine", "shop:"]) {
  if (appMain.includes(forbidden)) throw new Error(`LEGACY_ECONOMY_IPC_FORBIDDEN:${forbidden}`);
}

const preload = fs.readFileSync(path.join(root, "electron", "app-preload.cjs"), "utf8");
for (const channel of [
  "miner-runtime:append-journal",
  "miner-runtime:write-snapshot",
  "miner-runtime:read-recovery",
]) {
  if (!preload.includes(channel)) throw new Error(`RUNTIME_PRELOAD_CHANNEL_MISSING:${channel}`);
}
for (const forbidden of ["wallet:", "mining:mine", "shop:", "node:fs", "child_process"]) {
  if (preload.includes(forbidden)) throw new Error(`RUNTIME_PRELOAD_FORBIDDEN:${forbidden}`);
}

const baseline = path.join(repo, "diagnostics", "authority-sources", "miner", "main.js");
if (fs.existsSync(baseline)) {
  const source = fs.readFileSync(baseline, "utf8");
  for (const token of ["nodeIntegration: false", "contextIsolation: true", "sandbox: true", "webSecurity: true"]) {
    if (!source.includes(token)) throw new Error(`ELECTRON_SECURITY_BASELINE_MISSING:${token}`);
  }
}
console.log("runtime dependency/security contract PASS");
