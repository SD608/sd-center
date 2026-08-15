"use strict";

const path = require("node:path");
const { createWindowsInstaller } = require("electron-winstaller");

const appDirectory = process.env.APP_DIR;
const outputDirectory = process.env.BUILD_OUTPUT;
if (!appDirectory || !outputDirectory) {
  throw new Error("APP_DIR and BUILD_OUTPUT are required");
}

createWindowsInstaller({
  appDirectory,
  outputDirectory,
  name: "SDCenter",
  productName: "SD종합센터",
  version: "2.1.9",
  authors: "SDWallet",
  description: "센터 버전 표시 · 확장팩 ZIP 일괄 다운로드 · 즐겨찾기",
  exe: "SDCenter.exe",
  setupExe: "SDCenterSetup.exe",
  noMsi: true,
  setupIcon: path.join(appDirectory, "resources", "app", "public", "icons", "icon.ico"),
}).then(() => {
  console.log("Squirrel v2.1.9 build complete");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
