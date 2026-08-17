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
  version: "2.2.5",
  authors: "SDWallet",
  description: "SD지갑 코어 · 확장팩 상점 · 잠금 안전 업데이트 · SD Link 백그라운드 자동 시작",
  exe: "SDCenter.exe",
  setupExe: "SDCenterSetup.exe",
  noMsi: true,
  setupIcon: path.join(appDirectory, "resources", "app", "public", "icons", "icon.ico"),
}).then(() => {
  console.log("Squirrel v2.2.5 build complete");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
