"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const patchPath = process.argv[2];
const appRoot = process.argv[3];
if (!patchPath || !appRoot) {
  throw new Error("Usage: node run-v017-compat.js <patch-script> <app-root>");
}

const catalogPath = path.join(appRoot, "src", "theme-catalog.js");
if (!fs.existsSync(catalogPath)) throw new Error("v0.17 compat catalog input missing");

const originalCatalog = fs.readFileSync(catalogPath, "utf8");
const normalizedCatalog = originalCatalog.replace(/\r\n/g, "\n");
if (normalizedCatalog !== originalCatalog) {
  fs.writeFileSync(catalogPath, normalizedCatalog, "utf8");
  console.log("Normalized v0.16 theme catalog CRLF for v0.17 patch");
}

const run = spawnSync(process.execPath, [patchPath, appRoot], {
  stdio: "inherit",
  windowsHide: true,
});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status || 1);

const uiPath = path.join(appRoot, "public", "js", "ui-preview.js");
let ui = fs.readFileSync(uiPath, "utf8");
const oldToast = 'if(toast)showToast(theme.name+" 홈 테마를 적용했습니다.");';
const newToast = 'if(toast)showToast(theme.name+" 테마를 적용했습니다.");';
if (ui.includes(oldToast)) {
  ui = ui.replace(oldToast, newToast);
  fs.writeFileSync(uiPath, ui, "utf8");
  console.log("Normalized v0.17 theme toast compatibility form");
}

console.log("v0.17 legacy compatibility wrapper completed");
