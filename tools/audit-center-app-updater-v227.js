"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appRoot = process.argv[2];
if (!appRoot) throw new Error("Usage: node audit-center-app-updater-v227.js <installed-app-root>");

function read(rel) {
  return fs.readFileSync(path.join(appRoot, rel), "utf8").replace(/\r\n/g, "\n");
}
function must(text, marker, label = marker) {
  if (!text.includes(marker)) throw new Error(`missing updater contract marker: ${label}`);
}
function sliceBetween(text, start, end, label) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || b <= a) throw new Error(`cannot isolate ${label}`);
  return text.slice(a, b);
}

const pkg = JSON.parse(read("package.json"));
const main = read("main.js");
const registry = read("src/app-registry.js");

if (pkg.version !== "2.2.7") {
  throw new Error(`expected official v2.2.7 baseline, got ${pkg.version}`);
}

for (const marker of [
  "async function installInspectedZipWithRetry(inspected, destinationDirectory)",
  "async function terminateAppAndWait(id)",
  "forceKillChildTree",
  "taskkill.exe",
  "retryableCodes",
  "await updateDelay(350)",
  "autoUpdater",
]) must(main, marker);

const retryBlock = sliceBetween(
  main,
  "async function installInspectedZipWithRetry(inspected, destinationDirectory)",
  "async function terminateAppAndWait(id)",
  "installInspectedZipWithRetry",
);
for (const marker of ["EBUSY", "EPERM", "EACCES", "installInspectedZip(inspected, destinationDirectory);"]) {
  must(retryBlock, marker, `retry helper ${marker}`);
}
if (retryBlock.includes("await installInspectedZipWithRetry(inspected, destinationDirectory);")) {
  throw new Error("recursive updater retry regression detected");
}

const terminateBlock = sliceBetween(
  main,
  "async function terminateAppAndWait(id)",
  "function terminateAllApps()",
  "terminateAppAndWait",
);
for (const marker of ["await forceKillChildTree(child)", "await updateDelay(350)"]) {
  must(terminateBlock, marker, `terminate contract ${marker}`);
}

const killStart = main.indexOf("async function forceKillChildTree(child)");
const retryStart = main.indexOf("async function installInspectedZipWithRetry(inspected, destinationDirectory)");
if (killStart < 0 || retryStart < 0 || retryStart <= killStart) throw new Error("forceKillChildTree block not found");
const killBlock = main.slice(killStart, retryStart);
for (const marker of ["taskkill.exe", '"/T"', '"/F"', "windowsHide: true"]) {
  must(killBlock, marker, `Windows process-tree cleanup ${marker}`);
}

for (const marker of ["normalizeZipPath", "entryByName", "iconCandidates"]) {
  must(registry, marker, `ZIP inspection ${marker}`);
}

const installCall = "await installInspectedZipWithRetry(inspected, destinationDirectory);";
const callCount = main.split(installCall).length - 1;
if (callCount < 1) throw new Error("no hardened external app-install/update call found");

const shaMarkers = [
  'createHash("sha256")',
  "createHash('sha256')",
  ".sha256",
  "sha256",
].filter((marker) => main.toLowerCase().includes(marker.toLowerCase()));

console.log(`official center version: ${pkg.version}`);
console.log(`hardened install/update call sites: ${callCount}`);
console.log("Windows process-tree cleanup: PASS");
console.log("EBUSY/EPERM/EACCES staged retry: PASS");
console.log("recursive retry regression: PASS");
console.log("ZIP path/entry inspection markers: PASS");
console.log(`generic SHA-256 markers in main.js: ${shaMarkers.length ? shaMarkers.join(", ") : "none found"}`);
console.log("NOTE: generic SHA markers do not by themselves prove per-extension catalog pinning; catalog integrity is audited separately.");
