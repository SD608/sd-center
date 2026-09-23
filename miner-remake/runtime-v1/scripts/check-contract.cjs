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
const rendererFiles = ["bridge/runtime-persistence-client.js", "dev/harness.js"].map((p) => fs.readFileSync(path.join(root,p),"utf8")).join("\n");
if (/require\(["'](?:electron|node:fs|fs)["']\)/.test(rendererFiles)) throw new Error("RENDERER_PRIVILEGED_MODULE_FORBIDDEN");
const baseline = path.join(repo,"diagnostics","authority-sources","miner","main.js");
if (fs.existsSync(baseline)) {
  const source=fs.readFileSync(baseline,"utf8");
  for (const token of ["nodeIntegration: false","contextIsolation: true","sandbox: true","webSecurity: true"]) {
    if (!source.includes(token)) throw new Error(`ELECTRON_SECURITY_BASELINE_MISSING:${token}`);
  }
}
console.log("runtime dependency/security contract PASS");
