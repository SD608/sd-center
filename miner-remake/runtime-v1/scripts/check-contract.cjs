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
if (!appMain.includes("fileURLToPath") || !appMain.includes("path.resolve(fileURLToPath(target)) !== uiPath")) {
  throw new Error("RUNTIME_ELECTRON_NAVIGATION_MUST_BE_UI_FILE_ONLY");
}

const uiHtml = fs.readFileSync(path.join(repo, "miner-remake", "ui-v1", "index.html"), "utf8");
if (!uiHtml.includes('http-equiv="Content-Security-Policy"')) throw new Error("RUNTIME_UI_CSP_REQUIRED");
if (/script-src[^;]*unsafe-eval/i.test(uiHtml)) throw new Error("RUNTIME_UI_UNSAFE_EVAL_FORBIDDEN");
if (!/connect-src 'none'/i.test(uiHtml)) throw new Error("RUNTIME_UI_NETWORK_CONNECT_MUST_DEFAULT_DENY");

const workflow = fs.readFileSync(path.join(repo, ".github", "workflows", "miner-encounter-runtime-foundation-v1.yml"), "utf8");
if (workflow.includes("npm init -y")) throw new Error("ELECTRON_GATE_NPM_INIT_INVALID_NAME_REGRESSION");
if (!workflow.includes('$ErrorActionPreference = "Stop"')) throw new Error("ELECTRON_GATE_POWERSHELL_FAIL_FAST_REQUIRED");

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
