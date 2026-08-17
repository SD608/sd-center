"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v224-sdlink-background.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (pkg.version !== "2.2.3") {
  throw new Error(`Expected v2.2.3 base, got ${pkg.version}`);
}
pkg.version = "2.2.4";
pkg.description = "SD지갑 코어 · 확장팩 상점 · SD Link 백그라운드 자동 시작 · 종합센터 앱내 업데이트";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");

for (const marker of [
  "--sd-center-auto-link",
  "--sd-link-auto-start",
  "configureSdLinkWindowsAutoStart",
  "launchSdLinkForWindowsLogin",
  "hideAutoStartedChildWindow",
  "powershell.exe",
  "autoUpdater",
]) {
  if (!main.includes(marker)) throw new Error(`v2.2.3 base marker missing: ${marker}`);
}

const hideFunction = /\n  function hideAutoStartedChildWindow\(child\) \{[\s\S]*?\n  \}\n\n  function launchSdLinkForWindowsLogin\(\) \{/;
if (!hideFunction.test(main)) {
  throw new Error("PowerShell window-hide helper block not found");
}
main = main.replace(
  hideFunction,
  "\n  function launchSdLinkForWindowsLogin() {",
);

const launchBlock = `      const child = spawnChild(entry, {\n        track: true,\n        extraArgs: ["--sd-link-auto-start"],\n      });\n      hideAutoStartedChildWindow(child);`;
if (!main.includes(launchBlock)) {
  throw new Error("SD Link auto-start child launch block not found");
}
main = main.replace(
  launchBlock,
  `      spawnChild(entry, {\n        track: true,\n        extraArgs: ["--sd-link-auto-start"],\n      });`,
);

write("main.js", main);

const validation = read("main.js");
for (const marker of [
  "--sd-center-auto-link",
  "--sd-link-auto-start",
  "configureSdLinkWindowsAutoStart",
  "launchSdLinkForWindowsLogin",
  "app.setLoginItemSettings",
  "autoUpdater",
  "quitAndInstall",
]) {
  if (!validation.includes(marker)) throw new Error(`v2.2.4 preserved marker missing: ${marker}`);
}
for (const forbidden of [
  "powershell.exe",
  "powershellScript",
  "hideAutoStartedChildWindow",
  "ShowWindowAsync",
]) {
  if (validation.includes(forbidden)) throw new Error(`v2.2.4 forbidden marker remains: ${forbidden}`);
}

console.log("SDCenter v2.2.4 PowerShell-free SD Link background autostart patch applied");
