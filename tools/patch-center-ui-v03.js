"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v03.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

let main = read("main.js");
if (!main.includes("Menu.setApplicationMenu(null);")) {
  main = replaceOnce(
    main,
    '    mainWindow.webContents.setWindowOpenHandler(() => ({',
    `    // UI Preview v0.3: Electron 기본 메뉴를 완전히 제거해 Alt 키로 메뉴바가 나타나지 않게 합니다.
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();

    mainWindow.webContents.setWindowOpenHandler(() => ({`,
    "main window menu removal",
  );
}
write("main.js", main);

let renderer = read("public/js/app.js");
renderer = renderer.replace(
  'elements.quitCenterButton.textContent = "완전 종료";',
  'elements.quitCenterButton.textContent = "종료";',
);

if (!renderer.includes("sdCenterPreviewMarkLaunched")) {
  renderer = replaceOnce(
    renderer,
    `      const result = await bridge.launchAll();
      showToast(`,
    `      const result = await bridge.launchAll();
      window.sdCenterPreviewMarkLaunched?.(
        (result?.results || []).filter((item) => item?.ok).map((item) => item.id),
      );
      showToast(`,
    "launch all recent hook",
  );
}
write("public/js/app.js", renderer);

for (const marker of [
  "Menu.setApplicationMenu(null);",
  "mainWindow.setMenuBarVisibility(false);",
  "mainWindow.removeMenu();",
]) {
  if (!read("main.js").includes(marker)) throw new Error(`Missing main marker: ${marker}`);
}

for (const marker of [
  'elements.quitCenterButton.textContent = "종료";',
  "sdCenterPreviewMarkLaunched",
]) {
  if (!read("public/js/app.js").includes(marker)) throw new Error(`Missing renderer marker: ${marker}`);
}

console.log("SDCenter UI Preview v0.3 compatibility patch applied");
