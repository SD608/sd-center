"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v226-stack-overflow.js <app-root>");

const pkgPath = path.join(root, "package.json");
const mainPath = path.join(root, "main.js");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (pkg.version !== "2.2.5") {
  throw new Error(`Expected v2.2.5 base, got ${pkg.version}`);
}
pkg.version = "2.2.6";
pkg.description = "SD지갑 코어 · 확장팩 상점 · 잠금 안전 업데이트 · 재귀 설치 오류 수정 · SD Link 백그라운드 자동 시작";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

for (const marker of [
  "async function installInspectedZipWithRetry(inspected, destinationDirectory)",
  "async function terminateAppAndWait(id)",
  "forceKillChildTree",
  "taskkill.exe",
  "--sd-link-auto-start",
  "autoUpdater",
]) {
  if (!main.includes(marker)) throw new Error(`v2.2.5 base marker missing: ${marker}`);
}

const helperStart = main.indexOf("async function installInspectedZipWithRetry(inspected, destinationDirectory)");
const helperEnd = main.indexOf("async function terminateAppAndWait(id)", helperStart);
if (helperStart < 0 || helperEnd < 0 || helperEnd <= helperStart) {
  throw new Error("installInspectedZipWithRetry helper block not found");
}

let helper = main.slice(helperStart, helperEnd);
const brokenCall = "await installInspectedZipWithRetry(inspected, destinationDirectory);";
const brokenCount = helper.split(brokenCall).length - 1;
if (brokenCount !== 1) {
  throw new Error(`Expected exactly one recursive helper call, got ${brokenCount}`);
}

helper = helper.replace(brokenCall, "installInspectedZip(inspected, destinationDirectory);");
main = main.slice(0, helperStart) + helper + main.slice(helperEnd);

const validationHelper = main.slice(
  main.indexOf("async function installInspectedZipWithRetry(inspected, destinationDirectory)"),
  main.indexOf("async function terminateAppAndWait(id)"),
);

if (validationHelper.includes(brokenCall)) {
  throw new Error("Recursive install retry call still remains");
}
if (!validationHelper.includes("installInspectedZip(inspected, destinationDirectory);")) {
  throw new Error("Original installInspectedZip call missing from retry helper");
}

const hardenedCalls = main.split(brokenCall).length - 1;
if (hardenedCalls < 1) {
  throw new Error("No external install retry calls remain");
}

for (const marker of [
  "forceKillChildTree",
  "taskkill.exe",
  "installInspectedZipWithRetry",
  "retryableCodes",
  "await updateDelay(350)",
  "--sd-link-auto-start",
  "autoUpdater",
]) {
  if (!main.includes(marker)) throw new Error(`v2.2.6 marker missing: ${marker}`);
}
if (main.includes("powershell.exe")) {
  throw new Error("PowerShell dependency unexpectedly returned");
}

fs.writeFileSync(mainPath, main, "utf8");
console.log(`SDCenter v2.2.6 stack overflow hotfix applied; external retry calls: ${hardenedCalls}`);
